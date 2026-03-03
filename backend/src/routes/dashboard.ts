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

    const [
      totalUsers,
      totalFiles,
      pendingValidation,
      approvedTasks,
      usersByRoleRaw,
      filesByStatusRaw,
      recentActivity,
      totalTeams,
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
    ]);

    res.json({
      currentUser,
      totalUsers,
      totalFiles,
      pendingValidation,
      approvedTasks,
      totalTeams,
      usersByRole: usersByRoleRaw.map((r) => ({
        role: r.role,
        count: r._count.role,
      })),
      filesByStatus: filesByStatusRaw.map((r) => ({
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
