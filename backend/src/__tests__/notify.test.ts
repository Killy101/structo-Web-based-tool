/**
 * Unit tests for the notification helper.
 * Mocks Prisma to avoid a live DB connection.
 */

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    notification: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
  },
}));

import prisma from "../lib/prisma";
import { createNotification, notifyMany } from "../lib/notify";

describe("createNotification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a notification via prisma", async () => {
    await createNotification(1, "SYSTEM", "Test Title", "Test message");
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 1,
        type: "SYSTEM",
        title: "Test Title",
        message: "Test message",
        meta: undefined,
      },
    });
  });

  it("does not throw when prisma fails", async () => {
    (prisma.notification.create as jest.Mock).mockRejectedValueOnce(
      new Error("DB Error"),
    );
    await expect(
      createNotification(1, "SYSTEM", "Title", "Body"),
    ).resolves.not.toThrow();
  });

  it("passes meta payload when provided", async () => {
    const meta = { taskId: 42 };
    await createNotification(1, "TASK_ASSIGNED", "Title", "Body", meta);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ meta }),
    });
  });
});

describe("notifyMany", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls createNotification for each user", async () => {
    await notifyMany([1, 2, 3], "TASK_ASSIGNED", "Title", "Body");
    expect(prisma.notification.create).toHaveBeenCalledTimes(3);
  });

  it("handles empty user list without error", async () => {
    await expect(notifyMany([], "SYSTEM", "T", "B")).resolves.not.toThrow();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
