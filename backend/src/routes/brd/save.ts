// routes/brd/save.ts
import { Router, Request, Response } from 'express'
import pool from '../../lib/db'
import { requireBrdCreate } from '../../middleware/brd-access'

const router = Router()

const VALID_STATUSES = ['DRAFT', 'PAUSED', 'COMPLETED', 'APPROVED', 'ON_HOLD']
const VALID_FORMATS  = ['NEW', 'OLD']

function normalizeBrdStatus(status: unknown): string {
  const upper = String(status ?? 'DRAFT').toUpperCase()
  return upper === 'ONGOING' ? 'DRAFT' : upper
}

/**
 * Strip re-derivable fields from brdConfig before storing.
 * pathTransform and levelPatterns are always re-computed at generate time.
 */
function sanitizeBrdConfig(config: unknown): unknown {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  const c = { ...(config as Record<string, unknown>) }
  delete c.pathTransform
  delete c.path_transform
  delete c.levelPatterns
  delete c.level_patterns
  return c
}

// ── POST /brd/save ─────────────────────────────────────────────────────────
router.post('/save', requireBrdCreate, async (req: Request, res: Response) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        error: 'Request body is missing or not JSON.',
        hint:  'Set Content-Type: application/json and send a JSON body.',
      })
    }

    const {
      brdId,
      title,
      format         = 'NEW',
      status         = 'DRAFT',
      scope,
      metadata,
      toc,
      citations,
      contentProfile,
      brdConfig,
    } = req.body

    if (!brdId || !title) return res.status(400).json({ error: 'brdId and title are required' })

    const dbFormat = String(format).toUpperCase()
    const dbStatus = normalizeBrdStatus(status)

    if (!VALID_FORMATS.includes(dbFormat)) {
      return res.status(400).json({ error: `Invalid format: "${format}". Must be NEW or OLD.` })
    }
    if (!VALID_STATUSES.includes(dbStatus)) {
      return res.status(400).json({ error: `Invalid status: "${status}". Must be one of: ${VALID_STATUSES.join(', ')}` })
    }

    // Resolve createdById — find first existing user
    let createdById = 1
    try {
      const { rows } = await pool.query(`SELECT id FROM users LIMIT 1`)
      if (rows[0]) createdById = rows[0].id
    } catch { /* ignore */ }

    // Upsert the BRD record
    await pool.query(
      `INSERT INTO brds (brd_id, title, format, status, created_by_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (brd_id) DO UPDATE SET title = $2, format = $3, status = $4, updated_at = NOW()`,
      [brdId, title, dbFormat, dbStatus, createdById],
    )

    const sanitizedBrdConfig = sanitizeBrdConfig(brdConfig)

    // Build UPDATE set for partial saves (undefined = not sent = don't touch)
    const sets: string[] = ['updated_at = NOW()']
    const params: unknown[] = [brdId]
    let idx = 2

    if (scope          !== undefined) { sets.push(`scope = $${idx++}`);           params.push(JSON.stringify(scope ?? null)) }
    if (metadata       !== undefined) { sets.push(`metadata = $${idx++}`);        params.push(JSON.stringify(metadata ?? null)) }
    if (toc            !== undefined) { sets.push(`toc = $${idx++}`);             params.push(JSON.stringify(toc ?? null)) }
    if (citations      !== undefined) { sets.push(`citations = $${idx++}`);       params.push(JSON.stringify(citations ?? null)) }
    if (contentProfile !== undefined) { sets.push(`content_profile = $${idx++}`); params.push(JSON.stringify(contentProfile ?? null)) }
    if (brdConfig      !== undefined) { sets.push(`brd_config = $${idx++}`);      params.push(JSON.stringify(sanitizedBrdConfig ?? null)) }

    // Upsert brd_sections — create row if missing, then update changed columns
    await pool.query(
      `INSERT INTO brd_sections (brd_id) VALUES ($1) ON CONFLICT (brd_id) DO NOTHING`,
      [brdId],
    )

    if (sets.length > 1) {
      await pool.query(
        `UPDATE brd_sections SET ${sets.join(', ')} WHERE brd_id = $1`,
        params,
      )
    }

    return res.json({ success: true, brdId, status: dbStatus })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /brd/save]', message)
    return res.status(500).json({ error: message })
  }
})

export default router
