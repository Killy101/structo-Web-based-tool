import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import prisma from './prisma';

dotenv.config();

async function seed() {
  const email = 'superadmin@innodata.com';
  const password = 'Admin2026!';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Super admin already exists');
    return;
  }

  const hashed = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      email,
      password: hashed,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      mustChangePassword: false,  // super admin doesn't need to change
      status: 'ACTIVE'
    }
  });

  console.log('✅ Super Admin created!');
  console.log('Email:', email);
  console.log('Password:', password);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());