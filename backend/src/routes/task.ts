import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";

const router = Router();

// ── GET /tasks ────────────────────────────────────────────
router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const actorRole = req.user!.role;
    const actorId = req.user!.userId;

    let whereClause: any = {};

    if (
      actorRole === "USER" ||
      actorRole === "MANAGER_QA" ||
      actorRole === "MANAGER_QC"
    ) {
      whereClause = { assignees: { some: { userId: actorId } } };
    } else if (actorRole === "ADMIN") {
      const admin = await prisma.user.findUnique({
        where: { id: actorId },
        select: { teamId: true },
      });
      if (admin?.teamId) {
        whereClause = { teamId: admin.teamId };
      } else {
        return res.json({ tasks: [] });
      }
    }

    const tasks = await prisma.taskAssignment.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      include: {
        team: { select: { id: true, name: true } },
        createdBy: {
          select: { id: true, userId: true, firstName: true, lastName: true },
        },
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                userId: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        brdFile: {
          select: { id: true, originalName: true, status: true },
        },
      },
    });

    res.json({ tasks });
  } catch (error) {
    console.error("Get tasks error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /tasks ───────────────────────────────────────────
router.post(
  "/",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { title, description, assigneeIds, brdFileId, dueDate } = req.body;
      const actorId = req.user!.userId;
      const actorRole = req.user!.role;

      if (!title || !title.trim()) {
        return res.status(400).json({ error: "Task title is required" });
      }

      if (
        !assigneeIds ||
        !Array.isArray(assigneeIds) ||
        assigneeIds.length === 0
      ) {
        return res
          .status(400)
          .json({ error: "At least one assignee is required" });
      }

      if (assigneeIds.length > 3) {
        return res.status(400).json({ error: "Maximum 3 assignees per task" });
      }

      let teamId: number | null = null;
      if (actorRole === "ADMIN") {
        const admin = await prisma.user.findUnique({
          where: { id: actorId },
          select: { teamId: true },
        });
        teamId = admin?.teamId ?? null;
      } else {
        const firstAssignee = await prisma.user.findUnique({
          where: { id: assigneeIds[0] },
          select: { teamId: true },
        });
        teamId = firstAssignee?.teamId ?? null;
      }

      if (!teamId) {
        return res
          .status(400)
          .json({ error: "Could not determine team for this task" });
      }

      if (brdFileId) {
        const file = await prisma.fileUpload.findUnique({
          where: { id: brdFileId },
        });
        if (!file) {
          return res.status(400).json({ error: "BRD file not found" });
        }
      }

      const task = await prisma.taskAssignment.create({
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          teamId,
          createdById: actorId,
          brdFileId: brdFileId || null,
          dueDate: dueDate ? new Date(dueDate) : null,
          assignees: {
            create: assigneeIds.map((uid: number) => ({ userId: uid })),
          },
        },
        include: {
          assignees: {
            include: {
              user: {
                select: {
                  id: true,
                  userId: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          team: { select: { id: true, name: true } },
        },
      });

      await prisma.userLog.create({
        data: {
          userId: actorId,
          action: "TASK_CREATED",
          details: `Created task "${title.trim()}" assigned to ${assigneeIds.length} user(s)`,
        },
      });

      res.status(201).json({ message: "Task created", task });
    } catch (error) {
      console.error("Create task error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /tasks/:id/progress ─────────────────────────────
router.patch(
  "/:id/progress",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const taskId = parseInt(req.params.id as string);
      const { percentage, status } = req.body;
      const actorId = req.user!.userId;
      const actorRole = req.user!.role;

      const task = await prisma.taskAssignment.findUnique({
        where: { id: taskId },
        include: { assignees: true },
      });

      if (!task) return res.status(404).json({ error: "Task not found" });

      if (
        actorRole === "USER" ||
        actorRole === "MANAGER_QA" ||
        actorRole === "MANAGER_QC"
      ) {
        const isAssigned = task.assignees.some((a) => a.userId === actorId);
        if (!isAssigned) {
          return res
            .status(403)
            .json({ error: "You are not assigned to this task" });
        }
      }

      const updateData: any = {};
      if (percentage !== undefined) {
        if (percentage < 0 || percentage > 100) {
          return res
            .status(400)
            .json({ error: "Percentage must be between 0 and 100" });
        }
        updateData.percentage = percentage;
      }
      if (status) updateData.status = status;

      if (percentage === 100) updateData.status = "COMPLETED";
      else if (percentage > 0 && !status) updateData.status = "IN_PROGRESS";

      const updated = await prisma.taskAssignment.update({
        where: { id: taskId },
        data: updateData,
      });

      await prisma.userLog.create({
        data: {
          userId: actorId,
          action: "TASK_PROGRESS",
          details: `Updated task "${task.title}" to ${percentage ?? updated.percentage}%`,
        },
      });

      res.json({ message: "Task updated", task: updated });
    } catch (error) {
      console.error("Update task error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── DELETE /tasks/:id ─────────────────────────────────────
router.delete(
  "/:id",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const taskId = parseInt(req.params.id as string);

      const task = await prisma.taskAssignment.findUnique({
        where: { id: taskId },
      });
      if (!task) return res.status(404).json({ error: "Task not found" });

      await prisma.taskAssignment.delete({ where: { id: taskId } });

      res.json({ message: "Task deleted" });
    } catch (error) {
      console.error("Delete task error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
