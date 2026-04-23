# Structo – Claude Code Guide

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16, React 18, TypeScript, Tailwind CSS |
| Backend | Node.js, Express, PostgreSQL, Prisma ORM, JWT |
| Processing | Python FastAPI, PDF/DOCX/MHTML extraction |
| Infra | Docker Compose (3 services), GitHub Actions CI/CD |

No LLM/Claude API integration – document processing uses custom extraction logic.

## Project Structure

```
/
├── frontend/          # Next.js app
│   └── src/
│       ├── app/dashboard/   # Page routes
│       ├── components/      # Shared UI components
│       │   ├── layout/      # Sidebar, Unauthorized, WelcomeSplash
│       │   └── ui/          # Reusable UI primitives
│       ├── context/         # AuthContext, ThemeContext
│       ├── hooks/           # Custom React hooks
│       ├── services/api.ts  # All backend API calls
│       ├── types/           # Shared TypeScript types
│       └── utils/
├── backend/           # Express API
│   ├── src/routes/    # REST route handlers
│   ├── src/middleware/ # Auth, rate-limit
│   └── prisma/        # DB schema & migrations
├── processing/        # Python FastAPI microservice
│   └── src/
│       ├── routers/   # /process, /compare endpoints
│       └── services/  # Extraction, diff, PDF/DOCX/MHTML parsing
└── schema.sql         # PostgreSQL schema
```

## Common Commands

```bash
# Dev (all services)
./dev.sh

# Frontend only
cd frontend && npm run dev

# Backend only
cd backend && npm run dev

# Processing only
cd processing && uvicorn main:app --reload

# Run all tests
cd frontend && npm test
cd backend && npm test

# Type-check frontend
cd frontend && npx tsc --noEmit

# Lint frontend
cd frontend && npm run lint
```

## Key Files

- `frontend/src/services/api.ts` – all API client methods (authApi, settingsApi, userLogsApi, etc.)
- `frontend/src/app/dashboard/layout.tsx` – dashboard shell: auth guard, sidebar, maintenance banner
- `frontend/src/context/AuthContext.tsx` – auth state, user object, token management
- `backend/src/routes/` – Express route handlers per feature
- `processing/src/services/` – BRD extraction and diff algorithms

## Auth & Roles

Roles: `SUPER_ADMIN > ADMIN > USER`. Route access is enforced in `dashboard/layout.tsx` via `RESTRICTED_ROUTES` and `hasFeature()`. Feature flags come from `user.effectiveFeatures`.

## Database

PostgreSQL via Prisma. Schema at `backend/prisma/schema.prisma`. Also a legacy `schema.sql`. Supabase MCP configured in `backend/mcp.json`.

## Docker

Three services: `frontend` (port 3000), `backend` (port 4000), `processing` (port 8000). See `docker-compose.yml`.
