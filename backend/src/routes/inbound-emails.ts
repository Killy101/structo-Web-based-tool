import { Router, Request, Response } from 'express'
import pool from '../lib/db'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'

const router = Router()

function normalizeEmailAddress(input: unknown): string | null {
  if (!input) return null
  if (typeof input === 'string') {
    const raw = input.trim()
    if (!raw) return null
    const match = raw.match(/<([^>]+)>/)
    return (match?.[1] ?? raw).trim().toLowerCase()
  }
  if (typeof input === 'object') {
    const maybeEmail = (input as { email?: unknown }).email
    if (typeof maybeEmail === 'string' && maybeEmail.trim()) {
      return maybeEmail.trim().toLowerCase()
    }
  }
  return null
}

function normalizeRecipient(input: unknown): string | null {
  if (Array.isArray(input)) {
    for (const entry of input) {
      const value = normalizeEmailAddress(entry)
      if (value) return value
    }
    return null
  }
  return normalizeEmailAddress(input)
}

router.post('/inbound/resend', async (req: Request, res: Response) => {
  try {
    const expectedSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET?.trim()
    if (!expectedSecret) {
      return res.status(503).json({ error: 'Inbound email webhook is not configured' })
    }

    const providedSecret = String(req.headers['x-inbound-email-secret'] ?? '').trim()
    if (!providedSecret || providedSecret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized webhook request' })
    }

    const payload = req.body as Record<string, unknown>
    const messageId = String(payload.message_id ?? payload.id ?? '').trim() || null
    const fromEmail = normalizeEmailAddress(payload.from)
    const toEmail = normalizeRecipient(payload.to)
    const subject = typeof payload.subject === 'string' ? payload.subject : null
    const textBody = typeof payload.text === 'string' ? payload.text : (typeof payload.text_body === 'string' ? payload.text_body : null)
    const htmlBody = typeof payload.html === 'string' ? payload.html : (typeof payload.html_body === 'string' ? payload.html_body : null)

    const { rows } = await pool.query(
      `INSERT INTO inbound_emails (provider, message_id, from_email, to_email, subject, text_body, html_body, headers, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, received_at as "receivedAt"`,
      [
        'resend',
        messageId,
        fromEmail,
        toEmail,
        subject,
        textBody,
        htmlBody,
        payload.headers ? JSON.stringify(payload.headers) : null,
        JSON.stringify(payload),
      ],
    )

    res.status(201).json({ message: 'Inbound email stored', email: rows[0] })
  } catch (error) {
    console.log('Inbound email webhook error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/inbound', authenticate, authorize(['SUPER_ADMIN']), async (_req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, provider, message_id as "messageId", from_email as "fromEmail", to_email as "toEmail",
              subject, text_body as "textBody", html_body as "htmlBody", processed,
              processed_at as "processedAt", processing_error as "processingError", received_at as "receivedAt"
       FROM inbound_emails
       ORDER BY received_at DESC
       LIMIT 200`,
    )

    res.json({ emails: rows })
  } catch (error) {
    console.log('Get inbound emails error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/inbound/:id/processed', authenticate, authorize(['SUPER_ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const inboundId = Number(req.params.id)
    if (!Number.isFinite(inboundId)) return res.status(400).json({ error: 'Invalid inbound email id' })

    const { processed = true, processingError = null } = req.body as {
      processed?: boolean
      processingError?: string | null
    }

    const { rows } = await pool.query(
      `UPDATE inbound_emails
       SET processed = $1,
           processed_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
           processing_error = $2
       WHERE id = $3
       RETURNING id, processed, processed_at as "processedAt", processing_error as "processingError"`,
      [!!processed, processingError, inboundId],
    )

    if (!rows[0]) return res.status(404).json({ error: 'Inbound email not found' })

    res.json({ message: 'Inbound email updated', email: rows[0] })
  } catch (error) {
    console.log('Update inbound email status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
