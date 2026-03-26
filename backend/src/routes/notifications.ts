import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";

const router = Router();

// ── GET /notifications ─────────────────────────────────────
// Returns all non-archived notifications for the authenticated user.
// For SUPER_ADMIN / ADMIN roles, also injects virtual feed items for
// recent BRD uploads and new user registrations (last 7 days).
router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const role   = req.user!.role;

    // Fetch stored notifications, skipping archived ones
    const stored = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Filter out archived in application layer (meta.archived === true)
    const active = stored.filter((n) => {
      const m = n.meta as Record<string, unknown> | null;
      return !m?.archived;
    });

    // ── Admin-level virtual notifications ──────────────────
    // Inject recent BRD uploads and new users for privileged roles
    const virtual: typeof active = [];

    if (role === "SUPER_ADMIN" || role === "ADMIN") {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Recent BRD uploads (last 7 days, latest 20)
      const recentBrds = await prisma.brd.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          brdId: true,
          title: true,
          createdAt: true,
          createdBy: { select: { userId: true, firstName: true, lastName: true } },
        },
      });

      for (const brd of recentBrds) {
        const uploaderName = [brd.createdBy?.firstName, brd.createdBy?.lastName]
          .filter(Boolean).join(" ") || brd.createdBy?.userId || "Unknown";
        // Only inject if there is no matching stored notification to avoid duplicates
        const alreadyStored = active.some(
          (n) => (n.meta as Record<string, unknown> | null)?.brdId === brd.brdId,
        );
        if (!alreadyStored) {
          virtual.push({
            id: -(brd.id + 100000), // negative synthetic ID
            userId,
            type: "BRD_STATUS",
            title: "BRD Source Uploaded",
            message: `${uploaderName} uploaded "${brd.title ?? brd.brdId}"`,
            isRead: true,
            meta: { brdId: brd.brdId, virtual: true },
            createdAt: brd.createdAt,
          } as typeof active[0]);
        }
      }

      // Recent user registrations (last 7 days)
      const recentUsers = await prisma.user.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          userId: true,
          firstName: true,
          lastName: true,
          role: true,
          createdAt: true,
        },
      });

      for (const nu of recentUsers) {
        const fullName = [nu.firstName, nu.lastName].filter(Boolean).join(" ") || nu.userId;
        const alreadyStored = active.some(
          (n) => (n.meta as Record<string, unknown> | null)?.newUserId === nu.userId,
        );
        if (!alreadyStored) {
          virtual.push({
            id: -(nu.id + 200000),
            userId,
            type: "SYSTEM",
            title: "New User Registered",
            message: `${fullName} (${nu.userId}) joined as ${nu.role}`,
            isRead: true,
            meta: { newUserId: nu.userId, virtual: true },
            createdAt: nu.createdAt,
          } as typeof active[0]);
        }
      }
    }

    // Merge and sort by createdAt desc
    const all = [...active, ...virtual].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ).slice(0, 100);

    const unreadCount = active.filter((n) => !n.isRead).length;

    res.json({ notifications: all, unreadCount });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /notifications/archived ────────────────────────────
// Returns archived notifications for the authenticated user
router.get("/archived", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const stored = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const archived = stored.filter((n) => {
      const m = n.meta as Record<string, unknown> | null;
      return m?.archived === true;
    });
    res.json({ notifications: archived });
  } catch (error) {
    console.error("Get archived notifications error:", error);
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

      // Virtual (synthetic negative) notifications have no DB row to delete
      if (notifId < 0) {
        return res.json({ message: "Notification deleted" });
      }

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

// ── PATCH /notifications/:id/archive ──────────────────────
// Soft-archive a notification by setting meta.archived = true
router.patch(
  "/:id/archive",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId  = req.user!.userId;
      const notifId = parseInt(req.params.id as string);

      // Virtual notifications have no DB row — just acknowledge
      if (notifId < 0) {
        return res.json({ message: "Notification archived" });
      }

      const notif = await prisma.notification.findUnique({ where: { id: notifId } });
      if (!notif) return res.status(404).json({ error: "Notification not found" });
      if (notif.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      const existingMeta = (notif.meta as Record<string, unknown>) ?? {};
      const updated = await prisma.notification.update({
        where: { id: notifId },
        data: {
          isRead: true,
          meta: { ...existingMeta, archived: true } as Prisma.InputJsonValue,
        },
      });

      res.json({ notification: updated });
    } catch (error) {
      console.error("Archive notification error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
