jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    appSetting: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    userLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn().mockReturnValue({ userId: 1, role: "SUPER_ADMIN", teamId: 1 }),
  sign: jest.fn().mockReturnValue("mocked-token"),
}));

import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import settingsRoutes from "../routes/settings";
import prisma from "../lib/prisma";

const app = express();
app.use(express.json());
app.use("/settings", settingsRoutes);

const AUTH_HEADER = { Authorization: "Bearer valid-mock-token" };

describe("GET /settings/governance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (jwt.verify as jest.Mock).mockReturnValue({
      userId: 1,
      role: "SUPER_ADMIN",
      teamId: 1,
    });
  });

  it("returns defaults when no stored settings are found", async () => {
    ((prisma as any).appSetting.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get("/settings/governance").set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.settings.securityPolicy.minPasswordLength).toBe(15);
    expect(res.body.settings.securityPolicy.minSpecialChars).toBe(1);
    expect(res.body.settings.securityPolicy.rememberedCount).toBe(24);
    expect(res.body.settings.securityPolicy.minPasswordAgeDays).toBe(7);
    expect(res.body.settings.securityPolicy.maxPasswordAgeDays).toBe(90);
    expect(res.body.settings.operationsPolicy.maintenanceMode).toBe(false);
  });

  it("returns 403 for non-super-admin", async () => {
    (jwt.verify as jest.Mock).mockReturnValue({
      userId: 2,
      role: "USER",
      teamId: 1,
    });

    const res = await request(app).get("/settings/governance").set(AUTH_HEADER);

    expect(res.status).toBe(403);
  });
});

describe("GET /settings/operations-status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (jwt.verify as jest.Mock).mockReturnValue({
      userId: 2,
      role: "USER",
      teamId: 1,
    });
  });

  it("returns operations status for authenticated users", async () => {
    ((prisma as any).appSetting.findMany as jest.Mock).mockResolvedValue([
      {
        key: "governance.operations",
        value: {
          maintenanceMode: true,
          strictRateLimitMode: false,
          auditDigestEnabled: true,
        },
      },
    ]);

    const res = await request(app)
      .get("/settings/operations-status")
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.operationsPolicy.maintenanceMode).toBe(true);
    expect(res.body.operationsPolicy.auditDigestEnabled).toBe(true);
  });
});

describe("PATCH /settings/governance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (jwt.verify as jest.Mock).mockReturnValue({
      userId: 1,
      role: "SUPER_ADMIN",
      teamId: 1,
    });
    (prisma.$transaction as jest.Mock).mockResolvedValue([]);
    (prisma.userLog.create as jest.Mock).mockResolvedValue({ id: 1 });
  });

  it("normalizes and persists governance settings", async () => {
    const payload = {
      securityPolicy: {
        minPasswordLength: 6,
        requireUppercase: true,
        requireNumber: false,
        requireSpecial: true,
        sessionTimeoutMinutes: 2,
        enforceMfaForAdmins: true,
      },
      operationsPolicy: {
        maintenanceMode: true,
        strictRateLimitMode: true,
        auditDigestEnabled: false,
      },
    };

    const res = await request(app)
      .patch("/settings/governance")
      .set(AUTH_HEADER)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.settings.securityPolicy.minPasswordLength).toBe(15);
    expect(res.body.settings.securityPolicy.minSpecialChars).toBe(1);
    expect(res.body.settings.securityPolicy.sessionTimeoutMinutes).toBe(5);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.userLog.create).toHaveBeenCalledTimes(1);
  });
});
