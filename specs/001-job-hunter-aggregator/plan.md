# Implementation Plan: Job Hunter Aggregator

**Branch**: `feat/001-job-hunter-aggregator` | **Date**: 2026-06-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-job-hunter-aggregator/spec.md`

## Summary

Build a fully automated job aggregation and scoring system. ETL pipelines scrape JustJoin.it
and NoFluffJobs every 6 hours, normalize records into the shared `Job` type, and persist them
to Oracle Autonomous DB. Each new job is scored by a local Ollama model (qwen3.5:9b) via a
structured JSON prompt. High-score jobs (≥ 80/100) trigger Telegram alerts. A Vite + React +
Tailwind frontend renders the jobs as a drag-and-drop Kanban board, communicating with a
Fastify REST API protected by `X-API-TOKEN` auth.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 22 LTS — ESM (`"type": "module"`) throughout

**Primary Dependencies**:
- Backend: `fastify@5`, `@fastify/cors`, `@fastify/swagger`, `@fastify/swagger-ui`,
  `telegraf@4`, `node-cron@3`, `oracledb@6`
- Backend (dev): `vitest@2`, `@vitest/coverage-v8`, `msw@2`
- Frontend: `vite@6`, `react@19`, `tailwindcss@4`, `@dnd-kit/core`, `@dnd-kit/sortable`
- Shared: `packages/shared` — `Job`, `AIAnalysis`, `JobStatus` (source of truth)
- CI/CD: GitHub Actions, Docker (multi-stage), docker-compose

**Storage**: Oracle Autonomous DB — tables `jobs` + `ai_analysis` already created via
`apps/backend/src/config/init-db.ts`. Wallet auth via `TNS_ADMIN=./wallet`.

**Testing**: `vitest@2` for backend unit tests — Ollama HTTP calls mocked via `msw@2` so tests
run without local Ollama or Oracle wallet. Test files colocated at `apps/backend/src/**/*.test.ts`.
Manual end-to-end validation via `quickstart.md`.

**Target Platform**: Oracle VPS (Linux x64), Caddy reverse proxy for HTTPS/SSL; frontend on
Vercel (static SPA).

**Project Type**: Full-stack web service + background ETL scheduler

**Performance Goals**: Board load < 3 s; ETL cycle < 10 min; Telegram alert < 60 s after ingest.

**Constraints**: Single-user; no horizontal scaling; Ollama on localhost only; wallet required
for DB; cross-currency conversion out of scope.

**Scale/Scope**: ~100–500 job records per cycle; single admin user; one VPS instance.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Strict TypeScript | All `apps/*` + `packages/*` use strict TS; no JS in `src/` | ✅ PASS |
| II. Shared-Types Source of Truth | `Job`, `AIAnalysis`, `JobStatus` only in `packages/shared` | ✅ PASS |
| III. Oracle Thin Mode | No `initOracleClient()`; wallet via `TNS_ADMIN`; graceful exit on missing wallet | ✅ PASS |
| IV. API Security | `X-API-TOKEN` Fastify preHandler hook; 401 before any handler | ✅ PASS |
| V. One Branch Per Task | `feat/<TASK-ID>` per task; `--no-ff` merge into `dev` | ✅ PASS |

**Result: ALL GATES PASS — no violations.**

## Project Structure

### Documentation (this feature)

```text
specs/001-job-hunter-aggregator/
├── plan.md                    # This file
├── research.md                # Phase 0 output
├── data-model.md              # Phase 1 output
├── architecture-reference.md  # Migrated SP-01 (Oracle schema, types, API contracts)
├── quickstart.md              # Phase 1 output
├── contracts/
│   ├── api.md                 # REST endpoint contracts
│   └── ollama-prompt.md       # Ollama JSON-mode prompt schema
└── checklists/
    └── requirements.md        # Spec quality checklist (complete)
```

### Source Code (repository root)

```text
.github/
└── workflows/
    └── ci.yml                # Install → tsc → vitest → docker build + deploy

packages/
└── shared/
    └── src/
        ├── types.ts          # Job, AIAnalysis, JobStatus  ← DONE (INFRA-101)
        └── index.ts

apps/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.ts   # oracledb pool              ← DONE (INFRA-102)
│   │   │   └── init-db.ts    # schema runner              ← DONE (INFRA-102)
│   │   ├── middleware/
│   │   │   └── auth.ts       # X-API-TOKEN preHandler     ← DONE (T005)
│   │   ├── scrapers/
│   │   │   ├── justjoin.ts   # JustJoin.it fetcher + normalizer
│   │   │   ├── justjoin.test.ts
│   │   │   ├── nofluff.ts    # NoFluffJobs fetcher + normalizer
│   │   │   └── nofluff.test.ts
│   │   ├── ai/
│   │   │   ├── ollama.ts     # Ollama JSON-mode scorer
│   │   │   └── ollama.test.ts  # msw mocks Ollama HTTP
│   │   ├── bot/
│   │   │   └── telegram.ts   # Telegraf alert dispatcher
│   │   ├── routes/
│   │   │   ├── jobs.ts       # GET /api/jobs, PATCH /api/jobs/:id
│   │   │   └── jobs.test.ts
│   │   ├── scheduler/
│   │   │   └── etl.ts        # node-cron 6h cycle
│   │   └── index.ts          # Fastify server entrypoint  ← DONE (T004)
│   ├── wallet/               # Oracle wallet files (gitignored)
│   ├── Dockerfile            # Multi-stage: builder (tsc) + runner (alpine)
│   └── .env.example          ← DONE (T006)
└── frontend/
    └── src/
        ├── api/
        │   └── client.ts     # Typed fetch wrapper (injects X-API-TOKEN)
        ├── components/
        │   ├── KanbanBoard.tsx
        │   ├── KanbanColumn.tsx
        │   ├── JobCard.tsx
        │   └── ErrorState.tsx
        ├── hooks/
        │   └── useJobs.ts    # Fetch + optimistic status mutation
        ├── App.tsx
        └── main.tsx
```

**Structure Decision**: Web app layout under `apps/` — matches monorepo established in INFRA-101.
Backend is ESM Node process; frontend is Vite SPA deployed separately to Vercel.

## Complexity Tracking

> No constitution violations requiring justification.

## Phase Breakdown

| Phase | Task IDs | Description | Blocked By |
|---|---|---|---|
| 1 — Infra (DONE) | INFRA-101, INFRA-102 | Workspace + shared types + DB pool | — |
| 2 — Foundation (DONE) | T003–T006 | Fastify + CORS + auth + .env.example | INFRA-102 |
| 2b — Dev Tooling | T007–T014 | Swagger/UI, vitest + msw setup, Dockerfile, CI workflow | T004 |
| 3 — API Routes | T011–T012 | GET /api/jobs + PATCH /api/jobs/:id + route tests | T007–T010 |
| 4 — Scrapers | T013–T014 | JustJoin.it + NoFluffJobs ETL + unit tests | T011 |
| 5 — AI + Bot + Scheduler | T015–T018 | Ollama scorer (mocked tests) + Telegram + cron | T013–T014 |
| 6 — Frontend | T019–T027 | React Kanban + drag-drop + tax calc | T011 |
| 7 — Polish | T028–T032 | Docker compose, full build, e2e validation | All |

---

## Production Deployment Architecture (GHCR + Pull)

**Decision**: Oracle Always Free Tier VPS (1 OCPU / 1 GB RAM) cannot afford local Docker builds. All image building happens in GitHub Actions CI; the VPS only pulls prebuilt images from GitHub Container Registry (GHCR).

### CI/CD Pipeline (`feat/infrastructure-setup` → `main`)

```
Push to main
  → GitHub Actions ci-cd.yml
      1. pnpm audit --audit-level=high         # security gate
      2. tsc --noEmit (backend + frontend)     # type gate
      3. pnpm test                             # 32 tests
      4. docker buildx build                  # multi-stage, push to ghcr.io
         → ghcr.io/<org>/pl-jobhunter/backend:<sha>
         → ghcr.io/<org>/pl-jobhunter/backend:latest
      5. SSH → VPS
         → docker compose pull backend
         → docker compose up -d backend
```

### VPS `docker-compose.yml` (production)

```yaml
services:
  backend:
    image: ghcr.io/<org>/pl-jobhunter/backend:latest   # pull from GHCR — NO local build
    env_file: ./apps/backend/.env
    volumes:
      - ./apps/backend/wallet:/app/apps/backend/wallet:ro
    ports:
      - "3000:3000"
    restart: unless-stopped

  ollama:
    image: ollama/ollama:0.6.10
    volumes:
      - ollama_models:/root/.ollama
    ports:
      - "11434:11434"
    restart: unless-stopped

volumes:
  ollama_models:
```

### Frontend Environment Variables (Vercel)

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | `https://<vps-domain>` |
| `VITE_API_TOKEN` | Same token as `API_TOKEN` in backend `.env` |

**Standard**: `VITE_API_BASE_URL` is the canonical env var name. `apps/frontend/src/api/client.ts` reads `import.meta.env['VITE_API_BASE_URL']`. No other naming variant is accepted.

### Rationale

- **GHCR + Pull**: Zero build memory on VPS. Free tier has 1 GB RAM — `tsc` + `pnpm install` alone would OOM the machine.
- **`latest` tag on VPS**: VPS always pulls the last CI-built image. SHA tags exist in GHCR for rollback.
- **Ollama stays on VPS**: Inference must run locally; it is not containerized via GHCR.
