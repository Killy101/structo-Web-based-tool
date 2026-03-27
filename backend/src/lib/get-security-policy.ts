import pool from './db'

export type LiveSecurityPolicy = {
  minPasswordLength: number
  requireUppercase: boolean
  requireNumber: boolean
  minSpecialChars: number
  rememberedCount: number
  minPasswordAgeDays: number
  maxPasswordAgeDays: number
  sessionTimeoutMinutes: number
  enforceMfaForAdmins: boolean
}

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
}

export async function getSecurityPolicy(): Promise<LiveSecurityPolicy> {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'governance.security'`,
    )

    const v = rows[0]?.value as Record<string, unknown> | undefined
    if (!v || typeof v !== 'object' || Array.isArray(v)) return DEFAULTS

    return {
      minPasswordLength:     Math.max(15, Number(v.minPasswordLength    ?? DEFAULTS.minPasswordLength)),
      requireUppercase:      v.requireUppercase     === undefined ? DEFAULTS.requireUppercase     : Boolean(v.requireUppercase),
      requireNumber:         v.requireNumber        === undefined ? DEFAULTS.requireNumber        : Boolean(v.requireNumber),
      minSpecialChars:       Math.max(1, Number(v.minSpecialChars       ?? DEFAULTS.minSpecialChars)),
      rememberedCount:       Math.max(1, Number(v.rememberedCount       ?? DEFAULTS.rememberedCount)),
      minPasswordAgeDays:    Math.max(0, Number(v.minPasswordAgeDays    ?? DEFAULTS.minPasswordAgeDays)),
      maxPasswordAgeDays:    Math.max(1, Number(v.maxPasswordAgeDays    ?? DEFAULTS.maxPasswordAgeDays)),
      sessionTimeoutMinutes: Math.max(5, Number(v.sessionTimeoutMinutes ?? DEFAULTS.sessionTimeoutMinutes)),
      enforceMfaForAdmins:   v.enforceMfaForAdmins  === undefined ? DEFAULTS.enforceMfaForAdmins  : Boolean(v.enforceMfaForAdmins),
    }
  } catch {
    return DEFAULTS
  }
}
