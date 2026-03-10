import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";

const router = Router();

const BASE_POLICY_PREFIX = "__BASE_ROLE_POLICY__";
const BASE_ROLES = ["ADMIN", "USER"] as const;
type BaseRole = (typeof BASE_ROLES)[number];

const BASE_ROLE_DEFAULT_FEATURES: Record<BaseRole, string[]> = {
  ADMIN: [
    "brd-process",
    "view-brd",
    "compare",
    "generate-reports",
    "user-logs",
  ],
  USER: ["view-brd", "generate-reports"],
};

const basePolicySlug = (role: BaseRole) => `${BASE_POLICY_PREFIX}${role}`;

async function ensureBasePolicy(role: BaseRole) {
  const slug = basePolicySlug(role);
  const existing = await prisma.userRole.findUnique({ where: { slug } });
  if (existing) return existing;

  return prisma.userRole.create({
    data: {
      name: `Base Role Policy: ${role}`,
      slug,
      features: BASE_ROLE_DEFAULT_FEATURES[role],
    },
  });
}

// ── GET /roles ────────────────────────────────────────────
router.get(
  "/",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (_req: AuthRequest, res: Response) => {
    try {
      const roles = await prisma.userRole.findMany({
        where: {
          NOT: {
            slug: {
              startsWith: BASE_POLICY_PREFIX,
            },
          },
        },
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

// ── GET /roles/base-policies (SuperAdmin only) ───────────
router.get(
  "/base-policies",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (_req: AuthRequest, res: Response) => {
    try {
      const policies = await Promise.all(
        BASE_ROLES.map(async (role) => {
          const policy = await ensureBasePolicy(role);
          return {
            id: policy.id,
            role,
            features: policy.features,
            updatedAt: policy.updatedAt,
          };
        }),
      );

      res.json({ policies });
    } catch (error) {
      console.error("Get base policies error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /roles/base-policies/:role (SuperAdmin only) ───
router.patch(
  "/base-policies/:role",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const roleParam = String(req.params.role || "").toUpperCase();
      const role = BASE_ROLES.find((r) => r === roleParam) as
        | BaseRole
        | undefined;

      if (!role) {
        return res.status(400).json({ error: "Role must be ADMIN or USER" });
      }

      const { features } = req.body;
      if (!Array.isArray(features)) {
        return res.status(400).json({ error: "Features must be an array" });
      }

      const policy = await ensureBasePolicy(role);

      const updated = await prisma.userRole.update({
        where: { id: policy.id },
        data: {
          features: features.filter((f) => typeof f === "string"),
        },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "BASE_ROLE_POLICY_UPDATED",
          details: `Updated feature policy for ${role}`,
        },
      });

      res.json({
        message: "Base role policy updated",
        policy: {
          id: updated.id,
          role,
          features: updated.features,
          updatedAt: updated.updatedAt,
        },
      });
    } catch (error) {
      console.error("Update base policy error:", error);
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
