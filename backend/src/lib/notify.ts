import pool from './db'

type NotificationType = 'TASK_ASSIGNED' | 'TASK_UPDATED' | 'BRD_STATUS' | 'SYSTEM'

export async function createNotification(
  userId: number,
  type: NotificationType,
  title: string,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, message, meta ? JSON.stringify(meta) : null],
    )
  } catch (err) {
    console.log('Failed to create notification:', err)
  }
}

export async function notifyMany(
  userIds: number[],
  type: NotificationType,
  title: string,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await Promise.all(
    userIds.map((uid) => createNotification(uid, type, title, message, meta)),
  )
}
