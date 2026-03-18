import dotenv from 'dotenv'
dotenv.config()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const databaseUrl = process.env.DATABASE_URL?.trim()
const directUrl = process.env.DIRECT_URL?.trim()

// Prefer a real Postgres URL for the pg adapter.
// Some setups keep DATABASE_URL for pooled/proxy urls and DIRECT_URL for direct DB access.
const connectionString =
  databaseUrl && databaseUrl.startsWith('postgres')
    ? databaseUrl
    : directUrl || databaseUrl

if (!connectionString) {
  throw new Error('DATABASE_URL or DIRECT_URL must be defined in .env file')
}

const adapter = new PrismaPg({ connectionString })

const prisma = new PrismaClient({ adapter })

export default prisma