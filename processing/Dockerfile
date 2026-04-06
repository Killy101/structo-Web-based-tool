# ── Stage 1: Development (hot reload via volume mount) ────────────────────────
FROM python:3.11-slim AS development

WORKDIR /app

# System deps for PDF/image processing libraries (PyMuPDF, lxml, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8000
# Source code is bind-mounted at runtime; --reload watches for file changes.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]


# ── Stage 2: Production ────────────────────────────────────────────────────────
FROM python:3.11-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
# Use multiple workers in production for concurrency
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
