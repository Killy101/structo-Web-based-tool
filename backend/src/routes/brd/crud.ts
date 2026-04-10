// routes/brd/crud.ts
import { Router, Request, Response } from 'express'
import pool from '../../lib/db'
import { AuthRequest } from '../../middleware/authenticate'
import { authorize } from '../../middleware/authorize'
import {
  canReadBrdStatus,
  getBrdAccessPolicy,
  getBrdVisibilityStatuses,
  requireBrdDelete,
  requireBrdEdit,
  requireBrdTrashAccess,
} from '../../middleware/brd-access'
import { notifyMany } from '../../lib/notify'
import { authenticate } from '../../middleware/authenticate'

const router = Router()

const VALID_STATUSES = ['DRAFT', 'PAUSED', 'COMPLETED', 'APPROVED', 'ON_HOLD']
const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT:     ['DRAFT', 'COMPLETED', 'ON_HOLD'],
  PAUSED:    ['PAUSED', 'DRAFT', 'COMPLETED', 'ON_HOLD'],
  COMPLETED: ['COMPLETED', 'APPROVED', 'ON_HOLD'],
  APPROVED:  ['APPROVED', 'ON_HOLD'],
  ON_HOLD:   ['ON_HOLD', 'DRAFT', 'COMPLETED', 'APPROVED'],
}

function normalizeBrdStatus(status: unknown): string {
  const upper = String(status ?? '').toUpperCase()
  return upper === 'ONGOING' ? 'DRAFT' : upper
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function isSimilarTitle(a: string, b: string): boolean {
  const wordsA = new Set(normalizeTitle(a).split(' ').filter(Boolean))
  const wordsB = new Set(normalizeTitle(b).split(' ').filter(Boolean))
  const [smaller, larger] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA]
  if (smaller.size === 0) return false
  let matches = 0
  for (const w of smaller) if (larger.has(w)) matches++
  return matches / smaller.size >= 0.80
}

function resolveGeography(meta: Record<string, unknown> | null): string {
  if (!meta) return '—'

  const geo = ((meta.geography as string) ?? '').trim()
  if (geo) return geo

  const agency  = ((meta.issuing_agency       as string) ?? '').toLowerCase()
  const catName = ((meta.content_category_name as string) ?? '').toLowerCase()
  const auth    = ((meta.authoritative_source  as string) ?? '').toLowerCase()
  const combined = `${agency} ${catName} ${auth}`

  if (/\b(code of federal regulations|federal register|cfr|epa|fda|osha|irs|sec|dot|hhs|usda|dol|dod|hud|uscis|ftc|fcc|ferc|cftc|fdic|nlrb|nlr|occ|treasury|federal aviation|federal highway)\b/.test(combined)) {
    return 'United States'
  }

  const STATE_RE = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia)\b/i
  const stateMatch = combined.match(STATE_RE)
  if (stateMatch) {
    const state = stateMatch[0].replace(/\b\w/g, (c) => c.toUpperCase())
    return `${state}, United States`
  }

  return '—'
}

function getMetaString(meta: Record<string, unknown> | null, keys: string[]): string {
  if (!meta) return ''
  for (const key of keys) {
    const value = meta[key]
    if (typeof value !== 'string') continue
    const cleaned = value.trim()
    if (!cleaned || /^\{.*\}$/.test(cleaned)) continue
    return cleaned
  }
  return ''
}

function derivedFormat(format: string, meta: Record<string, unknown> | null): 'old' | 'new' {
  const storedFmt = String(meta?._format ?? '').toLowerCase()
  const sourceName = getMetaString(meta, ['source_name', 'sourceName', 'Source Name'])
  const sourceType = getMetaString(meta, ['source_type', 'sourceType', 'Source Type'])
  const contentCategory = getMetaString(meta, [
    'content_category_name',
    'contentCategoryName',
    'Content Category Name',
    'Content Category',
  ])

  if (contentCategory) return 'new'
  if (sourceName && sourceType) return 'old'
  if (storedFmt === 'old' || storedFmt === 'new') return storedFmt as 'old' | 'new'
  return format === 'OLD' ? 'old' : 'new'
}

// ── GET /brd — list all BRDs ───────────────────────────────────────────────
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const accessPolicy    = getBrdAccessPolicy(res)
    const visibleStatuses = getBrdVisibilityStatuses(accessPolicy)

    const statusFilter = visibleStatuses && visibleStatuses.length > 0
      ? `AND b.status::text = ANY($1::text[])`
      : ''
    const params = visibleStatuses && visibleStatuses.length > 0 ? [visibleStatuses] : []

    const { rows } = await pool.query(
      `SELECT b.brd_id as "brdId", b.title, b.format, b.status,
              b.updated_at as "updatedAt",
              s.metadata,
              v.version_num as "latestVersionNum", v.label as "latestVersionLabel"
       FROM brds b
       LEFT JOIN brd_sections s ON s.brd_id = b.brd_id
       LEFT JOIN LATERAL (
         SELECT version_num, label FROM brd_versions
         WHERE brd_id = b.brd_id ORDER BY version_num DESC LIMIT 1
       ) v ON true
       WHERE b.deleted_at IS NULL ${statusFilter}
       ORDER BY b.created_at ASC`,
      params,
    )

    const data = rows.map((b: any) => {
      const meta = (b.metadata ?? null) as Record<string, unknown> | null
      const geography = (meta?.geography as string) || (meta?.Geography as string) || resolveGeography(meta)
      const fmt = derivedFormat(b.format, meta)
      const displayName = b.title.charAt(0).toUpperCase() + b.title.slice(1)
      const latestVersion =
        (typeof b.latestVersionLabel === 'string' && b.latestVersionLabel.trim())
        || (typeof b.latestVersionNum === 'number' ? `v${b.latestVersionNum}.0` : 'v1.0')

      return {
        id:          b.brdId,
        title:       displayName,
        format:      fmt,
        status:      b.status,
        version:     latestVersion,
        lastUpdated: new Date(b.updatedAt).toISOString().split('T')[0],
        geography,
      }
    })

    return res.json(data)
  } catch (err) {
    console.log('[GET /brd]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /brd/deleted — list soft-deleted BRDs ─────────────────────────────
router.get('/deleted', requireBrdTrashAccess, async (_req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.brd_id as "brdId", b.title, b.format, b.status,
              b.deleted_at as "deletedAt",
              s.metadata
       FROM brds b
       LEFT JOIN brd_sections s ON s.brd_id = b.brd_id
       WHERE b.deleted_at IS NOT NULL
       ORDER BY b.deleted_at DESC`,
    )

    const data = rows.map((b: any) => {
      const meta = (b.metadata ?? null) as Record<string, unknown> | null
      const geography = (meta?.geography as string) ?? resolveGeography(meta)
      const fmt = derivedFormat(b.format, meta)
      return {
        id:        b.brdId,
        title:     b.title.charAt(0).toUpperCase() + b.title.slice(1),
        format:    fmt,
        status:    b.status,
        geography,
        deletedAt: new Date(b.deletedAt).toISOString().split('T')[0],
      }
    })

    return res.json(data)
  } catch (err) {
    console.log('[GET /brd/deleted]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /brd/next-id ───────────────────────────────────────────────────────
router.get('/next-id', async (_req: AuthRequest, res: Response) => {
  try {
    const accessPolicy = getBrdAccessPolicy(res)
    if (!accessPolicy.canCreate) {
      return res.status(403).json({ error: 'Only Pre-Production team can create BRDs.' })
    }

    const { rows } = await pool.query(`SELECT brd_id FROM brds WHERE deleted_at IS NULL`)
    const maxNum = (rows as Array<{ brd_id: string }>).reduce((max, { brd_id }) => {
      const n = parseInt(brd_id.replace('BRD-', ''), 10)
      return isNaN(n) ? max : Math.max(max, n)
    }, 0)
    return res.json({ nextId: `BRD-${String(maxNum + 1).padStart(3, '0')}` })
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /brd/check-duplicate?filename=xxx ─────────────────────────────────
router.get('/check-duplicate', async (req: AuthRequest, res: Response) => {
  try {
    const accessPolicy = getBrdAccessPolicy(res)
    if (!accessPolicy.canCreate) {
      return res.status(403).json({ error: 'Only Pre-Production team can create BRDs.' })
    }

    const raw      = String(req.query.filename ?? '')
    const filename = decodeURIComponent(raw.replace(/\+/g, ' ')).trim()
    if (!filename) return res.status(400).json({ error: 'filename query param is required' })

    const candidateTitle = filename
      .replace(/\.(pdf|doc|docx)$/i, '')
      .replace(/_{2,}/g, ' ')
      .replace(/_/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    const normalised = normalizeTitle(candidateTitle)
    const { rows } = await pool.query(
      `SELECT brd_id as "brdId", title, status FROM brds WHERE deleted_at IS NULL`,
    )

    const exact = rows.find((b: any) => normalizeTitle(b.title) === normalised)
    if (exact) return res.json({ exists: true, brdId: exact.brdId, title: exact.title, status: exact.status, matchType: 'exact' as const })

    const fuzzy = rows.find((b: any) => isSimilarTitle(b.title, candidateTitle))
    if (fuzzy) return res.json({ exists: true, brdId: fuzzy.brdId, title: fuzzy.title, status: fuzzy.status, matchType: 'fuzzy' as const })

    return res.json({ exists: false })
  } catch (err) {
    console.log('[GET /brd/check-duplicate]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /brd/check-duplicate-title?title=xxx ──────────────────────────────
router.get('/check-duplicate-title', async (req: AuthRequest, res: Response) => {
  try {
    const accessPolicy = getBrdAccessPolicy(res)
    if (!accessPolicy.canEdit) {
      return res.status(403).json({ error: 'Only Pre-Production team can edit BRDs.' })
    }

    const raw   = String(req.query.title ?? '').trim()
    const title = decodeURIComponent(raw.replace(/\+/g, ' ')).trim()
    if (!title) return res.status(400).json({ error: 'title query param is required' })

    const excludeId  = req.query.excludeId ? String(req.query.excludeId).trim() : null
    const normalised = normalizeTitle(title)

    const { rows } = await pool.query(
      `SELECT brd_id as "brdId", title, status FROM brds WHERE deleted_at IS NULL`,
    )
    const candidates = excludeId ? rows.filter((b: any) => b.brdId !== excludeId) : rows

    const exact = candidates.find((b: any) => normalizeTitle(b.title) === normalised)
    if (exact) return res.json({ exists: true, brdId: exact.brdId, title: exact.title, status: exact.status, matchType: 'exact' as const })

    const fuzzy = candidates.find((b: any) => isSimilarTitle(b.title, title))
    if (fuzzy) return res.json({ exists: true, brdId: fuzzy.brdId, title: fuzzy.title, status: fuzzy.status, matchType: 'fuzzy' as const })

    return res.json({ exists: false })
  } catch (err) {
    console.log('[GET /brd/check-duplicate-title]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /brd/:brdId — single BRD with all section blobs ───────────────────
router.get('/:brdId', async (req: AuthRequest, res: Response) => {
  try {
    const accessPolicy = getBrdAccessPolicy(res)

    const { rows } = await pool.query(
      `SELECT b.brd_id as "brdId", b.title, b.format, b.status,
              b.updated_at as "updatedAt", b.deleted_at as "deletedAt",
              s.scope, s.metadata, s.toc, s.citations,
              s.content_profile as "contentProfile",
              s.brd_config as "brdConfig"
       FROM brds b
       LEFT JOIN brd_sections s ON s.brd_id = b.brd_id
       WHERE b.brd_id = $1`,
      [String(req.params.brdId)],
    )

    const brd = rows[0]
    if (!brd || brd.deletedAt !== null) return res.status(404).json({ error: 'BRD not found' })
    if (!canReadBrdStatus(accessPolicy, brd.status)) {
      return res.status(403).json({ error: 'You can only view BRDs with APPROVED or ON_HOLD status.' })
    }

    const meta = (brd.metadata ?? null) as Record<string, unknown> | null
    const fmt  = derivedFormat(brd.format, meta)
    const displayName = brd.title.charAt(0).toUpperCase() + brd.title.slice(1)

    return res.json({
      id:             brd.brdId,
      title:          displayName,
      format:         fmt,
      status:         brd.status,
      lastUpdated:    new Date(brd.updatedAt).toISOString().split('T')[0],
      scope:          brd.scope          ?? null,
      metadata:       brd.metadata       ?? null,
      toc:            brd.toc            ?? null,
      citations:      brd.citations      ?? null,
      contentProfile: brd.contentProfile ?? null,
      brdConfig:      brd.brdConfig      ?? null,
    })
  } catch (err) {
    console.log('[GET /brd/:brdId]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /brd/:brdId/query — send a BRD query to Pre-Production ───────────
router.post('/:brdId/query', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const brdId = String(req.params.brdId)
    const body  = String(req.body?.body ?? '').trim()
    if (!body) return res.status(400).json({ error: 'Query body is required' })

    const [brdRes, actorRes, recipientsRes] = await Promise.all([
      pool.query(`SELECT brd_id as "brdId", title, status FROM brds WHERE brd_id = $1`, [brdId]),
      pool.query(`SELECT id, user_id as "userId", first_name as "firstName", last_name as "lastName" FROM users WHERE id = $1`, [req.user!.userId]),
      pool.query(`SELECT u.id FROM users u JOIN teams t ON u.team_id = t.id WHERE u.status = 'ACTIVE' AND t.slug = 'pre-production'`),
    ])

    const brd = brdRes.rows[0]
    if (!brd) return res.status(404).json({ error: 'BRD not found' })

    const recipients = recipientsRes.rows
    if (recipients.length === 0) return res.status(404).json({ error: 'No active pre-production users found' })

    const actor = actorRes.rows[0]
    const actorName = actor
      ? [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim() || actor.userId
      : 'A user'

    await notifyMany(
      recipients.map((u: any) => u.id),
      'BRD_STATUS',
      `BRD Query: ${brd.title}`,
      `${actorName} submitted a query for ${brd.brdId}: ${body}`,
      { brdId: brd.brdId, status: brd.status, query: body, submittedBy: req.user!.userId },
    )

    await pool.query(
      `INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'BRD_QUERY_SUBMITTED', $2)`,
      [req.user!.userId, `Submitted query for ${brd.brdId}: ${body}`],
    )

    return res.status(201).json({ message: 'Query sent to Pre-Production', recipients: recipients.length })
  } catch (err) {
    console.log('[POST /brd/:brdId/query]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── PATCH /brd/:brdId — update status, title, or format ──────────────────
router.patch('/:brdId', async (req: AuthRequest, res: Response) => {
  try {
    const accessPolicy = getBrdAccessPolicy(res)
    const { status, title, format } = req.body
    const normalizedStatus = status ? normalizeBrdStatus(status) : undefined

    if (normalizedStatus && !accessPolicy.canChangeStatus) {
      return res.status(403).json({ error: 'Only Pre-Production team can change BRD status.' })
    }
    if ((title !== undefined || format !== undefined) && !accessPolicy.canEdit) {
      return res.status(403).json({ error: 'Only Pre-Production team can edit BRDs.' })
    }

    const { rows } = await pool.query(
      `SELECT deleted_at as "deletedAt", status FROM brds WHERE brd_id = $1`,
      [String(req.params.brdId)],
    )
    const existing = rows[0]
    if (!existing || existing.deletedAt !== null) return res.status(404).json({ error: 'BRD not found' })

    if (normalizedStatus && !VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({ error: `Invalid status: "${status}". Must be one of: ${VALID_STATUSES.join(', ')}` })
    }
    if (normalizedStatus) {
      const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status] ?? [existing.status]
      if (!allowed.includes(normalizedStatus)) {
        return res.status(400).json({ error: `Invalid status transition: ${existing.status} -> ${normalizedStatus}. Allowed: ${allowed.join(', ')}` })
      }
    }

    const dbFormat = format ? String(format).toUpperCase() : undefined
    if (dbFormat && dbFormat !== 'NEW' && dbFormat !== 'OLD') {
      return res.status(400).json({ error: `Invalid format: "${format}". Must be new or old.` })
    }

    const sets: string[] = ['updated_at = NOW()']
    const params: unknown[] = []
    let idx = 1

    if (title)             { sets.push(`title = $${idx++}`);  params.push(title) }
    if (normalizedStatus)  { sets.push(`status = $${idx++}`); params.push(normalizedStatus) }
    if (dbFormat)          { sets.push(`format = $${idx++}`); params.push(dbFormat) }

    params.push(String(req.params.brdId))
    await pool.query(
      `UPDATE brds SET ${sets.join(', ')} WHERE brd_id = $${idx}`,
      params,
    )

    return res.json({ success: true, brdId: String(req.params.brdId) })
  } catch {
    return res.status(404).json({ error: 'BRD not found' })
  }
})

// ── DELETE /brd/:brdId — soft delete ──────────────────────────────────────
router.delete('/:brdId', requireBrdDelete, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT deleted_at FROM brds WHERE brd_id = $1`,
      [String(req.params.brdId)],
    )
    if (!rows[0] || rows[0].deleted_at !== null) return res.status(404).json({ error: 'BRD not found' })
    await pool.query(
      `UPDATE brds SET deleted_at = NOW(), updated_at = NOW() WHERE brd_id = $1`,
      [String(req.params.brdId)],
    )
    return res.json({ success: true })
  } catch {
    return res.status(404).json({ error: 'BRD not found' })
  }
})

// ── POST /brd/:brdId/restore — restore a soft-deleted BRD ─────────────────
router.post('/:brdId/restore', requireBrdTrashAccess, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT deleted_at FROM brds WHERE brd_id = $1`,
      [String(req.params.brdId)],
    )
    if (!rows[0]) return res.status(404).json({ error: 'BRD not found' })
    if (rows[0].deleted_at === null) return res.status(400).json({ error: 'BRD is not deleted' })
    await pool.query(
      `UPDATE brds SET deleted_at = NULL, updated_at = NOW() WHERE brd_id = $1`,
      [String(req.params.brdId)],
    )
    return res.json({ success: true })
  } catch {
    return res.status(404).json({ error: 'BRD not found' })
  }
})

// ── DELETE /brd/:brdId/permanent — hard delete ────────────────────────────
router.delete('/:brdId/permanent', requireBrdTrashAccess, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId)
    const { rows } = await pool.query(
      `SELECT deleted_at FROM brds WHERE brd_id = $1`,
      [brdId],
    )
    if (!rows[0]) return res.status(404).json({ error: 'BRD not found' })
    if (rows[0].deleted_at === null) return res.status(400).json({ error: 'BRD must be soft-deleted before permanent delete' })

    // All related rows (brd_sections, brd_cell_images, brd_versions) are deleted
    // by ON DELETE CASCADE constraints defined in the schema.
    await pool.query(`DELETE FROM brds WHERE brd_id = $1`, [brdId])

    return res.json({ success: true })
  } catch (err) {
    console.log('[DELETE /brd/:brdId/permanent]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /brd/fix-formats — backfill format for existing records ──────────
router.post('/fix-formats', requireBrdEdit, authorize(['SUPER_ADMIN', 'ADMIN']), async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.brd_id as "brdId", b.format, s.metadata
       FROM brds b
       LEFT JOIN brd_sections s ON s.brd_id = b.brd_id
       WHERE b.deleted_at IS NULL`,
    )

    let fixed = 0
    for (const b of rows) {
      const meta = (b.metadata ?? null) as Record<string, unknown> | null
      if (!meta) continue

      const detected = derivedFormat(b.format, meta)
      const dbFormat = detected === 'old' ? 'OLD' : 'NEW'

      if (b.format !== dbFormat) {
        await pool.query(`UPDATE brds SET format = $2 WHERE brd_id = $1`, [b.brdId, dbFormat])
        fixed++
      }
    }

    return res.json({ success: true, fixed, total: rows.length })
  } catch (err) {
    console.log('[POST /brd/fix-formats]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
