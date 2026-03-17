import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";

const router = Router();

const TEAM_POLICY_PREFIX = "__TEAM_ROLE_POLICY__";
const POLICY_ROLES = ["ADMIN", "USER"] as const;
type PolicyRole = (typeof POLICY_ROLES)[number];

const FEATURE_CATALOG: Record<string, string> = {
  dashboard: "Dashboard",
  "brd-process": "BRD Process",
  "brd-view-generate": "BRD View and Generate Sources",
  "user-management": "User Management",
  "compare-basic": "Compare",
  "compare-chunk": "Compare Chunk",
  "compare-merge": "Compare Merge",
  "compare-pdf-xml-only": "Compare PDF + XML Only",
  "user-logs": "User Logs",
};

function humanizeFeatureKey(key: string): string {
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function policySlug(teamSlug: string, role: PolicyRole) {
  return `${TEAM_POLICY_PREFIX}${teamSlug}__${role}`;
}

function defaultTeamRoleFeatures(
  teamSlug: string,
): Record<PolicyRole, string[]> {
  const slug = teamSlug.toLowerCase();

  if (slug === "pre-production") {
    return {
      ADMIN: [
        "dashboard",
        "brd-process",
        "user-management",
        "compare-basic",
        "compare-pdf-xml-only",
        "user-logs",
      ],
      USER: [
        "dashboard",
        "brd-process",
        "compare-basic",
        "compare-pdf-xml-only",
      ],
    };
  }

  if (slug === "production") {
    return {
      ADMIN: [
        "dashboard",
        "brd-view-generate",
        "user-management",
        "compare-basic",
        "compare-pdf-xml-only",
        "user-logs",
      ],
      USER: [
        "dashboard",
        "brd-view-generate",
        "compare-basic",
        "compare-pdf-xml-only",
      ],
    };
  }

  if (slug === "updating") {
    return {
      ADMIN: [
        "dashboard",
        "brd-view-generate",
        "user-management",
        "compare-basic",
        "compare-pdf-xml-only",
        "user-logs",
      ],
      USER: [
        "dashboard",
        "brd-view-generate",
        "compare-basic",
        "compare-chunk",
        "compare-merge",
      ],
    };
  }

  return {
    ADMIN: [
      "dashboard",
      "brd-process",
      "user-management",
      "compare-basic",
      "user-logs",
    ],
    USER: ["dashboard", "brd-process", "compare-basic"],
  };
}

async function ensureTeamPolicies(teamSlug: string) {
  const defaults = defaultTeamRoleFeatures(teamSlug);

  await Promise.all(
    POLICY_ROLES.map(async (role) => {
      const slug = policySlug(teamSlug, role);
      const existing = await prisma.userRole.findUnique({ where: { slug } });
      if (existing) return existing;

      return prisma.userRole.create({
        data: {
          name: `Team Policy: ${teamSlug} (${role})`,
          slug,
          features: defaults[role],
        },
      });
    }),
  );
}

async function renameTeamPolicies(oldSlug: string, nextSlug: string) {
  if (oldSlug === nextSlug) return;

  for (const role of POLICY_ROLES) {
    const current = await prisma.userRole.findUnique({
      where: { slug: policySlug(oldSlug, role) },
    });
    if (!current) continue;

    await prisma.userRole.update({
      where: { id: current.id },
      data: {
        slug: policySlug(nextSlug, role),
        name: `Team Policy: ${nextSlug} (${role})`,
      },
    });
  }
}

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

      await ensureTeamPolicies(team.slug);

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

      // Guard against slug / name collision with another team
      const collision = await prisma.team.findFirst({
        where: {
          id: { not: targetId },
          OR: [
            { name: { equals: name.trim(), mode: "insensitive" } },
            { slug },
          ],
        },
      });
      if (collision) {
        return res.status(409).json({ error: "A team with this name already exists" });
      }

      const updated = await prisma.team.update({
        where: { id: targetId },
        data: { name: name.trim(), slug },
      });

      await renameTeamPolicies(team.slug, updated.slug);

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "TEAM_RENAMED",
          details: `Renamed team "${team.name}" to "${name.trim()}"`,
        },
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

// ── GET /teams/policies (SuperAdmin/Admin) ───────────────
router.get(
  "/policies",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (_req: AuthRequest, res: Response) => {
    try {
      const teams = await prisma.team.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, slug: true },
      });

      const policyRows = await prisma.userRole.findMany({
        where: {
          slug: {
            startsWith: TEAM_POLICY_PREFIX,
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          features: true,
          updatedAt: true,
        },
      });

      const bySlug = new Map(policyRows.map((r) => [r.slug, r]));
      const items = await Promise.all(
        teams.map(async (team) => {
          await ensureTeamPolicies(team.slug);

          const admin = bySlug.get(policySlug(team.slug, "ADMIN"));
          const user = bySlug.get(policySlug(team.slug, "USER"));

          return {
            team,
            ADMIN: {
              role: "ADMIN",
              id: admin?.id ?? null,
              features:
                admin?.features ?? defaultTeamRoleFeatures(team.slug).ADMIN,
              updatedAt: admin?.updatedAt ?? null,
            },
            USER: {
              role: "USER",
              id: user?.id ?? null,
              features:
                user?.features ?? defaultTeamRoleFeatures(team.slug).USER,
              updatedAt: user?.updatedAt ?? null,
            },
          };
        }),
      );

      const knownFeatures = new Set(Object.keys(FEATURE_CATALOG));
      for (const row of policyRows) {
        for (const feature of row.features) knownFeatures.add(feature);
      }

      const featureCatalog = Array.from(knownFeatures)
        .sort()
        .map((key) => ({
          key,
          label: FEATURE_CATALOG[key] ?? humanizeFeatureKey(key),
        }));

      res.json({ policies: items, featureCatalog });
    } catch (error) {
      console.error("Get team policies error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

// ── PATCH /teams/:id/policies/:role (SuperAdmin only) ───
router.patch(
  "/:id/policies/:role",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const teamId = parseInt(req.params.id as string, 10);
      const role = String(req.params.role || "").toUpperCase() as PolicyRole;
      const { features } = req.body;

      if (!POLICY_ROLES.includes(role)) {
        return res.status(400).json({ error: "Role must be ADMIN or USER" });
      }

      if (!Array.isArray(features)) {
        return res.status(400).json({ error: "Features must be an array" });
      }

      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return res.status(404).json({ error: "Team not found" });

      await ensureTeamPolicies(team.slug);

      const policy = await prisma.userRole.findUnique({
        where: { slug: policySlug(team.slug, role) },
      });

      if (!policy) {
        return res.status(404).json({ error: "Team role policy not found" });
      }

      const updated = await prisma.userRole.update({
        where: { id: policy.id },
        data: {
          features: features.filter((f) => typeof f === "string"),
        },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "TEAM_POLICY_UPDATED",
          details: `Updated ${role} policy for team ${team.name}`,
        },
      });

      res.json({
        message: "Team policy updated",
        policy: {
          teamId: team.id,
          teamSlug: team.slug,
          role,
          features: updated.features,
          updatedAt: updated.updatedAt,
        },
      });
    } catch (error) {
      console.error("Update team policy error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);
