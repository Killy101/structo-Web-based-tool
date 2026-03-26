jest.mock("../lib/db", () => ({
  __esModule: true,
  default: { query: jest.fn().mockResolvedValue({ rows: [] }) },
  pool:    { query: jest.fn().mockResolvedValue({ rows: [] }) },
  withTransaction: jest.fn().mockImplementation(async (fn: any) => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    return fn(client);
  }),
}));

import express from "express";
import request from "supertest";
import pool from "../lib/db";
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
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        {
          value: {
            maintenanceMode: true,
            strictRateLimitMode: false,
          },
        },
      ],
    });

    const res = await request(app).post("/tasks").send({ title: "x" });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain("maintenance mode");
  });

  it("allows exempt governance endpoint during maintenance mode", async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        {
          value: {
            maintenanceMode: true,
            strictRateLimitMode: false,
          },
        },
      ],
    });

    const res = await request(app)
      .patch("/settings/governance")
      .send({ any: "value" });

    expect(res.status).toBe(200);
  });

  it("enforces stricter request cap when strict mode is enabled", async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        {
          value: {
            maintenanceMode: false,
            strictRateLimitMode: true,
          },
        },
      ],
    });

    let lastStatus = 200;
    for (let i = 0; i < 61; i += 1) {
      const res = await request(app).get("/dashboard");
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
