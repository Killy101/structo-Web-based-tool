import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";

const router = Router();

const GOVERNANCE_SECURITY_KEY = "governance.security";
const GOVERNANCE_OPERATIONS_KEY = "governance.operations";

type SecurityPolicyState = {
  minPasswordLength: number;
  requireUppercase: boolean;
  requireNumber: boolean;
  minSpecialChars: number;
  rememberedCount: number;
  minPasswordAgeDays: number;
  maxPasswordAgeDays: number;
  sessionTimeoutMinutes: number;
  enforceMfaForAdmins: boolean;
};

type OperationsPolicyState = {
  maintenanceMode: boolean;
  strictRateLimitMode: boolean;
  auditDigestEnabled: boolean;
  maintenanceBannerMessage: string;
  maintenanceWindowStartUtc: string;
  maintenanceWindowEndUtc: string;
  maintenanceLearnMoreUrl: string;
};

type GovernanceChangeEntry = {
  field: string;
  section: "security" | "operations";
  before: unknown;
  after: unknown;
};

const DEFAULT_SECURITY_POLICY: SecurityPolicyState = {
  minPasswordLength: 15,
  requireUppercase: true,
  requireNumber: true,
  minSpecialChars: 1,
  rememberedCount: 24,
  minPasswordAgeDays: 7,
  maxPasswordAgeDays: 90,
  sessionTimeoutMinutes: 30,
  enforceMfaForAdmins: false,
};

const DEFAULT_OPERATIONS_POLICY: OperationsPolicyState = {
  maintenanceMode: false,
  strictRateLimitMode: false,
  auditDigestEnabled: true,
  maintenanceBannerMessage:
    "Our system is currently undergoing maintenance to improve performance and reliability. We'll be back shortly. Thank you for your patience and understanding.",
  maintenanceWindowStartUtc: "",
  maintenanceWindowEndUtc: "",
  maintenanceLearnMoreUrl: "",
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeSecurityPolicy(input: unknown): SecurityPolicyState {
  const raw = asObject(input);

  const legacyMinSpecial =
    raw.minSpecialChars === undefined
      ? raw.requireSpecial === false
        ? 0
        : DEFAULT_SECURITY_POLICY.minSpecialChars
      : Number(raw.minSpecialChars);

  const minPasswordAgeDays = Math.max(
    0,
    Number(raw.minPasswordAgeDays ?? DEFAULT_SECURITY_POLICY.minPasswordAgeDays),
  );

  const maxPasswordAgeDays = Math.max(
    minPasswordAgeDays,
    Number(raw.maxPasswordAgeDays ?? DEFAULT_SECURITY_POLICY.maxPasswordAgeDays),
  );

  return {
    minPasswordLength: Math.max(
      15,
      Number(raw.minPasswordLength ?? DEFAULT_SECURITY_POLICY.minPasswordLength),
    ),
    requireUppercase:
      raw.requireUppercase === undefined
        ? DEFAULT_SECURITY_POLICY.requireUppercase
        : Boolean(raw.requireUppercase),
    requireNumber:
      raw.requireNumber === undefined
        ? DEFAULT_SECURITY_POLICY.requireNumber
        : Boolean(raw.requireNumber),
    minSpecialChars: Math.max(1, legacyMinSpecial),
    rememberedCount: Math.max(
      1,
      Number(raw.rememberedCount ?? DEFAULT_SECURITY_POLICY.rememberedCount),
    ),
    minPasswordAgeDays,
    maxPasswordAgeDays,
    sessionTimeoutMinutes: Math.max(
      5,
      Number(
        raw.sessionTimeoutMinutes ?? DEFAULT_SECURITY_POLICY.sessionTimeoutMinutes,
      ),
    ),
    enforceMfaForAdmins:
      raw.enforceMfaForAdmins === undefined
        ? DEFAULT_SECURITY_POLICY.enforceMfaForAdmins
        : Boolean(raw.enforceMfaForAdmins),
  };
}

function normalizeOperationsPolicy(input: unknown): OperationsPolicyState {
  const raw = asObject(input);
  const bannerMessage = String(
    raw.maintenanceBannerMessage ?? DEFAULT_OPERATIONS_POLICY.maintenanceBannerMessage,
  ).trim();
  const windowStart = String(raw.maintenanceWindowStartUtc ?? "").trim();
  const windowEnd = String(raw.maintenanceWindowEndUtc ?? "").trim();
  const learnMore = String(raw.maintenanceLearnMoreUrl ?? "").trim();

  return {
    maintenanceMode:
      raw.maintenanceMode === undefined
        ? DEFAULT_OPERATIONS_POLICY.maintenanceMode
        : Boolean(raw.maintenanceMode),
    strictRateLimitMode:
      raw.strictRateLimitMode === undefined
        ? DEFAULT_OPERATIONS_POLICY.strictRateLimitMode
        : Boolean(raw.strictRateLimitMode),
    auditDigestEnabled:
      raw.auditDigestEnabled === undefined
        ? DEFAULT_OPERATIONS_POLICY.auditDigestEnabled
        : Boolean(raw.auditDigestEnabled),
    maintenanceBannerMessage:
      bannerMessage || DEFAULT_OPERATIONS_POLICY.maintenanceBannerMessage,
    maintenanceWindowStartUtc: windowStart,
    maintenanceWindowEndUtc: windowEnd,
    maintenanceLearnMoreUrl: learnMore,
  };
}

function isSameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function collectChanges(
  section: "security" | "operations",
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): GovernanceChangeEntry[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: GovernanceChangeEntry[] = [];

  for (const key of keys) {
    if (isSameValue(before[key], after[key])) continue;
    changes.push({
      field: key,
      section,
      before: before[key],
      after: after[key],
    });
  }

  return changes;
}

async function loadGovernanceSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [GOVERNANCE_SECURITY_KEY, GOVERNANCE_OPERATIONS_KEY] } },
  });

  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  return {
    securityPolicy: normalizeSecurityPolicy(byKey.get(GOVERNANCE_SECURITY_KEY)),
    operationsPolicy: normalizeOperationsPolicy(byKey.get(GOVERNANCE_OPERATIONS_KEY)),
  };
}

async function loadOperationsStatus() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [GOVERNANCE_OPERATIONS_KEY, GOVERNANCE_SECURITY_KEY] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const operationsPolicy = normalizeOperationsPolicy(byKey.get(GOVERNANCE_OPERATIONS_KEY));
  const sec = byKey.get(GOVERNANCE_SECURITY_KEY) as Record<string, unknown> | undefined;
  const sessionTimeoutMinutes = Math.max(5, Number(sec?.sessionTimeoutMinutes ?? 30));
  return { operationsPolicy, sessionTimeoutMinutes };
}

// ── GET /settings/operations-status ───────────────────────────────────────────
router.get(
  "/operations-status",
  authenticate,
  async (_req: AuthRequest, res: Response) => {
    try {
      const status = await loadOperationsStatus();
      return res.json(status);
    } catch (error) {
      console.error("Get operations status error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /settings/governance ───────────────────────────────────────────────────
router.get(
  "/governance",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (_req: AuthRequest, res: Response) => {
    try {
      const settings = await loadGovernanceSettings();
      return res.json({ settings });
    } catch (error) {
      console.error("Get governance settings error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /settings/governance-history ─────────────────────
router.get(
  "/governance-history",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (_req: AuthRequest, res: Response) => {
    try {
      const logs = await prisma.userLog.findMany({
        where: { action: "GOVERNANCE_SETTINGS_UPDATED" },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          user: {
            select: { id: true, userId: true, firstName: true, lastName: true, role: true },
          },
        },
      });
      return res.json({ logs });
    } catch (error) {
      console.error("Get governance history error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /settings/governance ────────────────────────────────────────────────
router.patch(
  "/governance",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const current = await loadGovernanceSettings();
      const securityPolicy = normalizeSecurityPolicy(req.body?.securityPolicy);
      const operationsPolicy = normalizeOperationsPolicy(req.body?.operationsPolicy);

      await prisma.$transaction([
        prisma.appSetting.upsert({
          where:  { key: GOVERNANCE_SECURITY_KEY },
          create: { key: GOVERNANCE_SECURITY_KEY,  value: securityPolicy  as any },
          update: { value: securityPolicy  as any },
        }),
        prisma.appSetting.upsert({
          where:  { key: GOVERNANCE_OPERATIONS_KEY },
          create: { key: GOVERNANCE_OPERATIONS_KEY, value: operationsPolicy as any },
          update: { value: operationsPolicy as any },
        }),
      ]);

      const changes = [
        ...collectChanges(
          "security",
          current.securityPolicy as unknown as Record<string, unknown>,
          securityPolicy as unknown as Record<string, unknown>,
        ),
        ...collectChanges(
          "operations",
          current.operationsPolicy as unknown as Record<string, unknown>,
          operationsPolicy as unknown as Record<string, unknown>,
        ),
      ];

      const sections = Array.from(new Set(changes.map((c) => c.section)));

      await prisma.userLog.create({
        data: {
          userId:  req.user!.userId,
          action:  "GOVERNANCE_SETTINGS_UPDATED",
          details: JSON.stringify({
            message: "Updated governance settings",
            sections,
            changes,
          }),
        },
      });

      return res.json({
        message: "Governance settings updated",
        settings: { securityPolicy, operationsPolicy },
      });
    } catch (error) {
      console.error("Update governance settings error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
