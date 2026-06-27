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
- Backend: `fastify@5`, `@fastify/cors`, `telegraf@4`, `node-cron@3`, `oracledb@6`
- Frontend: `vite@6`, `react@19`, `tailwindcss@4`, `@dnd-kit/core`, `@dnd-kit/sortable`
- Shared: `packages/shared` — `Job`, `AIAnalysis`, `JobStatus` (source of truth)

**Storage**: Oracle Autonomous DB — tables `jobs` + `ai_analysis` already created via
`apps/backend/src/config/init-db.ts`. Wallet auth via `TNS_ADMIN=./wallet`.

**Testing**: Manual integration validation via `quickstart.md`; no automated test suite in v1.

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
│   │   │   └── auth.ts       # X-API-TOKEN preHandler
│   │   ├── scrapers/
│   │   │   ├── justjoin.ts   # JustJoin.it fetcher + normalizer
│   │   │   └── nofluff.ts    # NoFluffJobs fetcher + normalizer
│   │   ├── ai/
│   │   │   └── ollama.ts     # Ollama JSON-mode scorer
│   │   ├── bot/
│   │   │   └── telegram.ts   # Telegraf alert dispatcher
│   │   ├── routes/
│   │   │   └── jobs.ts       # GET /api/jobs, PATCH /api/jobs/:id
│   │   ├── scheduler/
│   │   │   └── etl.ts        # node-cron 6h cycle
│   │   └── index.ts          # Fastify server entrypoint
│   ├── wallet/               # Oracle wallet files (gitignored)
│   └── .env.example
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
| 2 — Container + Auth | INFRA-103 | Docker + Caddy; Fastify entrypoint + auth hook | INFRA-102 |
| 3 — Scrapers | BE-201, BE-202 | JustJoin.it + NoFluffJobs ETL | INFRA-102 |
| 4 — AI + Bot + API | BE-203, BE-204, BE-205 | Ollama scorer + cron + routes + Telegram | BE-201, BE-202 |
| 5 — Frontend | FE-301, FE-302, FE-303 | React Kanban + drag-drop + tax calc | BE-204 |
