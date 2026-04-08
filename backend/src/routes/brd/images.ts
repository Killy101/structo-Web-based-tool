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
             AND (
               LOWER(COALESCE(section, '')) = $2
               OR ((section IS NULL OR section = 'unknown') AND table_index = $3)
             )
           ORDER BY table_index ASC, row_index ASC, col_index ASC`,
          [brdId, section, fallbackIndex],
        )
      : await pool.query(
          `SELECT id, table_index as "tableIndex", row_index as "rowIndex",
                  col_index as "colIndex", rid, media_name as "mediaName",
                  mime_type as "mimeType", cell_text as "cellText",
                  section, field_label as "fieldLabel"
           FROM brd_cell_images
           WHERE brd_id = $1
           ORDER BY table_index ASC, row_index ASC, col_index ASC`,
          [brdId],
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

    res.set('Content-Type', img.mimeType || 'image/png')
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('X-Content-Type-Options', 'nosniff')
    return res.send(img.imageData)
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

    await pool.query(`DELETE FROM brd_cell_images WHERE brd_id = $1`, [brdId])

    for (const r of records) {
      const imageBytes = Buffer.from(r.imageData, 'base64')
      await pool.query(
        `INSERT INTO brd_cell_images
           (brd_id, table_index, row_index, col_index, rid, media_name, mime_type, cell_text, section, field_label, image_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [brdId, r.tableIndex, r.rowIndex, r.colIndex, r.rid, r.mediaName, r.mimeType,
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
    const { imageData, mimeType, mediaName, section, fieldLabel, cellText } = req.body

    if (!imageData || !mimeType) return res.status(400).json({ error: 'imageData and mimeType are required' })

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
       VALUES ($1, $2, 0, 0, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, media_name as "mediaName", mime_type as "mimeType",
                 section, field_label as "fieldLabel", cell_text as "cellText"`,
      [brdId, nextTableIndex, rid, mediaName ?? 'image', mimeType, cellText ?? '',
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

    await pool.query(`DELETE FROM brd_cell_images WHERE id = $1`, [imageId])
    return res.json({ success: true })
  } catch (err) {
    console.log('[DELETE /brd/:brdId/images/:imageId]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
