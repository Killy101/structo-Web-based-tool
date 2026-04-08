import { Router, Response } from 'express'
import pool from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'

const router = Router()

router.get(
  '/',
  authenticate,
  authorize(['SUPER_ADMIN', 'ADMIN']),
  async (req: AuthRequest, res: Response) => {
    try {
      const actorRole = req.user!.role
      const conditions: string[] = []
      const params: unknown[] = []
      let paramIdx = 1

      if (actorRole === 'ADMIN') {
        const { rows: adminRows } = await pool.query(
          `SELECT team_id FROM users WHERE id = $1`,
          [req.user!.userId],
        )
        const teamId = adminRows[0]?.team_id
        if (!teamId) return res.json({ logs: [] })

        const { rows: members } = await pool.query(
          `SELECT id FROM users WHERE team_id = $1`,
          [teamId],
        )
        const memberIds = members.map((m: any) => m.id)

        conditions.push(`ul.user_id = ANY($${paramIdx++})`)
        params.push(memberIds)

        // Admins must not see their own login/logout
        conditions.push(
          `NOT (ul.user_id = $${paramIdx++} AND ul.action = ANY($${paramIdx++}))`,
        )
        params.push(req.user!.userId, ['LOGIN', 'LOGOUT'])
      }

      const { userId, action, limit } = req.query
      if (userId) {
        conditions.push(`ul.user_id = $${paramIdx++}`)
        params.push(parseInt(userId as string))
      }
      if (action) {
        conditions.push(`ul.action = $${paramIdx++}`)
        params.push(action as string)
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const limitVal = limit ? parseInt(limit as string) : 100

      const { rows: logs } = await pool.query(
        `SELECT ul.id, ul.action, ul.details, ul.created_at as "createdAt",
                ul.user_id as "userId",
                json_build_object(
                  'id', u.id,
                  'userId', u.user_id,
                  'firstName', u.first_name,
                  'lastName', u.last_name,
                  'role', u.role
                ) as user
         FROM user_logs ul
         JOIN users u ON ul.user_id = u.id
         ${where}
         ORDER BY ul.created_at DESC
         LIMIT $${paramIdx}`,
        [...params, limitVal],
      )

      res.json({ logs })
    } catch (error) {
      console.log('Get user logs error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

router.get('/my', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { rows: logs } = await pool.query(
      `SELECT ul.id, ul.action, ul.details, ul.created_at as "createdAt",
              ul.user_id as "userId",
              json_build_object(
                'id', u.id,
                'userId', u.user_id,
                'firstName', u.first_name,
                'lastName', u.last_name,
                'role', u.role
              ) as user
       FROM user_logs ul
       JOIN users u ON ul.user_id = u.id
       WHERE ul.user_id = $1
       ORDER BY ul.created_at DESC
       LIMIT 50`,
      [req.user!.userId],
    )
    res.json({ logs })
  } catch (error) {
    console.log('Get my logs error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
