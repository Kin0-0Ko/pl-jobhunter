# Internal Function Contracts

This feature exposes no new external/HTTP interface. These are the **internal function signature contracts** that change, in `apps/backend/src`. Each lists the new signature/behavior and the invariants tests must hold.

## `scheduler/etl.ts`

### `mergeJob(job: Job): Promise<boolean>` — behavior change (C3/H1)

- MERGE gains `WHEN MATCHED THEN UPDATE SET`:
  - `description = CASE WHEN :description IS NOT NULL AND (dst.description IS NULL OR dst.description LIKE '[category:%' ) THEN :description ELSE NVL(:description, dst.description) END`
  - `salary_* = NVL(:salary_*, dst.salary_*)`
  - MUST NOT update `status`, `created_at`, `id`, `title`, `company`, `url`, `source`, `currency`.
- Return value: keep `rowsAffected > 0` semantics; callers rely on "newly inserted" — return must still distinguish insert vs update. **Contract**: add/return an explicit `{ inserted: boolean }` or keep boolean meaning "row was INSERTed (not matched)". Tests assert update path returns `inserted=false` and the row's description/salary changed.

### `mergeRawJob(job: Job): Promise<void>` — unchanged (staging stays insert-only)

### `runEtl(): Promise<void>` — behavior change (C1, C2, M1, M2)

- Scrapers invoked via `Promise.allSettled` (M1): rejected → warn + count 0; fulfilled → push results.
- Resolve scoring profile **once** before the loop (M2); pass into `scoreJob`.
- Per-job order revised (C2): existence/valid-analysis check BEFORE JustJoin detail fetch.
- DB failure handling (C1): per-job `continue` + `consecutiveDbFailures` counter; fatal only past `ETL_DB_FAILURE_ABORT_THRESHOLD`.
- **Invariant**: a single thrown DB error from one `mergeJob` does not prevent later jobs in the same chunk from being processed.

## `ai/ollama.ts`

### `scoreJob(job: Job, profile?: string): Promise<OllamaScoreResult>` — signature change (M2)

- New optional `profile` param. When provided, used as the candidate-profile string; `getProfileFromDb()` is NOT called per job.
- When omitted, falls back to existing env default (back-compat for any direct callers/tests).
- **Invariant**: with `profile` supplied, zero `user_profile` DB reads occur inside `scoreJob`.

### `callOllamaRaw(prompt: string, numPredict: number): Promise<string>` — behavior change (M4)

- Wraps `fetch` in `AbortController`; aborts after `OLLAMA_TIMEOUT_MS` (default 60000).
- On abort → throws (treated as HTTP error by existing retry/fallback).
- **Invariant**: a hung endpoint causes the call to reject within ~`OLLAMA_TIMEOUT_MS`, not hang indefinitely.

### `isNegativeJob(job: Job): boolean` — behavior change (H2)

- Negative keywords matched title-scoped and/or via word-boundary `\b…\b` regex, not space-padded `includes`.
- **Invariants**:
  - `"Senior Go Developer"` (title) → still `true`.
  - description containing `"let's go build great things"` with a relevant TS/Node title → `false`.
  - `"... we sap our resources ..."` in description with relevant title → `false`.

### Pass-1 prompt builder — behavior change (H4)

- Description slice uses `SCORING_DESC_MAX_CHARS` (default 2000), shared with the JustJoin detail cap so they cannot drift.
- **Invariant**: a tech token appearing only between char 800 and 2000 of the description is present in the Pass-1 prompt.

## `scrapers/justjoin.ts`

### `fetchJustJoinDetail(slug: string): Promise<string|null>` — constant alignment (H4)

- Truncation cap references the shared `SCORING_DESC_MAX_CHARS` constant (default 2000) rather than a hardcoded literal divergent from the prompt slice.
- **Invariant**: detail fetch cap === Pass-1 prompt slice cap.

## Config contract (new env vars, all optional)

| Var | Default | Effect |
|-----|---------|--------|
| `ETL_DB_FAILURE_ABORT_THRESHOLD` | 10 | consecutive per-job DB write failures before fatal abort |
| `SCORING_DESC_MAX_CHARS` | 2000 | shared description cap (detail fetch + Pass-1 prompt) |
| `OLLAMA_TIMEOUT_MS` | 60000 | per-call abort bound |

All must be documented in `.env.example`.
