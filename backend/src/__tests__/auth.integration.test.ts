/**
 * Integration tests for /auth endpoints.
 *
 * These tests spin up the Express app and make real HTTP calls.
 * Database calls are mocked via jest.mock so no live DB is needed.
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

jest.mock("../lib/get-security-policy", () => ({
  getSecurityPolicy: jest.fn().mockResolvedValue({
    minPasswordLength: 15,
    requireUppercase: true,
    requireNumber: true,
    minSpecialChars: 1,
    rememberedCount: 24,
    minPasswordAgeDays: 7,
    maxPasswordAgeDays: 90,
    sessionTimeoutMinutes: 30,
    enforceMfaForAdmins: false,
  }),
}));

import request from "supertest";
import express from "express";
import cors from "cors";
import authRoutes from "../routes/auth";
import pool from "../lib/db";

const app = express();
app.use(express.json());
app.use(cors());
app.use("/auth", authRoutes);

// Note: userId must match /^[a-zA-Z0-9]{3,6}$/ per auth route validation
const mockUserRow = {
  id: 1,
  user_id: "USR001",
  first_name: "Alice",
  last_name: "Smith",
  role: "USER",
  status: "ACTIVE",
  password: "$2b$10$placeholder_bcrypt_hash",
  team_id: 1,
  teamName: "Pre-Production",
  teamSlug: "pre-production",
  last_login_at: null,
  password_changed_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
};

describe("POST /auth/login", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("returns 400 when userId is missing", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ password: "Test@1234" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ userId: "USR001" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 401 when user does not exist", async () => {
    // Both possible user lookup queries return empty
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/auth/login")
      .send({ userId: "USR999", password: "Test@1234" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 when user is inactive", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ ...mockUserRow, status: "INACTIVE" }],
    });

    const res = await request(app)
      .post("/auth/login")
      .send({ userId: "USR001", password: "Test@1234" });

    expect(res.status).toBe(403);
  });
});

describe("GET /auth/me", () => {
  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 when an invalid token is provided", async () => {
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", "Bearer invalid.token.here");
    expect(res.status).toBe(401);
  });
});
