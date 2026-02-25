import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { Role } from '@prisma/client';
import { Resend } from 'resend';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);

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
  const special = '!@#$%';
  let p = '';
  for (let i = 0; i < 9; i++) p += alpha[Math.floor(Math.random() * alpha.length)];
  p += nums[Math.floor(Math.random() * nums.length)];
  p += special[Math.floor(Math.random() * special.length)];
  return p;
}

// ── GET /users (ADMIN, SUPER_ADMIN) ───────────────────────────────────────────
router.get('/', authenticate, authorize(['SUPER_ADMIN', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true,
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
    const { firstName, lastName, email, role } = req.body;
    const actorRole = req.user!.role as Role;

    // Validate required fields
    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Email domain check
    if (!email.toLowerCase().endsWith('@innodata.com')) {
      return res.status(400).json({ error: 'Only @innodata.com emails are allowed' });
    }

    // Permission check
    const allowedRoles = CAN_CREATE[actorRole] ?? [];
    if (!allowedRoles.includes(role as Role)) {
      return res.status(403).json({ error: `You cannot create a user with role ${role}` });
    }

    // Check duplicate email
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Generate + hash password
    const generatedPassword = generatePassword();
    const hashedPassword    = await bcrypt.hash(generatedPassword, 10);

    // Create user
    const newUser = await prisma.user.create({
      data: {
        firstName, lastName, email,
        role: role as Role,
        password: hashedPassword,
        mustChangePassword: true,
        createdById: req.user!.userId,
      },
    });

    // Send email via Resend (non-blocking)
    resend.emails.send({
      from:    'Structo <no-reply@innodata.com>',
      to:      email,
      subject: 'Your Structo account has been created',
      html: `
        <h2>Welcome to Structo, ${firstName}!</h2>
        <p>Your account has been created by an administrator.</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Temporary Password:</strong> <code>${generatedPassword}</code></p>
        <p>Please log in and change your password immediately.</p>
        <p>Login at: ${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/login</p>
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