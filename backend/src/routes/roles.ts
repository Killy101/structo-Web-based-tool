import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";

const router = Router();

// ── GET /roles ────────────────────────────────────────────
router.get(
  "/",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (_req: AuthRequest, res: Response) => {
    try {
      const roles = await prisma.userRole.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          _count: { select: { users: true } },
        },
      });

      res.json({ roles });
    } catch (error) {
      console.error("Get roles error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /roles (SuperAdmin only) ─────────────────────────
router.post(
  "/",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, features } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Role name is required" });
      }

      const slug = name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

      const existing = await prisma.userRole.findFirst({
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
          .json({ error: "A role with this name already exists" });
      }

      const role = await prisma.userRole.create({
        data: {
          name: name.trim(),
          slug,
          features: Array.isArray(features) ? features : [],
        },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "ROLE_CREATED",
          details: `Created user role "${name.trim()}"`,
        },
      });

      res.status(201).json({ message: "Role created", role });
    } catch (error) {
      console.error("Create role error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /roles/:id (SuperAdmin only) ───────────────────
router.patch(
  "/:id",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id as string);
      const { name, features } = req.body;

      const role = await prisma.userRole.findUnique({
        where: { id: targetId },
      });
      if (!role) return res.status(404).json({ error: "Role not found" });

      const updateData: { name?: string; slug?: string; features?: string[] } =
        {};

      if (name && name.trim()) {
        updateData.name = name.trim();
        updateData.slug = name
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
      }

      if (features !== undefined) {
        updateData.features = Array.isArray(features) ? features : [];
      }

      const updated = await prisma.userRole.update({
        where: { id: targetId },
        data: updateData,
      });

      res.json({ message: "Role updated", role: updated });
    } catch (error) {
      console.error("Update role error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── DELETE /roles/:id (SuperAdmin only) ───────────────────
router.delete(
  "/:id",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id as string);

      const role = await prisma.userRole.findUnique({
        where: { id: targetId },
        include: { _count: { select: { users: true } } },
      });

      if (!role) return res.status(404).json({ error: "Role not found" });

      if (role._count.users > 0) {
        return res.status(400).json({
          error:
            "Cannot delete a role that still has users. Reassign them first.",
        });
      }

      await prisma.userRole.delete({ where: { id: targetId } });

      res.json({ message: "Role deleted" });
    } catch (error) {
      console.error("Delete role error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
