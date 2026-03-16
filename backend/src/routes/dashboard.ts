import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";

const router = Router();

router.get("/stats", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const actorId = req.user!.userId;
    const actorRole = req.user!.role;

    const currentUser = await prisma.user.findUnique({
      where: { id: actorId },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        role: true,
        teamId: true,
        team: { select: { id: true, name: true } },
      },
    });

    let teamFilter: any = {};
    if (actorRole === "ADMIN" && currentUser?.teamId) {
      const teamMemberIds = await prisma.user.findMany({
        where: { teamId: currentUser.teamId },
        select: { id: true },
      });
      teamFilter = { uploadedById: { in: teamMemberIds.map((m) => m.id) } };
    }

    const userCountFilter =
      actorRole === "ADMIN" && currentUser?.teamId
        ? { teamId: currentUser.teamId, status: "ACTIVE" as const }
        : { status: "ACTIVE" as const };

    // Task filter based on role
    let taskFilter: any = {};
    if (actorRole === "ADMIN" && currentUser?.teamId) {
      taskFilter = { teamId: currentUser.teamId };
    }

    // Last 7 days for trend data
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      totalUsers,
      totalFiles,
      pendingValidation,
      approvedTasks,
      usersByRoleRaw,
      filesByStatusRaw,
      recentActivity,
      totalTeams,
      tasksByStatusRaw,
      totalTasks,
      totalBrds,
      brdsByStatusRaw,
      recentUploads7d,
    ] = await Promise.all([
      prisma.user.count({ where: userCountFilter }),
      prisma.fileUpload.count({ where: teamFilter }),
      prisma.fileUpload.count({
        where: { status: { in: ["SUBMITTED", "PENDING"] }, ...teamFilter },
      }),
      prisma.fileUpload.count({
        where: { status: "APPROVED", ...teamFilter },
      }),
      prisma.user.groupBy({
        by: ["role"],
        where: userCountFilter,
        _count: { role: true },
      }),
      prisma.fileUpload.groupBy({
        by: ["status"],
        where: teamFilter,
        _count: { status: true },
      }),
      prisma.fileUpload.findMany({
        take: 10,
        where: teamFilter,
        orderBy: { uploadedAt: "desc" },
        include: {
          uploadedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              userId: true,
              role: true,
            },
          },
        },
      }),
      prisma.team.count(),
      // Task stats
      prisma.taskAssignment.groupBy({
        by: ["status"],
        where: taskFilter,
        _count: { status: true },
      }),
      prisma.taskAssignment.count({ where: taskFilter }),
      // BRD stats
      prisma.brd.count(),
      prisma.brd.groupBy({
        by: ["status"],
        _count: { status: true },
      }),
      // Upload trend: last 7 days
      prisma.fileUpload.count({
        where: {
          uploadedAt: { gte: sevenDaysAgo },
          ...teamFilter,
        },
      }),
    ]);

    res.json({
      currentUser,
      totalUsers,
      totalFiles,
      pendingValidation,
      approvedTasks,
      totalTeams,
      totalTasks,
      totalBrds,
      recentUploads7d,
      usersByRole: usersByRoleRaw.map((r) => ({
        role: r.role,
        count: r._count.role,
      })),
      filesByStatus: filesByStatusRaw.map((r) => ({
        status: r.status,
        count: r._count.status,
      })),
      tasksByStatus: tasksByStatusRaw.map((r) => ({
        status: r.status,
        count: r._count.status,
      })),
      brdsByStatus: brdsByStatusRaw.map((r) => ({
        status: r.status,
        count: r._count.status,
      })),
      recentActivity,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
