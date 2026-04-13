import { Router, Response } from 'express'
import pool from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'

const router = Router()

const TEAM_POLICY_PREFIX = '__TEAM_ROLE_POLICY__'
const POLICY_ROLES = ['ADMIN', 'USER'] as const
type PolicyRole = (typeof POLICY_ROLES)[number]

const FEATURE_CATALOG: Record<string, string> = {
  dashboard: 'Dashboard', 'brd-process': 'BRD Process', 'brd-view-generate': 'BRD View and Generate Sources',
  'user-management': 'User Management', 'compare-basic': 'Compare',
  'compare-merge': 'Compare Merge', 'compare-pdf-xml-only': 'Compare PDF + XML Only', 'user-logs': 'User Logs',
}

function humanizeFeatureKey(key: string): string {
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function policySlug(teamSlug: string, role: PolicyRole) {
  return `${TEAM_POLICY_PREFIX}${teamSlug}__${role}`
}

function defaultTeamRoleFeatures(teamSlug: string): Record<PolicyRole, string[]> {
  const slug = teamSlug.toLowerCase()
  if (slug === 'pre-production') return {
    ADMIN: ['dashboard', 'brd-process', 'user-management', 'compare-basic', 'user-logs'],
    USER:  ['dashboard', 'brd-process', 'compare-basic'],
  }
  if (slug === 'production') return {
    ADMIN: ['dashboard', 'brd-view-generate', 'user-management', 'compare-basic', 'compare-pdf-xml-only', 'user-logs'],
    USER:  ['dashboard', 'brd-view-generate', 'compare-basic'],
  }
  if (slug === 'updating') return {
    ADMIN: ['dashboard', 'brd-view-generate', 'user-management', 'compare-basic', 'compare-pdf-xml-only', 'user-logs'],
    USER:  ['dashboard', 'brd-view-generate', 'compare-basic', 'compare-merge'],
  }
  return {
    ADMIN: ['dashboard', 'brd-process', 'user-management', 'compare-basic', 'user-logs'],
    USER:  ['dashboard', 'brd-process', 'compare-basic'],
  }
}

async function ensureTeamPolicies(teamSlug: string) {
  const defaults = defaultTeamRoleFeatures(teamSlug)
  await Promise.all(
    POLICY_ROLES.map(async (role) => {
      const slug = policySlug(teamSlug, role)
      const name = `Team Policy: ${teamSlug} (${role})`
      const { rows: existing } = await pool.query(
        `SELECT id FROM user_roles WHERE slug = $1 OR name = $2 LIMIT 1`,
        [slug, name],
      )

      if (existing[0]?.id) {
        await pool.query(
          `UPDATE user_roles
           SET slug = $1, name = $2, updated_at = NOW()
           WHERE id = $3`,
          [slug, name, existing[0].id],
        )
        return
      }

      await pool.query(
        `INSERT INTO user_roles (name, slug, features)
         VALUES ($1, $2, $3)`,
        [name, slug, defaults[role]],
      )
    }),
  )
}

async function renameTeamPolicies(oldSlug: string, nextSlug: string) {
  if (oldSlug === nextSlug) return
  for (const role of POLICY_ROLES) {
    await pool.query(
      `UPDATE user_roles SET slug = $1, name = $2, updated_at = NOW()
       WHERE slug = $3`,
      [policySlug(nextSlug, role), `Team Policy: ${nextSlug} (${role})`, policySlug(oldSlug, role)],
    )
  }
}

router.get('/', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = req.user!.role
    const actorTeamId = req.user!.teamId

    if (actorRole === 'ADMIN') {
      if (!actorTeamId) return res.json({ teams: [] })
      const { rows: teams } = await pool.query(
        `SELECT t.id, t.name, t.slug, t.created_at as "createdAt", t.updated_at as "updatedAt",
                (SELECT COUNT(*) FROM users WHERE team_id = t.id)::int as "memberCount",
                (SELECT COUNT(*) FROM task_assignments WHERE team_id = t.id)::int as "taskCount",
                COALESCE(
                  json_agg(json_build_object('id', u.id, 'userId', u.user_id, 'firstName', u.first_name, 'lastName', u.last_name, 'role', u.role, 'status', u.status))
                  FILTER (WHERE u.id IS NOT NULL), '[]'
                ) as members
         FROM teams t
         LEFT JOIN users u ON u.team_id = t.id
         WHERE t.id = $1
         GROUP BY t.id
         ORDER BY t.created_at ASC`,
        [actorTeamId],
      )
      const teamsFormatted = teams.map((t: any) => ({
        ...t,
        _count: { members: t.memberCount, taskAssignments: t.taskCount },
      }))
      return res.json({ teams: teamsFormatted })
    }

    const { rows: teams } = await pool.query(
      `SELECT t.id, t.name, t.slug, t.created_at as "createdAt", t.updated_at as "updatedAt",
              (SELECT COUNT(*) FROM users WHERE team_id = t.id)::int as "memberCount",
              (SELECT COUNT(*) FROM task_assignments WHERE team_id = t.id)::int as "taskCount",
              COALESCE(
                json_agg(json_build_object('id', u.id, 'userId', u.user_id, 'firstName', u.first_name, 'lastName', u.last_name, 'role', u.role, 'status', u.status))
                FILTER (WHERE u.id IS NOT NULL), '[]'
              ) as members
       FROM teams t
       LEFT JOIN users u ON u.team_id = t.id
       GROUP BY t.id
       ORDER BY t.created_at ASC`,
    )

    const teamsFormatted = teams.map((t: any) => ({
      ...t,
      _count: { members: t.memberCount, taskAssignments: t.taskCount },
    }))

    res.json({ teams: teamsFormatted })
  } catch (error) {
    console.log('Get teams error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Team name is required' })

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const { rows: existing } = await pool.query(
      `SELECT id FROM teams WHERE LOWER(name) = LOWER($1) OR slug = $2`,
      [name.trim(), slug],
    )
    if (existing.length > 0) return res.status(409).json({ error: 'A team with this name already exists' })

    const { rows: created } = await pool.query(
      `INSERT INTO teams (name, slug) VALUES ($1, $2) RETURNING *`,
      [name.trim(), slug],
    )
    const team = created[0]
    await ensureTeamPolicies(team.slug)
    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'TEAM_CREATED', $2)`, [req.user!.userId, `Created team "${name.trim()}"`])
    res.status(201).json({ message: 'Team created', team })
  } catch (error) {
    console.log('Create team error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string)
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Team name is required' })

    const { rows: teamRows } = await pool.query(`SELECT * FROM teams WHERE id = $1`, [targetId])
    const team = teamRows[0]
    if (!team) return res.status(404).json({ error: 'Team not found' })

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const { rows: collision } = await pool.query(
      `SELECT id FROM teams WHERE id != $1 AND (LOWER(name) = LOWER($2) OR slug = $3)`,
      [targetId, name.trim(), slug],
    )
    if (collision.length > 0) return res.status(409).json({ error: 'A team with this name already exists' })

    const { rows: updated } = await pool.query(
      `UPDATE teams SET name = $1, slug = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [name.trim(), slug, targetId],
    )
    await renameTeamPolicies(team.slug, updated[0].slug)
    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'TEAM_RENAMED', $2)`, [req.user!.userId, `Renamed team "${team.name}" to "${name.trim()}"`])
    res.json({ message: 'Team updated', team: updated[0] })
  } catch (error) {
    console.log('Update team error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/:id', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string)

    const { rows: teamRows } = await pool.query(
      `SELECT t.*, (SELECT COUNT(*) FROM users WHERE team_id = t.id)::int as member_count FROM teams t WHERE t.id = $1`,
      [targetId],
    )
    const team = teamRows[0]
    if (!team) return res.status(404).json({ error: 'Team not found' })
    if (team.member_count > 0) return res.status(400).json({ error: 'Cannot delete a team that still has members. Reassign them first.' })

    await pool.query(`DELETE FROM teams WHERE id = $1`, [targetId])
    res.json({ message: 'Team deleted' })
  } catch (error) {
    console.log('Delete team error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/policies', authenticate, authorize(['SUPER_ADMIN']), async (_req: AuthRequest, res: Response) => {
  try {
    const { rows: teams } = await pool.query(`SELECT id, name, slug FROM teams ORDER BY created_at ASC`)

    await Promise.all(teams.map((team: any) => ensureTeamPolicies(team.slug)))

    const { rows: policyRows } = await pool.query(
      `SELECT id, name, slug, features, updated_at as "updatedAt" FROM user_roles WHERE slug LIKE $1`,
      [`${TEAM_POLICY_PREFIX}%`],
    )
    const bySlug = new Map(policyRows.map((r: any) => [r.slug, r]))

    const items = await Promise.all(teams.map(async (team: any) => {
      const admin = bySlug.get(policySlug(team.slug, 'ADMIN'))
      const user  = bySlug.get(policySlug(team.slug, 'USER'))
      return {
        team,
        ADMIN: { role: 'ADMIN', id: admin?.id ?? null, features: admin?.features ?? defaultTeamRoleFeatures(team.slug).ADMIN, updatedAt: admin?.updatedAt ?? null },
        USER:  { role: 'USER',  id: user?.id  ?? null, features: user?.features  ?? defaultTeamRoleFeatures(team.slug).USER,  updatedAt: user?.updatedAt  ?? null },
      }
    }))

    const knownFeatures = new Set(Object.keys(FEATURE_CATALOG))
    for (const row of policyRows) {
      for (const feature of (row as any).features) knownFeatures.add(feature)
    }
    const featureCatalog = Array.from(knownFeatures).sort().map((key) => ({ key, label: FEATURE_CATALOG[key] ?? humanizeFeatureKey(key) }))

    res.json({ policies: items, featureCatalog })
  } catch (error) {
    console.log('Get team policies error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/policies/:role', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const teamId   = parseInt(req.params.id as string, 10)
    const role     = String(req.params.role || '').toUpperCase() as PolicyRole
    const { features } = req.body

    if (!POLICY_ROLES.includes(role)) return res.status(400).json({ error: 'Role must be ADMIN or USER' })
    if (!Array.isArray(features)) return res.status(400).json({ error: 'Features must be an array' })

    const { rows: teamRows } = await pool.query(`SELECT * FROM teams WHERE id = $1`, [teamId])
    const team = teamRows[0]
    if (!team) return res.status(404).json({ error: 'Team not found' })

    await ensureTeamPolicies(team.slug)

    const { rows: updated } = await pool.query(
      `UPDATE user_roles SET features = $1, updated_at = NOW() WHERE slug = $2
       RETURNING id, slug, features, updated_at as "updatedAt"`,
      [features.filter((f: any) => typeof f === 'string'), policySlug(team.slug, role)],
    )
    if (!updated[0]) return res.status(404).json({ error: 'Team role policy not found' })

    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'TEAM_POLICY_UPDATED', $2)`, [req.user!.userId, `Updated ${role} policy for team ${team.name}`])

    res.json({ message: 'Team policy updated', policy: { teamId: team.id, teamSlug: team.slug, role, features: updated[0].features, updatedAt: updated[0].updatedAt } })
  } catch (error) {
    console.log('Update team policy error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
