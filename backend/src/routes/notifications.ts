import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";

const router = Router();

// ── GET /notifications ─────────────────────────────────────
// Returns all notifications for the authenticated user
router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /notifications/:id/read ──────────────────────────
// Mark a single notification as read
router.patch(
  "/:id/read",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const notifId = parseInt(req.params.id as string);

      const notif = await prisma.notification.findUnique({
        where: { id: notifId },
      });

      if (!notif) return res.status(404).json({ error: "Notification not found" });
      if (notif.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      const updated = await prisma.notification.update({
        where: { id: notifId },
        data: { isRead: true },
      });

      res.json({ notification: updated });
    } catch (error) {
      console.error("Mark notification read error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /notifications/read-all ──────────────────────────
// Mark all notifications as read for the authenticated user
router.patch(
  "/read-all",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });

      res.json({ message: "All notifications marked as read" });
    } catch (error) {
      console.error("Mark all read error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── DELETE /notifications/:id ──────────────────────────────
router.delete(
  "/:id",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const notifId = parseInt(req.params.id as string);

      const notif = await prisma.notification.findUnique({
        where: { id: notifId },
      });

      if (!notif) return res.status(404).json({ error: "Notification not found" });
      if (notif.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      await prisma.notification.delete({ where: { id: notifId } });
      res.json({ message: "Notification deleted" });
    } catch (error) {
      console.error("Delete notification error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
