/**
 * Integration tests for /notifications endpoints.
 */

jest.mock("../lib/db", () => ({
  __esModule: true,
  default: { query: jest.fn().mockResolvedValue({ rows: [] }) },
  pool:    { query: jest.fn().mockResolvedValue({ rows: [] }) },
  withTransaction: jest.fn().mockImplementation(async (fn: any) => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    return fn(client);
  }),
}));

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn().mockReturnValue({ userId: 1, role: "USER", teamId: 1 }),
  sign: jest.fn().mockReturnValue("mocked-token"),
}));

import request from "supertest";
import express from "express";
import notificationsRoutes from "../routes/notifications";
import pool from "../lib/db";

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
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("returns notifications for the authenticated user", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockNotif] });

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
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("marks a notification as read", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 1, userId: 1 }] }) // findUnique
      .mockResolvedValueOnce({ rows: [{ ...mockNotif, isRead: true }] }); // update

    const res = await request(app)
      .patch("/notifications/1/read")
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.notification.isRead).toBe(true);
  });

  it("returns 404 for non-existent notification", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch("/notifications/999/read")
      .set(AUTH_HEADER);

    expect(res.status).toBe(404);
  });

  it("returns 403 when notification belongs to another user", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 1, userId: 999 }],
    });

    const res = await request(app)
      .patch("/notifications/1/read")
      .set(AUTH_HEADER);

    expect(res.status).toBe(403);
  });
});

describe("PATCH /notifications/read-all", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("marks all notifications as read", async () => {
    const res = await request(app)
      .patch("/notifications/read-all")
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("message");
  });
});

describe("DELETE /notifications/:id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("deletes a notification", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 1, userId: 1 }] }) // find
      .mockResolvedValueOnce({ rows: [] }); // delete

    const res = await request(app)
      .delete("/notifications/1")
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("message");
  });
});
