# ── Stage 1: Development (hot reload via volume mount) ────────────────────────
ARG PYTHON_IMAGE=python:3.11.12-slim-bookworm
FROM ${PYTHON_IMAGE} AS development

WORKDIR /app

# System deps for PDF/image processing libraries (PyMuPDF, lxml, etc.)
# libreoffice provides the `soffice` binary used to convert .doc → .docx
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8000
# Source code is bind-mounted at runtime; --reload watches for file changes.
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]


# ── Stage 2: Production ────────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS production

WORKDIR /app

# libreoffice provides the `soffice` binary used to convert .doc → .docx
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
# Use multiple workers in production for concurrency
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
