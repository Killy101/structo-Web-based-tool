import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import pool from '../lib/db'
import { withTransaction } from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import rateLimit from 'express-rate-limit'
import { PASSWORD_POLICY, validatePasswordPolicy, generateCompliantPassword } from '../lib/password-policy'
import { getSecurityPolicy } from '../lib/get-security-policy'
import { sendPasswordEmail } from '../lib/email'

const router = Router()

const TEAM_POLICY_PREFIX = '__TEAM_ROLE_POLICY__'

function policySlug(teamSlug: string, role: 'ADMIN' | 'USER') {
  return `${TEAM_POLICY_PREFIX}${teamSlug}__${role}`
}

function defaultTeamRoleFeatures(teamSlug: string): Record<'ADMIN' | 'USER', string[]> {
  const slug = teamSlug.toLowerCase()
  if (slug === 'pre-production') return {
    ADMIN: ['dashboard', 'brd-process', 'user-management', 'compare-basic', 'compare-pdf-xml-only', 'user-logs'],
    USER:  ['dashboard', 'brd-process', 'compare-basic', 'compare-pdf-xml-only'],
  }
  if (slug === 'production') return {
    ADMIN: ['dashboard', 'brd-view-generate', 'user-management', 'compare-basic', 'compare-pdf-xml-only', 'user-logs'],
    USER:  ['dashboard', 'brd-view-generate', 'compare-basic', 'compare-pdf-xml-only'],
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

function resolvePolicyRole(role: string): 'ADMIN' | 'USER' | null {
  if (role === 'ADMIN') return 'ADMIN'
  if (role === 'USER')  return 'USER'
  return null
}

const CAN_CHANGE_PASSWORD: Record<string, string[]> = {
  SUPER_ADMIN: ['ADMIN', 'USER'],
  ADMIN:       ['USER'],
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 50,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
})

router.get('/password-policy', async (_req: Request, res: Response) => {
  try {
    const policy = await getSecurityPolicy()
    res.json({ minPasswordLength: policy.minPasswordLength, requireUppercase: policy.requireUppercase, requireNumber: policy.requireNumber, minSpecialChars: policy.minSpecialChars })
  } catch {
    res.json({ minPasswordLength: 15, requireUppercase: true, requireNumber: true, minSpecialChars: 1 })
  }
})

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { userId, password } = req.body
    const trimmedUserId = String(userId ?? '').trim()

    if (!trimmedUserId || !password) return res.status(400).json({ error: 'User ID and password are required' })
    if (!/^[a-zA-Z0-9]{3,6}$/.test(trimmedUserId)) return res.status(400).json({ error: 'User ID must be 3–6 alphanumeric characters' })

    const superAdminUserId = (process.env.SUPERADMIN_USERID ?? 'SADMIN').toLowerCase()

    let userRow: any = null

    if (trimmedUserId.toLowerCase() === superAdminUserId) {
      const { rows } = await pool.query(
        `SELECT u.*, t.name as "teamName", t.slug as "teamSlug", t.id as "teamIdVal"
         FROM users u LEFT JOIN teams t ON u.team_id = t.id
         WHERE LOWER(u.user_id) = LOWER($1) AND u.role = 'SUPER_ADMIN' LIMIT 1`,
        [trimmedUserId],
      )
      userRow = rows[0]
    }

    if (!userRow) {
      const { rows } = await pool.query(
        `SELECT u.*, t.name as "teamName", t.slug as "teamSlug", t.id as "teamIdVal"
         FROM users u LEFT JOIN teams t ON u.team_id = t.id
         WHERE LOWER(u.user_id) = LOWER($1) LIMIT 1`,
        [trimmedUserId],
      )
      userRow = rows[0]
    }

    if (!userRow) return res.status(401).json({ error: 'Invalid User ID or password' })
    if (userRow.status === 'INACTIVE') return res.status(403).json({ error: 'Your account has been deactivated. Contact your admin.' })

    const isPasswordValid = await bcrypt.compare(password, userRow.password)
    if (!isPasswordValid) return res.status(401).json({ error: 'Invalid User ID or password' })

    const secPolicy = await getSecurityPolicy()
    const expiresAt = new Date(userRow.password_changed_at)
    expiresAt.setDate(expiresAt.getDate() + secPolicy.maxPasswordAgeDays)
    if (new Date() > expiresAt) return res.status(403).json({ error: 'Password expired. Please contact your administrator.', code: 'PASSWORD_EXPIRED' })

    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [userRow.id])
    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'LOGIN', 'User logged in')`, [userRow.id])

    const { rows: histRows } = await pool.query(`SELECT COUNT(*) as cnt FROM password_history WHERE user_id = $1`, [userRow.id])
    const passwordHistoryCount = parseInt(histRows[0].cnt)
    const createdAtMs = new Date(userRow.created_at).getTime()
    const changedAtMs = new Date(userRow.password_changed_at).getTime()
    const sameAsInitialPassword = Math.abs(changedAtMs - createdAtMs) <= 60_000
    const mustChangePassword = userRow.role !== 'SUPER_ADMIN' && (passwordHistoryCount === 0 || (passwordHistoryCount === 1 && sameAsInitialPassword))

    const token = jwt.sign(
      { userId: userRow.id, role: userRow.role, teamId: userRow.team_id, mustChangePassword },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' },
    )

    res.json({
      token,
      user: {
        id: userRow.id, userId: userRow.user_id, firstName: userRow.first_name, lastName: userRow.last_name,
        role: userRow.role, teamId: userRow.team_id, teamName: userRow.teamName ?? null, mustChangePassword,
      },
    })
  } catch (error) {
    console.log('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.user_id as "userId", u.first_name as "firstName", u.last_name as "lastName",
              u.role, u.status, u.last_login_at as "lastLoginAt", u.created_at as "createdAt",
              u.team_id as "teamId",
              CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'name', t.name, 'slug', t.slug) ELSE NULL END as team,
              CASE WHEN ur.id IS NOT NULL THEN json_build_object('slug', ur.slug, 'features', ur.features) ELSE NULL END as "userRole"
       FROM users u
       LEFT JOIN teams t ON u.team_id = t.id
       LEFT JOIN user_roles ur ON u.user_role_id = ur.id
       WHERE u.id = $1`,
      [req.user!.userId],
    )

    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })

    let effectiveFeatures: string[] = []
    if (user.role === 'SUPER_ADMIN') {
      effectiveFeatures = ['*']
    } else if (user.team?.slug) {
      const policyRole = resolvePolicyRole(user.role)
      if (!policyRole) return res.json({ user: { ...user, effectiveFeatures } })

      const { rows: policyRows } = await pool.query(
        `SELECT features FROM user_roles WHERE slug = $1`,
        [policySlug(user.team.slug, policyRole)],
      )
      effectiveFeatures = policyRows[0]?.features ?? defaultTeamRoleFeatures(user.team.slug)[policyRole]

      if (user.userRole && !user.userRole.slug.startsWith(TEAM_POLICY_PREFIX)) {
        effectiveFeatures = Array.from(new Set([...effectiveFeatures, ...user.userRole.features]))
      }
    }

    res.json({ user: { ...user, effectiveFeatures } })
  } catch (error) {
    console.log('Get user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/logout', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'LOGOUT', 'User logged out')`, [req.user!.userId])
    res.json({ message: 'Logged out' })
  } catch (error) {
    console.log('Logout error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { targetUserId, currentPassword, newPassword } = req.body
    const actorRole = req.user!.role

    const secPolicy = await getSecurityPolicy()
    const policyError = validatePasswordPolicy(String(newPassword ?? ''), secPolicy)
    if (policyError) return res.status(400).json({ error: policyError })

    if (!targetUserId) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required' })

      const { rows: actorRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.user!.userId])
      const actor = actorRows[0]
      if (!actor) return res.status(404).json({ error: 'User not found' })

      const isCurrentValid = await bcrypt.compare(String(currentPassword), actor.password)
      if (!isCurrentValid) return res.status(401).json({ error: 'Current password is incorrect' })

      if (await bcrypt.compare(newPassword, actor.password)) {
        return res.status(400).json({ error: `New password must not match any of the last ${secPolicy.rememberedCount} passwords.` })
      }

      const { rows: recentHistory } = await pool.query(
        `SELECT hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [actor.id, secPolicy.rememberedCount],
      )
      for (const h of recentHistory) {
        if (await bcrypt.compare(newPassword, h.hash)) {
          return res.status(400).json({ error: `New password must not match any of the last ${secPolicy.rememberedCount} passwords.` })
        }
      }

      const hash = await bcrypt.hash(newPassword, 10)
      await withTransaction(async (client) => {
        await client.query(`UPDATE users SET password = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2`, [hash, actor.id])
        await client.query(`INSERT INTO password_history (user_id, hash) VALUES ($1, $2)`, [actor.id, hash])
      })
      await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'PASSWORD_CHANGE', 'Changed own password')`, [actor.id])
      return res.json({ message: 'Password changed successfully' })
    }

    const allowedTargetRoles = CAN_CHANGE_PASSWORD[actorRole]
    if (!allowedTargetRoles) return res.status(403).json({ error: 'You are not authorized to change passwords' })

    const { rows: targetRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [Number(targetUserId)])
    const target = targetRows[0]
    if (!target) return res.status(404).json({ error: 'User not found' })
    if (!allowedTargetRoles.includes(target.role)) return res.status(403).json({ error: `You cannot change passwords for ${target.role} users` })

    if (await bcrypt.compare(newPassword, target.password)) {
      return res.status(400).json({ error: `New password must not match any of the last ${secPolicy.rememberedCount} passwords.` })
    }

    const { rows: recentHistory } = await pool.query(
      `SELECT hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [target.id, secPolicy.rememberedCount],
    )
    for (const h of recentHistory) {
      if (await bcrypt.compare(newPassword, h.hash)) {
        return res.status(400).json({ error: `New password must not match any of the last ${secPolicy.rememberedCount} passwords.` })
      }
    }

    const hash = await bcrypt.hash(newPassword, 10)
    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET password = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2`, [hash, target.id])
      await client.query(`INSERT INTO password_history (user_id, hash) VALUES ($1, $2)`, [target.id, hash])
    })
    await pool.query(
      `INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'PASSWORD_CHANGE', $2)`,
      [req.user!.userId, `Changed password for ${target.user_id} (${target.role})`],
    )
    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    console.log('Change password error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/reset-user-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { targetUserId } = req.body
    const actorRole = req.user!.role

    if (!targetUserId) return res.status(400).json({ error: 'Target user ID is required' })
    const allowedTargetRoles = CAN_CHANGE_PASSWORD[actorRole]
    if (!allowedTargetRoles) return res.status(403).json({ error: 'Not authorized' })

    const { rows: targetRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [Number(targetUserId)])
    const target = targetRows[0]
    if (!target) return res.status(404).json({ error: 'User not found' })
    if (!allowedTargetRoles.includes(target.role)) return res.status(403).json({ error: `You cannot reset passwords for ${target.role} users` })

    const resetPolicy = await getSecurityPolicy()
    const newPassword = generateCompliantPassword(resetPolicy.minPasswordLength)
    const hash = await bcrypt.hash(newPassword, 10)

    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET password = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2`, [hash, target.id])
      await client.query(`INSERT INTO password_history (user_id, hash) VALUES ($1, $2)`, [target.id, hash])
    })
    await pool.query(
      `INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'PASSWORD_RESET', $2)`,
      [req.user!.userId, `Reset password for ${target.user_id} (${target.role})`],
    )

    let emailResult: { success: boolean; error?: string } = { success: false, error: 'No email address on file' }
    if (target.email) {
      emailResult = await sendPasswordEmail({
        to: String(target.email),
        userId: target.user_id,
        fullName: [target.first_name, target.last_name].filter(Boolean).join(' '),
        password: newPassword,
        action: 'reset',
      })
    }

    res.json({ message: 'Password reset successfully', newPassword, targetUserId: target.user_id, emailSent: emailResult.success, emailError: emailResult.error || undefined })
  } catch (error) {
    console.log('Reset user password error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
