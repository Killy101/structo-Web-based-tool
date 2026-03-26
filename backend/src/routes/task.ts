import { Router, Response } from 'express'
import pool from '../lib/db'
import { withTransaction } from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { notifyMany } from '../lib/notify'

const router = Router()

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = req.user!.role
    const actorId   = req.user!.userId

    let whereClause = `WHERE ta.deleted_at IS NULL`
    const params: unknown[] = []

    if (actorRole === 'USER') {
      whereClause += ` AND EXISTS (SELECT 1 FROM task_assignees WHERE assignment_id = ta.id AND user_id = $1)`
      params.push(actorId)
    } else if (actorRole === 'ADMIN') {
      const { rows: adminRows } = await pool.query(`SELECT team_id FROM users WHERE id = $1`, [actorId])
      const teamId = adminRows[0]?.team_id
      if (!teamId) return res.json({ tasks: [] })
      whereClause += ` AND ta.team_id = $1`
      params.push(teamId)
    }

    const { rows: tasks } = await pool.query(
      `SELECT ta.id, ta.title, ta.description, ta.status, ta.percentage,
              ta.created_at as "createdAt", ta.updated_at as "updatedAt",
              ta.deleted_at as "deletedAt", ta.due_date as "dueDate",
              ta.team_id as "teamId", ta.created_by_id as "createdById",
              ta.brd_file_id as "brdFileId",
              json_build_object('id', t.id, 'name', t.name) as team,
              json_build_object('id', cb.id, 'userId', cb.user_id, 'firstName', cb.first_name, 'lastName', cb.last_name) as "createdBy",
              COALESCE(json_agg(
                json_build_object('id', tas.id, 'userId', tas.user_id, 'assignedAt', tas.assigned_at,
                  'user', json_build_object('id', au.id, 'userId', au.user_id, 'firstName', au.first_name, 'lastName', au.last_name))
              ) FILTER (WHERE tas.id IS NOT NULL), '[]') as assignees,
              CASE WHEN fu.id IS NOT NULL THEN json_build_object('id', fu.id, 'originalName', fu.original_name, 'status', fu.status) ELSE NULL END as "brdFile"
       FROM task_assignments ta
       JOIN teams t ON ta.team_id = t.id
       JOIN users cb ON ta.created_by_id = cb.id
       LEFT JOIN task_assignees tas ON tas.assignment_id = ta.id
       LEFT JOIN users au ON tas.user_id = au.id
       LEFT JOIN file_uploads fu ON ta.brd_file_id = fu.id
       ${whereClause}
       GROUP BY ta.id, t.id, cb.id, fu.id
       ORDER BY ta.created_at DESC`,
      params,
    )

    res.json({ tasks })
  } catch (error) {
    console.error('Get tasks error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, assigneeIds, brdFileId, dueDate } = req.body
    const actorId   = req.user!.userId
    const actorRole = req.user!.role

    if (!title?.trim()) return res.status(400).json({ error: 'Task title is required' })
    if (!Array.isArray(assigneeIds) || assigneeIds.length === 0) return res.status(400).json({ error: 'At least one assignee is required' })
    if (assigneeIds.length > 3) return res.status(400).json({ error: 'Maximum 3 assignees per task' })

    let teamId: number | null = null
    if (actorRole === 'ADMIN') {
      const { rows } = await pool.query(`SELECT team_id FROM users WHERE id = $1`, [actorId])
      teamId = rows[0]?.team_id ?? null
    } else {
      const { rows } = await pool.query(`SELECT team_id FROM users WHERE id = $1`, [assigneeIds[0]])
      teamId = rows[0]?.team_id ?? null
    }
    if (!teamId) return res.status(400).json({ error: 'Could not determine team for this task' })

    if (brdFileId) {
      const { rows } = await pool.query(`SELECT id FROM file_uploads WHERE id = $1`, [brdFileId])
      if (!rows[0]) return res.status(400).json({ error: 'BRD file not found' })
    }

    const task = await withTransaction(async (client) => {
      const { rows: created } = await client.query(
        `INSERT INTO task_assignments (title, description, team_id, created_by_id, brd_file_id, due_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [title.trim(), description?.trim() || null, teamId, actorId, brdFileId || null, dueDate ? new Date(dueDate) : null],
      )
      const taskId = created[0].id
      for (const uid of assigneeIds) {
        await client.query(`INSERT INTO task_assignees (assignment_id, user_id) VALUES ($1, $2)`, [taskId, uid])
      }
      return created[0]
    })

    const { rows: fullTask } = await pool.query(
      `SELECT ta.id, ta.title, ta.description, ta.status, ta.percentage,
              ta.created_at as "createdAt", ta.due_date as "dueDate",
              json_build_object('id', t.id, 'name', t.name) as team,
              COALESCE(json_agg(
                json_build_object('id', tas.id, 'userId', tas.user_id,
                  'user', json_build_object('id', au.id, 'userId', au.user_id, 'firstName', au.first_name, 'lastName', au.last_name))
              ) FILTER (WHERE tas.id IS NOT NULL), '[]') as assignees
       FROM task_assignments ta
       JOIN teams t ON ta.team_id = t.id
       LEFT JOIN task_assignees tas ON tas.assignment_id = ta.id
       LEFT JOIN users au ON tas.user_id = au.id
       WHERE ta.id = $1
       GROUP BY ta.id, t.id`,
      [task.id],
    )

    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'TASK_CREATED', $2)`, [actorId, `Created task "${title.trim()}" assigned to ${assigneeIds.length} user(s)`])
    await notifyMany(assigneeIds, 'TASK_ASSIGNED', 'New Task Assigned', `You have been assigned to task: "${title.trim()}"`, { taskId: task.id })

    res.status(201).json({ message: 'Task created', task: fullTask[0] })
  } catch (error) {
    console.error('Create task error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id/progress', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const taskId    = parseInt(req.params.id)
    const { percentage, status } = req.body
    const actorId   = req.user!.userId
    const actorRole = req.user!.role

    const { rows: taskRows } = await pool.query(
      `SELECT ta.*, json_agg(json_build_object('userId', tas.user_id)) as assignees
       FROM task_assignments ta
       LEFT JOIN task_assignees tas ON tas.assignment_id = ta.id
       WHERE ta.id = $1
       GROUP BY ta.id`,
      [taskId],
    )
    const task = taskRows[0]
    if (!task) return res.status(404).json({ error: 'Task not found' })

    if (actorRole === 'USER') {
      const isAssigned = task.assignees.some((a: any) => a.userId === actorId)
      if (!isAssigned) return res.status(403).json({ error: 'You are not assigned to this task' })
    }

    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (percentage !== undefined) {
      if (percentage < 0 || percentage > 100) return res.status(400).json({ error: 'Percentage must be between 0 and 100' })
      sets.push(`percentage = $${idx++}`)
      params.push(percentage)
    }

    let finalStatus = status
    if (percentage === 100) finalStatus = 'COMPLETED'
    else if (percentage > 0 && !status) finalStatus = 'IN_PROGRESS'

    if (finalStatus) { sets.push(`status = $${idx++}`); params.push(finalStatus) }
    sets.push(`updated_at = NOW()`)
    params.push(taskId)

    const { rows: updated } = await pool.query(
      `UPDATE task_assignments SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    )

    await pool.query(`INSERT INTO user_logs (user_id, action, details) VALUES ($1, 'TASK_PROGRESS', $2)`, [actorId, `Updated task "${task.title}" to ${percentage ?? updated[0].percentage}%`])
    res.json({ message: 'Task updated', task: updated[0] })
  } catch (error) {
    console.error('Update task error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const taskId = parseInt(req.params.id)
    const { rows: taskRows } = await pool.query(`SELECT id FROM task_assignments WHERE id = $1`, [taskId])
    if (!taskRows[0]) return res.status(404).json({ error: 'Task not found' })

    const { rows: comments } = await pool.query(
      `SELECT tc.id, tc.assignment_id as "assignmentId", tc.body, tc.created_at as "createdAt", tc.updated_at as "updatedAt",
              json_build_object('id', u.id, 'userId', u.user_id, 'firstName', u.first_name, 'lastName', u.last_name) as author
       FROM task_comments tc
       JOIN users u ON tc.author_id = u.id
       WHERE tc.assignment_id = $1
       ORDER BY tc.created_at ASC`,
      [taskId],
    )
    res.json({ comments })
  } catch (error) {
    console.error('Get comments error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const taskId  = parseInt(req.params.id)
    const actorId = req.user!.userId
    const { body } = req.body

    if (!body?.trim()) return res.status(400).json({ error: 'Comment body is required' })

    const { rows: taskRows } = await pool.query(
      `SELECT ta.*, json_agg(json_build_object('userId', tas.user_id)) as assignees
       FROM task_assignments ta
       LEFT JOIN task_assignees tas ON tas.assignment_id = ta.id
       WHERE ta.id = $1 GROUP BY ta.id`,
      [taskId],
    )
    if (!taskRows[0]) return res.status(404).json({ error: 'Task not found' })

    const { rows: commentRows } = await pool.query(
      `INSERT INTO task_comments (assignment_id, author_id, body) VALUES ($1, $2, $3)
       RETURNING id, assignment_id as "assignmentId", body, created_at as "createdAt", updated_at as "updatedAt"`,
      [taskId, actorId, body.trim()],
    )

    const { rows: authorRows } = await pool.query(
      `SELECT id, user_id as "userId", first_name as "firstName", last_name as "lastName" FROM users WHERE id = $1`,
      [actorId],
    )
    const comment = { ...commentRows[0], author: authorRows[0] }

    const assigneeUserIds = (taskRows[0].assignees as any[]).map((a: any) => a.userId).filter((uid: number) => uid !== actorId)
    if (assigneeUserIds.length > 0) {
      await notifyMany(assigneeUserIds, 'TASK_UPDATED', 'New Comment on Task', `A comment was added to task: "${taskRows[0].title}"`, { taskId })
    }

    res.status(201).json({ comment })
  } catch (error) {
    console.error('Create comment error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/:id/comments/:commentId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const commentId = parseInt(req.params.commentId)
    const actorId   = req.user!.userId
    const actorRole = req.user!.role

    const { rows: commentRows } = await pool.query(`SELECT * FROM task_comments WHERE id = $1`, [commentId])
    if (!commentRows[0]) return res.status(404).json({ error: 'Comment not found' })

    const canDelete = commentRows[0].author_id === actorId || actorRole === 'ADMIN' || actorRole === 'SUPER_ADMIN'
    if (!canDelete) return res.status(403).json({ error: 'Forbidden' })

    await pool.query(`DELETE FROM task_comments WHERE id = $1`, [commentId])
    res.json({ message: 'Comment deleted' })
  } catch (error) {
    console.error('Delete comment error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/:id', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const taskId = parseInt(req.params.id)
    const { rows } = await pool.query(`SELECT deleted_at FROM task_assignments WHERE id = $1`, [taskId])
    if (!rows[0] || rows[0].deleted_at !== null) return res.status(404).json({ error: 'Task not found' })
    await pool.query(`UPDATE task_assignments SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [taskId])
    res.json({ message: 'Task deleted' })
  } catch (error) {
    console.error('Delete task error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/restore', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const taskId = parseInt(req.params.id)
    const { rows } = await pool.query(`SELECT deleted_at FROM task_assignments WHERE id = $1`, [taskId])
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' })
    if (rows[0].deleted_at === null) return res.status(400).json({ error: 'Task is not deleted' })
    await pool.query(`UPDATE task_assignments SET deleted_at = NULL, updated_at = NOW() WHERE id = $1`, [taskId])
    res.json({ message: 'Task restored' })
  } catch (error) {
    console.error('Restore task error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
