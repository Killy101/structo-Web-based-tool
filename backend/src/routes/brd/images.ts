// routes/brd/images.ts
// Stores image binaries as BYTEA in the brd_cell_images.image_data column.

import { Router, Request, Response } from 'express'
import pool from '../../lib/db'
import { AuthRequest } from '../../middleware/authenticate'
import {
  canReadBrdStatus,
  getBrdAccessPolicy,
  requireBrdEdit,
} from '../../middleware/brd-access'

const router = Router()

// ── MIME type helpers ────────────────────────────────────────────────────────

/** Browser-renderable image MIME types. */
const BROWSER_IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/bmp',
  'image/webp', 'image/svg+xml', 'image/tiff', 'image/avif',
])

/**
 * Detect a browser-renderable MIME type from the first few bytes of binary
 * image data (magic numbers).  Returns null if the format is unrecognised or
 * cannot be rendered in a browser.
 */
function detectMimeFromBytes(buf: Buffer): string | null {
  if (buf.length < 4) return null

  // PNG:  89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png'

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg'

  // GIF:  47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'

  // BMP:  42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4D) return 'image/bmp'

  // WEBP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'

  // TIFF: 49 49 2A 00 (little-endian) or 4D 4D 00 2A (big-endian)
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2A && buf[3] === 0x00) ||
      (buf[0] === 0x4D && buf[1] === 0x4D && buf[2] === 0x00 && buf[3] === 0x2A)) return 'image/tiff'

  return null
}

/**
 * Resolve the final MIME type for a stored image.  If the stored type is
 * already a browser-renderable image type, return it unchanged.  Otherwise
 * fall back to magic-byte detection so that images uploaded before the MIME-
 * type fix can still be served correctly.
 */
function resolveImageMime(storedMime: string | undefined, data: Buffer): string {
  if (storedMime && BROWSER_IMAGE_MIMES.has(storedMime)) return storedMime
  return detectMimeFromBytes(data) ?? storedMime ?? 'application/octet-stream'
}

// ────────────────────────────────────────────────────────────────────────────

async function ensureReadableBrd(req: AuthRequest, res: Response): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT status, deleted_at FROM brds WHERE brd_id = $1`,
    [String(req.params.brdId)],
  )
  const brd = rows[0]
  if (!brd || brd.deleted_at !== null) {
    res.status(404).json({ error: 'BRD not found' })
    return false
  }
  const accessPolicy = getBrdAccessPolicy(res)
  if (!canReadBrdStatus(accessPolicy, brd.status)) {
    res.status(403).json({ error: 'You can only view BRDs with APPROVED or ON_HOLD status.' })
    return false
  }
  return true
}

// ── GET /brd/:brdId/images ─────────────────────────────────────────────────
// Returns image metadata (no binary data)
router.get('/:brdId/images', async (req: AuthRequest, res: Response) => {
  try {
    if (!(await ensureReadableBrd(req, res))) return

    const section = String(req.query.section ?? '').trim().toLowerCase()
    const includeIdsRaw = String(req.query.includeIds ?? '').trim()
    const includeIds = includeIdsRaw
      ? includeIdsRaw.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
      : []
    const legacyFallbackTableIndex: Record<string, number> = {
      toc: 2,
      scope: 3,
      citations: 4,
      metadata: 5,
      contentprofile: 6,
    }

    const brdId = String(req.params.brdId)
    const fallbackIndex = legacyFallbackTableIndex[section]
    const { rows: images } = section && Number.isFinite(fallbackIndex)
      ? await pool.query(
          `SELECT id, table_index as "tableIndex", row_index as "rowIndex",
                  col_index as "colIndex", rid, media_name as "mediaName",
                  mime_type as "mimeType", cell_text as "cellText",
                  section, field_label as "fieldLabel"
           FROM brd_cell_images
           WHERE brd_id = $1
             AND (deleted_at IS NULL OR id = ANY($4::int[]))
             AND (
               LOWER(COALESCE(section, '')) = $2
               OR ((section IS NULL OR section = 'unknown') AND table_index = $3)
             )
           ORDER BY table_index ASC, row_index ASC, col_index ASC`,
          [brdId, section, fallbackIndex, includeIds],
        )
      : await pool.query(
          `SELECT id, table_index as "tableIndex", row_index as "rowIndex",
                  col_index as "colIndex", rid, media_name as "mediaName",
                  mime_type as "mimeType", cell_text as "cellText",
                  section, field_label as "fieldLabel"
           FROM brd_cell_images
           WHERE brd_id = $1
             AND (deleted_at IS NULL OR id = ANY($2::int[]))
           ORDER BY table_index ASC, row_index ASC, col_index ASC`,
          [brdId, includeIds],
        )

    return res.json({ images })
  } catch (err) {
    console.log('[GET /brd/:brdId/images]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /brd/:brdId/images/:imageId/blob ──────────────────────────────────
// Serves raw image bytes from the image_data BYTEA column
router.get('/:brdId/images/:imageId/blob', async (req: AuthRequest, res: Response) => {
  try {
    if (!(await ensureReadableBrd(req, res))) return

    const imageId = Number(req.params.imageId)
    if (isNaN(imageId)) return res.status(400).json({ error: 'Invalid imageId' })

    const { rows } = await pool.query(
      `SELECT image_data as "imageData", mime_type as "mimeType", brd_id as "brdId"
       FROM brd_cell_images WHERE id = $1`,
      [imageId],
    )
    const img = rows[0]
    if (!img) return res.status(404).json({ error: 'Image not found' })
    if (img.brdId !== String(req.params.brdId)) return res.status(404).json({ error: 'Image not found' })
    if (!img.imageData) return res.status(404).json({ error: 'No image data stored' })

    const imageBuffer = Buffer.isBuffer(img.imageData)
      ? img.imageData
      : Buffer.from(img.imageData)
    const mimeType = resolveImageMime(img.mimeType, imageBuffer)
    res.set('Content-Type', mimeType)
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('X-Content-Type-Options', 'nosniff')
    return res.send(imageBuffer)
  } catch (err) {
    console.log('[GET /brd/:brdId/images/:imageId/blob]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /brd/:brdId/images ───────────────────────────────────────────────────
// Replaces all images for a BRD with fresh records (destructive).
router.post('/:brdId/images', requireBrdEdit, async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId)
    const records: Array<{
      tableIndex: number
      rowIndex:   number
      colIndex:   number
      rid:        string
      mediaName:  string
      mimeType:   string
      cellText:   string
      section:    string
      fieldLabel: string
      imageData:  string // base64
    }> = req.body.images

    if (!Array.isArray(records)) return res.status(400).json({ error: 'images must be an array' })

    await pool.query(`UPDATE brd_cell_images SET deleted_at = NOW() WHERE brd_id = $1 AND deleted_at IS NULL`, [brdId])
    const revisionTag = Date.now().toString(36)

    for (let i = 0; i < records.length; i++) {
      const r = records[i]
      const imageBytes = Buffer.from(r.imageData, 'base64')
      const snapshotRid = `${r.rid || 'img'}-rev-${revisionTag}-${i}`
      await pool.query(
        `INSERT INTO brd_cell_images
           (brd_id, table_index, row_index, col_index, rid, media_name, mime_type, cell_text, section, field_label, image_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [brdId, r.tableIndex, r.rowIndex, r.colIndex, snapshotRid, r.mediaName, r.mimeType,
         r.cellText ?? '', r.section ?? 'unknown', r.fieldLabel ?? '', imageBytes],
      )
    }

    return res.json({ saved: records.length })
  } catch (err) {
    console.log('[POST /brd/:brdId/images]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /brd/:brdId/images/upload ───────────────────────────────────────────
// Non-destructive single-image insert used by the manual "Add Image" UI.
router.post('/:brdId/images/upload', requireBrdEdit, async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId)
    const { imageData, mimeType, mediaName, section, fieldLabel, cellText, rowIndex, colIndex } = req.body

    if (!imageData || !mimeType) return res.status(400).json({ error: 'imageData and mimeType are required' })

    const parsedRowIndex = Number(rowIndex)
    const parsedColIndex = Number(colIndex)
    const safeRowIndex = Number.isFinite(parsedRowIndex) ? parsedRowIndex : 0
    const safeColIndex = Number.isFinite(parsedColIndex) ? parsedColIndex : 0

    const { rows: existing } = await pool.query(
      `SELECT table_index FROM brd_cell_images WHERE brd_id = $1 ORDER BY table_index DESC LIMIT 1`,
      [brdId],
    )
    const nextTableIndex = (existing[0]?.table_index ?? -1) + 1
    const imageBytes = Buffer.from(imageData, 'base64')
    const rid = `manual-${Date.now()}`

    const { rows: created } = await pool.query(
      `INSERT INTO brd_cell_images
         (brd_id, table_index, row_index, col_index, rid, media_name, mime_type, cell_text, section, field_label, image_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, media_name as "mediaName", mime_type as "mimeType",
                 section, field_label as "fieldLabel", cell_text as "cellText"`,
      [brdId, nextTableIndex, safeRowIndex, safeColIndex, rid, mediaName ?? 'image', mimeType, cellText ?? '',
       section ?? 'unknown', fieldLabel ?? '', imageBytes],
    )

    return res.json({ success: true, image: created[0] })
  } catch (err) {
    console.log('[POST /brd/:brdId/images/upload]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── DELETE /brd/:brdId/images/:imageId ───────────────────────────────────────
router.delete('/:brdId/images/:imageId', requireBrdEdit, async (req: Request, res: Response) => {
  try {
    const brdId   = String(req.params.brdId)
    const imageId = Number(req.params.imageId)
    if (isNaN(imageId)) return res.status(400).json({ error: 'Invalid imageId' })

    const { rows } = await pool.query(
      `SELECT brd_id FROM brd_cell_images WHERE id = $1`,
      [imageId],
    )
    if (!rows[0] || rows[0].brd_id !== brdId) return res.status(404).json({ error: 'Image not found' })

    await pool.query(`UPDATE brd_cell_images SET deleted_at = NOW() WHERE id = $1`, [imageId])
    return res.json({ success: true })
  } catch (err) {
    console.log('[DELETE /brd/:brdId/images/:imageId]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
