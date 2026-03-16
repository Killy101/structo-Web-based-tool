/**
 * Integration tests for /notifications endpoints.
 */

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    notification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn().mockReturnValue({ userId: 1, role: "USER", teamId: 1 }),
  sign: jest.fn().mockReturnValue("mocked-token"),
}));

import request from "supertest";
import express from "express";
import notificationsRoutes from "../routes/notifications";
import prisma from "../lib/prisma";

const app = express();
app.use(express.json());
app.use("/notifications", notificationsRoutes);

const AUTH_HEADER = { Authorization: "Bearer valid-mock-token" };

const mockNotif = {
  id: 1,
  userId: 1,
  type: "TASK_ASSIGNED",
  title: "New Task",
  message: "You have been assigned a task",
  isRead: false,
  meta: null,
  createdAt: new Date().toISOString(),
};

describe("GET /notifications", () => {
  it("returns notifications for the authenticated user", async () => {
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([mockNotif]);
    (prisma.notification.count as jest.Mock).mockResolvedValue(1);

    const res = await request(app).get("/notifications").set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("notifications");
    expect(res.body).toHaveProperty("unreadCount", 1);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).get("/notifications");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /notifications/:id/read", () => {
  it("marks a notification as read", async () => {
    (prisma.notification.findUnique as jest.Mock).mockResolvedValue(mockNotif);
    (prisma.notification.update as jest.Mock).mockResolvedValue({
      ...mockNotif,
      isRead: true,
    });

    const res = await request(app)
      .patch("/notifications/1/read")
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.notification.isRead).toBe(true);
  });

  it("returns 404 for non-existent notification", async () => {
    (prisma.notification.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .patch("/notifications/999/read")
      .set(AUTH_HEADER);

    expect(res.status).toBe(404);
  });

  it("returns 403 when notification belongs to another user", async () => {
    (prisma.notification.findUnique as jest.Mock).mockResolvedValue({
      ...mockNotif,
      userId: 999,
    });

    const res = await request(app)
      .patch("/notifications/1/read")
      .set(AUTH_HEADER);

    expect(res.status).toBe(403);
  });
});

describe("PATCH /notifications/read-all", () => {
  it("marks all notifications as read", async () => {
    (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

    const res = await request(app)
      .patch("/notifications/read-all")
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("message");
  });
});

describe("DELETE /notifications/:id", () => {
  it("deletes a notification", async () => {
    (prisma.notification.findUnique as jest.Mock).mockResolvedValue(mockNotif);
    (prisma.notification.delete as jest.Mock).mockResolvedValue(mockNotif);

    const res = await request(app)
      .delete("/notifications/1")
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("message");
  });
});
