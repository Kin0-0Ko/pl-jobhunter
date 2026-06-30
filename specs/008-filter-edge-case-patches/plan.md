# Implementation Plan: Filter Edge-Case Patches

**Branch**: `008-filter-edge-case-patches` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-filter-edge-case-patches/spec.md`

## Summary

Patch 5 production-identified gaps in the ETL pre-filter and AI scoring pipeline:
1. Guard against Ollama being called for jobs with empty/stub descriptions (`etl.ts`)
2. Replace primitive string-includes for java/python with word-boundary regex (`ollama.ts`)
3. Propagate NoFluffJobs native category into description stub — mirrors JustJoin (`nofluff.ts`)
4. Add Polish seniority keywords (Starszy/Lider/Ekspert) to title rejection (`ollama.ts`)
5. Exempt frontend-keyword titles from the infrastructure-role blocklist (`ollama.ts`)

All changes are surgical — 3 files, no schema changes, no new packages.

## Technical Context

**Language/Version**: TypeScript 5.x, strict mode, NodeNext ESM

**Primary Dependencies**: Existing — oracledb, pino, p-limit, node-cron. No new deps.

**Storage**: Oracle Autonomous DB — `jobs`, `ai_analysis`, `raw_jobs` tables (schema unchanged)

**Testing**: Vitest unit tests in `apps/backend/src/ai/ollama.test.ts`

**Target Platform**: Node.js 20 on Oracle VPS

**Project Type**: Backend ETL patch — no frontend changes

**Performance Goals**: Empty-description guard reduces Ollama calls (net improvement). No other perf impact.

**Constraints**: No new dependencies. All changes backward-compatible with existing DB rows.

**Scale/Scope**: ~500 jobs/ETL run across 4 scrapers

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Strict TypeScript | ✅ PASS | All patches in existing `.ts` files, strict mode unchanged |
| II. Shared-Types as Source of Truth | ✅ PASS | No type changes — `Job` interface unchanged |
| III. Oracle Thin Mode | ✅ PASS | No DB schema changes, no driver changes |
| IV. API Security | ✅ PASS | No HTTP route changes |
| V. One Branch Per Task | ✅ PASS | Single branch `008-filter-edge-case-patches` |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/008-filter-edge-case-patches/
├── plan.md              ← this file
├── research.md          ← Phase 0 (decisions pre-resolved from production audit)
├── quickstart.md        ← Phase 1 validation guide
└── tasks.md             ← Phase 2 output (/speckit-tasks)
```

### Source Code (affected files)

```text
apps/backend/src/
├── ai/
│   ├── ollama.ts          ← Patches: word-boundary regex, Polish seniority, frontend override
│   └── ollama.test.ts     ← New/updated unit tests for patched functions
├── scheduler/
│   └── etl.ts             ← Patch: empty-description guard before scoreJob()
└── scrapers/
    └── nofluff.ts         ← Patch: extract category field → description stub
```

**Structure Decision**: Monorepo backend patch — no new files or directories needed in `src/`.

## Complexity Tracking

> No Constitution violations — no entries required.
