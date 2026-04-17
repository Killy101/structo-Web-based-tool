import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import pool from './lib/db'
import { seedDevUserIfNeeded } from './lib/seed-dev-user'
import authRoutes from './routes/auth'
import usersRoutes from './routes/users'
import dashboardRoutes from './routes/dashboard'
import teamsRoutes from './routes/teams'
import rolesRoutes from './routes/roles'
import settingsRoutes from './routes/settings'
import tasksRoutes from './routes/task'
import userLogsRoutes from './routes/user-logs'
import brdRouter from './routes/brd'
import notificationsRoutes from './routes/notifications'
import inboundEmailsRoutes from './routes/inbound-emails'
import { governanceControlsMiddleware } from './middleware/governanceControls'
import {
  generalLimiter,
  uploadLimiter,
  processingLimiter,
  mutationLimiter,
} from './middleware/rateLimits'

dotenv.config()

// ── Startup env validation — fail fast rather than start in a broken state ───
const REQUIRED_ENV: Record<string, string> = {
  JWT_SECRET:     'Required for JWT signing/verification',
  DATABASE_URL:   'Required for PostgreSQL connection (or set DIRECT_URL)',
  PROCESSING_URL: 'Required to forward files to the Python processing service',
}

const missing: string[] = []
for (const [key, reason] of Object.entries(REQUIRED_ENV)) {
  // DATABASE_URL has an accepted alias DIRECT_URL
  if (key === 'DATABASE_URL' && (process.env.DATABASE_URL || process.env.DIRECT_URL)) continue
  if (!process.env[key]) missing.push(`  ${key}: ${reason}`)
}
if (missing.length > 0) {
  console.error('[startup] FATAL — missing required environment variables:')
  missing.forEach(m => console.error(m))
  process.exit(1)
}

if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  console.warn('[startup] WARNING — FRONTEND_URL is not set; CORS will default to localhost:3000')
}

const app = express()
const PORT = process.env.PORT || 4000

app.set('trust proxy', 1)

// Security headers — applied before all routes
app.use(
  helmet({
    // CSP is intentionally disabled on the API server; it is enforced by Nginx
    // for the frontend. Enabling it here would break the PDF blob/data URLs.
    contentSecurityPolicy: false,
    // Required false for PDF.js which uses cross-origin resources.
    crossOriginEmbedderPolicy: false,
    // The dashboard runs on a different origin in development (localhost:3000)
    // and needs to fetch BRD image blobs/PDFs from the API server.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Only send HSTS in production (dev runs over HTTP)
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
  }),
)

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  }),
)

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

app.use(governanceControlsMiddleware)
app.use(generalLimiter)

app.use('/auth',          authRoutes)
app.use('/users',         usersRoutes)
app.use('/dashboard',     dashboardRoutes)
app.use('/teams',         teamsRoutes)
app.use('/roles',         rolesRoutes)
app.use('/settings',      settingsRoutes)
app.use('/tasks',         tasksRoutes)
app.use('/user-logs',     userLogsRoutes)
app.use('/brd',           brdRouter)
app.use('/notifications', notificationsRoutes)
app.use('/emails',        inboundEmailsRoutes)

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() })
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected', timestamp: new Date().toISOString() })
  }
})

// Run lightweight startup migrations (idempotent ALTER TABLE ... IF NOT EXISTS)
async function runStartupMigrations() {
  try {
    await pool.query(`ALTER TABLE brd_versions ADD COLUMN IF NOT EXISTS image_ids JSONB`)
    console.log('[migrations] brd_versions.image_ids OK')

    await pool.query(`ALTER TABLE brd_cell_images ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_brd_cell_images_brd_id_deleted ON brd_cell_images (brd_id, deleted_at)`)
    console.log('[migrations] brd_cell_images.deleted_at OK')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS inbound_emails (
        id               SERIAL PRIMARY KEY,
        provider         TEXT        NOT NULL DEFAULT 'resend',
        message_id       TEXT,
        from_email       TEXT,
        to_email         TEXT,
        subject          TEXT,
        text_body        TEXT,
        html_body        TEXT,
        headers          JSONB,
        raw_payload      JSONB       NOT NULL,
        processed        BOOLEAN     NOT NULL DEFAULT FALSE,
        processed_at     TIMESTAMPTZ,
        processing_error TEXT,
        received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inbound_emails_received_at ON inbound_emails (received_at DESC)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inbound_emails_processed ON inbound_emails (processed)`)
    console.log('[migrations] inbound_emails table OK')

    // Performance indexes for user/team/log queries (safe to run on existing DBs)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_team_id ON users (team_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_role_status ON users (role, status)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_logs_user_id ON user_logs (user_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_logs_action_created_at ON user_logs (action, created_at DESC)`)
    console.log('[migrations] performance indexes OK')

    // Fix SERIAL sequences that may be out of sync with existing data
    await pool.query(`
      SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 0) + 1)
      WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='users_id_seq')
    `)
    console.log('[migrations] users_id_seq reset OK')
  } catch (err) {
    console.log('[migrations] startup migration failed:', err)
  }
}

runStartupMigrations().then(async () => {
  if (process.env.NODE_ENV !== 'production') {
    await seedDevUserIfNeeded()
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
})
