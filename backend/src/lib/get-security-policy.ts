/**
 * Loads the current security policy from app_settings.
 * Falls back to hardcoded defaults if the table is empty or unavailable.
 */
import prisma from "./prisma";

export type LiveSecurityPolicy = {
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

const DEFAULTS: LiveSecurityPolicy = {
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

export async function getSecurityPolicy(): Promise<LiveSecurityPolicy> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: "governance.security" },
      select: { value: true },
    });

    if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) {
      return DEFAULTS;
    }

    const v = row.value as Record<string, unknown>;

    return {
      minPasswordLength:    Math.max(15, Number(v.minPasswordLength    ?? DEFAULTS.minPasswordLength)),
      requireUppercase:     v.requireUppercase     === undefined ? DEFAULTS.requireUppercase     : Boolean(v.requireUppercase),
      requireNumber:        v.requireNumber        === undefined ? DEFAULTS.requireNumber        : Boolean(v.requireNumber),
      minSpecialChars:      Math.max(1, Number(v.minSpecialChars      ?? DEFAULTS.minSpecialChars)),
      rememberedCount:      Math.max(1, Number(v.rememberedCount      ?? DEFAULTS.rememberedCount)),
      minPasswordAgeDays:   Math.max(0, Number(v.minPasswordAgeDays   ?? DEFAULTS.minPasswordAgeDays)),
      maxPasswordAgeDays:   Math.max(1, Number(v.maxPasswordAgeDays   ?? DEFAULTS.maxPasswordAgeDays)),
      sessionTimeoutMinutes:Math.max(5, Number(v.sessionTimeoutMinutes?? DEFAULTS.sessionTimeoutMinutes)),
      enforceMfaForAdmins:  v.enforceMfaForAdmins  === undefined ? DEFAULTS.enforceMfaForAdmins  : Boolean(v.enforceMfaForAdmins),
    };
  } catch {
    return DEFAULTS;
  }
}
