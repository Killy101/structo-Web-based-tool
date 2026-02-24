import dotenv from 'dotenv'
dotenv.config()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined in .env file')
}

const adapter = new PrismaPg({ connectionString })

const prisma = new PrismaClient({ adapter })

export default prisma