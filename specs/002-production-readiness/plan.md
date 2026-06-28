# Implementation Plan: Production Readiness

**Branch**: `feat/002-production-readiness` | **Date**: 2026-06-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-production-readiness/spec.md`

## Summary

Three cross-cutting enhancements that make the job aggregator production-grade:

1. **Dynamic AI Profile Management** — Replace the hardcoded `OLLAMA_USER_PROFILE` env var with a persistent `user_profile` OracleDB table. Add `GET /api/profile` + `PUT /api/profile` Fastify endpoints and a React settings form. The Ollama scorer reads the DB profile at ETL time; env var is fallback only.

2. **Filtering, Search & Market Analytics** — Pure client-side filter bar (keyword, contract type, salary range, source) over the already-fetched `JobWithAnalysis[]` array. Top-5 demanded skills analytics widget aggregated from jobs where `match_score >= 80`. No server changes required.

3. **ETL Monitoring & Failure Alerts** — Integrate pino structured logging. Wrap the ETL orchestrator in a global error catch. On fatal errors (scraper 5xx, DB drop, Ollama OOM) dispatch a Telegram `🚨 CRITICAL` markdown alert; Ollama failures remain warnings only. Telegram failures are caught and logged — never crash ETL.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 22 LTS — ESM (`"type": "module"`) throughout

**Primary Dependencies (additions to existing stack)**:
- Backend: `pino-pretty` (devDep only) — Fastify already uses pino internally; reconfigure via `logger: { level, transport }` option object, not a second logger instance
- No new backend deps for profile endpoints (existing Fastify + oracledb stack sufficient)
- No new frontend deps for filtering (pure React state + derived computation)

**Storage**: Oracle Autonomous DB — adds `user_profile` table (single-row, upsert on PUT). Existing `jobs` + `ai_analysis` tables unchanged.

**Testing**: vitest@2 + msw@2 for profile route tests and ETL alert tests. Filter logic tested via vitest unit tests over mock `JobWithAnalysis[]` arrays.

**Target Platform**: Same — Oracle VPS + Caddy + Vercel frontend.

**Project Type**: Incremental enhancement to existing full-stack web service + ETL scheduler.

**Performance Goals**: Filter response < 100ms client-side over ≤500 jobs; profile read/write < 200ms DB round-trip; Telegram critical alert dispatched within 30s of fatal error.

**Constraints**: Single-user profile (one DB row); all filtering client-side only; pino must integrate with Fastify's existing `logger: true` config (not a parallel logger); Ollama errors remain non-fatal; Telegram dispatch failures must not propagate.

**Scale/Scope**: ~100–500 jobs in memory for filtering. Profile table: 1 row. Analytics aggregation: O(n) over in-memory array.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Strict TypeScript | All new files (`profile.ts`, filter hooks, analytics/profile components) in strict TS; `UserProfile` type added to `packages/shared` | ✅ PASS |
| II. Shared-Types Source of Truth | `UserProfile` type defined exclusively in `packages/shared/src/types.ts`; both backend routes and frontend form import from there | ✅ PASS |
| III. Oracle Thin Mode | `user_profile` table accessed via existing `getPool()` — same Thin Mode pool; no `initOracleClient()` introduced | ✅ PASS |
| IV. API Security | `GET /api/profile` and `PUT /api/profile` protected by existing `authHook` preHandler; 401 before any handler logic | ✅ PASS |
| V. One Branch Per Task | All new tasks on `feat/<TASK-ID>` branches, `--no-ff` merge to `dev` | ✅ PASS |

**Result: ALL GATES PASS — no violations.**

## Project Structure

### Documentation (this feature)

```text
specs/002-production-readiness/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output — user_profile schema + filter state design
├── quickstart.md        # Phase 1 output — validation scenarios
├── contracts/
│   ├── profile-api.md   # GET/PUT /api/profile REST contract
│   └── filter-state.md  # Client-side FilterState shape contract
├── tasks.md             # Phase 2 output (/speckit-tasks)
└── checklists/
    └── requirements.md  # Spec quality checklist (complete)
```

### Source Code (additions to existing monorepo)

```text
packages/
└── shared/
    └── src/
        └── types.ts                # + UserProfile type

apps/
├── backend/
│   └── src/
│       ├── config/
│       │   └── init-db.ts          # + CREATE TABLE user_profile DDL
│       ├── routes/
│       │   ├── profile.ts          # GET /api/profile + PUT /api/profile  [NEW]
│       │   └── profile.test.ts     # vitest + vi.mock DB pool              [NEW]
│       ├── ai/
│       │   └── ollama.ts           # modified: query DB for profile, env fallback
│       ├── scheduler/
│       │   └── etl.ts              # modified: global error catch + critical Telegram alerts
│       └── index.ts                # modified: register profileRoutes; pino logger config
└── frontend/
    └── src/
        ├── components/
        │   ├── FilterBar.tsx        # keyword + contract type + salary + source  [NEW]
        │   ├── AnalyticsWidget.tsx  # top 5 demanded skills from high-match jobs [NEW]
        │   └── ProfileForm.tsx      # settings page: GET/PUT /api/profile        [NEW]
        ├── hooks/
        │   ├── useFilter.ts         # derived filtered JobWithAnalysis[] array    [NEW]
        │   └── useProfile.ts        # fetch + update UserProfile                  [NEW]
        └── App.tsx                  # modified: FilterBar above board, profile tab
```

**Structure Decision**: Web app layout under `apps/` — extends existing monorepo. All new code follows established patterns: Fastify plugin for routes, vi.mock for DB in tests, React hook + component pairs for frontend features.

## Complexity Tracking

> No constitution violations requiring justification.

## Phase Breakdown

| Phase | Task IDs | Description | Blocked By |
|---|---|---|---|
| 8 — Profile DB + API | T058–T063 | UserProfile shared type, user_profile DDL, GET/PUT routes + tests, ollama.ts DB read | Phases 1–7 |
| 9 — Filtering & Analytics | T064–T069 | FilterBar component, useFilter hook, AnalyticsWidget, ProfileForm, useProfile hook, App.tsx wiring | Phase 8 (for profile tab) |
| 10 — ETL Monitoring | T070–T075 | pino logger config, ETL global catch, critical Telegram alerts, alert dispatch tests | Phases 1–7 |
