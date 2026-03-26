import { Router, Response } from 'express'
import bcrypt from 'bcrypt'
import pool from '../lib/db'
import { withTransaction } from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { generateCompliantPassword } from '../lib/password-policy'
import { sendPasswordEmail } from '../lib/email'
import { createNotification } from '../lib/notify'

const router = Router()

const CAN_CREATE:      Record<string, string[]> = { SUPER_ADMIN: ['ADMIN', 'USER'], ADMIN: ['USER'] }
const CAN_DEACTIVATE:  Record<string, string[]> = { SUPER_ADMIN: ['ADMIN', 'USER'], ADMIN: ['USER'] }
const CAN_CHANGE_ROLE: Record<string, string[]> = { SUPER_ADMIN: ['ADMIN', 'USER'], ADMIN: ['USER'] }
const CAN_EDIT_PROFILE:Record<string, string[]> = { SUPER_ADMIN: ['ADMIN', 'USER'], ADMIN: ['USER'] }
const ALLOWED_TARGET_ROLES: Record<string, string[]> = { SUPER_ADMIN: ['ADMIN', 'USER'], ADMIN: ['USER'] }

router.get('/', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = req.user!.role
    const actorId   = req.user!.userId

    let whereClause = ''
    const params: unknown[] = []

    if (actorRole === 'ADMIN') {
      const { rows: adminRows } = await pool.query(`SELECT team_id FROM users WHERE id = $1`, [actorId])
      const teamId = adminRows[0]?.team_id
      if (!teamId) return res.json({ users: [] })
      whereClause = `WHERE u.team_id = $1 AND u.role = 'USER'`
      params.push(teamId)
    }

    const { rows: users } = await pool.query(
      `SELECT u.id, u.user_id as "userId", u.email, u.first_name as "firstName", u.last_name as "lastName",
              u.role, u.status, u.last_login_at as "lastLoginAt", u.created_at as "createdAt",
              u.updated_at as "updatedAt", u.created_by_id as "createdById", u.team_id as "teamId",
              CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'name', t.name, 'slug', t.slug) ELSE NULL END as team,
              u.user_role_id as "userRoleId",
              CASE WHEN ur.id IS NOT NULL THEN json_build_object('id', ur.id, 'name', ur.name, 'slug', ur.slug, 'features', ur.features) ELSE NULL END as "userRole"
       FROM users u
       LEFT JOIN teams t ON u.team_id = t.id
       LEFT JOIN user_roles ur ON u.user_role_id = ur.id
       ${whereClause}
       ORDER BY u.created_at DESC`,
      params,
    )

    res.json({ users })
  } catch (error) {
    console.error('Get users error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/create', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, email, role, firstName, lastName, teamId, userRoleId } = req.body
    const actorRole = req.user!.role

    if (!userId || !role) return res.status(400).json({ error: 'User ID and role are required' })
    if (!firstName?.trim()) return res.status(400).json({ error: 'First name is required' })
    if (!lastName?.trim())  return res.status(400).json({ error: 'Last name is required' })

    const normalizedEmail = String(email ?? '').trim().toLowerCase()
    if (!normalizedEmail) return res.status(400).json({ error: 'Email is required' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ error: 'Invalid email format' })

    const trimmedUserId = userId.trim()
    if (!/^[a-zA-Z0-9]{3,6}$/.test(trimmedUserId)) return res.status(400).json({ error: 'User ID must be 3 to 6 alphanumeric characters' })

    const allowedRoles = CAN_CREATE[actorRole] ?? []
    if (!allowedRoles.includes(role)) return res.status(403).json({ error: `You cannot create a user with role ${role}` })

    const { rows: existingId } = await pool.query(`SELECT id FROM users WHERE user_id = $1`, [trimmedUserId])
    if (existingId.length > 0) return res.status(409).json({ error: 'A user with this User ID already exists' })

    const { rows: existingEmail } = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [normalizedEmail])
    if (existingEmail.length > 0) return res.status(409).json({ error: 'A user with this email already exists' })

    let assignTeamId = teamId
    if (actorRole === 'ADMIN' && !assignTeamId) {
      const { rows: adminRows } = await pool.query(`SELECT team_id FROM users WHERE id = $1`, [req.user!.userId])
      assignTeamId = adminRows[0]?.team_id
    }

    if (assignTeamId) {
      const { rows: teamRows } = await pool.query(`SELECT id FROM teams WHERE id = $1`, [assignTeamId])
      if (!teamRows[0]) return res.status(400).json({ error: 'Team not found' })
    }

    if (userRoleId) {
      const { rows: roleRows } = await pool.query(`SELECT id FROM user_roles WHERE id = $1`, [userRoleId])
      if (!roleRows[0]) return res.status(400).json({ error: 'User role not found' })
    }

    const generatedPassword = generateCompliantPassword()
    const hashedPassword    = await bcrypt.hash(generatedPassword, 10)

    const newUser = await withTransaction(async (client) => {
      const { rows: created } = await client.query(
        `INSERT INTO users (user_id, role, password, password_changed_at, created_by_id, email, first_name, last_name, team_id, user_role_id)
         VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9)
         RETURNING id, user_id as "userId"`,
        [trimmedUserId, role, hashedPassword, req.user!.userId, normalizedEmail, firstName.trim(), lastName.trim(), assignTeamId || null, userRoleId || null],
      )
      await client.query(`INSERT INTO password_history (user_id, hash) VALUES ($1, $2)`, [created[0].id, hashedPassword])
      return created[0]
    })

    await pool.query(
      `INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'USER_CREATED', $2)`,
      [req.user!.userId, `Created user ${trimmedUserId} (${firstName.trim()} ${lastName.trim()}) with role ${role} and email ${normalizedEmail}`],
    )

    const emailResult = await sendPasswordEmail({ to: normalizedEmail, userId: newUser.userId, fullName: `${firstName.trim()} ${lastName.trim()}`, password: generatedPassword, action: 'created' })

    const { rows: superAdmins } = await pool.query(`SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'`)
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
    await Promise.all(superAdmins.map((sa: any) => createNotification(sa.id, 'SYSTEM', 'New User Registered', `${fullName || trimmedUserId} (${trimmedUserId}) joined as ${role}`, { newUserId: newUser.userId })))

    res.status(201).json({ message: 'User created successfully', generatedPassword, emailSent: emailResult.success, emailError: emailResult.error || undefined, id: newUser.id, userIdStr: newUser.userId })
  } catch (error) {
    console.error('Create user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/profile', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId  = Number(req.params.id)
    const actorRole = req.user!.role
    const { userId, email, firstName, lastName } = req.body

    if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'Invalid user ID' })

    const { rows: targetRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [targetId])
    const target = targetRows[0]
    if (!target) return res.status(404).json({ error: 'User not found' })

    const allowedTargets = CAN_EDIT_PROFILE[actorRole] ?? []
    if (!allowedTargets.includes(target.role)) return res.status(403).json({ error: `You cannot edit profile details for ${target.role} users` })

    const trimmedUserId = String(userId ?? '').trim().toUpperCase()
    if (!/^[a-zA-Z0-9]{3,6}$/.test(trimmedUserId)) return res.status(400).json({ error: 'User ID must be 3 to 6 alphanumeric characters' })

    const normalizedEmail = String(email ?? '').trim().toLowerCase()
    if (!normalizedEmail) return res.status(400).json({ error: 'Email is required' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ error: 'Invalid email format' })

    const normalizedFirstName = String(firstName ?? '').trim()
    if (!normalizedFirstName) return res.status(400).json({ error: 'First name is required' })
    const normalizedLastName = String(lastName ?? '').trim()
    if (!normalizedLastName) return res.status(400).json({ error: 'Last name is required' })

    const { rows: dupId } = await pool.query(`SELECT id FROM users WHERE user_id = $1 AND id != $2`, [trimmedUserId, targetId])
    if (dupId.length > 0) return res.status(409).json({ error: 'A user with this User ID already exists' })

    const { rows: dupEmail } = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2`, [normalizedEmail, targetId])
    if (dupEmail.length > 0) return res.status(409).json({ error: 'A user with this email already exists' })

    const { rows: updated } = await pool.query(
      `UPDATE users SET user_id = $1, email = $2, first_name = $3, last_name = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, user_id as "userId", email, first_name as "firstName", last_name as "lastName"`,
      [trimmedUserId, normalizedEmail, normalizedFirstName, normalizedLastName, targetId],
    )

    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'USER_PROFILE_UPDATED', $2)`, [req.user!.userId, `Updated profile details for ${target.user_id} -> ${updated[0].userId}`])
    res.json({ message: 'User profile updated successfully', user: updated[0] })
  } catch (error) {
    console.error('Update user profile error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/team', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string)
    const { teamId } = req.body
    const actorRole = req.user!.role

    const { rows: targetRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [targetId])
    const target = targetRows[0]
    if (!target) return res.status(404).json({ error: 'User not found' })

    if (actorRole === 'ADMIN' && (target.role === 'ADMIN' || target.role === 'SUPER_ADMIN')) {
      return res.status(403).json({ error: "You cannot reassign this user's team" })
    }

    if (teamId) {
      const { rows: teamRows } = await pool.query(`SELECT id FROM teams WHERE id = $1`, [teamId])
      if (!teamRows[0]) return res.status(400).json({ error: 'Team not found' })
    }

    await pool.query(`UPDATE users SET team_id = $1, updated_at = NOW() WHERE id = $2`, [teamId || null, targetId])
    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'TEAM_ASSIGNED', $2)`, [req.user!.userId, `Assigned user ${target.user_id} to team ${teamId ?? 'none'}`])
    res.json({ message: 'Team assignment updated' })
  } catch (error) {
    console.error('Assign team error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/role', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string)
    const { role } = req.body
    const actorRole = req.user!.role

    const { rows: targetRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [targetId])
    const target = targetRows[0]
    if (!target) return res.status(404).json({ error: 'User not found' })

    const canChange = CAN_CHANGE_ROLE[actorRole] ?? []
    if (!canChange.includes(target.role)) return res.status(403).json({ error: "You cannot change this user's role" })

    const allowedTargets = ALLOWED_TARGET_ROLES[actorRole] ?? []
    if (!allowedTargets.includes(role)) return res.status(403).json({ error: `You cannot assign the role ${role}` })

    if (actorRole === 'ADMIN' && role === 'ADMIN') return res.status(403).json({ error: 'Only Super Admin can assign the Admin role' })

    await pool.query(`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`, [role, targetId])
    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'ROLE_CHANGED', $2)`, [req.user!.userId, `Changed ${target.user_id} from ${target.role} to ${role}`])
    res.json({ message: 'Role updated successfully' })
  } catch (error) {
    console.error('Change role error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/deactivate', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string)
    const actorRole = req.user!.role

    const { rows: targetRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [targetId])
    const target = targetRows[0]
    if (!target) return res.status(404).json({ error: 'User not found' })

    const allowed = CAN_DEACTIVATE[actorRole] ?? []
    if (!allowed.includes(target.role)) return res.status(403).json({ error: 'You cannot deactivate this user' })
    if (target.id === req.user!.userId) return res.status(400).json({ error: 'You cannot deactivate your own account' })

    await pool.query(`UPDATE users SET status = 'INACTIVE', updated_at = NOW() WHERE id = $1`, [targetId])
    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'USER_DEACTIVATED', $2)`, [req.user!.userId, `Deactivated user ${target.user_id}`])
    res.json({ message: 'User deactivated' })
  } catch (error) {
    console.error('Deactivate user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/activate', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string)
    const actorRole = req.user!.role

    const { rows: targetRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [targetId])
    const target = targetRows[0]
    if (!target) return res.status(404).json({ error: 'User not found' })

    const allowed = CAN_DEACTIVATE[actorRole] ?? []
    if (!allowed.includes(target.role)) return res.status(403).json({ error: 'You cannot activate this user' })

    await pool.query(`UPDATE users SET status = 'ACTIVE', updated_at = NOW() WHERE id = $1`, [targetId])
    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'USER_ACTIVATED', $2)`, [req.user!.userId, `Activated user ${target.user_id}`])
    res.json({ message: 'User activated' })
  } catch (error) {
    console.error('Activate user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/user-role', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string)
    const { userRoleId } = req.body

    const { rows: targetRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [targetId])
    const target = targetRows[0]
    if (!target) return res.status(404).json({ error: 'User not found' })

    let roleName: string | null = null
    if (userRoleId !== null && userRoleId !== undefined) {
      const { rows: roleRows } = await pool.query(`SELECT * FROM user_roles WHERE id = $1`, [Number(userRoleId)])
      if (!roleRows[0]) return res.status(400).json({ error: 'User role not found' })
      if (roleRows[0].slug.startsWith('__TEAM_ROLE_POLICY__')) return res.status(400).json({ error: 'Cannot assign a team policy role directly to a user' })
      roleName = roleRows[0].name
    }

    await pool.query(`UPDATE users SET user_role_id = $1, updated_at = NOW() WHERE id = $2`, [userRoleId != null ? Number(userRoleId) : null, targetId])
    await pool.query(
      `INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'USER_ROLE_ASSIGNED', $2)`,
      [req.user!.userId, roleName ? `Assigned custom role "${roleName}" to user ${target.user_id}` : `Cleared custom role from user ${target.user_id}`],
    )
    res.json({ message: 'User role updated' })
  } catch (error) {
    console.error('Assign user role error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
