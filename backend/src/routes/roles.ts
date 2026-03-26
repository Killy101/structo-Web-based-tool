import { Router, Response } from 'express'
import pool from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'

const router = Router()

const BASE_POLICY_PREFIX = '__BASE_ROLE_POLICY__'
const BASE_ROLES = ['ADMIN', 'USER'] as const
type BaseRole = (typeof BASE_ROLES)[number]

const BASE_ROLE_DEFAULT_FEATURES: Record<BaseRole, string[]> = {
  ADMIN: ['brd-process', 'view-brd', 'compare', 'generate-reports', 'user-logs'],
  USER:  ['view-brd', 'generate-reports'],
}

const basePolicySlug = (role: BaseRole) => `${BASE_POLICY_PREFIX}${role}`

async function ensureBasePolicy(role: BaseRole) {
  const slug = basePolicySlug(role)
  const { rows } = await pool.query(`SELECT * FROM user_roles WHERE slug = $1`, [slug])
  if (rows[0]) return rows[0]
  const { rows: created } = await pool.query(
    `INSERT INTO user_roles (name, slug, features) VALUES ($1, $2, $3) RETURNING *`,
    [`Base Role Policy: ${role}`, slug, BASE_ROLE_DEFAULT_FEATURES[role]],
  )
  return created[0]
}

router.get('/', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (_req: AuthRequest, res: Response) => {
  try {
    const { rows: roles } = await pool.query(
      `SELECT ur.id, ur.name, ur.slug, ur.features, ur.created_at as "createdAt", ur.updated_at as "updatedAt",
              (SELECT COUNT(*) FROM users WHERE user_role_id = ur.id)::int as "userCount"
       FROM user_roles ur
       WHERE ur.slug NOT LIKE $1
       ORDER BY ur.created_at ASC`,
      [`${BASE_POLICY_PREFIX}%`],
    )
    const formatted = roles.map((r: any) => ({ ...r, _count: { users: r.userCount } }))
    res.json({ roles: formatted })
  } catch (error) {
    console.error('Get roles error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/base-policies', authenticate, authorize(['SUPER_ADMIN']), async (_req: AuthRequest, res: Response) => {
  try {
    const policies = await Promise.all(
      BASE_ROLES.map(async (role) => {
        const policy = await ensureBasePolicy(role)
        return { id: policy.id, role, features: policy.features, updatedAt: policy.updated_at }
      }),
    )
    res.json({ policies })
  } catch (error) {
    console.error('Get base policies error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/base-policies/:role', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const roleParam = String(req.params.role || '').toUpperCase()
    const role = BASE_ROLES.find((r) => r === roleParam) as BaseRole | undefined
    if (!role) return res.status(400).json({ error: 'Role must be ADMIN or USER' })

    const { features } = req.body
    if (!Array.isArray(features)) return res.status(400).json({ error: 'Features must be an array' })

    const policy = await ensureBasePolicy(role)
    const { rows: updated } = await pool.query(
      `UPDATE user_roles SET features = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, features, updated_at as "updatedAt"`,
      [features.filter((f: any) => typeof f === 'string'), policy.id],
    )

    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'BASE_ROLE_POLICY_UPDATED', $2)`, [req.user!.userId, `Updated feature policy for ${role}`])
    res.json({ message: 'Base role policy updated', policy: { id: updated[0].id, role, features: updated[0].features, updatedAt: updated[0].updatedAt } })
  } catch (error) {
    console.error('Update base policy error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { name, features } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Role name is required' })

    const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')

    const { rows: existing } = await pool.query(
      `SELECT id FROM user_roles WHERE LOWER(name) = LOWER($1) OR slug = $2`,
      [name.trim(), slug],
    )
    if (existing.length > 0) return res.status(409).json({ error: 'A role with this name already exists' })

    const { rows: role } = await pool.query(
      `INSERT INTO user_roles (name, slug, features) VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), slug, Array.isArray(features) ? features : []],
    )

    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'ROLE_CREATED', $2)`, [req.user!.userId, `Created user role "${name.trim()}"`])
    res.status(201).json({ message: 'Role created', role: role[0] })
  } catch (error) {
    console.error('Create role error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id)
    const { name, features } = req.body

    const { rows: roleRows } = await pool.query(`SELECT * FROM user_roles WHERE id = $1`, [targetId])
    if (!roleRows[0]) return res.status(404).json({ error: 'Role not found' })

    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (name?.trim()) {
      const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
      sets.push(`name = $${idx++}`, `slug = $${idx++}`)
      params.push(name.trim(), slug)
    }
    if (features !== undefined) {
      sets.push(`features = $${idx++}`)
      params.push(Array.isArray(features) ? features : [])
    }

    if (sets.length === 0) return res.json({ message: 'No changes', role: roleRows[0] })

    sets.push(`updated_at = NOW()`)
    params.push(targetId)

    const { rows: updated } = await pool.query(
      `UPDATE user_roles SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    )
    res.json({ message: 'Role updated', role: updated[0] })
  } catch (error) {
    console.error('Update role error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/:id', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id)

    const { rows: roleRows } = await pool.query(
      `SELECT ur.*, (SELECT COUNT(*) FROM users WHERE user_role_id = ur.id)::int as user_count FROM user_roles ur WHERE ur.id = $1`,
      [targetId],
    )
    if (!roleRows[0]) return res.status(404).json({ error: 'Role not found' })
    if (roleRows[0].user_count > 0) return res.status(400).json({ error: 'Cannot delete a role that still has users. Reassign them first.' })

    await pool.query(`DELETE FROM user_roles WHERE id = $1`, [targetId])
    res.json({ message: 'Role deleted' })
  } catch (error) {
    console.error('Delete role error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
