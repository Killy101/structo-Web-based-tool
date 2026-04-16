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
        const teamId = req.user!.teamId
        if (!teamId) return res.json({ logs: [] })

        // Filter to team members via subquery — avoids 2 separate round-trips
        conditions.push(`ul.user_id IN (SELECT id FROM users WHERE team_id = $${paramIdx++})`)
        params.push(teamId)

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

router.post('/compare', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { fileA, fileB } = req.body
    if (!fileA || !fileB) return res.status(400).json({ error: 'fileA and fileB are required' })

    await pool.query(
      `INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'BRD_COMPARE_RUN', $2)`,
      [req.user!.userId, `Compared "${fileA}" vs "${fileB}"`],
    )
    return res.status(201).json({ success: true })
  } catch (error) {
    console.log('Log compare error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

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
