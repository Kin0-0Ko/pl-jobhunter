---

description: "Task list for Bulletproof Resource-Constrained ETL & AI Pipeline"
---

# Tasks: Bulletproof Resource-Constrained ETL & AI Pipeline

**Input**: Design documents from `specs/007-bulletproof-etl-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-modules.md, quickstart.md

**Tests**: INCLUDED — the spec mandates a broken-output corpus and inversion/loud-fail verification (User Story 4 + 1). Tests are written before the code they cover.

**Organization**: Grouped by user story. Story labels: US1 = preference resolution (P1), US2 = memory-bounded batching (P1), US3 = third-person output (P2), US4 = defensive parsing & persistence fallback (P1), US5 = cross-training wildcard (P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- All paths relative to repo root.

## Context note

Spec 006 already shipped the happy-path filter (`isRelevantJob` seniority/experience/wildcard), `getFilterProfile`, and the null-summary string guard. This feature closes the **seams**: silent malformed-config, raw `JSON.parse` truncation throws, dropped jobs on Ollama failure, unverified first-person inversion, and unbounded in-memory batch. Tasks below are scoped to those gaps, not a rewrite.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm build/test harness and env knobs the feature relies on.

- [x] T001 Verify backend Vitest config picks up `apps/backend/src/**/*.test.ts`; confirm `pnpm --filter @pl-jobhunter/backend test` runs the existing `ollama.test.ts`
- [x] T002 [P] Add `ETL_CHUNK_SIZE` (default 50) to `apps/backend/.env.example` with a comment on the 1 GB memory rationale

**Checkpoint**: Test runner green on existing suite; env knob documented.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure, dependency-free building blocks that the user-story phases consume. No business wiring yet.

**⚠️ CRITICAL**: User-story phases (3–7) depend on these.

- [x] T003 [P] Create new module `apps/backend/src/ai/json-repair.ts` exporting `repairAndParse(raw: string): RepairResult` per `contracts/internal-modules.md`; implement the ordered pipeline (strip ```` ```json ````/```` ``` ````/`<think>` blocks → brace-depth boundary extraction → `JSON.parse` → bounded repair: close unterminated string, close missing `}`/`]` by depth, strip trailing comma → re-parse). Return discriminated union `{ok:true,value} | {ok:false,reason}`; **never throw**
- [x] T004 [P] Add pure helpers to `apps/backend/src/ai/ollama.ts`: `isFirstPersonInverted(summary: string): boolean` (word-boundary first-person markers per contract), `normalizeScore(n: unknown): number` (coerce + clamp 0–100, NaN→0), `buildFallbackRecord(): OllamaScoreResult` (`{match_score:-1, summary:'Analysis unavailable — pending manual review', tech_stack:[], why_good:' '}`)
- [x] T005 Define `RepairResult` and `RawModelObject` types alongside `json-repair.ts`; confirm `OllamaScoreResult` in `ollama.ts` is the persist-shape (keeps `why_good`). No change needed to `packages/shared/src/types.ts` (verify `UserProfile` already carries `target_seniority`/`max_experience_years`)

**Checkpoint**: `tsc --noEmit` clean; new pure functions importable and unit-testable in isolation.

---

## Phase 3: User Story 1 — Filter preferences actually applied (Priority: P1) 🎯 MVP

**Goal**: Resolve `search_preferences` robustly; warn loudly on malformed config instead of silently bypassing the filter.

**Independent Test**: Set a truncated `search_preferences` blob → run ETL → log shows explicit `WARN` with parse error (not silent `filterProfile: {}`); set a valid blob → ~80% of batch rejected with per-job `reason`.

### Tests for User Story 1

- [x] T006 [P] [US1] In `apps/backend/src/ai/ollama.test.ts` add cases for `getFilterProfile`: (a) null field → `{}` no warn, (b) valid blob → populated profile, (c) malformed blob → warn + `{}`, (d) lowercase key fallback → resolved. Mock the DB pool/connection as existing tests do

### Implementation for User Story 1

- [x] T007 [US1] Rewrite `getFilterProfile()` in `apps/backend/src/ai/ollama.ts` to split outcomes (absent→quiet `{}`, resolved→populated, malformed→`logger.warn({raw,err})`+`{}`) and tolerate `SEARCH_PREFERENCES`/`search_preferences` casing. Remove the blanket `catch {} → {}` that hides parse failures (keep DB-connection errors caught + warned)
- [x] T008 [US1] In `apps/backend/src/scheduler/etl.ts` change the `filterProfile` log so a resolved-empty profile and a malformed-config warning are distinguishable in production logs (drop the unconditional `info` that printed `filterProfile: {}`)

**Checkpoint**: Malformed config is loud; valid config drives the filter. MVP boundary — filtering is trustworthy.

---

## Phase 4: User Story 4 — No malformed AI output crashes run or DB (Priority: P1)

**Goal**: Repair or fall back on every model response; guarantee a constraint-valid `ai_analysis` row for every promoted job (kills truncation throws + ORA-01400 + silent drops).

**Independent Test**: Feed corpus of broken responses (truncated, markdown-fenced, missing brace, null summary) → every item yields repaired-or-fallback record, zero unhandled throws, zero null summaries.

### Tests for User Story 4

- [x] T009 [P] [US4] Create `apps/backend/src/ai/json-repair.test.ts` covering the full corpus in `contracts/internal-modules.md` (clean, fenced, `<think>` preamble, trailing prose, unterminated string, missing closes, trailing comma, no-json, garbage) asserting `ok`/`reason` per case
- [x] T010 [P] [US4] Extend `apps/backend/src/ai/ollama.test.ts`: `scoreJob` returns a fallback record (never null) when the model response is unrepairable, empty, or HTTP-errors; `normalizeScore` clamps 150→100 / -5→0 / NaN→0; empty summary → non-empty enforced

### Implementation for User Story 4

- [x] T011 [US4] Rewire `callOllama()` in `apps/backend/src/ai/ollama.ts` to pass `data.response` through `repairAndParse` (replace bare `JSON.parse`); on `ok:false` return `buildFallbackRecord()`; on `ok:true` run `normalizeScore` + non-empty-summary guard; keep `num_predict:400`
- [x] T012 [US4] Change `scoreJob()` return contract to `Promise<OllamaScoreResult>` (non-null): on retry exhaustion / thrown error, return `buildFallbackRecord()` instead of `null`. Update its signature and remove the `| null`
- [x] T013 [US4] In `apps/backend/src/scheduler/etl.ts` replace the two silent-drop branches (`scoreJob` threw → `continue`; `!analysis` → `continue`) with `persistAnalysis(buildFallbackRecord())` so every promoted job persists exactly one row; keep `sendOllamaWarning`. Add `fallback` counter to the run-summary log
- [x] T014 [US4] Verify `persistAnalysis` is never called with empty `summary` (fallback + model paths both guaranteed non-empty); confirm `match_score=-1` fallback vs `match_score=0` negative-keyword remain distinct

**Checkpoint**: No broken model output can abort the run or violate the summary constraint; no promoted job is dropped.

---

## Phase 5: User Story 2 — Pipeline survives the 1 GB memory limit (Priority: P1)

**Goal**: Process ~1,500 jobs in bounded chunks; no OOM; per-item failure isolated.

**Independent Test**: Full batch on constrained instance completes (exit 0), no OOM kill, per-chunk progress logged, peak RSS within budget.

### Implementation for User Story 2

- [x] T015 [US2] In `apps/backend/src/scheduler/etl.ts` introduce chunked iteration over the scraped `jobs` array in slices of `ETL_CHUNK_SIZE` (env, default 50); process each slice fully (raw merge → filter → promote → score/fallback → persist) before the next; log `{ chunk, processed, total }` per slice
- [x] T016 [US2] Confirm the existing `pLimit(1)` Ollama gate in `ollama.ts` is retained (no concurrency increase); ensure per-job `try/catch` isolation so one job's throw never aborts the chunk or run
- [x] T017 [P] [US2] Document the `node --max-old-space-size=256` launch flag for the ETL process in `specs/007-bulletproof-etl-pipeline/quickstart.md` cross-check and in `apps/backend/.env.example`/run notes

**Checkpoint**: Batch runs within memory budget; progress observable; failures contained.

---

## Phase 6: User Story 3 — AI output describes the company, never the user (Priority: P2)

**Goal**: Detect and replace first-person/inverted summaries before persistence.

**Independent Test**: Model returns `"I am a TypeScript developer…"` → persisted summary is the review placeholder; `SELECT … WHERE LOWER(summary) LIKE 'i am %'` returns 0.

### Tests for User Story 3

- [x] T018 [P] [US3] In `apps/backend/src/ai/ollama.test.ts` assert `isFirstPersonInverted` true on `"I am …"`/`"I'm …"`/sentence-start `"My …"`, false on `"The company seeks …"` and on `"I/O"`/`"I18n"` false positives

### Implementation for User Story 3

- [x] T019 [US3] In `callOllama()` (`apps/backend/src/ai/ollama.ts`) after parse/normalize, run `isFirstPersonInverted(summary)`; if true, replace the whole record with `buildFallbackRecord()` (routes inversion through the same review channel as parse failure)
- [x] T020 [P] [US3] Tighten `buildPrompt()` token economy in `ollama.ts`: keep the third-person/no-first-person instruction, keep 1,500-char description slice and the exact 3-field output contract; no few-shot examples

**Checkpoint**: Inverted summaries never persist; prompt minimised.

---

## Phase 7: User Story 5 — Cross-training roles surfaced, not filtered (Priority: P3)

**Goal**: Cross-training phrase bypasses keyword block but does NOT override seniority/experience rejects (rule ordering).

**Independent Test**: Posting with cross-training phrase + non-matching stack → promoted; same phrase + senior title → still rejected by seniority.

### Tests for User Story 5

- [x] T021 [P] [US5] In `apps/backend/src/ai/ollama.test.ts` add `isRelevantJob` cases: (a) cross-training phrase + non-matching keywords → `{pass:true, reason:'wildcard'}`, (b) cross-training phrase + senior title under junior/mid target → `{pass:false, reason:'seniority'}`, (c) cross-training phrase + experience over cap → confirm intended precedence

### Implementation for User Story 5

- [x] T022 [US5] Audit rule order in `isRelevantJob` (`apps/backend/src/ai/ollama.ts`): seniority check must precede the wildcard short-circuit. Current code runs seniority (step 1) before wildcard (step 2) — verify and, if experience-over-cap should also outrank the wildcard, move the experience check above the wildcard or scope the wildcard to keyword-only bypass. Align behaviour with spec FR-005 + acceptance scenario 2

**Checkpoint**: Wildcard surfaces cross-training roles without defeating seniority/experience gates.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T023 [P] Run `pnpm --filter @pl-jobhunter/shared exec tsc --noEmit` and `pnpm --filter @pl-jobhunter/backend exec tsc --noEmit`; fix any type errors
- [x] T024 [P] Run full `pnpm --filter @pl-jobhunter/backend test`; all new + existing suites green
- [x] T025 Execute `specs/007-bulletproof-etl-pipeline/quickstart.md` scenarios 1–4 against a stub Ollama; capture logs proving each acceptance-gate row
- [x] T026 [P] Run `pnpm spec:check`; mark this feature's tasks DONE and record the commit hash per SDD workflow

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no deps — start immediately
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories (provides `json-repair.ts` + pure helpers)
- **User Stories (Phases 3–7)**: all depend on Foundational
- **Polish (Phase 8)**: depends on all targeted stories

### User Story Dependencies

- **US1 (P1, Phase 3)**: depends only on Foundational. Independent.
- **US4 (P1, Phase 4)**: depends on Foundational (`repairAndParse`, `buildFallbackRecord`, `normalizeScore`). Independent of US1.
- **US2 (P1, Phase 5)**: depends on Foundational; touches `etl.ts` — **shares `etl.ts` with US4 (T013) and US1 (T008)**, so sequence US1 → US4 → US2 to avoid edit conflicts in that file.
- **US3 (P2, Phase 6)**: depends on Foundational (`isFirstPersonInverted`, `buildFallbackRecord`) and on US4's `callOllama` rewire (T011) since T019 edits the same function — run after US4.
- **US5 (P3, Phase 7)**: depends only on Foundational. Independent of others.

### File-contention note (breaks naive parallelism)

`apps/backend/src/ai/ollama.ts` is edited by US1 (T007), US4 (T011/T012), US3 (T019/T020), US5 (T022). `apps/backend/src/scheduler/etl.ts` is edited by US1 (T008), US4 (T013), US2 (T015/T016). Within these files, tasks are **sequential**, not parallel. Test files and `json-repair.ts` are independent and `[P]`.

### Within Each User Story

- Tests written before the implementation they cover (spec mandates the corpus/inversion tests).
- Pure helpers (Phase 2) before wiring.

---

## Parallel Opportunities

- T002 ∥ (Setup)
- **Foundational**: T003 (`json-repair.ts`) ∥ T004 (`ollama.ts` helpers) — different files. T005 after.
- **Tests are [P] across stories**: T006, T009, T010, T018, T021 touch test files / `json-repair.test.ts` and can be drafted in parallel once their target signatures exist.
- T017, T020, T023, T024, T026 marked [P].
- Implementation tasks editing `ollama.ts` / `etl.ts` are **serialized** (see contention note).

---

## Parallel Example: Foundational + Story tests

```bash
# Foundational, parallel (different files):
Task: "T003 implement repairAndParse in apps/backend/src/ai/json-repair.ts"
Task: "T004 add isFirstPersonInverted/normalizeScore/buildFallbackRecord in apps/backend/src/ai/ollama.ts"

# Repair corpus tests, parallel with helper tests:
Task: "T009 json-repair.test.ts corpus"
Task: "T010 ollama.test.ts scoreJob fallback + normalizeScore"
```

---

## Implementation Strategy

### MVP First (US1 + US4)

The two highest-value P1 stories are US1 (trustworthy filtering) and US4 (durable persistence, no crashes). Recommended MVP:

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3 US1 (loud config) → validate
3. Phase 4 US4 (repair + always-persist fallback) → validate
4. **STOP & VALIDATE**: malformed config is loud, broken AI output never crashes or drops jobs, zero ORA-01400. Deployable.

### Incremental Delivery

US2 (chunking) → US3 (inversion guard) → US5 (wildcard ordering), each independently testable, each touching a bounded edit surface.

---

## Notes

- [P] = different files, no incomplete-task dependency.
- `ollama.ts` and `etl.ts` are hot files shared across stories — edit sequentially per the contention note.
- Tests precede the code they cover (corpus, inversion, loud-fail).
- `match_score`: `-1` = needs review (fallback), `0` = negative-keyword reject, `[1–100]` = scored — keep distinct.
- Commit after each task or logical group; record commit hash on DONE per SDD.
