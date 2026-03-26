/**
 * Integration tests for /tasks endpoints.
 * Mocks pool.query and JWT to run without a real DB.
 */

jest.mock("../lib/db", () => ({
  __esModule: true,
  default: { query: jest.fn().mockResolvedValue({ rows: [] }) },
  pool:    { query: jest.fn().mockResolvedValue({ rows: [] }) },
  withTransaction: jest.fn().mockImplementation(async (fn: any) => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task INSERT
        .mockResolvedValue({ rows: [] }), // assignee INSERTs
    };
    return fn(client);
  }),
}));

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn().mockReturnValue({ userId: 1, role: "ADMIN", teamId: 1 }),
  sign: jest.fn().mockReturnValue("mocked-token"),
}));

import request from "supertest";
import express from "express";
import tasksRoutes from "../routes/task";
import pool from "../lib/db";
import { withTransaction } from "../lib/db";

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
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("returns tasks for authenticated admin", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ team_id: 1 }] }) // user team lookup
      .mockResolvedValueOnce({ rows: [mockTask] }); // tasks list

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
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

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
    (withTransaction as jest.Mock).mockImplementationOnce(async (fn: any) => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT task
          .mockResolvedValue({ rows: [] }), // INSERT assignees
      };
      return fn(client);
    });

    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ team_id: 1 }] }) // team lookup
      .mockResolvedValueOnce({ rows: [mockTask] })        // full task query
      .mockResolvedValue({ rows: [] });                   // user_logs + notify

    const res = await request(app)
      .post("/tasks")
      .set(AUTH_HEADER)
      .send({ title: "Test Task", assigneeIds: [2] });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("task");
  });
});

describe("GET /tasks/:id/comments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("returns comments for a task", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists check
      .mockResolvedValueOnce({ rows: [] }); // comments list

    const res = await request(app).get("/tasks/1/comments").set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("comments");
  });

  it("returns 404 for non-existent task", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // task not found

    const res = await request(app).get("/tasks/999/comments").set(AUTH_HEADER);
    expect(res.status).toBe(404);
  });
});

describe("POST /tasks/:id/comments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("returns 400 when body is empty", async () => {
    const res = await request(app)
      .post("/tasks/1/comments")
      .set(AUTH_HEADER)
      .send({ body: "   " });

    expect(res.status).toBe(400);
  });

  it("creates a comment successfully", async () => {
    const mockComment = {
      id: 1,
      assignmentId: 1,
      body: "Great work!",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ ...mockTask, assignees: [{ userId: 2 }] }] }) // task lookup
      .mockResolvedValueOnce({ rows: [mockComment] }) // INSERT comment
      .mockResolvedValueOnce({ rows: [{ id: 1, userId: "USR-001", firstName: "Alice", lastName: "Smith" }] }) // author lookup
      .mockResolvedValue({ rows: [] }); // notify

    const res = await request(app)
      .post("/tasks/1/comments")
      .set(AUTH_HEADER)
      .send({ body: "Great work!" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("comment");
  });
});
