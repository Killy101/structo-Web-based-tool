import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/authenticate';

const router = Router();

// GET /dashboard/stats
// Returns all stats the dashboard needs in a single call
router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalUsers,
      totalFiles,
      pendingValidation,
      approvedTasks,
      usersByRoleRaw,
      filesByStatusRaw,
      recentActivity,
    ] = await Promise.all([
      // Total users
      prisma.user.count({ where: { status: 'ACTIVE' } }),

      // Total files
      prisma.fileUpload.count(),

      // Files submitted but not yet reviewed
      prisma.fileUpload.count({
        where: { status: { in: ['SUBMITTED', 'PENDING'] } },
      }),

      // Approved files
      prisma.fileUpload.count({ where: { status: 'APPROVED' } }),

      // Users grouped by role
      prisma.user.groupBy({
        by: ['role'],
        _count: { role: true },
      }),

      // Files grouped by status
      prisma.fileUpload.groupBy({
        by: ['status'],
        _count: { status: true },
      }),

      // Recent activity – last 10 uploads with uploader info
      prisma.fileUpload.findMany({
        take: 10,
        orderBy: { uploadedAt: 'desc' },
        include: {
          uploadedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    ]);

    res.json({
      totalUsers,
      totalFiles,
      pendingValidation,
      approvedTasks,
      usersByRole: usersByRoleRaw.map(r => ({ role: r.role, count: r._count.role })),
      filesByStatus: filesByStatusRaw.map(r => ({ status: r.status, count: r._count.status })),
      recentActivity,
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;