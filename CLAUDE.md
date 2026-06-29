# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # install all workspace deps
pnpm spec:check       # runs `specify check` — validate spec compliance (run after every task)
```

No packages exist yet — commands above work once workspace packages are created.

## Spec-Driven Development (SDD) — Mandatory

This project uses `.spec-kit/` to enforce SDD. **Never skip this workflow:**

1. Read the relevant spec in `.spec-kit/specs/` before writing any code.
2. Before starting a task from `.spec-kit/tasks/02_tasks.md`, change its `Status: PENDING` → `Status: IN_PROGRESS`.
3. After implementation, run `pnpm spec:check`.
4. When all Acceptance Criteria are met, mark status `DONE` and record the git commit hash.

## Architecture

pnpm monorepo with two workspace roots:
- `apps/*` — runnable applications
- `packages/*` — shared libraries

**Planned packages (per SP-01):**

| Package | Role |
|---|---|
| `packages/shared` | Shared TypeScript types (`Job`, `AIAnalysis`, `JobStatus`) — source of truth for all data contracts |
| `apps/backend` | Fastify REST API + node-cron ETL scheduler + Telegraf Telegram bot |
| `apps/frontend` | Vite + React + Tailwind, deployed to Vercel |

**Infrastructure:**
- DB: Oracle Autonomous DB (Thin Client, Wallet auth) — two tables: `jobs`, `ai_analysis`
- AI: Ollama at `127.0.0.1:11434`, model `qwen3.5:9b`, JSON mode required
- Reverse proxy: Caddy on Oracle VPS (handles HTTPS + SSL)
- Auth: `X-API-TOKEN` header on every client → backend request

**API surface (SP-01):**
- `GET /api/jobs` — all jobs joined with `ai_analysis`, sorted by `match_score DESC`
- `PATCH /api/jobs/:id` — update `status` field (`NEW | FAVORITE | APPLIED | ARCHIVED`)

## TypeScript Config

Base config at `tsconfig.base.json`: `ES2022`, `NodeNext` modules, strict mode. Each package extends this base.

## Task Status Reference

See `.spec-kit/tasks/02_tasks.md` for full task matrix. Current state: all tasks `PENDING`. Start from `INFRA-101`.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at `specs/005-fix-job-filtering-db-reset/plan.md`.

Previous completed plans:
- `specs/004-scrapers-etl-ui/plan.md`
- `specs/003-security-hardening/plan.md`
- `specs/002-production-readiness/plan.md`
- `specs/001-job-hunter-aggregator/plan.md`
<!-- SPECKIT END -->
