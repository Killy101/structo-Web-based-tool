/**
 * Integration tests for /auth endpoints.
 *
 * These tests spin up the Express app and make real HTTP calls.
 * Database calls are mocked via jest.mock so no live DB is needed.
 */

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    userLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    userRole: {
      findUnique: jest.fn(),
    },
  },
}));

import request from "supertest";
import express from "express";
import cors from "cors";
import authRoutes from "../routes/auth";
import prisma from "../lib/prisma";

const app = express();
app.use(express.json());
app.use(cors());
app.use("/auth", authRoutes);

// Note: userId must match /^[a-zA-Z0-9]{3,6}$/ per auth route validation
const mockUser = {
  id: 1,
  userId: "USR001",
  firstName: "Alice",
  lastName: "Smith",
  role: "USER",
  status: "ACTIVE",
  password: "$2b$10$placeholder_bcrypt_hash",
  teamId: 1,
  team: { id: 1, name: "Pre-Production" },
  lastLoginAt: null,
  passwordChangedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
  userRole: null,
};

describe("POST /auth/login", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      .send({ userId: "USR-001" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 401 when user does not exist", async () => {
    // Auth route uses findFirst, not findUnique
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post("/auth/login")
      .send({ userId: "USR999", password: "Test@1234" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 when user is inactive", async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({
      ...mockUser,
      status: "INACTIVE",
    });

    const res = await request(app)
      .post("/auth/login")
      .send({ userId: "USR001", password: "Test@1234" });

    // INACTIVE users receive 403 Forbidden
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
