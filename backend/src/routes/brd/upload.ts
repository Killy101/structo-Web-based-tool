// routes/brd/upload.ts
import { Router, Request, Response } from 'express'
import multer from 'multer'
import FormData from 'form-data'
import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'
import pool from '../../lib/db'
import { withTransaction } from '../../lib/db'
import { uploadLimiter, processingLimiter } from '../../middleware/rateLimits'
import { requireBrdCreate, requireBrdEdit } from '../../middleware/brd-access'
import { notifyMany } from '../../lib/notify'

const router = Router()

const PROCESSING_URL = process.env.PROCESSING_URL ?? 'http://localhost:8000'

const upload = multer({
  dest: path.join(process.cwd(), 'tmp', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(_, file, cb) {
    const allowed = ['.pdf', '.doc', '.docx']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) cb(null, true)
    else cb(new Error('Only PDF, DOC, DOCX files are allowed'))
  },
})

interface FormatFingerprint {
  extension: string
  container: string
  template: string
  label: string
}

interface ProcessingWarning {
  code: string
  severity: string
  message: string
}

interface ProcessingDiagnostics {
  summary?: Record<string, unknown>
  warnings?: ProcessingWarning[]
}

interface ProcessingResult {
  filename:           string
  char_count:         number
  detected_format?:   string   // "new" | "old" — auto-detected by Python
  scope:              Record<string, unknown>
  metadata:           Record<string, unknown>
  toc:                Record<string, unknown>
  citations:          Record<string, unknown>
  content_profile?:   Record<string, unknown>
  contentProfile?:    Record<string, unknown>
  brd_config?:        Record<string, unknown>
  brdConfig?:         Record<string, unknown>
  image_metadata?:    ImageMeta[]
  diagnostics?:       ProcessingDiagnostics
  format_fingerprint?: FormatFingerprint
  formatFingerprint?:  FormatFingerprint
}

interface ImageMeta {
  tableIndex: number
  rowIndex:   number
  colIndex:   number
  rid:        string
  mediaName:  string
  mimeType:   string
  cellText:   string
  section?:   string // "metadata" | "scope" | "toc" | "citations" | "unknown"
  fieldLabel?: string
  imageData:  string // base64 encoded
}

function stripQuotes(s: string): string {
  return s
    .trim()
    .replace(/^["\u201c\u201d\u2018\u2019]+|["\u201c\u201d\u2018\u2019]+$/g, '')
    .trim()
}

const BOILERPLATE_TITLES = new Set([
  'structuring requirements', 'content structure', 'formatting requirements',
  'document structure', 'template instructions', 'instructions', 'overview',
  'introduction', 'background', 'purpose', 'scope', 'document history',
  'glossary', 'file delivery', 'system display', 'citation visualization',
  'legal', 'copyright',
])

function isBoilerplate(title: string): boolean {
  const t = title.trim().toLowerCase()
  return BOILERPLATE_TITLES.has(t) || [...BOILERPLATE_TITLES].some(b => t.includes(b))
}

function buildTitle(meta: Record<string, string>, originalName: string): string {
  const categoryName  = stripQuotes(meta.content_category_name ?? '')
  const documentTitle = stripQuotes(meta.document_title        ?? '')
  const issuingAgency = stripQuotes(meta.issuing_agency        ?? '')

  let rawTitle = ''

  if (categoryName && documentTitle && !isBoilerplate(documentTitle)) {
    const catLower = categoryName.toLowerCase()
    const docLower = documentTitle.toLowerCase()
    const isRedundant = catLower === docLower || catLower.includes(docLower) || docLower.includes(catLower)
    if (isRedundant) {
      rawTitle = categoryName.length >= documentTitle.length ? categoryName : documentTitle
    } else {
      rawTitle = `${categoryName} - ${documentTitle}`
    }
  } else if (categoryName) {
    rawTitle = categoryName
  } else if (documentTitle) {
    rawTitle = documentTitle
  } else if (issuingAgency) {
    rawTitle = issuingAgency
  } else {
    rawTitle = originalName
      .replace(/\.(pdf|doc|docx)$/i, '')
      .replace(/_{2,}/g, ' ')
      .replace(/_/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  return rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1)
}

router.post(
  '/upload',
  requireBrdCreate,
  uploadLimiter,
  upload.single('file'),
  async (req: Request, res: Response) => {
    const file = req.file

    if (!file) return res.status(400).json({ error: 'No file uploaded' })

    try {
      // ── 1. Generate BRD ID — use MAX numeric suffix to avoid collisions ──
      const { rows: allBrds } = await pool.query(`SELECT brd_id FROM brds`)
      const maxNum = (allBrds as Array<{ brd_id: string }>).reduce((max, { brd_id }) => {
        const n = parseInt(brd_id.replace('BRD-', ''), 10)
        return isNaN(n) ? max : Math.max(max, n)
      }, 0)
      const brdId = `BRD-${String(maxNum + 1).padStart(3, '0')}`

      console.log('\n' + '='.repeat(80))
      console.log('UPLOAD PROCESS STARTED')
      console.log('='.repeat(80))
      console.log(`File: ${file.originalname}`)
      console.log(`Generated BRD ID: ${brdId}`)
      console.log(`Processing URL: ${PROCESSING_URL}`)

      // ── 2. Forward to Python processor ───────────────────────────────────
      const form = new FormData()
      form.append('file', fs.createReadStream(file.path), {
        filename: file.originalname,
        contentType: file.mimetype,
      })

      const processUrl = `${PROCESSING_URL}/process?brd_id=${encodeURIComponent(brdId)}`
      const pyRes = await fetch(processUrl, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
      })

      if (!pyRes.ok) {
        const errText = await pyRes.text()
        throw new Error(`Processing service error [${pyRes.status}]: ${errText}`)
      }

      const extracted = (await pyRes.json()) as ProcessingResult
      console.log(`Processing successful! Images extracted: ${extracted.image_metadata?.length || 0}`)

      // ── 3. Prepare section data ───────────────────────────────────────────
      const meta = (extracted.metadata ?? {}) as Record<string, string>
      const title = buildTitle(meta, file.originalname)
      const detectedFormat = extracted.detected_format === 'old' ? 'old' : 'new'

      // Strip runtime-only fields from brdConfig before storing
      const rawBrdConfig = extracted.brd_config || extracted.brdConfig || null
      let cleanBrdConfig: Record<string, unknown> | null = null
      if (rawBrdConfig && typeof rawBrdConfig === 'object' && !Array.isArray(rawBrdConfig)) {
        const { pathTransform, path_transform, levelPatterns, level_patterns, ...rest } = rawBrdConfig as Record<string, unknown>
        void pathTransform; void path_transform; void levelPatterns; void level_patterns
        cleanBrdConfig = rest
      }

      const extractedContentProfile = extracted.content_profile ?? extracted.contentProfile ?? null

      // ── 4. Persist everything in a transaction ────────────────────────────
      await withTransaction(async (client) => {
        // Create or update BRD record
        const creatorId = (req as any).user?.userId ?? 1
        await client.query(
          `INSERT INTO brds (brd_id, title, format, status, created_by_id)
           VALUES ($1, $2, $3, 'DRAFT', $4)
           ON CONFLICT (brd_id) DO UPDATE SET title = $2, format = $3`,
          [brdId, title, detectedFormat === 'old' ? 'OLD' : 'NEW', creatorId],
        )

        // Store all sections as JSONB directly
        await client.query(
          `INSERT INTO brd_sections (brd_id, scope, metadata, toc, citations, content_profile, brd_config)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (brd_id) DO UPDATE
             SET scope = $2, metadata = $3, toc = $4, citations = $5,
                 content_profile = $6, brd_config = $7, updated_at = NOW()`,
          [
            brdId,
            JSON.stringify(extracted.scope ?? null),
            JSON.stringify(extracted.metadata ?? null),
            JSON.stringify(extracted.toc ?? null),
            JSON.stringify(extracted.citations ?? null),
            JSON.stringify(extractedContentProfile),
            JSON.stringify(cleanBrdConfig),
          ],
        )

        // Soft-delete active images so previous versions remain immutable.
        await client.query(`UPDATE brd_cell_images SET deleted_at = NOW() WHERE brd_id = $1 AND deleted_at IS NULL`, [brdId])

        const revisionTag = Date.now().toString(36)
        for (let i = 0; i < (extracted.image_metadata ?? []).length; i++) {
          const img = extracted.image_metadata![i]
          const imageBytes = Buffer.from(img.imageData, 'base64')
          const snapshotRid = `${img.rid || 'img'}-rev-${revisionTag}-${i}`
          await client.query(
            `INSERT INTO brd_cell_images
               (brd_id, table_index, row_index, col_index, rid, media_name, mime_type, cell_text, section, field_label, image_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [brdId, img.tableIndex, img.rowIndex, img.colIndex, snapshotRid, img.mediaName, img.mimeType, img.cellText || '', img.section ?? 'unknown', img.fieldLabel ?? '', imageBytes],
          )
        }
      })

      console.log('='.repeat(80) + '\n')

      // ── 5. Notify SUPER_ADMIN users ───────────────────────────────────────
      try {
        const { rows: superAdmins } = await pool.query(
          `SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'`,
        )
        await notifyMany(
          superAdmins.map((u: any) => u.id),
          'BRD_STATUS',
          'BRD Source Uploaded',
          `"${title}" (${brdId}) was uploaded and processed successfully`,
          { brdId },
        )
      } catch (notifyErr) {
        console.warn('Failed to send BRD upload notification:', notifyErr)
      }

      // ── 6. Return extracted data (strip binary imageData from response) ───
      const responseImageMetadata = extracted.image_metadata?.map(({ imageData, ...rest }) => rest) || []

      return res.json({
        brdId,
        title,
        status: 'DRAFT',
        format: detectedFormat,
        filename: extracted.filename,
        scope: extracted.scope,
        metadata: extracted.metadata,
        toc: extracted.toc,
        citations: extracted.citations,
        contentProfile: extractedContentProfile,
        brdConfig: cleanBrdConfig,
        imageMetadata: responseImageMetadata,
        diagnostics: extracted.diagnostics ?? null,
        formatFingerprint: extracted.format_fingerprint ?? extracted.formatFingerprint ?? null,
      })

    } catch (err) {
      console.log('\nUpload error:', err)
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Upload processing failed',
      })
    } finally {
      if (file?.path) {
        fs.unlink(file.path, (err) => {
          if (err) console.warn(`Failed to clean up temp file ${file.path}:`, err)
        })
      }
    }
  },
)

// ── POST /brd/re-upload/:brdId — replace sections for an existing BRD ────────
router.post(
  '/re-upload/:brdId',
  requireBrdEdit,
  processingLimiter,
  upload.single('file'),
  async (req: Request, res: Response) => {
    const file  = req.file
    const brdId = String(req.params.brdId)

    if (!file) return res.status(400).json({ error: 'No file uploaded' })

    try {
      // Confirm BRD exists and is not deleted
      const { rows } = await pool.query(
        `SELECT brd_id, status, deleted_at FROM brds WHERE brd_id = $1`,
        [brdId],
      )
      if (!rows[0] || rows[0].deleted_at !== null) {
        return res.status(404).json({ error: 'BRD not found' })
      }
      const currentStatus: string = rows[0].status ?? 'DRAFT'

      // Fetch existing sections as fallback
      const { rows: existingRows } = await pool.query(
        `SELECT scope, metadata, toc, citations, content_profile, brd_config
         FROM brd_sections WHERE brd_id = $1`,
        [brdId],
      )
      const existing = existingRows[0] ?? {}

      // Forward to Python processor
      const form = new FormData()
      form.append('file', fs.createReadStream(file.path), {
        filename: file.originalname,
        contentType: file.mimetype,
      })

      const pyRes = await fetch(
        `${PROCESSING_URL}/process?brd_id=${encodeURIComponent(brdId)}`,
        { method: 'POST', body: form, headers: form.getHeaders() },
      )

      if (!pyRes.ok) {
        const errText = (await pyRes.text()).slice(0, 500)
        throw new Error(`Processing service error [${pyRes.status}]: ${errText}`)
      }

      const extracted = (await pyRes.json()) as ProcessingResult

      // Use extracted value if present, otherwise fall back to existing DB value
      const newScope     = extracted.scope     !== undefined && extracted.scope     !== null ? JSON.stringify(extracted.scope)     : (existing.scope     ?? null)
      const newMetadata  = extracted.metadata  !== undefined && extracted.metadata  !== null ? JSON.stringify(extracted.metadata)  : (existing.metadata  ?? null)
      const newToc       = extracted.toc       !== undefined && extracted.toc       !== null ? JSON.stringify(extracted.toc)       : (existing.toc       ?? null)
      const newCitations = extracted.citations !== undefined && extracted.citations !== null ? JSON.stringify(extracted.citations) : (existing.citations  ?? null)

      const extractedContentProfile = extracted.content_profile ?? extracted.contentProfile
      const newContentProfile = extractedContentProfile !== undefined && extractedContentProfile !== null
        ? JSON.stringify(extractedContentProfile) : (existing.content_profile ?? null)

      const extractedBrdConfig = extracted.brd_config || extracted.brdConfig
      const newBrdConfig = extractedBrdConfig !== undefined && extractedBrdConfig !== null
        ? JSON.stringify(extractedBrdConfig) : (existing.brd_config ?? null)

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO brd_sections (brd_id, scope, metadata, toc, citations, content_profile, brd_config)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (brd_id) DO UPDATE
             SET scope = $2, metadata = $3, toc = $4, citations = $5,
                 content_profile = $6, brd_config = $7, updated_at = NOW()`,
          [brdId, newScope, newMetadata, newToc, newCitations, newContentProfile, newBrdConfig],
        )

        await client.query(`UPDATE brd_cell_images SET deleted_at = NOW() WHERE brd_id = $1 AND deleted_at IS NULL`, [brdId])
        const revisionTag = Date.now().toString(36)
        for (let i = 0; i < (extracted.image_metadata ?? []).length; i++) {
          const img = extracted.image_metadata![i]
          const imageBytes = Buffer.from(img.imageData, 'base64')
          const snapshotRid = `${img.rid || 'img'}-rev-${revisionTag}-${i}`
          await client.query(
            `INSERT INTO brd_cell_images
               (brd_id, table_index, row_index, col_index, rid, media_name, mime_type, cell_text, section, field_label, image_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [brdId, img.tableIndex, img.rowIndex, img.colIndex, snapshotRid, img.mediaName, img.mimeType, img.cellText || '', img.section ?? 'unknown', img.fieldLabel ?? '', imageBytes],
          )
        }
      })

      const responseImageMetadata = extracted.image_metadata?.map(({ imageData, ...rest }) => rest) || []

      return res.json({
        brdId,
        status:         currentStatus,
        format:         extracted.detected_format === 'old' ? 'old' : 'new',
        scope:          extracted.scope,
        metadata:       extracted.metadata,
        toc:            extracted.toc,
        citations:      extracted.citations,
        contentProfile: extractedContentProfile,
        brdConfig:      extractedBrdConfig ?? null,
        imageMetadata:  responseImageMetadata,
        diagnostics:    extracted.diagnostics ?? null,
        formatFingerprint: extracted.format_fingerprint ?? extracted.formatFingerprint ?? null,
      })
    } catch (err) {
      console.log('[POST /brd/re-upload/:brdId]', err)
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Re-upload failed' })
    } finally {
      if (file?.path) fs.unlink(file.path, () => {})
    }
  },
)

export default router
