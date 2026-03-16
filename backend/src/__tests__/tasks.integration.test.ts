/**
 * Integration tests for /tasks endpoints.
 * Mocks Prisma and JWT to run without a real DB.
 */

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    taskAssignment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    taskComment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    fileUpload: {
      findUnique: jest.fn(),
    },
    userLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    notification: {
      create: jest.fn().mockResolvedValue({}),
    },
  },
}));

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn().mockReturnValue({ userId: 1, role: "ADMIN", teamId: 1 }),
  sign: jest.fn().mockReturnValue("mocked-token"),
}));

import request from "supertest";
import express from "express";
import tasksRoutes from "../routes/task";
import prisma from "../lib/prisma";

const app = express();
app.use(express.json());
app.use("/tasks", tasksRoutes);

const AUTH_HEADER = { Authorization: "Bearer valid-mock-token" };

const mockTask = {
  id: 1,
  title: "Test Task",
  description: "Description",
  status: "PENDING",
  percentage: 0,
  teamId: 1,
  createdById: 1,
  brdFileId: null,
  dueDate: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  team: { id: 1, name: "Pre-Production" },
  createdBy: { id: 1, userId: "USR-001", firstName: "Alice", lastName: "Smith" },
  assignees: [
    {
      id: 1,
      userId: 2,
      user: { id: 2, userId: "USR-002", firstName: "Bob", lastName: "Jones" },
    },
  ],
  brdFile: null,
};

describe("GET /tasks", () => {
  it("returns tasks for authenticated admin", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1, teamId: 1 });
    (prisma.taskAssignment.findMany as jest.Mock).mockResolvedValue([mockTask]);

    const res = await request(app).get("/tasks").set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("tasks");
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(401);
  });
});

describe("POST /tasks", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when title is missing", async () => {
    const res = await request(app)
      .post("/tasks")
      .set(AUTH_HEADER)
      .send({ assigneeIds: [2] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when no assignees provided", async () => {
    const res = await request(app)
      .post("/tasks")
      .set(AUTH_HEADER)
      .send({ title: "My Task", assigneeIds: [] });

    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 3 assignees", async () => {
    const res = await request(app)
      .post("/tasks")
      .set(AUTH_HEADER)
      .send({ title: "My Task", assigneeIds: [1, 2, 3, 4] });

    expect(res.status).toBe(400);
  });

  it("creates a task successfully", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1, teamId: 1 });
    (prisma.taskAssignment.create as jest.Mock).mockResolvedValue(mockTask);

    const res = await request(app)
      .post("/tasks")
      .set(AUTH_HEADER)
      .send({ title: "Test Task", assigneeIds: [2] });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("task");
  });
});

describe("GET /tasks/:id/comments", () => {
  it("returns comments for a task", async () => {
    (prisma.taskAssignment.findUnique as jest.Mock).mockResolvedValue(mockTask);
    (prisma.taskComment.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get("/tasks/1/comments").set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("comments");
  });

  it("returns 404 for non-existent task", async () => {
    (prisma.taskAssignment.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app).get("/tasks/999/comments").set(AUTH_HEADER);
    expect(res.status).toBe(404);
  });
});

describe("POST /tasks/:id/comments", () => {
  it("returns 400 when body is empty", async () => {
    (prisma.taskAssignment.findUnique as jest.Mock).mockResolvedValue(mockTask);

    const res = await request(app)
      .post("/tasks/1/comments")
      .set(AUTH_HEADER)
      .send({ body: "   " });

    expect(res.status).toBe(400);
  });

  it("creates a comment successfully", async () => {
    (prisma.taskAssignment.findUnique as jest.Mock).mockResolvedValue(mockTask);
    (prisma.taskComment.create as jest.Mock).mockResolvedValue({
      id: 1,
      assignmentId: 1,
      authorId: 1,
      body: "Great work!",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: { id: 1, userId: "USR-001", firstName: "Alice", lastName: "Smith" },
    });

    const res = await request(app)
      .post("/tasks/1/comments")
      .set(AUTH_HEADER)
      .send({ body: "Great work!" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("comment");
  });
});
