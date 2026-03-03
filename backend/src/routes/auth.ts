import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import rateLimit from "express-rate-limit";

const router = Router();

// ─── Who can change whose password ───────────────────────
const CAN_CHANGE_PASSWORD: Record<string, string[]> = {
  SUPER_ADMIN: ["ADMIN", "MANAGER_QA", "MANAGER_QC", "USER"],
  ADMIN: ["MANAGER_QA", "MANAGER_QC", "USER"],
};

// ─── RATE LIMITER ────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {
    error: "Too many login attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── LOGIN (userId + password only) ──────────────────────
router.post("/login", loginLimiter, async (req: Request, res: Response) => {
  try {
    const { userId, password } = req.body;
    const trimmedUserId = String(userId ?? "").trim();

    if (!trimmedUserId || !password) {
      return res
        .status(400)
        .json({ error: "User ID and password are required" });
    }

    if (!/^[a-zA-Z0-9]{3,6}$/.test(trimmedUserId)) {
      return res
        .status(400)
        .json({ error: "User ID must be 3–6 alphanumeric characters" });
    }

    const superAdminUserId = (
      process.env.SUPERADMIN_USERID ?? "SADMIN"
    ).toLowerCase();

    let user = null;

    if (trimmedUserId.toLowerCase() === superAdminUserId) {
      user = await prisma.user.findFirst({
        where: { role: "SUPER_ADMIN" },
        orderBy: { id: "asc" },
        include: { team: true },
      });
    }

    if (!user) {
      user = await prisma.user.findFirst({
        where: {
          userId: { equals: trimmedUserId, mode: "insensitive" },
        },
        include: { team: true },
      });
    }

    if (!user) {
      return res.status(401).json({ error: "Invalid User ID or password" });
    }

    if (user.status === "INACTIVE") {
      return res.status(403).json({
        error: "Your account has been deactivated. Contact your admin.",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid User ID or password" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await prisma.userLog.create({
      data: {
        userId: user.id,
        action: "LOGIN",
        details: "User logged in",
      },
    });

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        teamId: user.teamId,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" },
    );

    res.json({
      token,
      user: {
        id: user.id,
        userId: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        teamId: user.teamId,
        teamName: user.team?.name ?? null,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET CURRENT USER ────────────────────────────────────
router.get("/me", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        teamId: true,
        team: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── CHANGE PASSWORD ─────────────────────────────────────
// SuperAdmin → ADMIN, MANAGER_QA, MANAGER_QC, USER
// Admin     → MANAGER_QA, MANAGER_QC, USER
router.post(
  "/change-password",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { targetUserId, newPassword } = req.body;
      const actorRole = req.user!.role;

      if (!targetUserId) {
        return res.status(400).json({ error: "Target user ID is required" });
      }

      if (!newPassword || newPassword.length < 8) {
        return res
          .status(400)
          .json({ error: "Password must be at least 8 characters" });
      }

      const allowedTargetRoles = CAN_CHANGE_PASSWORD[actorRole];
      if (!allowedTargetRoles) {
        return res
          .status(403)
          .json({ error: "You are not authorized to change passwords" });
      }

      const target = await prisma.user.findUnique({
        where: { id: targetUserId },
      });

      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!allowedTargetRoles.includes(target.role)) {
        return res.status(403).json({
          error: `You cannot change passwords for ${target.role} users`,
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: target.id },
        data: { password: hashedPassword },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "PASSWORD_CHANGE",
          details: `Changed password for ${target.userId} (${target.role})`,
        },
      });

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── RESET PASSWORD (auto-generate) ─────────────────────
router.post(
  "/reset-user-password",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { targetUserId } = req.body;
      const actorRole = req.user!.role;

      if (!targetUserId) {
        return res.status(400).json({ error: "Target user ID is required" });
      }

      const allowedTargetRoles = CAN_CHANGE_PASSWORD[actorRole];
      if (!allowedTargetRoles) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const target = await prisma.user.findUnique({
        where: { id: targetUserId },
      });

      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!allowedTargetRoles.includes(target.role)) {
        return res.status(403).json({
          error: `You cannot reset passwords for ${target.role} users`,
        });
      }

      const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
      const nums = "23456789";
      let suffix = "";
      for (let i = 0; i < 5; i++)
        suffix += alpha[Math.floor(Math.random() * alpha.length)];
      suffix += nums[Math.floor(Math.random() * nums.length)];
      const newPassword = `innod@${suffix}`;

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: target.id },
        data: { password: hashedPassword },
      });

      await prisma.userLog.create({
        data: {
          userId: req.user!.userId,
          action: "PASSWORD_RESET",
          details: `Reset password for ${target.userId} (${target.role})`,
        },
      });

      res.json({
        message: "Password reset successfully",
        newPassword,
        targetUserId: target.userId,
      });
    } catch (error) {
      console.error("Reset user password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
