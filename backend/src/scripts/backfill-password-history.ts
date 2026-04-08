import pool from '../lib/db'

export const createPasswordHistory = async (userId: number, passwordHash: string, createdAt: Date) => {
  const { rows: existing } = await pool.query(
    `SELECT id FROM password_history WHERE user_id = $1 AND hash = $2 LIMIT 1`,
    [userId, passwordHash],
  )

  if (existing[0]) return existing[0]

  await pool.query(
    `INSERT INTO password_history (user_id, hash, created_at) VALUES ($1, $2, $3)`,
    [userId, passwordHash, createdAt],
  )

  return null
}

async function main() {
  const { rows: users } = await pool.query(
    `SELECT id, password, password_changed_at, created_at FROM users WHERE password IS NOT NULL`,
  )

  let backfilled = 0
  for (const user of users) {
    const result = await createPasswordHistory(
      user.id,
      user.password,
      user.password_changed_at ?? user.created_at,
    )
    if (result === null) backfilled++
  }

  console.log(`Backfilled ${backfilled} password history entries for ${users.length} users.`)
  await pool.end()
}

main().catch((err) => {
  console.log('Backfill error:', err)
  process.exit(1)
})
