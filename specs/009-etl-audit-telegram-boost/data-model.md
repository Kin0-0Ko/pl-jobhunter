# Data Model: ETL Audit Fixes & Telegram Boost

**Feature**: 009-etl-audit-telegram-boost | **Date**: 2026-06-30

No schema changes. All entities map to existing DB tables.

---

## ETLRunSummary (in-memory only — no DB table)

Module-level variable in `apps/backend/src/scheduler/etl.ts`. Reset on each run start, populated at run end.

| Field | Type | Description |
|-------|------|-------------|
| `completedAt` | `Date` | When `runEtl()` finished |
| `rawTotal` | `number` | Total jobs fetched from all scrapers |
| `filtered` | `number` | Jobs blocked by pre-filter (not promoted to `jobs` table) |
| `inserted` | `number` | Net new rows in `jobs` table this run |
| `scored` | `number` | Jobs that received an `ai_analysis` row (includes score=0 negatives) |
| `fallback` | `number` | Jobs where Ollama failed and fallback analysis was used |
| `topJobs` | `TopJobEntry[]` | Top 5 by `match_score DESC` from jobs inserted this run |

### TopJobEntry

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Job title |
| `company` | `string` | Company name |
| `salaryDisplay` | `string \| null` | Pre-formatted: `"9k–13k PLN (UoP)"` or `null` |
| `score` | `number` | `match_score` from `ai_analysis` |
| `stack` | `string[]` | `tech_stack` array from `ai_analysis` |

---

## AIAnalysis (existing `ai_analysis` table — no schema change)

| Column | Type | Change |
|--------|------|--------|
| `job_id` | VARCHAR2 | No change |
| `match_score` | NUMBER | No change |
| `summary` | VARCHAR2/CLOB | Now validated: no `<`, min 20 chars; fallback = `job.title` + score=10 |
| `tech_stack` | VARCHAR2/CLOB (JSON) | Bug fix: now correctly fetched with `fetchInfo` → parsed as `string[]` |
| `why_good` | VARCHAR2/CLOB | Now stored as `null` or empty — no longer whitespace-only `' '` |

### Validation Rules (enforced in `ollama.ts` before `persistAnalysis`)

- `summary` MUST NOT contain `<`
- `summary.trim().length` MUST be ≥ 20
- Violation → `summary = job.title`, `match_score = 10`
- `why_good` MUST be trimmed; if result is empty string → store `null`

---

## Frontend Display Model (no API change)

`JobWithAnalysis` from `packages/shared` already has `tech_stack: string[]`. The API join already returns it — the bug is in how the Oracle CLOB is fetched (missing `fetchInfo`). After fix, no API contract change.

### Salary Anomaly Rule (frontend-only)

| Condition | Display |
|-----------|---------|
| `salary_b2b_min < 500` AND `currency === 'PLN'` | Show `⚠ hourly?` badge next to B2B salary |
| `salary_uop_min < 500` AND `currency === 'PLN'` | Show `⚠ hourly?` badge next to UoP salary |
| Any salary ≥ 500 | Normal display, no badge |
| Both salaries null | "Salary not specified" (existing behavior) |
