# Implementation Plan: ETL Correctness & Efficiency Fixes

**Branch**: `010-etl-correctness-fixes` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-etl-correctness-fixes/spec.md`

## Summary

Fix seven defects in the job-scraping ETL surfaced by a code audit. Three are correctness-critical (P1): a single DB write failure no longer aborts the whole batch; the dedup/existing-analysis check moves ahead of the JustJoin detail fetch so already-stored jobs cost no network round-trip; and `MERGE` statements gain `WHEN MATCHED` UPDATE clauses so enriched descriptions and changed salaries actually persist. Two are quality (P2): the negative-keyword blocklist matches title-scoped/word-boundary instead of incidental substrings; and the Pass-1 scoring prompt receives the full fetched description length. Two are efficiency (P3): the operator profile is read once per run instead of per job, the Ollama call gets an `AbortController` timeout, and the four scrapers run via `Promise.allSettled`. All changes are write-path / ordering / bounding edits to existing files — no schema migration, no new tables, no new packages.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, ES2022 / NodeNext (per `tsconfig.base.json`)

**Primary Dependencies**: Fastify, node-cron, Telegraf, `oracledb` (Thin Mode), `pino`, `p-limit`, native `fetch`/`AbortController` (Node ≥ 20)

**Storage**: Oracle Autonomous DB — existing tables `jobs`, `ai_analysis`, `raw_jobs`, `user_profile`. No schema change in this feature.

**Testing**: Vitest (existing `*.test.ts` beside sources — `ollama.test.ts`, `justjoin.test.ts`, `json-repair.test.ts`, `nofluff.test.ts`, route tests)

**Target Platform**: Node.js on Oracle VPS (1 GB RAM Always-Free constraint on the AI host)

**Project Type**: pnpm monorepo — backend workspace (`apps/backend`)

**Performance Goals**: Eliminate redundant per-job detail fetches (target: 0 detail fetches for already-analyzed jobs on a re-run); reduce fetch-phase wall-clock via concurrency; bound any single Ollama call so one hang cannot stall the run.

**Constraints**: Ollama concurrency stays `pLimit(1)` (1 GB RAM); preserve per-job error isolation, fallback record on Ollama failure, `raw_jobs` staging, and `ai_analysis` upsert; backward-compatible with current tables; no `oracledb.initOracleClient()`.

**Scale/Scope**: ~4 sources × up to 5 pages × ~100 offers per run, every 3 hours. ~5 files touched in `apps/backend/src`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|-----------|--------|------|
| I. Strict TypeScript Everywhere | ✅ PASS | All edits in existing `.ts` under `strict`; no `any` introduced. |
| II. Shared-Types as Source of Truth | ✅ PASS | `Job` / `AIAnalysis` consumed from `@pl-jobhunter/shared`; no redefinition. Description & salary already on `Job` — no contract change. |
| III. Oracle Thin Mode | ✅ PASS | No client init; MERGE stays Thin Mode; wallet path unchanged. |
| IV. API Security — Token Header | ✅ PASS | No HTTP surface change; ETL trigger route keeps existing `authHook`. |
| V. One Branch Per Task | ✅ PASS | Work on `010-etl-correctness-fixes`; merged via `--no-ff`. |
| Stack: AI layer JSON-validated | ✅ PASS | Existing `repairAndParse*` JSON validation preserved; timeout only bounds the wait, fallback path unchanged. |
| Stack: "Two tables only" | ✅ PASS (no regression) | `raw_jobs`/`user_profile` predate this feature; this feature adds zero tables and zero schema changes. |

**Result**: PASS. No violations → Complexity Tracking table omitted.

## Project Structure

### Documentation (this feature)

```text
specs/010-etl-correctness-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (internal function contracts)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/backend/src/
├── scheduler/
│   ├── etl.ts            # C1 per-job DB isolation; C2 reorder dedup-before-detail;
│   │                     #   C3/H1 call UPDATE-capable merges; M1 parallel scrapers;
│   │                     #   M2 read profile once, thread into scoreJob
│   └── etl-state.ts      # (unchanged)
├── ai/
│   └── ollama.ts         # H2 title-scoped/word-boundary negatives; H4 raise pass1 cap;
│                         #   M2 scoreJob accepts profile param; M4 AbortController timeout
├── scrapers/
│   └── justjoin.ts       # H4 align detail fetch cap (detail fetch invoked later per C2)
└── routes/
    └── etl.ts            # (unchanged — already routes through runEtl)

apps/backend/src/**/*.test.ts   # extend existing Vitest suites for changed units
```

**Structure Decision**: Single backend workspace; no new source files except tests. Edits localized to `scheduler/etl.ts`, `ai/ollama.ts`, `scrapers/justjoin.ts`, with coverage added to co-located `*.test.ts`. Frontend untouched.

## Complexity Tracking

No constitution violations — table omitted.
