# ── Stage 1: Development (hot reload via volume mount) ────────────────────────
FROM node:20-alpine AS development

WORKDIR /app

COPY package*.json ./
RUN npm install

EXPOSE 3000
# Source code is bind-mounted at runtime; node_modules stay in the image layer.
CMD ["npm", "run", "dev"]


# ── Stage 2: Builder ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build the optimised Next.js output (standalone mode must be enabled in next.config.ts)
RUN npm run build


# ── Stage 3: Production (minimal image) ───────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Standalone output bundles everything the server needs; no extra npm install required.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
# next build --output=standalone generates a self-contained server.js
CMD ["node", "server.js"]
