// routes/brd/versions.ts
// Handles BRD version snapshots — section JSON stored directly as JSONB.
//
// GET    /brd/:brdId/versions              — list all versions (summary)
// GET    /brd/:brdId/versions/:versionNum  — fetch one version's full section data
// POST   /brd/:brdId/versions              — create a new version snapshot
// DELETE /brd/:brdId/versions/:versionNum  — delete a specific version

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

// ── GET /brd/:brdId/versions ──────────────────────────────────────────────────
router.get('/:brdId/versions', async (req: AuthRequest, res: Response) => {
  try {
    if (!(await ensureReadableBrd(req, res))) return

    const { rows: versions } = await pool.query(
      `SELECT id, brd_id as "brdId", version_num as "versionNum", label,
              saved_at as "savedAt"
       FROM brd_versions
       WHERE brd_id = $1
       ORDER BY version_num DESC`,
      [String(req.params.brdId)],
    )

    return res.json({ versions })
  } catch (err) {
    console.error('[GET /brd/:brdId/versions]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /brd/:brdId/versions/:versionNum ─────────────────────────────────────
router.get('/:brdId/versions/:versionNum', async (req: AuthRequest, res: Response) => {
  try {
    if (!(await ensureReadableBrd(req, res))) return

    const brdId      = String(req.params.brdId)
    const versionNum = parseInt(String(req.params.versionNum), 10)
    if (isNaN(versionNum)) return res.status(400).json({ error: 'Invalid versionNum' })

    const { rows } = await pool.query(
      `SELECT id, brd_id as "brdId", version_num as "versionNum", label, saved_at as "savedAt",
              scope, metadata, toc, citations,
              content_profile as "contentProfile",
              brd_config as "brdConfig"
       FROM brd_versions
       WHERE brd_id = $1 AND version_num = $2`,
      [brdId, versionNum],
    )
    const version = rows[0]
    if (!version) return res.status(404).json({ error: 'Version not found' })

    return res.json({
      id:             version.id,
      brdId:          version.brdId,
      versionNum:     version.versionNum,
      label:          version.label,
      savedAt:        version.savedAt,
      scope:          version.scope          ?? null,
      metadata:       version.metadata       ?? null,
      toc:            version.toc            ?? null,
      citations:      version.citations      ?? null,
      contentProfile: version.contentProfile ?? null,
      brdConfig:      version.brdConfig      ?? null,
    })
  } catch (err) {
    console.error('[GET /brd/:brdId/versions/:versionNum]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /brd/:brdId/versions ─────────────────────────────────────────────────
router.post('/:brdId/versions', requireBrdEdit, async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId)
    const { scope, metadata, toc, citations, contentProfile, brdConfig, label } = req.body

    const { rows: latestRows } = await pool.query(
      `SELECT version_num FROM brd_versions WHERE brd_id = $1 ORDER BY version_num DESC LIMIT 1`,
      [brdId],
    )
    const nextNum = (latestRows[0]?.version_num ?? 0) + 1
    const vLabel  = label || `v${nextNum}.0`

    try {
      const { rows: created } = await pool.query(
        `INSERT INTO brd_versions
           (brd_id, version_num, label, scope, metadata, toc, citations, content_profile, brd_config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, brd_id as "brdId", version_num as "versionNum", label, saved_at as "savedAt"`,
        [
          brdId, nextNum, vLabel,
          JSON.stringify(scope          ?? null),
          JSON.stringify(metadata       ?? null),
          JSON.stringify(toc            ?? null),
          JSON.stringify(citations      ?? null),
          JSON.stringify(contentProfile ?? null),
          JSON.stringify(brdConfig      ?? null),
        ],
      )
      const version = created[0]
      return res.status(201).json({
        id:         version.id,
        brdId:      version.brdId,
        versionNum: version.versionNum,
        label:      version.label,
        savedAt:    version.savedAt,
      })
    } catch (createErr: any) {
      // unique constraint violation — another request beat us to it
      if (createErr?.code === '23505') {
        const { rows: existing } = await pool.query(
          `SELECT id, brd_id as "brdId", version_num as "versionNum", label, saved_at as "savedAt"
           FROM brd_versions WHERE brd_id = $1 ORDER BY version_num DESC LIMIT 1`,
          [brdId],
        )
        if (existing[0]) return res.status(200).json(existing[0])
      }
      throw createErr
    }
  } catch (err) {
    console.error('[POST /brd/:brdId/versions]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── DELETE /brd/:brdId/versions/:versionNum ───────────────────────────────────
router.delete('/:brdId/versions/:versionNum', requireBrdEdit, async (req: Request, res: Response) => {
  try {
    const brdId      = String(req.params.brdId)
    const versionNum = parseInt(String(req.params.versionNum), 10)
    if (isNaN(versionNum)) return res.status(400).json({ error: 'Invalid versionNum' })

    const { rows } = await pool.query(
      `SELECT id FROM brd_versions WHERE brd_id = $1 AND version_num = $2`,
      [brdId, versionNum],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Version not found' })

    await pool.query(`DELETE FROM brd_versions WHERE id = $1`, [rows[0].id])
    return res.json({ success: true })
  } catch (err) {
    console.error('[DELETE /brd/:brdId/versions/:versionNum]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
