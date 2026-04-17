import { Router, Response } from 'express'
import pool from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'

const router = Router()

router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const actorId = req.user!.userId
    const actorRole = req.user!.role

    const { rows: userRows } = await pool.query(
      `SELECT u.id, u.user_id as "userId", u.first_name as "firstName", u.last_name as "lastName",
              u.role, u.team_id as "teamId",
              CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'name', t.name) ELSE NULL END as team
       FROM users u LEFT JOIN teams t ON u.team_id = t.id
       WHERE u.id = $1`,
      [actorId],
    )
    const currentUser = userRows[0] ?? null
    const teamId = currentUser?.teamId ?? null

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const userWhere = [`status = 'ACTIVE'`]
    const userParams: unknown[] = []
    const uploadWhere: string[] = []
    const uploadParams: unknown[] = []
    const taskWhere = [`deleted_at IS NULL`]
    const taskParams: unknown[] = []
    const brdWhere = [`deleted_at IS NULL`]
    const brdParams: unknown[] = []

    let totalTeamsCount = 0

    if (actorRole === 'ADMIN') {
      if (teamId) {
        userParams.push(teamId)
        userWhere.push(`team_id = $${userParams.length}`)

        uploadParams.push(teamId)
        uploadWhere.push(`uploaded_by_id IN (SELECT id FROM users WHERE team_id = $${uploadParams.length})`)

        taskParams.push(teamId)
        taskWhere.push(`team_id = $${taskParams.length}`)

        brdParams.push(teamId)
        brdWhere.push(`created_by_id IN (SELECT id FROM users WHERE team_id = $${brdParams.length})`)

        totalTeamsCount = 1
      } else {
        userWhere.push(`1 = 0`)
        uploadWhere.push(`1 = 0`)
        taskWhere.push(`1 = 0`)
        brdWhere.push(`1 = 0`)
      }
    } else if (actorRole === 'USER') {
      userParams.push(actorId)
      userWhere.push(`id = $${userParams.length}`)

      uploadParams.push(actorId)
      uploadWhere.push(`uploaded_by_id = $${uploadParams.length}`)

      taskParams.push(actorId)
      taskWhere.push(`EXISTS (SELECT 1 FROM task_assignees WHERE assignment_id = task_assignments.id AND user_id = $${taskParams.length})`)

      brdParams.push(actorId)
      brdWhere.push(`created_by_id = $${brdParams.length}`)

      totalTeamsCount = teamId ? 1 : 0
    } else {
      const { rows: teamRows } = await pool.query(`SELECT COUNT(*)::int as count FROM teams`)
      totalTeamsCount = teamRows[0]?.count ?? 0
    }

    const uploadScopeClause = uploadWhere.length > 0 ? ` AND ${uploadWhere.join(' AND ')}` : ''

    const [
      totalUsersRes, totalFilesRes, pendingRes, approvedRes,
      usersByRoleRes, filesByStatusRes, recentActivityRes,
      tasksByStatusRes, totalTasksRes, totalBrdsRes,
      brdsByStatusRes, recentUploads7dRes,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as count FROM users WHERE ${userWhere.join(' AND ')}`, userParams),
      pool.query(`SELECT COUNT(*)::int as count FROM file_uploads WHERE 1=1${uploadScopeClause}`, uploadParams),
      pool.query(`SELECT COUNT(*)::int as count FROM file_uploads WHERE status IN ('SUBMITTED','PENDING')${uploadScopeClause}`, uploadParams),
      pool.query(`SELECT COUNT(*)::int as count FROM file_uploads WHERE status = 'APPROVED'${uploadScopeClause}`, uploadParams),
      pool.query(`SELECT role, COUNT(*)::int as count FROM users WHERE ${userWhere.join(' AND ')} GROUP BY role`, userParams),
      pool.query(`SELECT status, COUNT(*)::int as count FROM file_uploads WHERE 1=1${uploadScopeClause} GROUP BY status`, uploadParams),
      pool.query(`SELECT f.id, f.original_name as "originalName", f.file_type as "fileType", f.file_size as "fileSize", f.status, f.uploaded_at as "uploadedAt",
                         json_build_object('id', u.id, 'firstName', u.first_name, 'lastName', u.last_name, 'userId', u.user_id, 'role', u.role) as "uploadedBy"
                  FROM file_uploads f JOIN users u ON f.uploaded_by_id = u.id
                  WHERE 1=1${uploadScopeClause}
                  ORDER BY f.uploaded_at DESC LIMIT 10`, uploadParams),
      pool.query(`SELECT status, COUNT(*)::int as count FROM task_assignments WHERE ${taskWhere.join(' AND ')} GROUP BY status`, taskParams),
      pool.query(`SELECT COUNT(*)::int as count FROM task_assignments WHERE ${taskWhere.join(' AND ')}`, taskParams),
      pool.query(`SELECT COUNT(*)::int as count FROM brds WHERE ${brdWhere.join(' AND ')}`, brdParams),
      pool.query(`SELECT status, COUNT(*)::int as count FROM brds WHERE ${brdWhere.join(' AND ')} GROUP BY status`, brdParams),
      pool.query(`SELECT COUNT(*)::int as count FROM file_uploads WHERE uploaded_at >= $1${uploadScopeClause}`,
        [sevenDaysAgo, ...uploadParams]),
    ])

    res.json({
      currentUser,
      totalUsers: totalUsersRes.rows[0].count,
      totalFiles: totalFilesRes.rows[0].count,
      pendingValidation: pendingRes.rows[0].count,
      approvedTasks: approvedRes.rows[0].count,
      totalTeams: totalTeamsCount,
      totalTasks: totalTasksRes.rows[0].count,
      totalBrds: totalBrdsRes.rows[0].count,
      recentUploads7d: recentUploads7dRes.rows[0].count,
      usersByRole: usersByRoleRes.rows,
      filesByStatus: filesByStatusRes.rows,
      tasksByStatus: tasksByStatusRes.rows,
      brdsByStatus: brdsByStatusRes.rows,
      recentActivity: recentActivityRes.rows,
    })
  } catch (error) {
    console.log('Dashboard stats error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
