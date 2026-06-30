# Implementation Plan: ETL Audit Fixes & Telegram Boost

**Branch**: `009-etl-audit-telegram-boost` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-etl-audit-telegram-boost/spec.md`

## Summary

Fix 6 production regressions found in the ETL/AI pipeline (bad summaries, empty tech_stack, whitespace why_good, no JSON-repair debug log, salary anomaly display, raw port exposure), replace per-job Telegram spam with a single end-of-run digest, and add tech_stack badges + salary anomaly warning to frontend job cards and modal.

## Technical Context

**Language/Version**: TypeScript 5.x, strict mode, NodeNext ESM

**Primary Dependencies**: Existing — Fastify, Telegraf, oracledb, p-limit, pino, Vite+React+Tailwind. No new packages.

**Storage**: Oracle Autonomous DB — `jobs`, `ai_analysis`, `raw_jobs` tables. No schema changes.

**Testing**: Vitest — `apps/backend/src/ai/ollama.test.ts`, `apps/backend/src/bot/telegram.test.ts`

**Target Platform**: Node.js 20 on Oracle VPS (backend) + Vercel (frontend)

**Project Type**: Multi-package monorepo — backend ETL/bot patch + frontend UI additions

**Performance Goals**: End-of-run digest reduces Telegram messages from N/run → 1/run. No other perf targets.

**Constraints**: No new dependencies. No schema changes. `HOST` env default `0.0.0.0` → `127.0.0.1`.

**Scale/Scope**: ~500–1600 jobs/ETL run, 1 bot user, 1 Telegram admin chat

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Strict TypeScript | ✅ PASS | All changes in existing `.ts` files, strict mode unchanged |
| II. Shared-Types as Source of Truth | ✅ PASS | `tech_stack: string[]` already exists on `JobWithAnalysis` in `packages/shared` — no type changes |
| III. Oracle Thin Mode | ✅ PASS | No DB driver changes |
| IV. API Security | ✅ PASS | Localhost-only bind strengthens security; no auth changes |
| V. One Branch Per Task | ✅ PASS | Single branch `009-etl-audit-telegram-boost` |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/009-etl-audit-telegram-boost/
├── plan.md                      ← this file
├── research.md                  ← Phase 0
├── data-model.md                ← Phase 1
├── contracts/
│   └── telegram-digest.md       ← Phase 1 — message format contract
├── quickstart.md                ← Phase 1
└── tasks.md                     ← Phase 2 (/speckit-tasks)
```

### Source Code (affected files)

```text
apps/backend/src/
├── ai/
│   └── ollama.ts          ← (1) summary quality guard (<20 chars or contains `<` → fallback)
│                              (2) why_good trim → null/empty if whitespace-only
│                              (3) log raw Ollama text on pass2 JSON repair failure
│                              (4) why_good currently hardcoded ' ' at line 364 — fix to real pass2 output
├── scheduler/
│   └── etl.ts             ← (5) remove sendJobAlert() per-job calls (line 265)
│                              (6) add ETLRunSummary accumulator (in-memory module var)
│                              (7) call sendRunDigest() once at run end (line 278)
│                              (8) export isRunning boolean guard
└── bot/
│   └── telegram.ts        ← (9) add sendRunDigest(summary, topJobs) function
│                              (10) replace /status body with last ETLRunSummary lookup
│                              (11) replace /scrape spawn() with in-process runEtl() + follow-up

apps/backend/
└── index.ts               ← (12) HOST default: '0.0.0.0' → '127.0.0.1'

apps/frontend/src/components/
├── JobCard.tsx             ← (13) tech_stack pill badges row (below summary)
│                              (14) salary anomaly badge (⚠ hourly?) when b2b_min < 500 PLN
└── JobDetailModal.tsx      ← (15) salary anomaly badge in header chip row
                                   (tech_stack already renders in modal — no change needed)
```

**Structure Decision**: Monorepo patch — 5 files touched across backend and frontend. No new files, no new packages, no schema changes.

## Complexity Tracking

> No Constitution violations — no entries required.
