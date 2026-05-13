"""
processing/src/services/web_scraper.py
======================================
WebScrape service – uses Scrapling to recursively crawl a URL, extract
structured content (headings, paragraphs, lists), optionally OCR image-
embedded text, and produce HTML / PDF outputs.

Architecture
------------
* create_job()      — register a new job, return job_id
* run_scrape_job()  — blocking entry-point for a background thread
* get_job()         — read job state (thread-safe)
* build_html_output() / _try_build_pdf() — output generators

Security
--------
* is_safe_url() blocks private-network / loopback / metadata IPs to
  prevent SSRF.  Only public HTTP(S) targets are allowed.

Optional dependencies (service degrades gracefully if absent)
-------------------------------------------------------------------
* scrapling         — primary fetcher (falls back to httpx)
* httpx             — fallback HTTP client
* beautifulsoup4    — HTML parser (falls back to minimal regex extraction)
* pytesseract       — OCR for image-embedded text
* Pillow            — image handling for OCR
* weasyprint        — HTML-to-PDF (highest quality)
* xhtml2pdf         — HTML-to-PDF pure-Python fallback
"""

from __future__ import annotations

import html as _html_module
import ipaddress
import re
import threading
import time
import urllib.parse
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


# ── Optional deps ─────────────────────────────────────────────────────────────

def _try_import(name: str):
    try:
        import importlib
        return importlib.import_module(name)
    except ImportError:
        return None


_scrapling_fetcher = None
SCRAPLING_AVAILABLE = False
try:
    from scrapling.fetchers import Fetcher as _ScraplingFetcher  # type: ignore
    _scrapling_fetcher = _ScraplingFetcher
    SCRAPLING_AVAILABLE = True
except ImportError:
    pass

_httpx = _try_import("httpx")
HTTPX_AVAILABLE = _httpx is not None

_bs4_mod = _try_import("bs4")
BS4_AVAILABLE = _bs4_mod is not None

_PIL_Image = None
PIL_AVAILABLE = False
try:
    from PIL import Image as _PIL_Image_cls  # type: ignore
    _PIL_Image = _PIL_Image_cls
    PIL_AVAILABLE = True
except ImportError:
    pass

_pytesseract = _try_import("pytesseract")
TESSERACT_AVAILABLE = _pytesseract is not None

_playwright_mod = None
PLAYWRIGHT_AVAILABLE = False
try:
    from playwright.sync_api import sync_playwright as _sync_playwright  # type: ignore
    _playwright_mod = _sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    pass

_fitz = _try_import("fitz")           # PyMuPDF — already in requirements.txt
PYMUPDF_AVAILABLE = _fitz is not None

# ── SSRF protection ────────────────────────────────────────────────────────────

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local / AWS metadata
    ipaddress.ip_network("100.64.0.0/10"),   # shared address space
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]

_BLOCKED_HOSTNAMES = frozenset(
    [
        "localhost",
        "metadata.google.internal",
        "169.254.169.254",
        "instance-data",
    ]
)


def is_safe_url(url: str) -> bool:
    """Return True only for public HTTP/HTTPS URLs (SSRF guard)."""
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower().strip()
    if not host:
        return False
    if host in _BLOCKED_HOSTNAMES:
        return False
    # Reject numeric private IPs
    try:
        addr = ipaddress.ip_address(host)
        return not any(addr in net for net in _PRIVATE_NETWORKS)
    except ValueError:
        pass  # Not an IP — hostname is fine for now
    return True


# ── Data classes ───────────────────────────────────────────────────────────────

@dataclass
class ScrapeConfig:
    max_depth: int = 2
    max_pages: int = 30
    timeout: float = 20.0
    follow_same_domain: bool = True
    include_images_ocr: bool = True


@dataclass
class ScrapedPage:
    url: str
    depth: int
    parent_url: Optional[str]
    title: str
    headings: list  # [{"level": int, "text": str}]
    paragraphs: list  # [str]
    lists: list  # [[str, ...], ...]
    image_texts: list  # [str]  — OCR results
    child_urls: list  # [str]  — discovered child links
    error: Optional[str] = None
    rich_html: Optional[str] = None  # sanitized content HTML preserving formatting
    tables: list = field(default_factory=list)  # [html_string, ...]


@dataclass
class ScrapeJob:
    job_id: str
    url: str
    config: ScrapeConfig
    status: str = "queued"  # queued | running | completed | failed
    progress: int = 0
    pages: list = field(default_factory=list)  # list[ScrapedPage]
    html_output: Optional[str] = None
    pdf_bytes: Optional[bytes] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None


# ── In-memory job store ────────────────────────────────────────────────────────

_jobs: dict = {}
_jobs_lock = threading.Lock()


def create_job(url: str, config: ScrapeConfig) -> str:
    job_id = uuid.uuid4().hex
    job = ScrapeJob(job_id=job_id, url=url, config=config)
    with _jobs_lock:
        _jobs[job_id] = job
    return job_id


def get_job(job_id: str) -> Optional[ScrapeJob]:
    with _jobs_lock:
        return _jobs.get(job_id)


def _update_job(job_id: str, **kwargs):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job:
            for k, v in kwargs.items():
                setattr(job, k, v)


# ── HTTP fetching layer ────────────────────────────────────────────────────────

_SCRAPER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _fetch_scrapling(url: str, timeout: float) -> tuple:
    """Fetch with Scrapling. Returns (html, title, final_url)."""
    fetcher = _scrapling_fetcher(auto_match=False)  # type: ignore[call-arg]
    page = fetcher.get(url, timeout=int(timeout))
    if page is None:
        raise RuntimeError("Scrapling returned None (request failed or blocked)")
    title_el = page.css_first("title")
    title = title_el.text if title_el else ""
    return page.html or "", title, url  # scrapling doesn't expose final URL


def _fetch_httpx(url: str, timeout: float) -> tuple:
    """Fallback fetch with httpx (SSL-tolerant). Returns (html, title, final_url)."""
    resp = _httpx_get(url, timeout)
    resp.raise_for_status()
    final_url = str(resp.url)  # httpx tracks the final URL after all redirects
    return resp.text, "", final_url


def _fetch_playwright(url: str, timeout: float) -> tuple:
    """Fetch with Playwright Chromium (handles JS-rendered pages). Returns (html, title, final_url).

    Returns the *final* URL after any HTTP redirects — critical so that relative
    child links are resolved against the correct domain, not the original redirect URL.
    """
    with _playwright_mod() as pw:  # type: ignore[operator]
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(
            user_agent=_SCRAPER_UA,
            java_script_enabled=True,
        )
        page = context.new_page()
        page.goto(url, wait_until="networkidle", timeout=int(timeout * 1000))
        # Extra wait for SPAs that hydrate after networkidle
        try:
            page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        html = page.content()
        title = page.title()
        final_url = page.url  # actual URL after all redirects

        # Collect content from child frames (e.g. law.go.kr loads article text
        # inside an <iframe>; frameset-based sites put all content in <frame>s).
        # We append each frame's body HTML so BeautifulSoup can see the text.
        frame_extras: list[str] = []
        for frame in page.frames[1:]:   # index 0 is the main frame
            try:
                frame_url = frame.url
                # Skip blank / data: / about: frames
                if not frame_url or frame_url in ("about:blank", "") or frame_url.startswith("data:"):
                    continue
                f_html = frame.content()
                if f_html and _html_has_content(f_html):
                    frame_extras.append(f_html)
            except Exception:
                pass

        if frame_extras:
            # Inject frame bodies as <div data-frame> blocks into the main HTML
            # so _extract_main_content sees them as part of the document.
            injection = "\n".join(
                f'<div data-frame="1">{f}</div>' for f in frame_extras
            )
            # Insert before </body> if possible, otherwise just append
            if "</body>" in html:
                html = html.replace("</body>", injection + "</body>", 1)
            else:
                html = html + injection

        browser.close()
    return html, title, final_url


def _html_has_content(html: str) -> bool:
    """Return True if the HTML appears to contain meaningful text content."""
    if not html or len(html) < 500:
        return False
    if BS4_AVAILABLE:
        soup = _bs4_mod.BeautifulSoup(html, "html.parser")  # type: ignore[union-attr]
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
    else:
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
    return len(text) > 300


def fetch_page(url: str, timeout: float = 20.0) -> tuple:
    """Fetch a page, returning (raw_html_or_sentinel, title, final_url, pdf_bytes_or_None).

    Returns a 4-tuple:
        raw_html   — HTML string, or None if this is a PDF
        title      — str (may be empty)
        final_url  — URL after all redirects
        pdf_bytes  — raw bytes if the response is a PDF, else None

    Strategy:
    1. If the URL path ends in .pdf, download as bytes and return early.
    2. Try Scrapling / httpx static fetch.
       - If the response body is a PDF (magic header), return PDF bytes.
    3. If HTML has no meaningful content (JS SPA), fall back to Playwright.
       - Playwright: if the page navigates to a PDF URL, download it.
    """
    _fetch_errors: list[str] = []   # accumulate real errors for diagnostics

    # Fast path: URL obviously points to a PDF
    if _url_looks_like_pdf(url) and HTTPX_AVAILABLE:
        try:
            pdf_bytes = _fetch_pdf_bytes(url, timeout)
            if _bytes_are_pdf(pdf_bytes):
                resp = _httpx_get(url, timeout)
                return None, "", str(resp.url), pdf_bytes
        except Exception as _e:
            _fetch_errors.append(f"pdf-fast-path: {_e}")

    static_html: Optional[str] = None
    static_title: str = ""
    static_final_url: str = url

    if SCRAPLING_AVAILABLE:
        try:
            static_html, static_title, static_final_url = _fetch_scrapling(url, timeout)
        except Exception as _e:
            _fetch_errors.append(f"scrapling: {_e}")

    if not static_html and HTTPX_AVAILABLE:
        try:
            # For httpx, check response content-type / magic bytes
            resp = _httpx_get(url, timeout)
            resp.raise_for_status()
            static_final_url = str(resp.url)
            content_type = resp.headers.get("content-type", "").lower()
            if "application/pdf" in content_type or _bytes_are_pdf(resp.content[:4]):
                return None, "", static_final_url, resp.content
            static_html = resp.text
        except Exception as _e:
            _fetch_errors.append(f"httpx: {_e}")

    # If static HTML has content, use it
    if static_html and _html_has_content(static_html):
        return static_html, static_title, static_final_url, None

    # Fall back to Playwright for JS-rendered pages
    if PLAYWRIGHT_AVAILABLE:
        try:
            html, title, final_url = _fetch_playwright(url, timeout)
            # If Playwright ended up on a PDF URL, download the bytes via httpx
            if _url_looks_like_pdf(final_url) and HTTPX_AVAILABLE:
                try:
                    pdf_bytes = _fetch_pdf_bytes(final_url, timeout)
                    if _bytes_are_pdf(pdf_bytes):
                        return None, title, final_url, pdf_bytes
                except Exception:
                    pass
            return html, title, final_url, None
        except Exception as _e:
            err_msg = str(_e)
            # Playwright triggered a browser download for a PDF URL.
            # Fall back: download via httpx directly.
            if HTTPX_AVAILABLE and "download is starting" in err_msg.lower():
                try:
                    pdf_bytes = _fetch_pdf_bytes(url, timeout)
                    if _bytes_are_pdf(pdf_bytes):
                        return None, "", url, pdf_bytes
                except Exception as _e2:
                    _fetch_errors.append(f"playwright-pdf-fallback: {_e2}")
            _fetch_errors.append(f"playwright: {_e}")

    if static_html is not None:
        return static_html, static_title, static_final_url, None

    # Build a useful error message showing what actually failed
    if _fetch_errors:
        details = "; ".join(_fetch_errors)
        raise RuntimeError(f"All fetch strategies failed: {details}")
    raise RuntimeError(
        "No HTTP client available. Install scrapling, httpx, or playwright."
    )

# ── PDF detection & extraction ─────────────────────────────────────────────────

def _url_looks_like_pdf(url: str) -> bool:
    """Quick heuristic: does the URL path end in .pdf (before any query string)?"""
    path = urllib.parse.urlparse(url).path.lower()
    return path.endswith(".pdf")


def _bytes_are_pdf(data: bytes) -> bool:
    """Check the %PDF magic header."""
    return data[:4] == b"%PDF"


def _httpx_get(url: str, timeout: float, **kwargs):
    """httpx GET with automatic SSL-verification fallback.

    Many government / corporate sites present certificates from untrusted
    intermediate CAs.  We try with full verification first; if that raises an
    SSL error we retry with verify=False (the data is still encrypted, we just
    cannot authenticate the certificate chain — acceptable for a read-only
    scraping tool where the user has explicitly provided the URL).
    """
    if not HTTPX_AVAILABLE or _httpx is None:
        raise RuntimeError("httpx is not installed")
    try:
        return _httpx.get(  # type: ignore[union-attr]
            url, follow_redirects=True, timeout=timeout,
            headers={"User-Agent": _SCRAPER_UA}, **kwargs,
        )
    except Exception as _e:
        err_str = str(_e).lower()
        if "ssl" in err_str or "certificate" in err_str:
            return _httpx.get(  # type: ignore[union-attr]
                url, follow_redirects=True, timeout=timeout,
                headers={"User-Agent": _SCRAPER_UA}, verify=False, **kwargs,
            )
        raise


def _fetch_pdf_bytes(url: str, timeout: float) -> bytes:
    """Download raw bytes from a URL (used for PDF fetching)."""
    if HTTPX_AVAILABLE:
        resp = _httpx_get(url, timeout)
        resp.raise_for_status()
        return resp.content
    raise RuntimeError("httpx is required to fetch PDF bytes")


def extract_pdf_content(pdf_bytes: bytes, url: str) -> dict:
    """Extract structured content from a PDF using PyMuPDF.

    Returns the same shape as parse_page() so _crawl can use it uniformly.
    Falls back to a minimal representation when PyMuPDF is unavailable.
    """
    if not PYMUPDF_AVAILABLE:
        return {
            "title": url,
            "headings": [],
            "paragraphs": ["[PDF content — install PyMuPDF to enable extraction]"],
            "lists": [],
            "child_urls": [],
            "image_urls": [],
            "rich_html": None,
            "tables": [],
            "is_pdf": True,
            "page_count": 0,
        }

    import io as _io

    doc = _fitz.open(stream=_io.BytesIO(pdf_bytes), filetype="pdf")  # type: ignore[union-attr]
    title = (doc.metadata.get("title") or "").strip() or url

    headings: list = []
    paragraphs: list = []
    seen_para: set = set()
    rich_parts: list = []

    for page_num, page in enumerate(doc):
        blocks = page.get_text("dict", flags=_fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]  # type: ignore[union-attr]
        for block in blocks:
            if block.get("type") != 0:   # 0 = text block
                continue
            for line in block.get("lines", []):
                line_text_parts = []
                for span in line.get("spans", []):
                    text = (span.get("text") or "").strip()
                    if not text:
                        continue
                    size: float = span.get("size", 10)
                    flags: int = span.get("flags", 0)
                    is_bold   = bool(flags & 2**4)
                    is_italic = bool(flags & 2**1)

                    # Classify by font size as heading / body
                    if size >= 16:
                        headings.append({"level": 1, "text": text})
                        rich_parts.append(f"<h2><strong>{_esc(text)}</strong></h2>")
                    elif size >= 13:
                        headings.append({"level": 2, "text": text})
                        rich_parts.append(f"<h3>{_esc(text)}</h3>")
                    else:
                        wrapped = _esc(text)
                        if is_bold and is_italic:
                            wrapped = f"<strong><em>{wrapped}</em></strong>"
                        elif is_bold:
                            wrapped = f"<strong>{wrapped}</strong>"
                        elif is_italic:
                            wrapped = f"<em>{wrapped}</em>"
                        line_text_parts.append(wrapped)

                if line_text_parts:
                    combined = " ".join(line_text_parts)
                    plain = re.sub(r"<[^>]+>", "", combined).strip()
                    if plain and plain not in seen_para:
                        seen_para.add(plain)
                        paragraphs.append(plain)
                        rich_parts.append(f"<p>{combined}</p>")

        # Page separator in rich HTML
        if page_num < len(doc) - 1:
            rich_parts.append(f'<hr style="margin:16px 0;border:none;border-top:1px dashed #cbd5e1"/>'
                               f'<p style="font-size:10px;color:#94a3b8;font-family:monospace">— Page {page_num + 2} —</p>')

    doc.close()

    return {
        "title": title,
        "headings": headings[:200],    # cap to avoid huge outputs
        "paragraphs": paragraphs[:500],
        "lists": [],
        "child_urls": [],              # PDFs have no clickable nav links to crawl
        "image_urls": [],
        "rich_html": "\n".join(rich_parts) if rich_parts else None,
        "tables": [],
        "is_pdf": True,
        "page_count": len(doc) if PYMUPDF_AVAILABLE else 0,
    }

# ── Content sanitization helpers ──────────────────────────────────────────────

_NOISE_TAG_PATTERN = re.compile(
    r"\b(nav(bar)?|menu|sidebar|footer|header|cookie|banner|advertisement|ads?[-_]|"
    r"breadcrumb|pagination|popup|modal|overlay|sticky|widget|toolbar|topbar)\b",
    re.I,
)

_KEEP_ATTRS: dict = {
    "a":    ["href", "title"],
    "img":  ["src", "alt", "width", "height"],
    "th":   ["colspan", "rowspan", "scope"],
    "td":   ["colspan", "rowspan"],
    "col":  ["span"],
    "abbr": ["title"],
}


def _extract_main_content(soup, base_url: str) -> str:
    """Return sanitized inner HTML from the main content, preserving inline formatting.

    Removes navigation/ads noise, strips unsafe attributes, and fixes relative URLs.
    """
    # Remove purely noisy element types (incl. their content)
    for tag in soup.find_all([
        "script", "style", "noscript", "canvas", "video", "audio",
        "form", "input", "button", "select", "textarea", "nav", "header",
        "footer", "aside",
    ]):
        tag.decompose()

    # Decompose iframe shells but NOT data-frame divs (which hold merged frame content)
    for tag in soup.find_all("iframe"):
        tag.decompose()

    # Remove elements whose id/class match navigation / ad patterns
    for tag in list(soup.find_all(True)):
        id_cls = " ".join(filter(None, [tag.get("id") or ""] + (tag.get("class") or [])))
        if _NOISE_TAG_PATTERN.search(id_cls):
            try:
                tag.decompose()
            except Exception:
                pass

    # Locate main content container (prefer semantic landmarks)
    main = (
        soup.find("main")
        or soup.find(attrs={"role": "main"})
        or soup.find("div", attrs={"data-frame": "1"})   # merged iframe/frame content
        or soup.find(id=re.compile(r"\b(content|main|article)\b", re.I))
        or soup.find(class_=re.compile(r"\b(content|main|article)\b", re.I))
        or soup.find("article")
        or soup.find("body")
        or soup
    )

    # Strip unsafe attributes from every element; fix/validate links
    for tag in list(main.find_all(True)):
        if not tag.name:
            continue
        name = tag.name.lower()
        keep = _KEEP_ATTRS.get(name, [])
        for attr in list(tag.attrs.keys()):
            if attr not in keep:
                del tag[attr]
        if name == "a":
            href = (tag.get("href") or "").strip()
            if not href or href.lower().startswith("javascript:"):
                tag.unwrap()
                continue
            if not href.startswith(("http://", "https://", "#", "mailto:")):
                tag["href"] = urllib.parse.urljoin(base_url, href)
            tag["target"] = "_blank"
            tag["rel"] = "noopener noreferrer"

    return main.decode_contents()


def _extract_tables(soup) -> list:
    """Return table elements as cleaned HTML strings."""
    tables = []
    for tbl in soup.find_all("table"):
        for cell in tbl.find_all(["th", "td"]):
            for attr in list(cell.attrs.keys()):
                if attr not in ("colspan", "rowspan", "scope"):
                    del cell[attr]
        for tr in tbl.find_all("tr"):
            for attr in list(tr.attrs.keys()):
                del tr[attr]
        tables.append(str(tbl))
    return tables


# ── HTML parsing ───────────────────────────────────────────────────────────────

def parse_page(raw_html: str, base_url: str, config: ScrapeConfig) -> dict:
    """
    Extract structured content from raw HTML.
    Returns: {title, headings, paragraphs, lists, child_urls, image_urls, rich_html, tables}
    """
    if not BS4_AVAILABLE:
        return _parse_page_minimal(raw_html, base_url)

    BeautifulSoup = _bs4_mod.BeautifulSoup  # type: ignore[union-attr]
    soup = BeautifulSoup(raw_html, "html.parser")

    # Extract rich formatted HTML + tables BEFORE further stripping
    rich_html = _extract_main_content(soup, base_url)
    tables = _extract_tables(soup)

    # Strip remaining noise for plain-text extraction fallback
    for tag in soup(["script", "style", "noscript", "iframe", "svg", "button", "form"]):
        tag.decompose()

    # Title
    title_tag = soup.find("title")
    h1_tag = soup.find("h1")
    title = (
        (title_tag.get_text(strip=True) if title_tag else "")
        or (h1_tag.get_text(separator=" ", strip=True) if h1_tag else "")
    )

    # Headings (h1–h6) — preserve document order + level
    headings = []
    for level in range(1, 7):
        for h in soup.find_all(f"h{level}"):
            text = h.get_text(separator=" ", strip=True)
            if text:
                headings.append({"level": level, "text": text})
    # Sort by DOM order via string position in raw HTML
    headings.sort(key=lambda h: raw_html.find(h["text"]) if h["text"] in raw_html else 0)

    # Paragraphs
    paragraphs = []
    seen_para = set()
    for tag in soup.find_all(["p", "article", "main", "section", "blockquote", "dd"]):
        text = tag.get_text(separator=" ", strip=True)
        if text and len(text) > 25 and text not in seen_para:
            seen_para.add(text)
            paragraphs.append(text)

    # Lists
    lists = []
    for ul in soup.find_all(["ul", "ol"]):
        items = []
        for li in ul.find_all("li", recursive=False):
            t = li.get_text(separator=" ", strip=True)
            if t:
                items.append(t)
        if items:
            lists.append(items)

    # Child links — same-domain navigation/content links
    parsed_base = urllib.parse.urlparse(base_url)
    base_domain = parsed_base.netloc
    child_urls = []
    seen_urls: set = set()

    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if not href or href.startswith("#") or href.startswith("javascript:") or href.startswith("mailto:"):
            continue
        abs_url = urllib.parse.urljoin(base_url, href)
        # Normalise (remove fragment)
        abs_url = urllib.parse.urldefrag(abs_url)[0]
        if abs_url in seen_urls or abs_url == base_url:
            continue
        parsed_abs = urllib.parse.urlparse(abs_url)
        if parsed_abs.scheme not in ("http", "https"):
            continue
        if not is_safe_url(abs_url):
            continue
        if config.follow_same_domain and parsed_abs.netloc != base_domain:
            continue
        seen_urls.add(abs_url)
        child_urls.append(abs_url)

    # Image URLs for OCR — always collected (auto-enabled)
    image_urls = []
    for img in soup.find_all("img", src=True):
        src = (img.get("src") or "").strip()
        if not src:
            continue
        abs_src = urllib.parse.urljoin(base_url, src)
        if is_safe_url(abs_src):
            image_urls.append(abs_src)

    return {
        "title": title,
        "headings": headings,
        "paragraphs": paragraphs,
        "lists": lists,
        "child_urls": child_urls,
        "image_urls": image_urls,
        "rich_html": rich_html,
        "tables": tables,
    }


def _parse_page_minimal(raw_html: str, base_url: str) -> dict:
    """Regex-based minimal fallback when bs4 is unavailable."""
    title_m = re.search(r"<title[^>]*>([^<]*)</title>", raw_html, re.I)
    title = title_m.group(1).strip() if title_m else ""
    text_only = re.sub(r"<[^>]+>", " ", raw_html)
    text_only = re.sub(r"\s+", " ", text_only).strip()
    return {
        "title": title,
        "headings": [],
        "paragraphs": [text_only[:8000]] if text_only else [],
        "lists": [],
        "child_urls": [],
        "image_urls": [],
        "rich_html": None,
        "tables": [],
    }


# ── OCR ────────────────────────────────────────────────────────────────────────

def extract_image_text(image_url: str, timeout: float = 10.0) -> str:
    """Download an image and run OCR. Returns extracted text or ''."""
    if not TESSERACT_AVAILABLE or not PIL_AVAILABLE or not HTTPX_AVAILABLE:
        return ""
    try:
        import io
        resp = _httpx.get(image_url, follow_redirects=True, timeout=timeout,  # type: ignore[union-attr]
                          headers={"User-Agent": _SCRAPER_UA})
        resp.raise_for_status()
        img = _PIL_Image.open(io.BytesIO(resp.content)).convert("RGB")  # type: ignore[union-attr]
        return (_pytesseract.image_to_string(img) or "").strip()  # type: ignore[union-attr]
    except Exception:
        return ""


# ── Recursive crawler ──────────────────────────────────────────────────────────

def _crawl(
    job_id: str,
    url: str,
    depth: int,
    parent_url: Optional[str],
    visited: set,
    config: ScrapeConfig,
):
    """Recursively crawl pages. Appends ScrapedPage objects to the job."""
    if url in visited:
        return
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job.status == "failed":
            return
        page_count = len(job.pages)
    if page_count >= config.max_pages:
        return
    if depth > config.max_depth:
        return
    if not is_safe_url(url):
        return

    visited.add(url)
    # Update progress estimate
    progress = min(90, 10 + (len(visited) * 80 // max(1, config.max_pages)))
    _update_job(job_id, progress=progress)

    # ── Fetch with retry (up to 2 retries, increasing back-off) ─────────────
    raw_html: Optional[str] = None
    scrapling_title: str = ""
    final_url: str = url
    pdf_bytes: Optional[bytes] = None
    last_exc: Optional[Exception] = None

    for attempt in range(3):
        try:
            raw_html, scrapling_title, final_url, pdf_bytes = fetch_page(url, config.timeout)
            last_exc = None
            break
        except Exception as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(1.0 * (attempt + 1))

    if last_exc is not None:
        error_page = ScrapedPage(
            url=url, depth=depth, parent_url=parent_url, title=url,
            headings=[], paragraphs=[], lists=[], image_texts=[], child_urls=[],
            error=str(last_exc),
        )
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job:
                job.pages.append(error_page)
        return

    try:
        # ── PDF branch ──────────────────────────────────────────────────────
        if pdf_bytes is not None:
            parsed = extract_pdf_content(pdf_bytes, final_url)
            title = parsed["title"]
            page = ScrapedPage(
                url=url,
                depth=depth,
                parent_url=parent_url,
                title=title,
                headings=parsed["headings"],
                paragraphs=parsed["paragraphs"],
                lists=[],
                image_texts=[],
                child_urls=[],         # PDFs don't yield crawlable child links
                rich_html=parsed.get("rich_html"),
                tables=[],
            )
            with _jobs_lock:
                job = _jobs.get(job_id)
                if job:
                    job.pages.append(page)
            return  # No recursion from PDFs

        # ── HTML branch ─────────────────────────────────────────────────────
        if raw_html is None:
            return  # nothing to parse

        # Use final_url (after redirects) as base — ensures relative child links
        # resolve to the actual destination domain, not the original redirect URL.
        parsed = parse_page(raw_html, final_url, config)
        title = scrapling_title or parsed["title"] or url

        # OCR — always enabled; cap at 5 images per page to keep runtime reasonable
        image_texts = []
        for img_url in parsed["image_urls"][:5]:
            text = extract_image_text(img_url, config.timeout / 2)
            if text:
                image_texts.append(text)

        page = ScrapedPage(
            url=url,
            depth=depth,
            parent_url=parent_url,
            title=title,
            headings=parsed["headings"],
            paragraphs=parsed["paragraphs"],
            lists=parsed["lists"],
            image_texts=image_texts,
            child_urls=parsed["child_urls"][:30],
            rich_html=parsed.get("rich_html"),
            tables=parsed.get("tables", []),
        )

        with _jobs_lock:
            job = _jobs.get(job_id)
            if job:
                job.pages.append(page)

        # Recurse into child pages
        if depth < config.max_depth:
            # Breadth cap — at most 10 children per level to prevent explosion
            for child_url in parsed["child_urls"][:10]:
                _crawl(job_id, child_url, depth + 1, url, visited, config)

    except Exception as exc:
        error_page = ScrapedPage(
            url=url,
            depth=depth,
            parent_url=parent_url,
            title=url,
            headings=[],
            paragraphs=[],
            lists=[],
            image_texts=[],
            child_urls=[],
            error=str(exc),
        )
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job:
                job.pages.append(error_page)


def run_scrape_job(job_id: str) -> None:
    """
    Blocking entry-point for a background thread.
    Runs the full crawl and builds HTML / PDF outputs.
    """
    _update_job(job_id, status="running", progress=5)
    try:
        with _jobs_lock:
            job = _jobs.get(job_id)
        if not job:
            return

        visited: set = set()
        _crawl(job_id, job.url, 0, None, visited, job.config)

        # Re-read job after crawl (pages have been appended)
        with _jobs_lock:
            job = _jobs.get(job_id)
        if not job:
            return

        html = build_html_output(job)
        pdf = _try_build_pdf(html)

        _update_job(
            job_id,
            status="completed",
            progress=100,
            html_output=html,
            pdf_bytes=pdf,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

    except Exception as exc:
        _update_job(
            job_id,
            status="failed",
            error=str(exc),
            progress=0,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )


# ── Output generation ──────────────────────────────────────────────────────────

def _esc(text: str) -> str:
    """HTML-escape a string."""
    return _html_module.escape(str(text))


def build_html_output(job: ScrapeJob) -> str:
    """Build a clean, structured HTML document from all scraped pages."""
    pages = sorted(job.pages, key=lambda p: (p.depth, p.url))
    success_count = sum(1 for p in pages if not p.error)

    sections = []
    for page in pages:
        depth_cls = f"ws-depth-{min(page.depth, 5)}"
        h_level = min(2 + page.depth, 6)

        if page.error:
            sections.append(
                f'<section class="ws-page ws-error {depth_cls}">'
                f'<h{h_level} class="ws-page-title">{_esc(page.url)}</h{h_level}>'
                f'<p class="ws-err-msg">&#9888; {_esc(page.error)}</p>'
                f'</section>'
            )
            continue

        parts = [
            f'<section class="ws-page {depth_cls}" data-url="{_esc(page.url)}">'
            f'<h{h_level} class="ws-page-title">{_esc(page.title)}'
            + (f' <span class="ws-badge-pdf">PDF</span>' if page.url.lower().endswith(".pdf") else "")
            + f'</h{h_level}>'
            f'<p class="ws-page-url">'
            f'<a href="{_esc(page.url)}" target="_blank" rel="noopener noreferrer">{_esc(page.url)}</a>'
            f'</p>'
        ]

        # Use rich HTML (preserves bold/italic/tables/etc.) when available
        if page.rich_html:
            parts.append(f'<div class="ws-rich-content">{page.rich_html}</div>')
        else:
            # Fallback: structured plain-text extracts
            for h in page.headings:
                hl = min(h_level + 1, 6)
                parts.append(f'<h{hl} class="ws-h ws-h{h["level"]}">{_esc(h["text"])}</h{hl}>')
            for para in page.paragraphs:
                parts.append(f'<p class="ws-p">{_esc(para)}</p>')
            for lst in page.lists:
                items_html = "".join(f'<li>{_esc(item)}</li>' for item in lst)
                parts.append(f'<ul class="ws-list">{items_html}</ul>')

        # OCR text blocks (auto-collected)
        for img_text in page.image_texts:
            parts.append(
                f'<div class="ws-ocr">'
                f'<span class="ws-ocr-label">Image Text (OCR)</span>'
                f'<pre class="ws-ocr-pre">{_esc(img_text)}</pre>'
                f'</div>'
            )

        parts.append('</section>')
        sections.append("".join(parts))

    sections_html = "\n".join(sections)
    generated_at = job.completed_at or datetime.now(timezone.utc).isoformat()

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>WebScrape: {_esc(job.url)}</title>
<style>
/* ── Base ── */
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Georgia,'Times New Roman',serif;max-width:960px;margin:40px auto;padding:0 24px;color:#1e293b;line-height:1.75;background:#fff}}
h1{{font-size:22px;font-weight:700;border-bottom:2px solid #3b82f6;padding-bottom:10px;color:#1e3a8a;margin-bottom:4px}}
.ws-meta{{font-size:12px;color:#64748b;margin-bottom:36px;font-family:monospace}}
/* ── Page sections ── */
.ws-page{{border-left:3px solid #e2e8f0;padding:14px 0 14px 20px;margin:20px 0}}
.ws-depth-0{{border-left-color:#3b82f6}} .ws-depth-1{{border-left-color:#8b5cf6}}
.ws-depth-2{{border-left-color:#06b6d4}} .ws-depth-3,.ws-depth-4,.ws-depth-5{{border-left-color:#94a3b8}}
.ws-page-title{{font-size:17px;font-weight:700;color:#1e3a8a;margin:0 0 3px}}
.ws-page-url{{font-size:10px;color:#94a3b8;margin:0 0 12px;font-family:monospace}}
.ws-page-url a{{color:inherit;text-decoration:none}}
/* ── Rich content — preserves source formatting ── */
.ws-rich-content{{color:#1e293b;font-size:13.5px;line-height:1.8}}
.ws-rich-content h1,.ws-rich-content h2{{font-size:16px;font-weight:700;color:#1e3a8a;margin:18px 0 6px}}
.ws-rich-content h3,.ws-rich-content h4{{font-size:14px;font-weight:700;color:#334155;margin:14px 0 4px}}
.ws-rich-content h5,.ws-rich-content h6{{font-size:13px;font-weight:600;color:#475569;margin:10px 0 3px}}
.ws-rich-content p{{margin:6px 0}}
.ws-rich-content strong,.ws-rich-content b{{font-weight:700}}
.ws-rich-content em,.ws-rich-content i{{font-style:italic}}
.ws-rich-content u{{text-decoration:underline}}
.ws-rich-content s,.ws-rich-content del,.ws-rich-content strike{{text-decoration:line-through;color:#64748b}}
.ws-rich-content ul,.ws-rich-content ol{{margin:6px 0 6px 24px}}
.ws-rich-content li{{margin:3px 0}}
.ws-rich-content blockquote{{border-left:3px solid #cbd5e1;padding-left:14px;color:#475569;margin:10px 0;font-style:italic}}
.ws-rich-content code{{background:#f1f5f9;padding:1px 5px;border-radius:3px;font-family:monospace;font-size:12px}}
.ws-rich-content pre{{background:#f1f5f9;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px}}
.ws-rich-content a{{color:#3b82f6;text-decoration:underline}}
/* ── Tables ── */
.ws-rich-content table{{border-collapse:collapse;width:100%;margin:12px 0;font-size:12.5px}}
.ws-rich-content th,.ws-rich-content td{{border:1px solid #e2e8f0;padding:6px 10px;text-align:left;vertical-align:top}}
.ws-rich-content thead tr,.ws-rich-content th{{background:#f8fafc;font-weight:700;color:#334155}}
.ws-rich-content tr:nth-child(even){{background:#fafbfc}}
/* ── Plain-text fallback ── */
.ws-h{{color:#334155;margin:12px 0 2px}} .ws-h1{{font-size:15px}} .ws-h2{{font-size:14px}} .ws-h3,.ws-h4,.ws-h5,.ws-h6{{font-size:13px}}
.ws-p{{color:#374151;margin:6px 0;font-size:13.5px}}
.ws-list{{color:#374151;margin:6px 0 6px 22px;font-size:13.5px}} .ws-list li{{margin:2px 0}}
/* ── OCR ── */
.ws-ocr{{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;margin:12px 0}}
.ws-ocr-label{{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-family:monospace}}
.ws-ocr-pre{{white-space:pre-wrap;font-size:12px;margin:6px 0 0;color:#374151}}
/* ── Errors ── */
.ws-error{{border-left-color:#ef4444!important}} .ws-err-msg{{color:#dc2626;font-size:13px}}
.ws-badge-pdf{{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:#fee2e2;color:#dc2626;padding:1px 5px;border-radius:3px;vertical-align:middle;margin-left:6px;font-family:monospace}}
/* ── Print ── */
@media print{{body{{margin:0;padding:16px}} .ws-page{{page-break-inside:avoid}} .ws-rich-content table{{page-break-inside:avoid}}}}
</style>
</head>
<body>
<h1>WebScrape Output</h1>
<div class="ws-meta">
Root URL: {_esc(job.url)} &nbsp;|&nbsp;
Pages scraped: {success_count} of {len(pages)} &nbsp;|&nbsp;
Generated: {generated_at}
</div>
{sections_html}
</body>
</html>"""


def _try_build_pdf(html: str) -> Optional[bytes]:
    """Build a PDF from HTML. Returns bytes, or None if no PDF library is available."""
    # Attempt 1: weasyprint
    try:
        import weasyprint  # type: ignore
        return weasyprint.HTML(string=html).write_pdf()
    except Exception:
        pass

    # Attempt 2: xhtml2pdf (pure Python)
    try:
        import io
        from xhtml2pdf import pisa  # type: ignore
        buf = io.BytesIO()
        status = pisa.CreatePDF(html, dest=buf)
        if not status.err:
            return buf.getvalue()
    except Exception:
        pass

    return None
