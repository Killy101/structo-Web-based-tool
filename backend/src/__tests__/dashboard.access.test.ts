jest.mock("../lib/db", () => ({
  __esModule: true,
  default: { query: jest.fn() },
  pool: { query: jest.fn() },
}));

let mockUser = { userId: 7, role: "USER" };

jest.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = mockUser;
    next();
  },
}));

import express from "express";
import request from "supertest";
import dashboardRoutes from "../routes/dashboard";
import pool from "../lib/db";

const app = express();
app.use(express.json());
app.use("/dashboard", dashboardRoutes);

function installDashboardMocks(teamId: number | null) {
  (pool.query as jest.Mock).mockImplementation((sql: string) => {
    if (sql.includes("FROM users u LEFT JOIN teams t ON u.team_id = t.id")) {
      return Promise.resolve({
        rows: [
          {
            id: mockUser.userId,
            userId: "USR001",
            firstName: "Test",
            lastName: "User",
            role: mockUser.role,
            teamId,
            team: teamId ? { id: teamId, name: "Scoped Team" } : null,
          },
        ],
      });
    }

    if (sql.includes("SELECT COUNT(*)::int as count") || sql.includes("GROUP BY")) {
      if (sql.includes("GROUP BY role")) return Promise.resolve({ rows: [{ role: mockUser.role, count: 1 }] });
      if (sql.includes("GROUP BY status")) return Promise.resolve({ rows: [{ status: "DRAFT", count: 1 }] });
      return Promise.resolve({ rows: [{ count: 1 }] });
    }

    if (sql.includes("FROM file_uploads f JOIN users u")) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });
}

describe("GET /dashboard/stats access scope", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("limits USER dashboard queries to the signed-in user", async () => {
    mockUser = { userId: 7, role: "USER" };
    installDashboardMocks(3);

    const res = await request(app).get("/dashboard/stats");

    expect(res.status).toBe(200);
    expect(res.body.totalTeams).toBe(1);

    const sqlStatements = (pool.query as jest.Mock).mock.calls.map(([sql]) => String(sql));
    expect(sqlStatements.some((sql) => sql.includes("uploaded_by_id = $1"))).toBe(true);
    expect(sqlStatements.some((sql) => sql.includes("created_by_id = $1"))).toBe(true);
    expect(sqlStatements.some((sql) => sql.includes("EXISTS (SELECT 1 FROM task_assignees"))).toBe(true);
  });

  it("limits ADMIN dashboard queries to their own team", async () => {
    mockUser = { userId: 11, role: "ADMIN" };
    installDashboardMocks(5);

    const res = await request(app).get("/dashboard/stats");

    expect(res.status).toBe(200);
    expect(res.body.totalTeams).toBe(1);

    const sqlStatements = (pool.query as jest.Mock).mock.calls.map(([sql]) => String(sql));
    expect(sqlStatements.some((sql) => sql.includes("team_id = $1"))).toBe(true);
    expect(sqlStatements.some((sql) => sql.includes("uploaded_by_id IN (SELECT id FROM users WHERE team_id = $1)"))).toBe(true);
    expect(sqlStatements.some((sql) => sql.includes("created_by_id IN (SELECT id FROM users WHERE team_id = $1)"))).toBe(true);
  });
});
