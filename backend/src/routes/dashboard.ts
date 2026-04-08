import { Router, Response } from 'express'
import pool from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'

const router = Router()

router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const actorId   = req.user!.userId
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

    const teamId = currentUser?.teamId

    // Build team member IDs for ADMIN scope
    let teamMemberIds: number[] = []
    if (actorRole === 'ADMIN' && teamId) {
      const { rows: members } = await pool.query(`SELECT id FROM users WHERE team_id = $1`, [teamId])
      teamMemberIds = members.map((m: any) => m.id)
    }

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const teamFilter       = actorRole === 'ADMIN' && teamId ? `AND team_id = ${teamId}` : ''
    const uploadUserFilter = actorRole === 'ADMIN' && teamMemberIds.length > 0 ? `AND uploaded_by_id = ANY(ARRAY[${teamMemberIds.join(',')}]::int[])` : ''
    const userCountFilter  = actorRole === 'ADMIN' && teamId ? `AND team_id = ${teamId} AND status = 'ACTIVE'` : `AND status = 'ACTIVE'`

    const [
      totalUsersRes, totalFilesRes, pendingRes, approvedRes,
      usersByRoleRes, filesByStatusRes, recentActivityRes,
      totalTeamsRes, tasksByStatusRes, totalTasksRes,
      totalBrdsRes, brdsByStatusRes, recentUploads7dRes,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as count FROM users WHERE 1=1 ${userCountFilter}`),
      pool.query(`SELECT COUNT(*)::int as count FROM file_uploads WHERE 1=1 ${uploadUserFilter}`),
      pool.query(`SELECT COUNT(*)::int as count FROM file_uploads WHERE status IN ('SUBMITTED','PENDING') ${uploadUserFilter}`),
      pool.query(`SELECT COUNT(*)::int as count FROM file_uploads WHERE status = 'APPROVED' ${uploadUserFilter}`),
      pool.query(`SELECT role, COUNT(*)::int as count FROM users WHERE 1=1 ${userCountFilter} GROUP BY role`),
      pool.query(`SELECT status, COUNT(*)::int as count FROM file_uploads WHERE 1=1 ${uploadUserFilter} GROUP BY status`),
      pool.query(`SELECT f.id, f.original_name as "originalName", f.file_type as "fileType", f.file_size as "fileSize", f.status, f.uploaded_at as "uploadedAt",
                         json_build_object('id', u.id, 'firstName', u.first_name, 'lastName', u.last_name, 'userId', u.user_id, 'role', u.role) as "uploadedBy"
                  FROM file_uploads f JOIN users u ON f.uploaded_by_id = u.id
                  WHERE 1=1 ${uploadUserFilter}
                  ORDER BY f.uploaded_at DESC LIMIT 10`),
      pool.query(`SELECT COUNT(*)::int as count FROM teams`),
      pool.query(`SELECT status, COUNT(*)::int as count FROM task_assignments WHERE deleted_at IS NULL ${teamFilter} GROUP BY status`),
      pool.query(`SELECT COUNT(*)::int as count FROM task_assignments WHERE deleted_at IS NULL ${teamFilter}`),
      pool.query(`SELECT COUNT(*)::int as count FROM brds`),
      pool.query(`SELECT status, COUNT(*)::int as count FROM brds GROUP BY status`),
      pool.query(`SELECT COUNT(*)::int as count FROM file_uploads WHERE uploaded_at >= $1 ${uploadUserFilter}`, [sevenDaysAgo]),
    ])

    res.json({
      currentUser,
      totalUsers:       totalUsersRes.rows[0].count,
      totalFiles:       totalFilesRes.rows[0].count,
      pendingValidation: pendingRes.rows[0].count,
      approvedTasks:    approvedRes.rows[0].count,
      totalTeams:       totalTeamsRes.rows[0].count,
      totalTasks:       totalTasksRes.rows[0].count,
      totalBrds:        totalBrdsRes.rows[0].count,
      recentUploads7d:  recentUploads7dRes.rows[0].count,
      usersByRole:      usersByRoleRes.rows,
      filesByStatus:    filesByStatusRes.rows,
      tasksByStatus:    tasksByStatusRes.rows,
      brdsByStatus:     brdsByStatusRes.rows,
      recentActivity:   recentActivityRes.rows,
    })
  } catch (error) {
    console.log('Dashboard stats error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
