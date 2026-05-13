# ── Stage 1: Development (hot reload via volume mount) ────────────────────────
ARG PYTHON_IMAGE=python:3.11-slim-bookworm
FROM ${PYTHON_IMAGE} AS development

WORKDIR /app

# System deps for PDF/image processing libraries (PyMuPDF, lxml, etc.)
# libreoffice provides the `soffice` binary used to convert .doc → .docx
# weasyprint requires pango/cairo for PDF rendering; pycairo needs gcc + dev headers
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libglib2.0-0 \
    libgl1 \
    libreoffice \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libcairo2 \
    libcairo2-dev \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Install Playwright Chromium browser for JS-rendered page scraping
RUN python -m playwright install chromium --with-deps

EXPOSE 8000
# Source code is bind-mounted at runtime; --reload watches for file changes.
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]


# ── Stage 2: Production ────────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS production

WORKDIR /app

# libreoffice provides the `soffice` binary used to convert .doc → .docx
# weasyprint requires pango/cairo for PDF rendering; pycairo needs gcc + dev headers
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libglib2.0-0 \
    libgl1 \
    libreoffice \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libcairo2 \
    libcairo2-dev \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Install Playwright Chromium browser for JS-rendered page scraping
RUN python -m playwright install chromium --with-deps

COPY . .

EXPOSE 8000
# Use multiple workers in production for concurrency
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
