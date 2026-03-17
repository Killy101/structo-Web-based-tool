jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    appSetting: {
      findMany: jest.fn(),
    },
  },
}));

import express from "express";
import request from "supertest";
import prisma from "../lib/prisma";
import {
  __resetGovernanceControlsForTests,
  governanceControlsMiddleware,
} from "../middleware/governanceControls";

const app = express();
app.use(express.json());
app.use(governanceControlsMiddleware);
app.post("/tasks", (_req, res) => res.status(201).json({ ok: true }));
app.patch("/settings/governance", (_req, res) =>
  res.status(200).json({ ok: true }),
);
app.get("/dashboard", (_req, res) => res.status(200).json({ ok: true }));

describe("governanceControlsMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetGovernanceControlsForTests();
  });

  it("blocks mutation requests in maintenance mode", async () => {
    ((prisma as any).appSetting.findMany as jest.Mock).mockResolvedValue([
      {
        key: "governance.operations",
        value: {
          maintenanceMode: true,
          strictRateLimitMode: false,
        },
      },
    ]);

    const res = await request(app).post("/tasks").send({ title: "x" });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain("maintenance mode");
  });

  it("allows exempt governance endpoint during maintenance mode", async () => {
    ((prisma as any).appSetting.findMany as jest.Mock).mockResolvedValue([
      {
        key: "governance.operations",
        value: {
          maintenanceMode: true,
          strictRateLimitMode: false,
        },
      },
    ]);

    const res = await request(app)
      .patch("/settings/governance")
      .send({ any: "value" });

    expect(res.status).toBe(200);
  });

  it("enforces stricter request cap when strict mode is enabled", async () => {
    ((prisma as any).appSetting.findMany as jest.Mock).mockResolvedValue([
      {
        key: "governance.operations",
        value: {
          maintenanceMode: false,
          strictRateLimitMode: true,
        },
      },
    ]);

    let lastStatus = 200;
    for (let i = 0; i < 61; i += 1) {
      const res = await request(app).get("/dashboard");
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
