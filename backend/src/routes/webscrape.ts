// backend/src/routes/webscrape.ts
// Proxy route: forwards WebScrape requests to the Python processing service.

import { Router, Response } from 'express'
import fetch from 'node-fetch'
import { authenticate, AuthRequest } from '../middleware/authenticate'
import { processingLimiter } from '../middleware/rateLimits'

const router = Router()

const PROCESSING_URL = (process.env.PROCESSING_URL ?? 'http://localhost:8000').replace(/\/$/, '')

// ── POST /webscrape/start ─────────────────────────────────────────────────────
// Start a new scrape job.  Body: { url, max_depth?, max_pages?,
//   include_images_ocr?, follow_same_domain? }
// Returns: { job_id, status }
router.post(
  '/start',
  authenticate,
  processingLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const { url, max_depth, max_pages, include_images_ocr, follow_same_domain } = req.body as {
        url?: string
        max_depth?: number
        max_pages?: number
        include_images_ocr?: boolean
        follow_same_domain?: boolean
      }

      if (!url || typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({ error: 'url is required' })
      }

      const payload = {
        url: url.trim(),
        ...(max_depth   != null && { max_depth   }),
        ...(max_pages   != null && { max_pages   }),
        ...(include_images_ocr != null && { include_images_ocr }),
        ...(follow_same_domain != null && { follow_same_domain }),
      }

      const upstream = await fetch(`${PROCESSING_URL}/scrape/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await upstream.json() as Record<string, unknown>
      return res.status(upstream.status).json(data)
    } catch (err) {
      console.error('[webscrape/start]', err)
      return res.status(500).json({ error: 'Failed to start scrape job' })
    }
  },
)

// ── GET /webscrape/:jobId ──────────────────────────────────────────────────────
// Poll job status + pages summary.
router.get('/:jobId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string }
    if (!jobId || !/^[0-9a-f]{32}$/.test(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' })
    }

    const upstream = await fetch(`${PROCESSING_URL}/scrape/${encodeURIComponent(jobId)}`)
    const data = await upstream.json() as Record<string, unknown>
    return res.status(upstream.status).json(data)
  } catch (err) {
    console.error('[webscrape/status]', err)
    return res.status(500).json({ error: 'Failed to get scrape job status' })
  }
})

// ── GET /webscrape/:jobId/html ────────────────────────────────────────────────
// Download the generated HTML document.
router.get('/:jobId/html', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string }
    if (!jobId || !/^[0-9a-f]{32}$/.test(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' })
    }

    const upstream = await fetch(`${PROCESSING_URL}/scrape/${encodeURIComponent(jobId)}/html`)

    if (!upstream.ok) {
      const data = await upstream.json() as Record<string, unknown>
      return res.status(upstream.status).json(data)
    }

    const html = await upstream.text()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="scrape-output.html"')
    return res.send(html)
  } catch (err) {
    console.error('[webscrape/html]', err)
    return res.status(500).json({ error: 'Failed to download HTML output' })
  }
})

// ── GET /webscrape/:jobId/pdf ─────────────────────────────────────────────────
// Download the generated PDF document.
router.get('/:jobId/pdf', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string }
    if (!jobId || !/^[0-9a-f]{32}$/.test(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' })
    }

    const upstream = await fetch(`${PROCESSING_URL}/scrape/${encodeURIComponent(jobId)}/pdf`)

    if (!upstream.ok) {
      const data = await upstream.json() as Record<string, unknown>
      return res.status(upstream.status).json(data)
    }

    const buffer = await upstream.buffer()
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="scrape-output.pdf"')
    return res.send(buffer)
  } catch (err) {
    console.error('[webscrape/pdf]', err)
    return res.status(500).json({ error: 'Failed to download PDF output' })
  }
})

export default router
