# Research: ETL Correctness & Efficiency Fixes

All Technical Context items were known from the existing codebase audit; no `NEEDS CLARIFICATION` remained. This file records the design decisions per finding.

## C1 — Per-job DB error isolation (FR-001, FR-002, FR-003)

- **Decision**: On a `mergeJob` (promotion) failure, log + `continue` to the next job instead of `sendCriticalAlert` + `process.exitCode = 1` + `return`. Track a per-run consecutive-DB-failure counter; only when it exceeds a threshold (env `ETL_DB_FAILURE_ABORT_THRESHOLD`, default e.g. 10 consecutive) do we treat it as fatal — raise the critical alert and stop. Reset the counter on any success.
- **Rationale**: A transient single-row failure must cost one job, not the batch (SC-001). A sustained outage still needs to alert the operator (FR-003). The consecutive counter distinguishes "blip" from "DB is down".
- **Process-exit**: Do not mutate `process.exitCode` from inside the per-job loop in long-running (cron/server) mode. The `--run-once` entrypoint may still surface a non-zero exit, but only after a *fatal* abort, not a single skipped job.
- **Alternatives rejected**: (a) Retry-with-backoff per write — adds latency and complexity inside `pLimit(1)` window; the pool already retries connections. (b) Transaction batching — larger rollback blast radius, contradicts per-job isolation principle.

## C2 — Dedup before detail fetch (FR-004, FR-005, SC-002)

- **Decision**: Reorder the per-job steps so the "already stored with valid analysis → skip" decision happens before the JustJoin v1 detail fetch. Concretely: do the staging insert, pre-filter, then check existence/valid-analysis; only if the job is new OR missing valid analysis do we (for JustJoin) fetch the detail, then promote + score.
- **Rationale**: The detail fetch is a network round-trip; performing it for already-complete jobs is the dominant waste (SC-002 = 0 detail fetches on re-run). Existence is cheaply known from `jobs` + `ai_analysis`.
- **Subtlety**: `mergeJob` currently returns `wasInserted`. To know "already exists + valid analysis" before promotion, query existence up front (lightweight `checkAnalysisExists` already exists) rather than relying on the insert result. Detail fetch is then gated on that.
- **Alternatives rejected**: Caching detail responses in memory — does not survive process restart and still risks the call on cold runs; ordering fix is simpler and complete.

## C3 / H1 — UPDATE-capable MERGE (FR-006, FR-007, SC-003)

- **Decision**: Add `WHEN MATCHED THEN UPDATE SET` to `mergeJob` (and `mergeRawJob` where appropriate) for mutable fields: `description`, salary columns. Guard against clobbering a known value with null using `COALESCE`/`NVL` semantics — only overwrite when the incoming value is non-null, OR overwrite description when the stored value is still a placeholder stub (`[category:%]`).
- **Rationale**: Enriched descriptions and changed salaries are computed then currently discarded (SC-003). Updating in place avoids duplicate rows.
- **Null-handling default** (per spec Assumptions): `description = NVL(:description, dst.description)`; for the stub case prefer the new real description. Salary: `salary_x = NVL(:incoming, dst.salary_x)` so a missing incoming value never erases a known one.
- **Alternatives rejected**: Delete+reinsert — loses `status`, `created_at`, and any FK rows; unsafe.

## H2 — Precise negative blocklist (FR-008, FR-009, SC-004)

- **Decision**: Match negative keywords against the **title** primarily; where description matching is retained, use word-boundary regex (`\b…\b`) rather than raw `includes` of space-padded substrings like `' go '`. Build a single compiled `RegExp` per keyword set.
- **Rationale**: `' go '`, `'sap '`, `'dba '` produce false positives in free text (SC-004). Genuine blocked-tech jobs name the tech in the title, which still matches.
- **Alternatives rejected**: Dropping description matching entirely — would let some genuinely-blocked jobs through whose title is generic; word-boundary keeps that signal without the false positives.

## H4 — Align scoring description cap (FR-010, SC follows from accuracy)

- **Decision**: Raise the Pass-1 prompt description slice from 800 to match the fetched length (JustJoin detail caps at 2000). Use a shared constant (env-overridable, e.g. `SCORING_DESC_MAX_CHARS`, default 2000) referenced by both the detail fetch cap and the prompt slice so they cannot drift again.
- **Rationale**: The discarded 1200 chars frequently hold the requirements/tech list most relevant to scoring (FR-010).
- **Trade-off**: Larger prompt = more tokens per Pass-1 call on a 1 GB host. `num_predict` (output budget) is unchanged; input grows modestly. Acceptable given `pLimit(1)` already serializes and the model is small. Keep the value env-tunable to back off if latency regresses.

## M2 — Read profile once per run (FR-011, SC-005)

- **Decision**: Resolve the user/matching profile once in `runEtl` (the run already calls `getFilterProfile`). Pass the scoring profile string into `scoreJob(job, profile)` instead of `scoreJob` calling `getProfileFromDb` per job. Keep the env fallback inside `runEtl` when DB read returns null.
- **Rationale**: Hundreds of identical `user_profile` SELECTs per run (SC-005 = exactly one read).
- **Alternatives rejected**: Module-level cache in `ollama.ts` — hidden state, harder to test, and stale across runs; explicit parameter is cleaner and matches existing `getFilterProfile` flow.

## M4 — Ollama call timeout (FR-012, SC-006)

- **Decision**: Wrap `callOllamaRaw`'s `fetch` with an `AbortController` + `setTimeout` (env `OLLAMA_TIMEOUT_MS`, default e.g. 60000). On abort, the existing retry/fallback path treats it as an HTTP error → eventually returns the fallback record.
- **Rationale**: A hung model behind `pLimit(1)` stalls the whole run indefinitely (SC-006). Bounding the wait lets the run proceed with the established fallback.
- **Alternatives rejected**: Killing the Ollama process — out of scope and host-disruptive; client-side abort is sufficient.

## M1 — Parallel scrapers (FR-013, SC-007)

- **Decision**: Replace the sequential `for` over scrapers with `Promise.allSettled` of the four `fn()` calls. Map `fulfilled` → results + count; `rejected` → log warn + count 0 (preserving current "one scraper fails, others continue" behavior).
- **Rationale**: The four fetches are independent I/O (SC-007). Ollama remains the bottleneck but fetch-phase latency drops.
- **Alternatives rejected**: A concurrency pool across scrapers — unnecessary at N=4; `allSettled` is the minimal, correct primitive.

## Cross-cutting

- **No schema change**: All target columns (`description`, salary fields on `jobs`/`raw_jobs`) already exist. FR-015 satisfied without migration.
- **Behavior preservation (FR-014)**: per-job try/catch isolation, fallback record (`match_score === -1`), `raw_jobs` capture, and `ai_analysis` MERGE-upsert all remain; this feature changes *ordering, write scope, match precision, and bounds* only.
- **Config surface added** (all optional, defaulted): `ETL_DB_FAILURE_ABORT_THRESHOLD`, `SCORING_DESC_MAX_CHARS`, `OLLAMA_TIMEOUT_MS`. Document in `.env.example`.
