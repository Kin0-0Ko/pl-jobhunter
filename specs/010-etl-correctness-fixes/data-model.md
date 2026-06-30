# Data Model: ETL Correctness & Efficiency Fixes

No schema changes. This documents the entities the feature reads/writes and the **mutable-field update rules** introduced (the only data-layer behavior change).

## Entities (existing — unchanged shape)

### Job (`jobs` table; type `Job` from `@pl-jobhunter/shared`)

| Field | Type | Mutable by ETL? | Update rule (new) |
|-------|------|-----------------|-------------------|
| `id` | string PK | no | match key |
| `title` | string | no | insert-only |
| `company` | string | no | insert-only |
| `url` | string | no | insert-only |
| `source` | string | no | insert-only |
| `description` | string\|null | **yes** | `WHEN MATCHED`: set to incoming if incoming non-null AND (stored is null OR stored matches `[category:%]` stub OR incoming is longer/real). Never overwrite a real description with null. |
| `salary_b2b_min/max`, `salary_uop_min/max` | number\|null | **yes** | `WHEN MATCHED`: `NVL(:incoming, dst.col)` — update when incoming non-null; never clobber a known value with null. |
| `currency` | string | no | insert-only |
| `status` | JobStatus | no | insert-only (operator-owned; ETL must not reset) |
| `created_at` | date | no | insert-only |

### RawJob (`raw_jobs` staging table)

Audit capture of every scraped job. Currently insert-only. **Decision**: keep staging insert-only (it is an append-only audit trail); the UPDATE rules above apply to `jobs` only. (Re-evaluate only if FR-006/007 explicitly require raw history mutation — they do not.)

### JobAnalysis (`ai_analysis` table; type `AIAnalysis`)

Unchanged. MERGE-upsert keyed on `job_id`: `match_score`, `summary`, `tech_stack` (JSON), `why_good`. "Valid analysis" = row exists AND `tech_stack` parses to a non-empty array.

### OperatorMatchingProfile (`user_profile` table, row `id=1`)

Read-only in ETL. Now read **once per run**: `getFilterProfile()` (seniority/experience) and the scoring profile string both resolved at run start; the scoring string is threaded into `scoreJob`.

## State / ordering rules (new)

### Per-job processing order (revised — C2)

```
1. staging insert (raw_jobs)              [isolated: failure → skip job]
2. pre-filter isRelevantJob               [fail → filtered++, next job]
3. existence check (jobs + valid analysis) ← MOVED UP (was after detail+promote)
     ├─ exists AND valid analysis → skip (no detail fetch, no score)   ← SC-002
     └─ new OR missing valid analysis → continue
4. detail enrichment (JustJoin only, stub/empty desc)  ← now only reached for 3-continue jobs
5. promote to jobs (MERGE w/ WHEN MATCHED update)      [isolated: failure → skip + counter]
6. negative blocklist (title-scoped/word-boundary)     [hit → persist score 0, next job]
7. score via Ollama(job, profile) with timeout
8. persist ai_analysis (upsert)
```

### DB-failure counter (C1)

- `consecutiveDbFailures` integer, run-scoped, starts 0.
- On promotion write success → reset to 0.
- On promotion write failure → increment, log, `continue` (skip job).
- If `consecutiveDbFailures > ETL_DB_FAILURE_ABORT_THRESHOLD` (default 10) → `sendCriticalAlert('oracle', err)`, stop run (fatal). Only this path may set a non-zero exit in `--run-once` mode.

## Validation rules

- `description` UPDATE must treat `[category:%]` as a placeholder eligible for replacement.
- Salary UPDATE must use null-coalescing so partial re-posts never erase known values (spec Assumption).
- `status` is operator-owned and MUST remain insert-only in the ETL write path (no regression of FAVORITE/APPLIED/ARCHIVED).
