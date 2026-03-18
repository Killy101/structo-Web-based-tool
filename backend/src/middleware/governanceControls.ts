import { NextFunction, Request, Response } from "express";
import prisma from "../lib/prisma";

const GOVERNANCE_OPERATIONS_KEY = "governance.operations";
const GOVERNANCE_CACHE_TTL_MS = 10_000;
const STRICT_WINDOW_MS = 60_000;
const STRICT_MAX_REQUESTS_PER_WINDOW = 60;

type OperationsFlags = {
  maintenanceMode: boolean;
  strictRateLimitMode: boolean;
};

type StrictCounterState = {
  count: number;
  resetAt: number;
};

let cachedFlags: (OperationsFlags & { fetchedAt: number }) | null = null;
const strictCounter = new Map<string, StrictCounterState>();

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeOperationsFlags(input: unknown): OperationsFlags {
  const raw = asObject(input);
  return {
    maintenanceMode: Boolean(raw.maintenanceMode),
    strictRateLimitMode: Boolean(raw.strictRateLimitMode),
  };
}

const GOVERNANCE_ERROR_CACHE_TTL_MS = 30_000; // retry DB after 30s on error

async function getOperationsFlags(): Promise<OperationsFlags> {
  const now = Date.now();
  if (cachedFlags && now - cachedFlags.fetchedAt < GOVERNANCE_CACHE_TTL_MS) {
    return cachedFlags;
  }

  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: GOVERNANCE_OPERATIONS_KEY },
      select: { value: true },
    });
    const ops = normalizeOperationsFlags(row?.value);
    cachedFlags = { ...ops, fetchedAt: now };
    return ops;
  } catch (err) {
    // DB unreachable — keep serving from cache if available, otherwise use safe defaults.
    // Use a longer TTL on error so we don't hammer a struggling DB every request.
    if (cachedFlags) return cachedFlags;
    const safe: OperationsFlags = { maintenanceMode: false, strictRateLimitMode: false };
    cachedFlags = { ...safe, fetchedAt: now - GOVERNANCE_CACHE_TTL_MS + GOVERNANCE_ERROR_CACHE_TTL_MS };
    return safe;
  }
}

function isMutationMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function isMaintenanceExemptPath(path: string): boolean {
  return (
    path === "/health" ||
    path.startsWith("/settings/governance") ||
    path.startsWith("/auth/login") ||
    path.startsWith("/auth/forgot-password") ||
    path.startsWith("/auth/reset-password")
  );
}

function incrementStrictCounter(ip: string): StrictCounterState {
  const now = Date.now();
  const current = strictCounter.get(ip);

  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + STRICT_WINDOW_MS };
    strictCounter.set(ip, next);
    return next;
  }

  current.count += 1;
  strictCounter.set(ip, current);
  return current;
}

function cleanupStrictCounter(now: number): void {
  if (strictCounter.size < 500) return;
  for (const [key, value] of strictCounter.entries()) {
    if (value.resetAt <= now) {
      strictCounter.delete(key);
    }
  }
}

export async function governanceControlsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const path = req.path || req.originalUrl || "";

  if (req.method === "OPTIONS") {
    return next();
  }

  try {
    const operations = await getOperationsFlags();

    if (
      operations.maintenanceMode &&
      isMutationMethod(req.method) &&
      !isMaintenanceExemptPath(path)
    ) {
      return res.status(503).json({
        error: "System is currently in maintenance mode. Please try again later.",
      });
    }

    if (operations.strictRateLimitMode) {
      const now = Date.now();
      cleanupStrictCounter(now);

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const counter = incrementStrictCounter(ip);

      if (counter.count > STRICT_MAX_REQUESTS_PER_WINDOW) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((counter.resetAt - now) / 1000),
        );
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          error:
            "Strict rate-limit mode is enabled. Too many requests; please try again shortly.",
        });
      }
    }

    return next();
  } catch (error) {
    console.error("Governance controls middleware error:", error);
    return next();
  }
}

export function __resetGovernanceControlsForTests(): void {
  cachedFlags = null;
  strictCounter.clear();
}
