import prisma from "./prisma";
import bcrypt from "bcrypt";

async function seed() {
  console.log("🌱 Seeding database...");

  const defaultTeams = [
    { name: "Pre-Production", slug: "pre-production" },
    { name: "Production", slug: "production" },
    { name: "Updating", slug: "updating" },
    { name: "Post-Production", slug: "post-production" },
  ];

  for (const team of defaultTeams) {
    await prisma.team.upsert({
      where: { slug: team.slug },
      update: {},
      create: team,
    });
    console.log(`  ✓ Team "${team.name}"`);
  }

  const superAdminUserId = process.env.SUPERADMIN_USERID ?? "SADMIN";
  const superAdminPassword =
    process.env.SUPERADMIN_PASSWORD ?? "Innodata@2026!SA";

  const existing = await prisma.user.findUnique({
    where: { userId: superAdminUserId },
  });

  if (!existing) {
    const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

    const created = await prisma.user.create({
      data: {
        userId: superAdminUserId,
        firstName: "Super",
        lastName: "Admin",
        role: "SUPER_ADMIN",
        password: hashedPassword,
        passwordChangedAt: new Date(),
      },
    });

    await prisma.passwordHistory.create({
      data: { userId: created.id, hash: hashedPassword },
    });

    console.log(`  ✓ Super Admin created (userId: ${superAdminUserId})`);
  } else {
    console.log(`  ⏭ Super Admin already exists`);
  }

  console.log("✅ Seed complete");
}

seed()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
