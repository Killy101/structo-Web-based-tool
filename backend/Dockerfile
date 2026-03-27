# ── Stage 1: Development (hot reload via volume mount) ────────────────────────
FROM node:20-alpine AS development

WORKDIR /app

# Native build tools needed by packages like bcrypt
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

EXPOSE 4000
# Source code is bind-mounted at runtime.
# nodemon (configured by nodemon.json) watches src/ and restarts on changes.
CMD ["npm", "run", "dev"]


# ── Stage 2: Builder ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build


# ── Stage 3: Production (minimal image) ───────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache python3 make g++

COPY package*.json ./
# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled JS output
COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["npm", "run", "start"]
