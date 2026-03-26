/**
 * Unit tests for the notification helper.
 * Mocks pool.query to avoid a live DB connection.
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

import pool from "../lib/db";
import { createNotification, notifyMany } from "../lib/notify";

describe("createNotification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("creates a notification via pool.query", async () => {
    await createNotification(1, "SYSTEM", "Test Title", "Test message");
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO notifications"),
      expect.arrayContaining([1, "SYSTEM", "Test Title", "Test message"]),
    );
  });

  it("does not throw when pool.query fails", async () => {
    (pool.query as jest.Mock).mockRejectedValueOnce(new Error("DB Error"));
    await expect(
      createNotification(1, "SYSTEM", "Title", "Body"),
    ).resolves.not.toThrow();
  });

  it("passes meta payload when provided", async () => {
    const meta = { taskId: 42 };
    await createNotification(1, "TASK_ASSIGNED", "Title", "Body", meta);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO notifications"),
      expect.arrayContaining([meta]),
    );
  });
});

describe("notifyMany", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it("calls pool.query once per user", async () => {
    await notifyMany([1, 2, 3], "TASK_ASSIGNED", "Title", "Body");
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it("handles empty user list without error", async () => {
    await expect(notifyMany([], "SYSTEM", "T", "B")).resolves.not.toThrow();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
