import express from 'express'
import cors from 'cors'
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
import { governanceControlsMiddleware } from './middleware/governanceControls'
import {
  generalLimiter,
  uploadLimiter,
  processingLimiter,
  mutationLimiter,
} from './middleware/rateLimits'

dotenv.config()

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable must be set before starting the server')
}

const app = express()
const PORT = process.env.PORT || 4000

app.set('trust proxy', 1)

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

app.get('/health', (_req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() })
})

// Run lightweight startup migrations (idempotent ALTER TABLE ... IF NOT EXISTS)
async function runStartupMigrations() {
  try {
    await pool.query(`ALTER TABLE brd_versions ADD COLUMN IF NOT EXISTS image_ids JSONB`)
    console.log('[migrations] brd_versions.image_ids OK')
    // Seed development user in dev environment

    if (process.env.NODE_ENV === 'development') {
      await seedDevUserIfNeeded()
    }  } catch (err) {
    console.error('[migrations] startup migration failed:', err)
  }
}

runStartupMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
})
