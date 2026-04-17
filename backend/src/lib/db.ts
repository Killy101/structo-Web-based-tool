import dotenv from 'dotenv'
dotenv.config()

import { Pool, PoolClient } from 'pg'

const connectionString = (process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? '').trim()

if (!connectionString) {
  throw new Error('DATABASE_URL or DIRECT_URL must be defined in .env file')
}

export const pool = new Pool({
  connectionString,
  max: 25,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
})

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export default pool
