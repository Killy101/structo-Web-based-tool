import { Router, Response } from 'express'
import pool from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'

const router = Router()

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    const role   = req.user!.role

    const { rows: stored } = await pool.query(
      `SELECT id, user_id as "userId", type, title, message, is_read as "isRead", meta, created_at as "createdAt"
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId],
    )

    const active = stored.filter((n) => {
      const m = n.meta as Record<string, unknown> | null
      return !m?.archived
    })

    const virtual: typeof active = []

    if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      const { rows: recentBrds } = await pool.query(
        `SELECT b.brd_id as "brdId", b.title, b.created_at as "createdAt",
                u.user_id as "creatorUserId", u.first_name as "creatorFirstName", u.last_name as "creatorLastName"
         FROM brds b
         LEFT JOIN users u ON b.created_by_id = u.id
         WHERE b.created_at >= $1
         ORDER BY b.created_at DESC
         LIMIT 20`,
        [sevenDaysAgo],
      )

      for (const brd of recentBrds) {
        const uploaderName = [brd.creatorFirstName, brd.creatorLastName].filter(Boolean).join(' ') || brd.creatorUserId || 'Unknown'
        const alreadyStored = active.some((n) => (n.meta as Record<string, unknown> | null)?.brdId === brd.brdId)
        if (!alreadyStored) {
          virtual.push({
            id: -(Math.abs(brd.brdId.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0)) + 100000),
            userId,
            type: 'BRD_STATUS',
            title: 'BRD Source Uploaded',
            message: `${uploaderName} uploaded "${brd.title ?? brd.brdId}"`,
            isRead: true,
            meta: { brdId: brd.brdId, virtual: true },
            createdAt: brd.createdAt,
          } as any)
        }
      }

      const { rows: recentUsers } = await pool.query(
        `SELECT id, user_id as "userId", first_name as "firstName", last_name as "lastName", role, created_at as "createdAt"
         FROM users
         WHERE created_at >= $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [sevenDaysAgo],
      )

      for (const nu of recentUsers) {
        const fullName = [nu.firstName, nu.lastName].filter(Boolean).join(' ') || nu.userId
        const alreadyStored = active.some((n) => (n.meta as Record<string, unknown> | null)?.newUserId === nu.userId)
        if (!alreadyStored) {
          virtual.push({
            id: -(nu.id + 200000),
            userId,
            type: 'SYSTEM',
            title: 'New User Registered',
            message: `${fullName} (${nu.userId}) joined as ${nu.role}`,
            isRead: true,
            meta: { newUserId: nu.userId, virtual: true },
            createdAt: nu.createdAt,
          } as any)
        }
      }
    }

    const all = [...active, ...virtual]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100)

    const unreadCount = active.filter((n) => !n.isRead).length
    res.json({ notifications: all, unreadCount })
  } catch (error) {
    console.log('Get notifications error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/archived', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    const { rows } = await pool.query(
      `SELECT id, user_id as "userId", type, title, message, is_read as "isRead", meta, created_at as "createdAt"
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId],
    )
    const archived = rows.filter((n) => {
      const m = n.meta as Record<string, unknown> | null
      return m?.archived === true
    })
    res.json({ notifications: archived })
  } catch (error) {
    console.log('Get archived notifications error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId  = req.user!.userId
    const notifId = parseInt(req.params.id as string)

    const { rows } = await pool.query(
      `SELECT id, user_id as "userId" FROM notifications WHERE id = $1`,
      [notifId],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Notification not found' })
    if (rows[0].userId !== userId) return res.status(403).json({ error: 'Forbidden' })

    const { rows: updated } = await pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1
       RETURNING id, user_id as "userId", type, title, message, is_read as "isRead", meta, created_at as "createdAt"`,
      [notifId],
    )
    res.json({ notification: updated[0] })
  } catch (error) {
    console.log('Mark notification read error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/read-all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId
    await pool.query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [userId])
    res.json({ message: 'All notifications marked as read' })
  } catch (error) {
    console.log('Mark all read error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId  = req.user!.userId
    const notifId = parseInt(req.params.id as string)

    if (notifId < 0) return res.json({ message: 'Notification deleted' })

    const { rows } = await pool.query(
      `SELECT id, user_id as "userId" FROM notifications WHERE id = $1`,
      [notifId],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Notification not found' })
    if (rows[0].userId !== userId) return res.status(403).json({ error: 'Forbidden' })

    await pool.query(`DELETE FROM notifications WHERE id = $1`, [notifId])
    res.json({ message: 'Notification deleted' })
  } catch (error) {
    console.log('Delete notification error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/archive', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId  = req.user!.userId
    const notifId = parseInt(req.params.id as string)

    if (notifId < 0) return res.json({ message: 'Notification archived' })

    const { rows } = await pool.query(
      `SELECT id, user_id as "userId", meta FROM notifications WHERE id = $1`,
      [notifId],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Notification not found' })
    if (rows[0].userId !== userId) return res.status(403).json({ error: 'Forbidden' })

    const existingMeta = (rows[0].meta as Record<string, unknown>) ?? {}
    const newMeta = { ...existingMeta, archived: true }

    const { rows: updated } = await pool.query(
      `UPDATE notifications SET is_read = true, meta = $1 WHERE id = $2
       RETURNING id, user_id as "userId", type, title, message, is_read as "isRead", meta, created_at as "createdAt"`,
      [JSON.stringify(newMeta), notifId],
    )
    res.json({ notification: updated[0] })
  } catch (error) {
    console.log('Archive notification error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
