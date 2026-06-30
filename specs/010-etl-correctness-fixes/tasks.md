---
description: "Task list for ETL Correctness & Efficiency Fixes"
---

# Tasks: ETL Correctness & Efficiency Fixes

**Input**: Design documents from `/specs/010-etl-correctness-fixes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-functions.md, quickstart.md

**Tests**: INCLUDED. The spec defines an Independent Test per story and a unit-test gate in quickstart.md; test tasks are generated accordingly (Vitest, co-located `*.test.ts`).

**Organization**: Grouped by user story (US1–US6) in priority order. ⚠️ Most stories edit the SAME files (`scheduler/etl.ts`, `ai/ollama.ts`), so cross-story work is sequential, not parallel, even though each story is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6 maps to the spec's user stories
- File paths are relative to repo root

## ⚠️ Shared-file warning

`scheduler/etl.ts` is touched by US1, US2, US3, US6. `ai/ollama.ts` is touched by US2, US4, US5, US6. Tasks editing the same file across stories are **not** `[P]` relative to each other; complete them in phase order. `[P]` is used only for test files and the two distinct source files when genuinely independent within a phase.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch + config surface + shared constants the stories rely on

- [x] T001 Confirm work is on branch `010-etl-correctness-fixes` and `pnpm --filter @pl-jobhunter/backend test` runs green as a baseline
- [x] T002 Add new optional env vars with defaults to `apps/backend/.env.example`: `ETL_DB_FAILURE_ABORT_THRESHOLD=10`, `SCORING_DESC_MAX_CHARS=2000`, `OLLAMA_TIMEOUT_MS=60000` (document each in a comment)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared `SCORING_DESC_MAX_CHARS` constant must exist before US5/H4 can align both call sites; reading it from env in one place prevents drift.

**⚠️ CRITICAL**: Complete before US5 (and referenced by US2 detail fetch).

- [x] T003 Introduce a single source-of-truth constant `SCORING_DESC_MAX_CHARS` (env-overridable, default 2000) in `apps/backend/src/ai/ollama.ts` (exported) so both the Pass-1 prompt slice and the JustJoin detail cap can import it

**Checkpoint**: Shared constant available — user stories can proceed.

---

## Phase 3: User Story 1 - Single DB hiccup must not wipe the run (Priority: P1) 🎯 MVP

**Goal**: One failing per-job DB write skips only that job; sustained failures still alert; scheduled service is not left in a failed state. (C1 / FR-001,002,003 / SC-001)

**Independent Test**: Force one job's promotion write to fail mid-batch; assert remaining jobs still process, the failed job is logged/skipped, and no global failure flag is set in scheduled mode.

### Tests for User Story 1

- [x] T004 [P] [US1] Add Vitest cases in `apps/backend/src/scheduler/etl.test.ts` (create if absent): (a) one `mergeJob` rejection → remaining jobs still scored; (b) failures below threshold do NOT trigger `sendCriticalAlert`; (c) consecutive failures exceeding `ETL_DB_FAILURE_ABORT_THRESHOLD` DO trigger the alert and stop. Mock DB + scrapers.

### Implementation for User Story 1

- [x] T005 [US1] In `apps/backend/src/scheduler/etl.ts` `runEtl`: replace the `mergeJob` catch block that does `sendCriticalAlert` + `process.exitCode=1` + `return` with per-job log + `continue`; add a run-scoped `consecutiveDbFailures` counter (reset on any successful write)
- [x] T006 [US1] In `apps/backend/src/scheduler/etl.ts`: when `consecutiveDbFailures > ETL_DB_FAILURE_ABORT_THRESHOLD` (env, default 10), raise `sendCriticalAlert('oracle', err)` and stop the run as fatal; ensure the non-zero `process.exitCode` is set ONLY on this fatal path and ONLY meaningful for the `--run-once` entrypoint (not the cron/server path)
- [x] T007 [US1] Verify the existing `finally { setRunning(false) }` still runs on the fatal path so the service is not left marked running

**Checkpoint**: US1 independently testable — batch survives isolated DB faults.

---

## Phase 4: User Story 2 - Stop re-fetching details for jobs we already have (Priority: P1)

**Goal**: Existence/valid-analysis check runs BEFORE the JustJoin detail fetch; already-complete jobs cost no detail round-trip. (C2 / FR-004,005 / SC-002)

**Independent Test**: Run twice over unchanged data; assert zero detail fetches on the second run for jobs already stored with valid analysis.

### Tests for User Story 2

- [x] T008 [P] [US2] Add Vitest cases in `apps/backend/src/scheduler/etl.test.ts`: a job already present with valid analysis → `fetchJustJoinDetail` is NOT called; a new/missing-analysis job → it IS called. Spy on the detail fetch.

### Implementation for User Story 2

- [x] T009 [US2] In `apps/backend/src/scheduler/etl.ts` `runEtl` per-job loop: move the existing-job + `checkAnalysisExists` gate to run BEFORE the JustJoin detail-enrichment block; skip already-complete jobs (no detail fetch, no score) at that point
- [x] T010 [US2] Ensure the detail-enrichment block (and subsequent promote/score) is reached only for jobs that are new OR missing a valid analysis; preserve the existing re-score-on-empty-tech_stack behavior

**Checkpoint**: US2 independently testable — SC-002 holds (0 redundant fetches).

---

## Phase 5: User Story 3 - Enriched/updated data must persist (Priority: P1)

**Goal**: `MERGE` updates mutable fields (description stub→real, salary via NVL) without duplicate rows and without touching operator-owned `status`/`created_at`. (C3/H1 / FR-006,007 / SC-003)

**Independent Test**: Store a stub-description job, run when real description available; assert row updated in place, no duplicate, `status`/`created_at` intact.

### Tests for User Story 3

- [x] T011 [P] [US3] Add Vitest cases for `mergeJob` matched-path behavior in `apps/backend/src/scheduler/etl.test.ts`: stub `[category:*]` description replaced by real; salary NVL (incoming null never clobbers known); `status`/`created_at` untouched; return value still distinguishes insert vs update

### Implementation for User Story 3

- [x] T012 [US3] In `apps/backend/src/scheduler/etl.ts` `mergeJob`: add `WHEN MATCHED THEN UPDATE SET` for `description` (replace when stored is null or `LIKE '[category:%'`, else `NVL(:description, dst.description)`) and salary columns (`NVL(:incoming, dst.col)`); do NOT update `status`, `created_at`, `id`, `title`, `company`, `url`, `source`, `currency`
- [x] T013 [US3] Preserve/clarify `mergeJob` return semantics so callers still detect "newly inserted" vs "updated existing" (e.g. boolean = was-inserted); update the call site in `runEtl` accordingly
- [x] T014 [US3] Confirm `mergeRawJob` stays insert-only (staging is append-only audit) per data-model.md — add a brief code comment to prevent future drift

**Checkpoint**: US1+US2+US3 (all P1) deliver the correctness MVP.

---

## Phase 6: User Story 4 - Stop wrongly rejecting good jobs (Priority: P2)

**Goal**: Negative blocklist matches title-scoped/word-boundary, not incidental substrings. (H2 / FR-008,009 / SC-004)

**Independent Test**: Incidental substrings in description don't auto-zero; genuine blocked-tech titles still auto-zero.

### Tests for User Story 4

- [x] T015 [P] [US4] Add/extend Vitest cases in `apps/backend/src/ai/ollama.test.ts` for `isNegativeJob`: `"Senior Go Developer"` title → true; relevant Node title + `"let's go build"` desc → false; `"we sap resources"` desc + relevant title → false; `"Java Developer"` title → true

### Implementation for User Story 4

- [x] T016 [US4] In `apps/backend/src/ai/ollama.ts` `isNegativeJob`: replace space-padded `includes` matching with title-scoped and/or word-boundary `\b…\b` regex matching over `NEGATIVE_KEYWORDS`; build compiled RegExp(s) once at module load; keep the keyword list semantics (java-not-javascript handling) intact

**Checkpoint**: US4 independently testable — false auto-zeros eliminated.

---

## Phase 7: User Story 5 - Score using the full fetched description (Priority: P2)

**Goal**: Pass-1 prompt uses `SCORING_DESC_MAX_CHARS` (2000), matching the detail fetch cap. (H4 / FR-010)

**Independent Test**: A tech token at offset 800–2000 appears in the built Pass-1 prompt.

### Tests for User Story 5

- [x] T017 [P] [US5] Add Vitest case in `apps/backend/src/ai/ollama.test.ts`: build the Pass-1 prompt for a job whose description has a unique token at offset ~1500; assert the token is present in the prompt string

### Implementation for User Story 5

- [x] T018 [US5] In `apps/backend/src/ai/ollama.ts` `buildPass1Prompt`: replace the hardcoded `slice(0, 800)` with `slice(0, SCORING_DESC_MAX_CHARS)` (the Phase-2 constant)
- [x] T019 [P] [US5] In `apps/backend/src/scrapers/justjoin.ts` `fetchJustJoinDetail`: replace the hardcoded `slice(0, 2000)` with the shared `SCORING_DESC_MAX_CHARS` constant imported from `ai/ollama.ts` (or a shared module) so the two caps cannot drift

**Checkpoint**: US5 independently testable — full description reaches scoring.

---

## Phase 8: User Story 6 - No stall on hung model + faster fetch (Priority: P3)

**Goal**: Bounded Ollama wait via AbortController; profile read once per run; scrapers via `Promise.allSettled`. (M4/M2/M1 / FR-011,012,013 / SC-005,006,007)

**Independent Test**: hung model → call aborts within bound, fallback used, run continues; profile read exactly once; one scraper failing leaves others' results intact.

### Tests for User Story 6

- [x] T020 [P] [US6] Add Vitest case in `apps/backend/src/ai/ollama.test.ts`: a never-resolving fetch mock → `callOllamaRaw` rejects within `OLLAMA_TIMEOUT_MS` (use a low value)
- [x] T021 [P] [US6] Add Vitest case in `apps/backend/src/ai/ollama.test.ts`: `scoreJob(job, profile)` with explicit profile → `getProfileFromDb` / `user_profile` SELECT is NOT invoked
- [x] T022 [P] [US6] Add Vitest case in `apps/backend/src/scheduler/etl.test.ts`: one scraper rejects → other scrapers' results still aggregated (allSettled behavior)

### Implementation for User Story 6

- [x] T023 [US6] In `apps/backend/src/ai/ollama.ts` `callOllamaRaw`: wrap `fetch` with `AbortController` + `setTimeout(OLLAMA_TIMEOUT_MS, default 60000)`; clear the timer in `finally`; on abort throw so the existing retry/fallback path handles it
- [x] T024 [US6] In `apps/backend/src/ai/ollama.ts`: change `scoreJob(job)` → `scoreJob(job, profile?: string)`; when `profile` provided use it and SKIP `getProfileFromDb`; keep env fallback when absent
- [x] T025 [US6] In `apps/backend/src/scheduler/etl.ts` `runEtl`: resolve the scoring profile string once before the chunk loop and pass it into every `scoreJob(job, profile)` call
- [x] T026 [US6] In `apps/backend/src/scheduler/etl.ts` `runEtl`: replace the sequential scraper `for` loop with `Promise.allSettled` over the four scraper fns; fulfilled → push results + record count; rejected → log warn + count 0 (preserve current resilience)

**Checkpoint**: All stories complete.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T027 Run `pnpm --filter @pl-jobhunter/backend test` — all unit gates from quickstart.md green
- [x] T028 Execute `specs/010-etl-correctness-fixes/quickstart.md` integration scenarios (SC-001,002,003,005,006,007) against a dev DB + stub Ollama where noted
- [x] T029 Run `pnpm spec:check` (exit 0); set this feature's tasks to DONE and record commit hashes per CLAUDE.md SDD workflow
- [x] T030 [P] Update `apps/backend` README/env docs if present to mention the three new env vars and the new per-job DB-failure behavior

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**: none — start immediately
- **Foundational (P2)**: after Setup — T003 constant BLOCKS US5 (and feeds US2/US6 caps)
- **US1 (P3)**, **US2 (P4)**, **US3 (P5)**: all P1; all edit `etl.ts` → run SEQUENTIALLY in this order
- **US4 (P6)**, **US5 (P7)**: P2; US4 edits `ollama.ts`, US5 edits `ollama.ts`+`justjoin.ts` → sequential w.r.t. ollama.ts
- **US6 (P8)**: P3; edits both `etl.ts` and `ollama.ts` → after US1–US5 to avoid same-file churn
- **Polish (P9)**: after all desired stories

### Within Each User Story

- Test task first (write, expect fail), then implementation
- `mergeJob` change (T012) before its call-site update (T013)
- Phase-2 constant (T003) before T018/T019

### Parallel Opportunities

- T004/T008/T011 are all in `etl.test.ts` → NOT mutually [P] (same file); the `[P]` marks them parallel to non-`etl.ts` source work, not to each other
- T015/T017/T020/T021 in `ollama.test.ts` → same caveat (same file)
- T019 (`justjoin.ts`) is genuinely [P] vs `ollama.ts`/`etl.ts` edits
- Across stories there is little real parallelism due to two shared hot files — treat the order above as authoritative

---

## Implementation Strategy

### MVP First (P1 correctness slice)

1. Phase 1 Setup → Phase 2 Foundational
2. US1 → US2 → US3 (all P1, sequential on `etl.ts`)
3. **STOP & VALIDATE**: SC-001, SC-002, SC-003 — the three regressions that lose/corrupt data are fixed
4. Deploy MVP

### Incremental Delivery

1. MVP (US1–US3) → validate → deploy
2. US4 (recall) → US5 (scoring depth) → validate SC-004 → deploy
3. US6 (reliability/speed) → validate SC-005/006/007 → deploy

---

## Notes

- Two shared hot files (`scheduler/etl.ts`, `ai/ollama.ts`) drive the sequential ordering; respect it to avoid merge churn.
- No schema migration in any task (FR-015) — all target columns already exist.
- Preserve existing safeguards (FR-014): per-job try/catch, fallback record, `raw_jobs` capture, `ai_analysis` upsert.
- Commit after each task or logical group; per constitution, feature branch merged to `dev` via `--no-ff`.
