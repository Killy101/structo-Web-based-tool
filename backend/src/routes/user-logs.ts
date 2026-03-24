// ─── BACKEND: routes/user-logs.ts ──────────────────────────
import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";

const router = Router();

// ─── GET /user-logs ────────────────────────────────────────
// Admin sees logs for their team members; SuperAdmin sees all
router.get(
  "/",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const actorRole = req.user!.role;
      let where: any = {};

      if (actorRole === "ADMIN") {
        const admin = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { teamId: true },
        });
        if (admin?.teamId) {
          // Get user IDs in admin's team
          const teamMembers = await prisma.user.findMany({
            where: { teamId: admin.teamId },
            select: { id: true },
          });
          where.userId = { in: teamMembers.map((m) => m.id) };
        } else {
          return res.json({ logs: [] });
        }

        // Admins must not see their own login/logout — only SUPER_ADMIN
        // can view their own session events.
        where.NOT = {
          AND: [
            { userId: req.user!.userId },
            { action: { in: ["LOGIN", "LOGOUT"] } },
          ],
        };
      }

      // Optional filters
      const { userId, action, limit } = req.query;
      if (userId) where.userId = parseInt(userId as string);
      if (action) where.action = action as string;

      const logs = await prisma.userLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit ? parseInt(limit as string) : 100,
        include: {
          user: {
            select: {
              id: true,
              userId: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
      });

      res.json({ logs });
    } catch (error) {
      console.error("Get user logs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── GET /user-logs/my ─────────────────────────────────────
// Any user can see their own logs
router.get("/my", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const logs = await prisma.userLog.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: {
          select: {
            id: true,
            userId: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    res.json({ logs });
  } catch (error) {
    console.error("Get my logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
