import bcrypt from 'bcrypt'
import pool from './db'

/**
 * Creates or updates a development test user
 * Default credentials:
 * - User ID: TEST (4 chars)
 * - Password: TestPassword@12345
 */
export async function seedDevUserIfNeeded() {
    try {
        const password = 'TestPassword@12345'
        const hashedPassword = await bcrypt.hash(password, 10)

        // Upsert: Insert if doesn't exist, update if it does
        const { rows } = await pool.query(
        `INSERT INTO users (user_id, password, email, first_name, last_name, role, status, password_changed_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            password = EXCLUDED.password,
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            password_changed_at = NOW(),
            updated_at = NOW()
        RETURNING id, (xmax = 0) as inserted`,
        ['TEST', hashedPassword, 'test@dev.local', 'Test', 'User', 'SUPER_ADMIN', 'ACTIVE']
        )
        const { id, inserted } = rows[0]
        if (inserted) {
        console.log(`[dev-seed] ✓ Test user created successfully (ID: ${id})`)
        } else {
        console.log(`[dev-seed] ✓ Test user updated successfully (ID: ${id})`)
        }
        console.log('[dev-seed]   User ID: TEST')
        console.log('[dev-seed]   Password: TestPassword@12345')
    } catch (error) {
        console.log('[dev-seed] Error with test user:', error)
    }
}
