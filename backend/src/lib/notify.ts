import prisma from "./prisma";
import { Prisma } from "@prisma/client";

type NotificationType = "TASK_ASSIGNED" | "TASK_UPDATED" | "BRD_STATUS" | "SYSTEM";

export async function createNotification(
  userId: number,
  type: NotificationType,
  title: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  try {
    const metaValue: Prisma.InputJsonValue | undefined = meta
      ? (meta as Prisma.InputJsonValue)
      : undefined;
    await prisma.notification.create({
      data: { userId, type, title, message, meta: metaValue },
    });
  } catch (err) {
    // Notifications are non-critical; log but do not throw
    console.error("Failed to create notification:", err);
  }
}

export async function notifyMany(
  userIds: number[],
  type: NotificationType,
  title: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  await Promise.all(
    userIds.map((uid) => createNotification(uid, type, title, message, meta)),
  );
}
