import pool from './db'
import bcrypt from 'bcrypt'

async function seed() {
  console.log('🌱 Seeding database...')

  const defaultTeams = [
    { name: 'Pre-Production', slug: 'pre-production' },
    { name: 'Production',     slug: 'production' },
    { name: 'Updating',       slug: 'updating' },
    { name: 'Post-Production', slug: 'post-production' },
  ]

  for (const team of defaultTeams) {
    await pool.query(
      `INSERT INTO teams (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [team.name, team.slug],
    )
    console.log(`  ✓ Team "${team.name}"`)
  }

  const superAdminUserId = process.env.SUPERADMIN_USERID ?? 'SADMIN'
  const superAdminPassword = process.env.SUPERADMIN_PASSWORD ?? 'Innodata@2026!SA'

  const { rows } = await pool.query(
    `SELECT id FROM users WHERE user_id = $1`,
    [superAdminUserId],
  )

  if (rows.length === 0) {
    const hashedPassword = await bcrypt.hash(superAdminPassword, 10)

    const { rows: created } = await pool.query(
      `INSERT INTO users (user_id, first_name, last_name, role, password, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      [superAdminUserId, 'Super', 'Admin', 'SUPER_ADMIN', hashedPassword],
    )

    await pool.query(
      `INSERT INTO password_history (user_id, hash) VALUES ($1, $2)`,
      [created[0].id, hashedPassword],
    )

    console.log(`  ✓ Super Admin created (userId: ${superAdminUserId})`)
  } else {
    console.log(`  ⏭ Super Admin already exists`)
  }

  console.log('✅ Seed complete')
}

seed()
  .catch((e) => {
    console.error('Seed error:', e)
    process.exit(1)
  })
  .finally(() => pool.end())
