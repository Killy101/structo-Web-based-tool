import { PrismaClient, User } from "@prisma/client";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();
const supabase = createSupabaseClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export const createPasswordHistory = async (user: User) => {
  const existing = await prisma.passwordHistory.findFirst({
    where: {
      userId: user.id,
      hash: user.password,
    },
    select: { id: true },
  });

  if (existing) {
    return existing;
  }

  await prisma.passwordHistory.create({
    data: {
      userId: user.id,
      hash: user.password,
      createdAt: user.passwordChangedAt ?? new Date(),
    },
  });

  return null;
};

export const getSupabaseClient = () => {
  return supabase;
};

export const prismaClient = () => {
  return prisma;
};
