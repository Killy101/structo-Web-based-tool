import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/authenticate';
import { checkMustChangePassword } from '../middleware/mustChangePassword';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

const router = Router();

// ─── RATE LIMITERS ───────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── LOGIN ───────────────────────────────────────────────
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
<<<<<<< HEAD
    const { password } = req.body;
    const identifier = String(req.body.identifier ?? req.body.email ?? req.body.userId ?? '').trim();

    // 1. validate input
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/User ID and password are required' });
    }

    // 2. find user
    const normalizedIdentifier = identifier.toLowerCase();
    const superAdminUserId = (process.env.SUPERADMIN_USERID ?? 'SADMIN').toLowerCase();

    let user = await prisma.user.findFirst({
      where: {
        email: { equals: identifier, mode: 'insensitive' }
      }
    });

    if (!user && !identifier.includes('@')) {
      if (normalizedIdentifier === superAdminUserId) {
        user = await prisma.user.findFirst({
          where: { role: 'SUPER_ADMIN' },
          orderBy: { id: 'asc' }
        });
      }

      if (!user) {
        user = await prisma.user.findFirst({
          where: {
            email: { startsWith: `${identifier}@`, mode: 'insensitive' }
          }
        });
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email/user ID or password' });
=======
    const { identifier, password } = req.body;

    // 1. validate input
    if (!identifier || !password) {
      return res.status(400).json({ error: 'User ID or email and password are required' });
    }

    // 2. find user by email OR userId
    const trimmed = identifier.trim();
    const isEmail = trimmed.includes('@');

    const user = isEmail
      ? await prisma.user.findUnique({ where: { email: trimmed } })
      : await prisma.user.findUnique({ where: { userId: trimmed.toUpperCase() } });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
>>>>>>> 25747ac81b0e4784f6425b31212875768b594248
    }

    // 3. check if account is active
    if (user.status === 'INACTIVE') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact your admin.' });
    }

    // 4. check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
<<<<<<< HEAD
      return res.status(401).json({ error: 'Invalid email/user ID or password' });
=======
      return res.status(401).json({ error: 'Invalid credentials' });
>>>>>>> 25747ac81b0e4784f6425b31212875768b594248
    }

    // 5. update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 6. generate token
    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        email: user.email,
        mustChangePassword: user.mustChangePassword,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    // 7. return token and user info
    res.json({
      token,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        userId: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── CHANGE PASSWORD ─────────────────────────────────────
router.post('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // 1. validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    // 2. password strength check
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    // 3. get user from database
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 4. verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // 5. make sure new password is different
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    // 6. hash and save new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
      },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET CURRENT USER ────────────────────────────────────
router.get('/me', authenticate, checkMustChangePassword, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
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
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── EMAIL TRANSPORTER ───────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── FORGOT PASSWORD ─────────────────────────────────────
router.post('/forgot-password', forgotPasswordLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 1000 * 60 * 60);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpiry: resetExpiry,
      },
    });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: `"STRUCTO" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #0f172a; margin-bottom: 8px;">Reset your password</h2>
          <p style="color: #64748b; font-size: 14px;">
            You requested a password reset for your STRUCTO account. Click the button below to set a new password.
          </p>
          <a href="${resetUrl}"
            style="display: inline-block; margin: 24px 0; background: #0f172a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
            Reset Password →
          </a>
          <p style="color: #94a3b8; font-size: 12px;">
            This link expires in <strong>1 hour</strong>. If you didn't request this, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #cbd5e1; font-size: 11px;">© 2026 Innodata — Legal Regulatory Delivery Unit</p>
        </div>
      `,
    });

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── RESET PASSWORD ──────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiry: null,
        mustChangePassword: false,
      },
    });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;