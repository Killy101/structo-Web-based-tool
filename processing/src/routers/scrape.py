"""
processing/src/routers/scrape.py
=================================
FastAPI router for the WebScrape feature.

Endpoints
---------
POST /scrape/start          — Queue a new scrape job.  Returns {job_id, status}.
GET  /scrape/{job_id}       — Poll job status + pages summary (no binary data).
GET  /scrape/{job_id}/html  — Download the HTML output (completed jobs only).
GET  /scrape/{job_id}/pdf   — Download the PDF output (completed jobs, pdf must be available).
"""

import threading

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, field_validator

from src.services.web_scraper import (
    ScrapeConfig,
    create_job,
    get_job,
    is_safe_url,
    run_scrape_job,
)

router = APIRouter(prefix="/scrape", tags=["scrape"])

# ── Request / Response models ──────────────────────────────────────────────────


class ScrapeRequest(BaseModel):
    url: str
    max_depth: int = 2
    max_pages: int = 30
    include_images_ocr: bool = True
    follow_same_domain: bool = True

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("url must not be empty")
        if not is_safe_url(v):
            raise ValueError(
                "url must be a public HTTP/HTTPS address "
                "(private/loopback/metadata IPs are not allowed)"
            )
        return v

    @field_validator("max_depth")
    @classmethod
    def cap_depth(cls, v: int) -> int:
        return min(max(v, 0), 5)

    @field_validator("max_pages")
    @classmethod
    def cap_pages(cls, v: int) -> int:
        return min(max(v, 1), 100)


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.post("/start")
def start_scrape(req: ScrapeRequest):
    """Start a new scrape job in the background. Returns {job_id, status}."""
    config = ScrapeConfig(
        max_depth=req.max_depth,
        max_pages=req.max_pages,
        timeout=30.0,
        follow_same_domain=req.follow_same_domain,
        include_images_ocr=True,  # always auto-enabled
    )
    job_id = create_job(req.url, config)
    thread = threading.Thread(target=run_scrape_job, args=(job_id,), daemon=True)
    thread.start()
    return {"job_id": job_id, "status": "queued"}


@router.get("/{job_id}")
def get_scrape_status(job_id: str):
    """Return the current status and a summary of scraped pages."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Scrape job not found")

    pages_summary = [
        {
            "url": p.url,
            "depth": p.depth,
            "parent_url": p.parent_url,
            "title": p.title,
            "heading_count": len(p.headings),
            "paragraph_count": len(p.paragraphs),
            "list_count": len(p.lists),
            "has_ocr_text": bool(p.image_texts),
            "has_rich_content": bool(p.rich_html),
            "child_url_count": len(p.child_urls),
            "error": p.error,
        }
        for p in job.pages
    ]

    return {
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "url": job.url,
        "pages": pages_summary,
        "page_count": len(job.pages),
        "success_count": sum(1 for p in job.pages if not p.error),
        "html_available": job.html_output is not None,
        "pdf_available": job.pdf_bytes is not None,
        "error": job.error,
        "created_at": job.created_at,
        "completed_at": job.completed_at,
    }


@router.get("/{job_id}/html", response_class=HTMLResponse)
def download_html(job_id: str):
    """Return the HTML output document."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Scrape job not found")
    if job.status != "completed" or job.html_output is None:
        raise HTTPException(status_code=400, detail="HTML output is not yet ready")
    return HTMLResponse(content=job.html_output, media_type="text/html; charset=utf-8")


@router.get("/{job_id}/pdf")
def download_pdf(job_id: str):
    """Return the PDF output document (if a PDF library was available)."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Scrape job not found")
    if job.status != "completed":
        raise HTTPException(status_code=400, detail="Job has not completed yet")
    if not job.pdf_bytes:
        raise HTTPException(
            status_code=404,
            detail="PDF output is not available (install weasyprint or xhtml2pdf to enable)",
        )
    return Response(
        content=job.pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="scrape-output.pdf"'},
    )
