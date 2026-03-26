// routes/brd/sections.ts
// GET  /brd/:brdId/sections        — returns all section blobs at once
// GET  /brd/:brdId/sections/:name  — returns one blob
// PUT  /brd/:brdId/sections/:name  — replaces one blob

import { Router, Request, Response } from 'express'
import pool from '../../lib/db'
import { AuthRequest } from '../../middleware/authenticate'
import { canReadBrdStatus, getBrdAccessPolicy, requireBrdEdit } from '../../middleware/brd-access'

const router = Router()

type SectionName = 'scope' | 'metadata' | 'toc' | 'citations' | 'contentProfile' | 'brdConfig' | 'innodMetajson' | 'simpleMetajson'

const VALID_SECTIONS: SectionName[] = ['scope', 'metadata', 'toc', 'citations', 'contentProfile', 'brdConfig', 'innodMetajson', 'simpleMetajson']

// Map camelCase section names to snake_case DB columns
const COLUMN_MAP: Record<SectionName, string> = {
  scope: 'scope', metadata: 'metadata', toc: 'toc', citations: 'citations',
  contentProfile: 'content_profile', brdConfig: 'brd_config',
  innodMetajson: 'innod_metajson', simpleMetajson: 'simple_metajson',
}

function isValidSection(name: string): name is SectionName {
  return VALID_SECTIONS.includes(name as SectionName)
}

async function ensureReadableBrd(req: AuthRequest, res: Response): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT status, deleted_at FROM brds WHERE brd_id = $1`,
    [String(req.params.brdId)],
  )
  if (!rows[0] || rows[0].deleted_at !== null) {
    res.status(404).json({ error: 'BRD not found' })
    return false
  }
  const accessPolicy = getBrdAccessPolicy(res)
  if (!canReadBrdStatus(accessPolicy, rows[0].status)) {
    res.status(403).json({ error: 'You can only view BRDs with APPROVED or ON_HOLD status.' })
    return false
  }
  return true
}

router.get('/:brdId/sections', async (req: AuthRequest, res: Response) => {
  try {
    if (!(await ensureReadableBrd(req, res))) return
    const { rows } = await pool.query(
      `SELECT scope, metadata, toc, citations, content_profile as "contentProfile",
              brd_config as "brdConfig", innod_metajson as "innodMetajson",
              simple_metajson as "simpleMetajson"
       FROM brd_sections WHERE brd_id = $1`,
      [String(req.params.brdId)],
    )
    if (!rows[0]) {
      return res.json({ scope: null, metadata: null, toc: null, citations: null, contentProfile: null, brdConfig: null, innodMetajson: null, simpleMetajson: null })
    }
    return res.json(rows[0])
  } catch (err) {
    console.error('[GET /brd/:brdId/sections]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:brdId/sections/:name', async (req: AuthRequest, res: Response) => {
  const name = String(req.params.name)
  if (!isValidSection(name)) return res.status(400).json({ error: `Unknown section: ${name}. Valid: ${VALID_SECTIONS.join(', ')}` })
  try {
    if (!(await ensureReadableBrd(req, res))) return
    const col = COLUMN_MAP[name]
    const { rows } = await pool.query(
      `SELECT ${col} as value FROM brd_sections WHERE brd_id = $1`,
      [String(req.params.brdId)],
    )
    return res.json({ [name]: rows[0]?.value ?? null })
  } catch (err) {
    console.error(`[GET /brd/:brdId/sections/${name}]`, err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/:brdId/sections/:name', requireBrdEdit, async (req: Request, res: Response) => {
  const name  = String(req.params.name)
  const brdId = String(req.params.brdId)
  if (!isValidSection(name)) return res.status(400).json({ error: `Unknown section: ${name}` })

  const { data } = req.body
  if (data === undefined) return res.status(400).json({ error: 'Request body must contain { data: ... }' })

  try {
    const { rows } = await pool.query(`SELECT deleted_at FROM brds WHERE brd_id = $1`, [brdId])
    if (!rows[0] || rows[0].deleted_at !== null) return res.status(404).json({ error: 'BRD not found' })

    const col = COLUMN_MAP[name]
    await pool.query(
      `INSERT INTO brd_sections (brd_id, ${col})
       VALUES ($1, $2)
       ON CONFLICT (brd_id) DO UPDATE SET ${col} = $2, updated_at = NOW()`,
      [brdId, JSON.stringify(data)],
    )
    return res.json({ success: true, brdId, section: name })
  } catch (err) {
    console.error(`[PUT /brd/:brdId/sections/${name}]`, err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
