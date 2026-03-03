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
  const existing = await prisma.user.findUnique({
    where: { userId: superAdminUserId },
  });

  if (!existing) {
    const hashedPassword = await bcrypt.hash("Admin@123", 10);
    await prisma.user.create({
      data: {
        userId: superAdminUserId,
        firstName: "Super",
        lastName: "Admin",
        role: "SUPER_ADMIN",
        password: hashedPassword,
      },
    });
    console.log(
      `  ✓ Super Admin created (userId: ${superAdminUserId}, password: Admin@123)`,
    );
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
