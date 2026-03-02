import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { Role } from '@prisma/client';
import nodemailer from 'nodemailer';

const router = Router();

// Gmail transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Role creation permissions
const CAN_CREATE: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ['ADMIN', 'MANAGER_QA', 'MANAGER_QC', 'USER'],
  ADMIN:       ['MANAGER_QA', 'MANAGER_QC', 'USER'],
};

const CAN_DEACTIVATE: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ['ADMIN', 'MANAGER_QA', 'MANAGER_QC', 'USER'],
  ADMIN:       ['MANAGER_QA', 'MANAGER_QC', 'USER'],
};

function generatePassword(): string {
  const alpha   = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const nums    = '23456789';
  let suffix = '';
  for (let i = 0; i < 5; i++) suffix += alpha[Math.floor(Math.random() * alpha.length)];
  suffix += nums[Math.floor(Math.random() * nums.length)];
  return `innod@${suffix}`;
}

// ── GET /users (ADMIN, SUPER_ADMIN) ───────────────────────────────────────────
router.get('/', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, userId: true, email: true, firstName: true, lastName: true,
        role: true, status: true, mustChangePassword: true,
        lastLoginAt: true, createdAt: true, updatedAt: true, createdById: true,
      },
    });
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /users/create ────────────────────────────────────────────────────────
router.post('/create', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, email, role, firstName, lastName } = req.body;
    const actorRole = req.user!.role as Role;

    // Validate required fields (firstName and lastName are optional)
    if (!userId || !email || !role) {
      return res.status(400).json({ error: 'User ID, email, and role are required' });
    }

    // Validate userId format (min 6 alphanumeric characters)
    const trimmedUserId = userId.trim().toUpperCase();
    if (trimmedUserId.length < 6) {
      return res.status(400).json({ error: 'User ID must be at least 6 characters' });
    }
    if (!/^[a-zA-Z0-9]+$/.test(trimmedUserId)) {
      return res.status(400).json({ error: 'User ID must contain only letters and numbers' });
    }

    // Email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Permission check
    const allowedRoles = CAN_CREATE[actorRole] ?? [];
    if (!allowedRoles.includes(role as Role)) {
      return res.status(403).json({ error: `You cannot create a user with role ${role}` });
    }

    // Check duplicate email
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Check duplicate userId
    const existingUserId = await prisma.user.findUnique({ where: { userId: trimmedUserId } });
    if (existingUserId) {
      return res.status(409).json({ error: 'A user with this User ID already exists' });
    }

    // Generate + hash password
    const generatedPassword = generatePassword();
    const hashedPassword    = await bcrypt.hash(generatedPassword, 10);

    // Create user
    const newUser = await prisma.user.create({
      data: {
        userId: trimmedUserId,
        email,
        role: role as Role,
        password: hashedPassword,
        mustChangePassword: true,
        createdById: req.user!.userId,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
      },
    });

    // Send email via Nodemailer (non-blocking)
    const loginUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const roleLabelMap: Record<string, string> = {
      SUPER_ADMIN: 'Super Admin',
      ADMIN: 'Admin',
      MANAGER_QA: 'QA Manager',
      MANAGER_QC: 'QC Manager',
      USER: 'User',
    };
    const roleLabel = roleLabelMap[role] ?? role;

    transporter.sendMail({
      from: `"STRUCTO" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your Structo account has been created',
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <div style="background:#1a56f0;padding:32px 40px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">STRUCTO</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;font-weight:400;">Document Processing Platform</p>
    </div>
    <div style="padding:36px 40px 28px;">
      <h2 style="margin:0 0 6px;color:#0f172a;font-size:18px;font-weight:600;">Your account has been created</h2>
      <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.5;">
        An administrator has created a Structo account for you. Below are your login credentials. Please change your password immediately after your first login.
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;width:120px;vertical-align:top;">User ID</td>
            <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;">${trimmedUserId}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Email</td>
            <td style="padding:8px 0;color:#0f172a;font-size:14px;">${email}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Role</td>
            <td style="padding:8px 0;color:#0f172a;font-size:14px;">${roleLabel}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:12px 0 0;"><div style="border-top:1px solid #e2e8f0;"></div></td>
          </tr>
          <tr>
            <td style="padding:12px 0 4px;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Password</td>
            <td style="padding:10px 0 4px;">
              <code style="display:inline-block;background:#1a56f0;color:#ffffff;padding:6px 14px;border-radius:6px;font-size:16px;font-weight:700;letter-spacing:2px;font-family:'Courier New',monospace;">${generatedPassword}</code>
            </td>
          </tr>
        </table>
      </div>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:28px;">
        <p style="margin:0;color:#92400e;font-size:13px;line-height:1.5;">
          ⚠️ This is a temporary password. You will be required to change it upon your first login. Do not share this password with anyone.
        </p>
      </div>
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${loginUrl}/login" style="display:inline-block;background:#1a56f0;color:#ffffff;padding:14px 40px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.3px;">Log in to Structo</a>
      </div>
      <p style="text-align:center;margin:12px 0 0;color:#94a3b8;font-size:12px;">${loginUrl}/login</p>
    </div>
    <div style="height:1px;background:#e2e8f0;margin:0 40px;"></div>
    <div style="padding:24px 40px;text-align:center;">
      <p style="margin:0 0 4px;color:#64748b;font-size:13px;">Need help? Contact your system administrator or reach out to</p>
      <a href="mailto:support@innodata.com" style="color:#1a56f0;text-decoration:none;font-size:13px;font-weight:600;">support@innodata.com</a>
    </div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
      <p style="margin:0;color:#94a3b8;font-size:11px;">&copy; 2025 Structo by Innodata. All rights reserved.</p>
      <p style="margin:4px 0 0;color:#cbd5e1;font-size:11px;">This is an automated message. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
      `,
    }).catch(e => console.error('Email send error:', e));

    res.status(201).json({
      message: 'User created successfully',
      generatedPassword,
      userId: newUser.id,
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /users/:id/deactivate ───────────────────────────────────────────────
router.patch('/:id/deactivate', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string);
    const actorRole = req.user!.role as Role;

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const allowed = CAN_DEACTIVATE[actorRole] ?? [];
    if (!allowed.includes(target.role)) {
      return res.status(403).json({ error: 'You cannot deactivate this user' });
    }

    if (target.id === req.user!.userId) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    await prisma.user.update({ where: { id: targetId }, data: { status: 'INACTIVE' } });
    res.json({ message: 'User deactivated' });

  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /users/:id/activate ─────────────────────────────────────────────────
router.patch('/:id/activate', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.id as string);
    const actorRole = req.user!.role as Role;

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const allowed = CAN_DEACTIVATE[actorRole] ?? [];
    if (!allowed.includes(target.role)) {
      return res.status(403).json({ error: 'You cannot activate this user' });
    }

    await prisma.user.update({ where: { id: targetId }, data: { status: 'ACTIVE' } });
    res.json({ message: 'User activated' });

  } catch (error) {
    console.error('Activate user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;