# Implementation Plan: Fix Job Filtering & DB Reset

**Branch**: `005-fix-job-filtering-db-reset` | **Date**: 2026-06-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-fix-job-filtering-db-reset/spec.md`

## Summary

AI scores all jobs 95-100 because `buildPrompt()` sends no job content and the `why_good` framing biases the model toward positive scores. Additionally no pre-filter exists, so CNC operators and audit specialists reach Ollama. Fix: add title-only keyword pre-filter, improve prompt strictness, add `raw_jobs` staging table for all scraped data, add `--reset` CLI flag to clear dirty DB, and seed `user_profile` with the actual 17-skill list.

**Research finding**: No list API (JustJoin, NoFluff, RocketJobs) returns job descriptions — detail calls would cost 500+ HTTP requests per ETL run on a 1GB VPS. Pre-filter operates on title only. `description?: string` is added to `Job` type for future use but left unpopulated by current scrapers.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20, ESM (`"type": "module"`)

**Primary Dependencies**: oracledb (Thin Mode), Fastify, node-cron, pino, p-limit

**Storage**: Oracle Autonomous DB — tables: `jobs`, `ai_analysis`, `user_profile` (existing) + `raw_jobs` (new)

**Testing**: Manual SQL verification + TypeScript `--noEmit` check (no unit test framework in this feature scope)

**Target Platform**: Oracle VPS, 1GB RAM

**Performance Goals**: ETL run completes without OOM; Ollama call volume reduced proportionally to pre-filter rejection rate (~70-80% of jobs expected to be filtered out)

**Constraints**: Oracle Thin Mode only (no `initOracleClient`). All SQL must be valid Oracle syntax. `num_predict: 400` max to protect RAM.

**Scale/Scope**: ~450 jobs per ETL run; ~80-100 after pre-filter; all 450 in `raw_jobs`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Strict TypeScript Everywhere | PASS | All changes in `.ts` files with `strict: true` |
| II. Shared-Types as Source of Truth | PASS | `description?: string` added to `packages/shared/src/types.ts` first |
| III. Oracle Thin Mode — No Native Client | PASS | New table DDL uses same pattern as existing `init-db.ts`, no `initOracleClient` call |
| IV. API Security — Token-Header | PASS | No new endpoints; existing auth middleware unchanged |
| V. One Branch Per Task, No Direct Dev Commits | PASS | Implemented on feature branch `005-fix-job-filtering-db-reset` |

**No violations.**

## Project Structure

### Documentation (this feature)

```text
specs/005-fix-job-filtering-db-reset/
├── spec.md
├── plan.md              <- this file
├── research.md          <- Phase 0 output
├── data-model.md        <- Phase 1 output
├── quickstart.md        <- Phase 1 output
├── contracts/
│   └── api-delta.md
├── checklists/
│   └── requirements.md
└── tasks.md             <- Phase 2 output (/speckit-tasks)
```

### Source Code (affected files)

```text
packages/
└── shared/
    └── src/
        └── types.ts                    <- add description?: string to Job

apps/
└── backend/
    └── src/
        ├── config/
        │   └── init-db.ts              <- --reset flag, raw_jobs table, profile seed
        ├── ai/
        │   └── ollama.ts               <- isRelevantJob(), fixed buildPrompt(), num_predict 400
        └── scheduler/
            └── etl.ts                  <- raw_jobs merge step, pre-filter gate
```

Scrapers (`justjoin.ts`, `nofluff.ts`, `rocketjobs.ts`) need **no changes** — `description` field is optional and left undefined until detail endpoints are available.

## Complexity Tracking

No Constitution violations. Table not needed.

---

## Phase 0: Research

**Complete.** See [research.md](research.md).

Key decisions:
- Pre-filter on title only (no description available from list APIs)
- `description?: string` added to type for future use
- `raw_jobs` staging table: all scraped, no FK constraints
- `--reset` preserves `user_profile`, seeds it if empty

---

## Phase 1: Implementation Steps

### Task 1 — Shared Type Update
**File**: `packages/shared/src/types.ts`

Add to `Job` interface:
```ts
description?: string;
```

No other type changes. `JobWithAnalysis` does not need `description` (not in `ai_analysis`).

---

### Task 2 — init-db: raw_jobs table + --reset flag + profile seed
**File**: `apps/backend/src/config/init-db.ts`

**2a. Add `CREATE_RAW_JOBS` DDL constant**:
```sql
CREATE TABLE raw_jobs (
  id VARCHAR2(100) PRIMARY KEY,
  title VARCHAR2(255) NOT NULL,
  company VARCHAR2(255) NOT NULL,
  url VARCHAR2(500) NOT NULL,
  source VARCHAR2(50) NOT NULL,
  description CLOB,
  salary_b2b_min NUMBER,
  salary_b2b_max NUMBER,
  salary_uop_min NUMBER,
  salary_uop_max NUMBER,
  currency VARCHAR2(10) DEFAULT 'PLN',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

**2b. Add `resetSchema()` function**:
- Drop `ai_analysis` (ignore ORA-00942)
- Drop `jobs` (ignore ORA-00942)
- Drop `raw_jobs` (ignore ORA-00942)
- Run CREATE for `jobs`, `raw_jobs`, `ai_analysis`
- Call `seedProfile(conn)`

**2c. Add `seedProfile(conn)` function**:
```sql
MERGE INTO user_profile dst
USING (SELECT 1 AS id FROM dual) src
ON (dst.id = src.id)
WHEN NOT MATCHED THEN INSERT (id, skills, preferred_contract, updated_at)
VALUES (1, :skills, 'b2b', SYSTIMESTAMP)
```
`:skills` = `JSON.stringify(["TypeScript","JavaScript","Node.js","NestJS","Express.js","React","Next.js","Redux","PostgreSQL","MongoDB","Redis","RabbitMQ","TypeORM","AWS","Docker","GitHub Actions","CI/CD"])`

**2d. Update `main()`**:
```ts
if (process.argv.includes('--reset')) {
  await resetSchema();
} else {
  // existing create-if-not-exists flow, extended to include raw_jobs
}
```

Note: Normal (non-reset) flow also creates `raw_jobs` if not exists.

---

### Task 3 — ollama.ts: isRelevantJob + fixed buildPrompt + num_predict
**File**: `apps/backend/src/ai/ollama.ts`

**3a. Add and export `isRelevantJob(job: Job): boolean`**:
```ts
const PROFILE_KEYWORDS = [
  'typescript', 'javascript', 'node.js', 'nodejs', 'nestjs', 'nest',
  'express', 'react', 'next.js', 'nextjs', 'redux',
  'postgresql', 'postgres', 'mongodb', 'mongo', 'redis',
  'rabbitmq', 'typeorm', 'aws', 'docker',
  'github actions', 'ci/cd', 'cicd',
  'fullstack', 'full-stack', 'full stack',
  'backend', 'frontend', 'devops',
  'software engineer', 'software developer', 'web developer', 'developer',
];

export function isRelevantJob(job: Job): boolean {
  if (PROFILE_KEYWORDS.length === 0) {
    logger.warn('isRelevantJob: keyword list empty, passing all jobs');
    return true;
  }
  const haystack = [job.title, job.description ?? ''].join(' ').toLowerCase();
  return PROFILE_KEYWORDS.some(kw => haystack.includes(kw));
}
```

**3b. Replace `buildPrompt()`** with strict version:
```ts
function buildPrompt(job: Job, userProfile: string): string {
  const descSection = job.description
    ? `\n\nJob description:\n${job.description.slice(0, 1500)}`
    : '';

  return `You are a strict job-match scorer. Score based ONLY on actual skill overlap.

Scoring rules:
- match_score: 0-100 (0 = zero overlap, 100 = perfect match)
- Score below 30 if core skills do not match
- If job title suggests a non-developer role (production worker, CNC, auditor, product manager, accountant), return match_score: 0
- Do NOT invent technologies not mentioned in the job

Return JSON with these exact fields:
- match_score: integer 0-100
- summary: one sentence describing the actual role
- tech_stack: array of technology strings explicitly mentioned (empty array if none)
- why_good: one sentence on actual skill overlap, or explain mismatch if score < 50

User profile: ${userProfile}

Job: ${job.title} at ${job.company}${descSection}

Respond ONLY with valid JSON. No markdown, no <think> tags.`;
}
```

**3c. Change `num_predict: 200` to `num_predict: 400`** in `callOllama()`.

---

### Task 4 — etl.ts: raw_jobs merge step + pre-filter gate
**File**: `apps/backend/src/scheduler/etl.ts`

**4a. Add `mergeRawJob(job: Job): Promise<void>`**:
- Same MERGE pattern as `mergeJob()` but targets `raw_jobs`
- Includes `description` binding (nullable)
- No return value (not tracking whether new or existing)
- Errors caught at call site, logged as warning, job skipped

**4b. Import `isRelevantJob`** from `'../ai/ollama.js'`

**4c. Update `runEtl()` main loop**:
```
for each job:
  1. try mergeRawJob(job) — on error: log warn, continue
  2. if !isRelevantJob(job): log debug, continue
  3. try mergeJob(job) — existing error handling
  4. if !wasInserted: continue
  5. inserted++
  6. scoreJob() + persistAnalysis() — existing logic unchanged
```

**4d. Add `rawInserted` counter** to final log:
```ts
logger.info({ etl_run_id, rawInserted: jobs.length, inserted, scored }, '[ETL] Run complete');
```

---

## Verification

See [quickstart.md](quickstart.md) for full step-by-step SQL validation.

Key checks:
1. `init-db --reset` → all 3 tables empty, `user_profile` row has 17 skills
2. ETL run → `COUNT(raw_jobs)` >> `COUNT(jobs)`
3. CNC/audit/production titles absent from `jobs`
4. `ai_analysis` score distribution: varied (not all 95-100)
5. `tsc --noEmit` passes in `packages/shared` and `apps/backend`
