import { Router, Response } from 'express'
import pool from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'

const router = Router()

const GOVERNANCE_SECURITY_KEY   = 'governance.security'
const GOVERNANCE_OPERATIONS_KEY = 'governance.operations'

type SecurityPolicyState = {
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

type OperationsPolicyState = {
  maintenanceMode: boolean
  strictRateLimitMode: boolean
  auditDigestEnabled: boolean
  maintenanceBannerMessage: string
  maintenanceWindowStartUtc: string
  maintenanceWindowEndUtc: string
  maintenanceLearnMoreUrl: string
}

type GovernanceChangeEntry = { field: string; section: 'security' | 'operations'; before: unknown; after: unknown }

const DEFAULT_SECURITY_POLICY: SecurityPolicyState = {
  minPasswordLength: 15, requireUppercase: true, requireNumber: true,
  minSpecialChars: 1, rememberedCount: 24, minPasswordAgeDays: 7,
  maxPasswordAgeDays: 90, sessionTimeoutMinutes: 30, enforceMfaForAdmins: false,
}

const DEFAULT_OPERATIONS_POLICY: OperationsPolicyState = {
  maintenanceMode: false, strictRateLimitMode: false, auditDigestEnabled: true,
  maintenanceBannerMessage: "Our system is currently undergoing maintenance to improve performance and reliability. We'll be back shortly. Thank you for your patience and understanding.",
  maintenanceWindowStartUtc: '', maintenanceWindowEndUtc: '', maintenanceLearnMoreUrl: '',
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeSecurityPolicy(input: unknown): SecurityPolicyState {
  const raw = asObject(input)
  const legacyMinSpecial = raw.minSpecialChars === undefined
    ? (raw.requireSpecial === false ? 0 : DEFAULT_SECURITY_POLICY.minSpecialChars)
    : Number(raw.minSpecialChars)
  const minPasswordAgeDays = Math.max(0, Number(raw.minPasswordAgeDays ?? DEFAULT_SECURITY_POLICY.minPasswordAgeDays))
  const maxPasswordAgeDays = Math.max(minPasswordAgeDays, Number(raw.maxPasswordAgeDays ?? DEFAULT_SECURITY_POLICY.maxPasswordAgeDays))
  return {
    minPasswordLength:     Math.max(15, Number(raw.minPasswordLength ?? DEFAULT_SECURITY_POLICY.minPasswordLength)),
    requireUppercase:      raw.requireUppercase === undefined ? DEFAULT_SECURITY_POLICY.requireUppercase : Boolean(raw.requireUppercase),
    requireNumber:         raw.requireNumber === undefined ? DEFAULT_SECURITY_POLICY.requireNumber : Boolean(raw.requireNumber),
    minSpecialChars:       Math.max(1, legacyMinSpecial),
    rememberedCount:       Math.max(1, Number(raw.rememberedCount ?? DEFAULT_SECURITY_POLICY.rememberedCount)),
    minPasswordAgeDays, maxPasswordAgeDays,
    sessionTimeoutMinutes: Math.max(5, Number(raw.sessionTimeoutMinutes ?? DEFAULT_SECURITY_POLICY.sessionTimeoutMinutes)),
    enforceMfaForAdmins:   raw.enforceMfaForAdmins === undefined ? DEFAULT_SECURITY_POLICY.enforceMfaForAdmins : Boolean(raw.enforceMfaForAdmins),
  }
}

function normalizeOperationsPolicy(input: unknown): OperationsPolicyState {
  const raw = asObject(input)
  return {
    maintenanceMode:      raw.maintenanceMode === undefined ? DEFAULT_OPERATIONS_POLICY.maintenanceMode : Boolean(raw.maintenanceMode),
    strictRateLimitMode:  raw.strictRateLimitMode === undefined ? DEFAULT_OPERATIONS_POLICY.strictRateLimitMode : Boolean(raw.strictRateLimitMode),
    auditDigestEnabled:   raw.auditDigestEnabled === undefined ? DEFAULT_OPERATIONS_POLICY.auditDigestEnabled : Boolean(raw.auditDigestEnabled),
    maintenanceBannerMessage: String(raw.maintenanceBannerMessage ?? DEFAULT_OPERATIONS_POLICY.maintenanceBannerMessage).trim() || DEFAULT_OPERATIONS_POLICY.maintenanceBannerMessage,
    maintenanceWindowStartUtc: String(raw.maintenanceWindowStartUtc ?? '').trim(),
    maintenanceWindowEndUtc:   String(raw.maintenanceWindowEndUtc ?? '').trim(),
    maintenanceLearnMoreUrl:   String(raw.maintenanceLearnMoreUrl ?? '').trim(),
  }
}

function isSameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function collectChanges(section: 'security' | 'operations', before: Record<string, unknown>, after: Record<string, unknown>): GovernanceChangeEntry[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changes: GovernanceChangeEntry[] = []
  for (const key of keys) {
    if (isSameValue(before[key], after[key])) continue
    changes.push({ field: key, section, before: before[key], after: after[key] })
  }
  return changes
}

async function loadGovernanceSettings() {
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
    [[GOVERNANCE_SECURITY_KEY, GOVERNANCE_OPERATIONS_KEY]],
  )
  const byKey = new Map(rows.map((r: any) => [r.key, r.value]))
  return {
    securityPolicy:   normalizeSecurityPolicy(byKey.get(GOVERNANCE_SECURITY_KEY)),
    operationsPolicy: normalizeOperationsPolicy(byKey.get(GOVERNANCE_OPERATIONS_KEY)),
  }
}

async function loadOperationsStatus() {
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
    [[GOVERNANCE_OPERATIONS_KEY, GOVERNANCE_SECURITY_KEY]],
  )
  const byKey = new Map(rows.map((r: any) => [r.key, r.value]))
  const operationsPolicy = normalizeOperationsPolicy(byKey.get(GOVERNANCE_OPERATIONS_KEY))
  const sec = byKey.get(GOVERNANCE_SECURITY_KEY) as Record<string, unknown> | undefined
  const sessionTimeoutMinutes = Math.max(5, Number(sec?.sessionTimeoutMinutes ?? 30))
  return { operationsPolicy, sessionTimeoutMinutes }
}

router.get('/operations-status', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    return res.json(await loadOperationsStatus())
  } catch (error) {
    console.log('Get operations status error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/governance', authenticate, authorize(['SUPER_ADMIN']), async (_req: AuthRequest, res: Response) => {
  try {
    return res.json({ settings: await loadGovernanceSettings() })
  } catch (error) {
    console.log('Get governance settings error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/governance-history', authenticate, authorize(['SUPER_ADMIN']), async (_req: AuthRequest, res: Response) => {
  try {
    const { rows: logs } = await pool.query(
      `SELECT ul.id, ul.action, ul.details, ul.created_at as "createdAt",
              json_build_object(
                'id', u.id, 'userId', u.user_id,
                'firstName', u.first_name, 'lastName', u.last_name, 'role', u.role
              ) as user
       FROM user_logs ul
       JOIN users u ON ul.user_id = u.id
       WHERE ul.action = 'GOVERNANCE_SETTINGS_UPDATED'
       ORDER BY ul.created_at DESC
       LIMIT 50`,
    )
    return res.json({ logs })
  } catch (error) {
    console.log('Get governance history error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/governance', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const current = await loadGovernanceSettings()
    const securityPolicy   = normalizeSecurityPolicy(req.body?.securityPolicy)
    const operationsPolicy = normalizeOperationsPolicy(req.body?.operationsPolicy)

    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2), ($3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [
        GOVERNANCE_SECURITY_KEY,   JSON.stringify(securityPolicy),
        GOVERNANCE_OPERATIONS_KEY, JSON.stringify(operationsPolicy),
      ],
    )

    const changes = [
      ...collectChanges('security',   current.securityPolicy   as unknown as Record<string, unknown>, securityPolicy   as unknown as Record<string, unknown>),
      ...collectChanges('operations', current.operationsPolicy as unknown as Record<string, unknown>, operationsPolicy as unknown as Record<string, unknown>),
    ]
    const sections = Array.from(new Set(changes.map((c) => c.section)))

    await pool.query(
      `INSERT INTO user_logs (user_id, action, details) VALUES ($1, $2, $3)`,
      [req.user!.userId, 'GOVERNANCE_SETTINGS_UPDATED', JSON.stringify({ message: 'Updated governance settings', sections, changes })],
    )

    return res.json({ message: 'Governance settings updated', settings: { securityPolicy, operationsPolicy } })
  } catch (error) {
    console.log('Update governance settings error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
