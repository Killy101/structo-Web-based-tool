import { Router, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";
import { Role } from "@prisma/client";
import { generateCompliantPassword } from "../lib/password-policy";
import { sendPasswordEmail } from "../lib/email";

const router = Router();

const CAN_CREATE: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

const CAN_DEACTIVATE: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

const CAN_CHANGE_ROLE: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

const CAN_EDIT_PROFILE: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

const ALLOWED_TARGET_ROLES: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ["ADMIN", "USER"],
  ADMIN: ["USER"],
};

function generatePassword(): string {
  return generateCompliantPassword();
}

// ── GET /users ────────────────────────────────────────────
router.get(
  "/",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const actorRole = req.user!.role;
      const actorId = req.user!.userId;

      let whereClause: any = {};

      // Super Admin can fetch all users.
      if (actorRole === "ADMIN") {
        // Admin only sees users in their own team.
        const admin = await prisma.user.findUnique({
          where: { id: actorId },
          select: { teamId: true },
        });
        if (admin?.teamId) {
          whereClause = { teamId: admin.teamId, role: "USER" };
        } else {
          return res.json({ users: [] });
        }
      }

      const users = await prisma.user.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          userId: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          teamId: true,
          team: { select: { id: true, name: true, slug: true } },
          userRoleId: true,
          userRole: {
            select: { id: true, name: true, slug: true, features: true },
          },
        },
      });

      res.json({ users });
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /users/create ────────────────────────────────────
router.post(
  "/create",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId, email, role, firstName, lastName, teamId, userRoleId } =
        req.body;
      const actorRole = req.user!.role as Role;

      if (!userId || !role) {
        return res.status(400).json({ error: "User ID and role are required" });
      }

      if (!firstName || !firstName.trim()) {
        return res.status(400).json({ error: "First name is required" });
      }

      if (!lastName || !lastName.trim()) {
        return res.status(400).json({ error: "Last name is required" });
      }

      const normalizedEmail = String(email ?? "").trim().toLowerCase();
      if (!normalizedEmail) {
        return res.status(400).json({ error: "Email is required" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      const trimmedUserId = userId.trim();
      if (!/^[a-zA-Z0-9]{3,6}$/.test(trimmedUserId)) {
        return res.status(400).json({
          error: "User ID must be 3 to 6 alphanumeric characters",
        });
      }

      const allowedRoles = CAN_CREATE[actorRole] ?? [];
      if (!allowedRoles.includes(role as Role)) {
        return res
          .status(403)
          .json({ error: `You cannot create a user with role ${role}` });
      }

      const existingUserId = await prisma.user.findUnique({
        where: { userId: trimmedUserId },
      });
      if (existingUserId) {
        return res
          .status(409)
          .json({ error: "A user with this User ID already exists" });
      }

      const existingEmail = await prisma.user.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: "insensitive" },
        },
      });
      if (existingEmail) {
        return res.status(409).json({ error: "A user with this email already exists" });
      }

      // Admin auto-assigns their team if no teamId provided
      let assignTeamId = teamId;
      if (actorRole === "ADMIN" && !assignTeamId) {
        const admin = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { teamId: true },
        });
        assignTeamId = admin?.teamId;
      }

      if (assignTeamId) {
        const team = await prisma.team.findUnique({
          where: { id: assignTeamId },
        });
        if (!team) {
          return res.status(400).json({ error: "Team not found" });
        }
      }

      const generatedPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(generatedPassword, 10);

      // Validate userRoleId if provided
      if (userRoleId) {
        const customRole = await prisma.userRole.findUnique({
          where: { id: userRoleId },
        });
        if (!customRole) {
          return res.status(400).json({ error: "User role not found" });
        }
      }

      const newUser = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            userId: trimmedUserId,
            role: role as Role,
            password: hashedPassword,
            passwordChangedAt: new Date(),
            createdById: req.user!.userId,
            email: normalizedEmail,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            teamId: assignTeamId || null,
            userRoleId: userRoleId || null,
          },
        });

        await tx.passwordHistory.create({
          data: { userId: created.id, hash: hashedPassword },
        });

        return created;
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "USER_CREATED",
          details: `Created user ${trimmedUserId} (${firstName.trim()} ${lastName.trim()}) with role ${role} and email ${normalizedEmail}`,
        },
      });

      const emailSent = await sendPasswordEmail({
        to: normalizedEmail,
        userId: newUser.userId,
        fullName: `${firstName.trim()} ${lastName.trim()}`,
        password: generatedPassword,
        action: "created",
      });

      res.status(201).json({
        message: "User created successfully",
        generatedPassword,
        emailSent,
        id: newUser.id,
        userIdStr: newUser.userId,
      });
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /users/:id/profile ─────────────────────────────
router.patch(
  "/:id/profile",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = Number(req.params.id as string);
      const actorRole = req.user!.role as Role;
      const { userId, email, firstName, lastName } = req.body;

      if (!Number.isFinite(targetId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "User not found" });

      const allowedTargets = CAN_EDIT_PROFILE[actorRole] ?? [];
      if (!allowedTargets.includes(target.role)) {
        return res.status(403).json({
          error: `You cannot edit profile details for ${target.role} users`,
        });
      }

      const trimmedUserId = String(userId ?? "").trim().toUpperCase();
      if (!/^[a-zA-Z0-9]{3,6}$/.test(trimmedUserId)) {
        return res.status(400).json({
          error: "User ID must be 3 to 6 alphanumeric characters",
        });
      }

      const normalizedEmail = String(email ?? "").trim().toLowerCase();
      if (!normalizedEmail) {
        return res.status(400).json({ error: "Email is required" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      const normalizedFirstName = String(firstName ?? "").trim();
      if (!normalizedFirstName) {
        return res.status(400).json({ error: "First name is required" });
      }

      const normalizedLastName = String(lastName ?? "").trim();
      if (!normalizedLastName) {
        return res.status(400).json({ error: "Last name is required" });
      }

      const duplicateUserId = await prisma.user.findFirst({
        where: {
          userId: trimmedUserId,
          id: { not: targetId },
        },
      });
      if (duplicateUserId) {
        return res
          .status(409)
          .json({ error: "A user with this User ID already exists" });
      }

      const duplicateEmail = await prisma.user.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: "insensitive" },
          id: { not: targetId },
        },
      });
      if (duplicateEmail) {
        return res
          .status(409)
          .json({ error: "A user with this email already exists" });
      }

      const updated = await prisma.user.update({
        where: { id: targetId },
        data: {
          userId: trimmedUserId,
          email: normalizedEmail,
          firstName: normalizedFirstName,
          lastName: normalizedLastName,
        },
        select: {
          id: true,
          userId: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "USER_PROFILE_UPDATED",
          details: `Updated profile details for ${target.userId} -> ${updated.userId}`,
        },
      });

      res.json({
        message: "User profile updated successfully",
        user: updated,
      });
    } catch (error) {
      console.error("Update user profile error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /users/:id/team ─────────────────────────────────
router.patch(
  "/:id/team",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id as string);
      const { teamId } = req.body;
      const actorRole = req.user!.role as Role;

      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "User not found" });

      if (actorRole === "ADMIN") {
        if (target.role === "ADMIN" || target.role === "SUPER_ADMIN") {
          return res
            .status(403)
            .json({ error: "You cannot reassign this user's team" });
        }
      }

      if (teamId) {
        const team = await prisma.team.findUnique({ where: { id: teamId } });
        if (!team) return res.status(400).json({ error: "Team not found" });
      }

      await prisma.user.update({
        where: { id: targetId },
        data: { teamId: teamId || null },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "TEAM_ASSIGNED",
          details: `Assigned user ${target.userId} to team ${teamId ?? "none"}`,
        },
      });

      res.json({ message: "Team assignment updated" });
    } catch (error) {
      console.error("Assign team error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /users/:id/role ─────────────────────────────────
router.patch(
  "/:id/role",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id as string);
      const { role } = req.body;
      const actorRole = req.user!.role as Role;

      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "User not found" });

      // Check if actor can change this user's role
      const canChange = CAN_CHANGE_ROLE[actorRole] ?? [];
      if (!canChange.includes(target.role)) {
        return res
          .status(403)
          .json({ error: "You cannot change this user's role" });
      }

      // Check if the target role is allowed
      const allowedTargets = ALLOWED_TARGET_ROLES[actorRole] ?? [];
      if (!allowedTargets.includes(role as Role)) {
        return res
          .status(403)
          .json({ error: `You cannot assign the role ${role}` });
      }

      // Admin cannot change anyone to ADMIN role
      if (actorRole === "ADMIN" && role === "ADMIN") {
        return res
          .status(403)
          .json({ error: "Only Super Admin can assign the Admin role" });
      }

      await prisma.user.update({
        where: { id: targetId },
        data: { role: role as Role },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "ROLE_CHANGED",
          details: `Changed ${target.userId} from ${target.role} to ${role}`,
        },
      });

      res.json({ message: "Role updated successfully" });
    } catch (error) {
      console.error("Change role error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /users/:id/deactivate ───────────────────────────
router.patch(
  "/:id/deactivate",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id as string);
      const actorRole = req.user!.role as Role;

      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "User not found" });

      const allowed = CAN_DEACTIVATE[actorRole] ?? [];
      if (!allowed.includes(target.role)) {
        return res
          .status(403)
          .json({ error: "You cannot deactivate this user" });
      }

      if (target.id === req.user!.userId) {
        return res
          .status(400)
          .json({ error: "You cannot deactivate your own account" });
      }

      await prisma.user.update({
        where: { id: targetId },
        data: { status: "INACTIVE" },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "USER_DEACTIVATED",
          details: `Deactivated user ${target.userId}`,
        },
      });

      res.json({ message: "User deactivated" });
    } catch (error) {
      console.error("Deactivate user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /users/:id/activate ─────────────────────────────
router.patch(
  "/:id/activate",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id as string);
      const actorRole = req.user!.role as Role;

      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "User not found" });

      const allowed = CAN_DEACTIVATE[actorRole] ?? [];
      if (!allowed.includes(target.role)) {
        return res.status(403).json({ error: "You cannot activate this user" });
      }

      await prisma.user.update({
        where: { id: targetId },
        data: { status: "ACTIVE" },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "USER_ACTIVATED",
          details: `Activated user ${target.userId}`,
        },
      });

      res.json({ message: "User activated" });
    } catch (error) {
      console.error("Activate user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /users/:id/user-role (SuperAdmin only) ──────────
router.patch(
  "/:id/user-role",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id as string);
      const { userRoleId } = req.body; // null to clear

      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "User not found" });

      let roleName: string | null = null;
      if (userRoleId !== null && userRoleId !== undefined) {
        const customRole = await prisma.userRole.findUnique({
          where: { id: Number(userRoleId) },
        });
        if (!customRole) {
          return res.status(400).json({ error: "User role not found" });
        }
        // Disallow assigning internal team-policy roles directly to users
        if (customRole.slug.startsWith("__TEAM_ROLE_POLICY__")) {
          return res
            .status(400)
            .json({ error: "Cannot assign a team policy role directly to a user" });
        }
        roleName = customRole.name;
      }

      await prisma.user.update({
        where: { id: targetId },
        data: { userRoleId: userRoleId != null ? Number(userRoleId) : null },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "USER_ROLE_ASSIGNED",
          details: roleName
            ? `Assigned custom role "${roleName}" to user ${target.userId}`
            : `Cleared custom role from user ${target.userId}`,
        },
      });

      res.json({ message: "User role updated" });
    } catch (error) {
      console.error("Assign user role error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
