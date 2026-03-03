import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";

const router = Router();

// ── GET /teams ────────────────────────────────────────────
router.get(
  "/",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const teams = await prisma.team.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          _count: { select: { members: true, taskAssignments: true } },
          members: {
            select: {
              id: true,
              userId: true,
              firstName: true,
              lastName: true,
              role: true,
              status: true,
            },
          },
        },
      });

      res.json({ teams });
    } catch (error) {
      console.error("Get teams error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /teams (SuperAdmin only) ─────────────────────────
router.post(
  "/",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { name } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Team name is required" });
      }

      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const existing = await prisma.team.findFirst({
        where: {
          OR: [
            { name: { equals: name.trim(), mode: "insensitive" } },
            { slug },
          ],
        },
      });

      if (existing) {
        return res
          .status(409)
          .json({ error: "A team with this name already exists" });
      }

      const team = await prisma.team.create({
        data: { name: name.trim(), slug },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "TEAM_CREATED",
          details: `Created team "${name.trim()}"`,
        },
      });

      res.status(201).json({ message: "Team created", team });
    } catch (error) {
      console.error("Create team error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /teams/:id (SuperAdmin only) ───────────────────
router.patch(
  "/:id",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id as string);
      const { name } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Team name is required" });
      }

      const team = await prisma.team.findUnique({ where: { id: targetId } });
      if (!team) return res.status(404).json({ error: "Team not found" });

      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const updated = await prisma.team.update({
        where: { id: targetId },
        data: { name: name.trim(), slug },
      });

      res.json({ message: "Team updated", team: updated });
    } catch (error) {
      console.error("Update team error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── DELETE /teams/:id (SuperAdmin only) ───────────────────
router.delete(
  "/:id",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id as string);

      const team = await prisma.team.findUnique({
        where: { id: targetId },
        include: { _count: { select: { members: true } } },
      });

      if (!team) return res.status(404).json({ error: "Team not found" });

      if (team._count.members > 0) {
        return res.status(400).json({
          error:
            "Cannot delete a team that still has members. Reassign them first.",
        });
      }

      await prisma.team.delete({ where: { id: targetId } });

      res.json({ message: "Team deleted" });
    } catch (error) {
      console.error("Delete team error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
