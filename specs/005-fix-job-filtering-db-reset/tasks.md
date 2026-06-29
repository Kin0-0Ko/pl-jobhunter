---
description: "Task list for Fix Job Filtering & DB Reset"
---

# Tasks: Fix Job Filtering & DB Reset

**Input**: Design documents from `specs/005-fix-job-filtering-db-reset/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-delta.md

**Tests**: Not requested — manual SQL verification per quickstart.md

**Organization**: 4 implementation tasks across 4 files. All changes are backend-only. No frontend changes.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared type update — must land first as `packages/shared` is the source of truth (Constitution Principle II)

- [ ] T001 Add `description?: string` to `Job` interface in `packages/shared/src/types.ts`

**Checkpoint**: `packages/shared` type updated. `apps/backend` consumers inherit the optional field automatically — no breaking change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DB schema and reset mechanism — must exist before ETL changes can reference `raw_jobs`

- [ ] T002 Add `CREATE_RAW_JOBS` DDL constant, `resetSchema()` function, `seedProfile()` function, and `--reset` CLI flag handling in `apps/backend/src/config/init-db.ts`

Details for T002:
- `CREATE_RAW_JOBS` SQL: mirror of `jobs` columns + `description CLOB`, no FK constraints, no `status` column
- `resetSchema()`: drop `ai_analysis` (ignore ORA-00942) → drop `jobs` (ignore ORA-00942) → drop `raw_jobs` (ignore ORA-00942) → recreate all 3 → call `seedProfile(conn)`
- `seedProfile(conn)`: MERGE into `user_profile` WHEN NOT MATCHED INSERT with 17-skill JSON array and `preferred_contract = 'b2b'`
- Skills to seed: `["TypeScript","JavaScript","Node.js","NestJS","Express.js","React","Next.js","Redux","PostgreSQL","MongoDB","Redis","RabbitMQ","TypeORM","AWS","Docker","GitHub Actions","CI/CD"]`
- Normal (non-reset) `main()` flow: also add `runStatement(conn, CREATE_RAW_JOBS, 'raw_jobs')` so fresh deploys create the table
- `main()`: check `process.argv.includes('--reset')` → branch to `resetSchema()` vs existing create flow

**Checkpoint**: Run `npx tsx apps/backend/src/config/init-db.ts --reset` → all 3 tables empty, user_profile seeded.

---

## Phase 3: User Story 2 — Irrelevant Jobs Blocked Before Scoring (Priority: P1) 🎯 MVP

**Goal**: Add keyword pre-filter and fix Ollama prompt so CNC/audit/non-dev jobs never reach the AI scorer.

**Independent Test**: After ETL run, `SELECT COUNT(*) FROM jobs WHERE LOWER(title) LIKE '%cnc%'` returns 0; score distribution is varied (not all 95-100).

### Implementation

- [ ] T003 [US2] Add `PROFILE_KEYWORDS` constant, export `isRelevantJob(job: Job): boolean`, replace `buildPrompt()` with strict version, change `num_predict` 200→400 in `apps/backend/src/ai/ollama.ts`

Details for T003:
- `PROFILE_KEYWORDS` array (case-insensitive match targets): `['typescript', 'javascript', 'node.js', 'nodejs', 'nestjs', 'nest', 'express', 'react', 'next.js', 'nextjs', 'redux', 'postgresql', 'postgres', 'mongodb', 'mongo', 'redis', 'rabbitmq', 'typeorm', 'aws', 'docker', 'github actions', 'ci/cd', 'cicd', 'fullstack', 'full-stack', 'full stack', 'backend', 'frontend', 'devops', 'software engineer', 'software developer', 'web developer', 'developer']`
- `isRelevantJob`: if keyword list empty → log warn + return true; else join `job.title` + `(job.description ?? '')`, lowercase, check `.some(kw => haystack.includes(kw))`
- New `buildPrompt()` — strict instructions, no positive-bias framing, includes `job.description` (up to 1500 chars) when present, explicit rule to return `match_score: 0` for non-developer roles
- `num_predict: 400` in `callOllama()` body JSON

**Checkpoint**: `isRelevantJob({ title: 'CNC Operator', ... })` returns false; `isRelevantJob({ title: 'Senior TypeScript Developer', ... })` returns true.

---

## Phase 4: User Story 1 — Clean DB & Fresh ETL (Priority: P1)

**Goal**: Wire `raw_jobs` merge into ETL pipeline and gate `jobs` insertion behind `isRelevantJob`.

**Independent Test**: After reset + ETL run, `COUNT(raw_jobs) > COUNT(jobs)`.

### Implementation

- [ ] T004 [US1] Add `mergeRawJob()` function, import `isRelevantJob`, update `runEtl()` loop with raw-merge → pre-filter → promote flow in `apps/backend/src/scheduler/etl.ts`

Details for T004:
- `mergeRawJob(job: Job): Promise<void>`: MERGE INTO `raw_jobs` using same bind pattern as `mergeJob()`, add `description: job.description ?? null` binding, no return value, autoCommit true
- Import: `import { scoreJob, isRelevantJob } from '../ai/ollama.js'`
- Updated loop order per plan.md Phase 1 Task 4c:
  1. `try { await mergeRawJob(job) } catch { log warn; continue }`
  2. `if (!isRelevantJob(job)) { logger.debug(...); continue }`
  3. existing `mergeJob()` + score + alert logic (unchanged)
- Add `rawInserted: jobs.length` to final `[ETL] Run complete` log

**Checkpoint**: Full ETL run completes; `raw_jobs` has all scraped rows; `jobs` has only keyword-matching rows; Telegram alerts only for high-scoring relevant jobs.

---

## Phase 5: User Stories 3 & 4 — Data Preservation & Score Accuracy

**Goal**: US3 (raw data preserved) and US4 (accurate scores) are fully delivered by T002–T004 above — no additional implementation needed. US3 is satisfied by `raw_jobs` table; US4 is satisfied by the fixed `buildPrompt()`.

**Independent Test (US3)**: `SELECT COUNT(*) FROM raw_jobs` >= total scraped count after ETL.
**Independent Test (US4)**: `SELECT MIN(match_score), MAX(match_score) FROM ai_analysis` shows range (not all 95+).

*No tasks — covered by T002, T003, T004.*

---

## Phase 6: Polish & Verification

**Purpose**: TypeScript build validation + quickstart walkthrough

- [ ] T005 [P] Run `npx tsc --noEmit` in `packages/shared` and verify 0 errors
- [ ] T006 [P] Run `npx tsc --noEmit` in `apps/backend` and verify 0 errors
- [ ] T007 Execute full reset + ETL validation sequence from `specs/005-fix-job-filtering-db-reset/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (T001)**: No dependencies — start immediately
- **Phase 2 (T002)**: Depends on T001 (needs `Job` type with `description?`)
- **Phase 3 (T003)**: Can start after T001 — no dependency on T002
- **Phase 4 (T004)**: Depends on T002 (needs `raw_jobs` table) AND T003 (needs `isRelevantJob` export)
- **Phase 6 (T005-T007)**: Depends on T001–T004 complete

### Parallel Opportunities

```
T001 (types.ts)
   ├── T002 (init-db.ts)    ← can run parallel with T003
   └── T003 (ollama.ts)     ← can run parallel with T002
            └── T004 (etl.ts) ← needs T002 + T003 done

T005, T006 ← parallel with each other after all impl done
T007 ← after T005, T006 pass
```

---

## Implementation Strategy

### MVP (Stories 1 + 2 — the critical path)

1. T001 — type update (2 min)
2. T002 — init-db reset/seed (15 min)
3. T003 — ollama filter + prompt (15 min)
4. T004 — etl pipeline wiring (15 min)
5. Run reset: `npx tsx apps/backend/src/config/init-db.ts --reset`
6. Run ETL: `npx tsx apps/backend/src/scheduler/etl.ts --run-once`
7. Validate via quickstart.md SQL queries

---

## Notes

- No scraper changes needed — `description` field is optional on `Job`, scrapers leave it undefined
- `theprotocol.ts` already returns `[]` (Cloudflare blocked) — no changes
- Oracle Thin Mode preserved — all new SQL follows existing `init-db.ts` patterns
- `ORA-00942` (table not found on drop) must be swallowed silently in `resetSchema()`
- `ORA-00955` (table already exists on create) already handled by existing `runStatement()`
