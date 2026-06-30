# Tasks: Filter Edge-Case Patches

**Input**: Design documents from `specs/008-filter-edge-case-patches/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ quickstart.md ✅

**Organization**: Tasks grouped by user story. Stories US1+US2 are P1, US3–US5 are P2.
All patches touch separate files/functions — high parallelism available.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

**Purpose**: Verify baseline before patching

- [ ] T001 Confirm existing test suite passes with `pnpm --filter @pl-jobhunter/backend test` in `apps/backend/`
- [ ] T002 [P] Read and note current `NEGATIVE_KEYWORDS` array and `isNegativeJob()` in `apps/backend/src/ai/ollama.ts`
- [ ] T003 [P] Read and note current `SENIOR_TITLE_KEYWORDS` and `isRelevantJob()` in `apps/backend/src/ai/ollama.ts`
- [ ] T004 [P] Read and note current `scoreJob()` flow in `apps/backend/src/scheduler/etl.ts`

**Checkpoint**: Baseline green — all tests pass, code locations confirmed

---

## Phase 2: Foundational (No Prerequisites Between Stories)

**Purpose**: This patch has no shared infrastructure to build — each story is an independent surgical edit. Proceed directly to user story phases.

**⚠️ NOTE**: US1 and US2 both touch `ollama.ts`. Complete T005–T010 (US1) before T011–T014 (US2) to avoid merge conflicts in the same file.

---

## Phase 3: User Story 1 — Empty Description Guard (Priority: P1) 🎯 MVP

**Goal**: Jobs with null/stub description skip Ollama and get `match_score=10`, `summary=job.title`

**Independent Test**: `pnpm --filter @pl-jobhunter/backend test -- --grep "empty description"`

### Implementation

- [ ] T005 [US1] In `apps/backend/src/scheduler/etl.ts`, after `isNegativeJob()` check (Step 4) and before `scoreJob()` call (Step 5): add guard `if (!job.description || job.description.length < 30)` that calls `persistAnalysis(job.id, 10, job.title, [], ' ')`, increments `scored`, logs `[ETL] Empty description — skip Ollama`, then `continue`
- [ ] T006 [US1] Add unit tests in `apps/backend/src/ai/ollama.test.ts` covering: (a) job with `description=null` → `scoreJob` never called; (b) job with `description="[category:javascript]"` (22 chars) → `scoreJob` never called; (c) job with 31-char description → normal flow proceeds

**Checkpoint**: Run `pnpm --filter @pl-jobhunter/backend test -- --grep "empty description"` → all pass

---

## Phase 4: User Story 2 — Word-Boundary Regex Java/Python (Priority: P1)

**Goal**: `isNegativeJob()` catches `java+`, `java/`, `(java)` variants; never false-positives on `javascript`

**Independent Test**: `pnpm --filter @pl-jobhunter/backend test -- --grep "isNegativeJob"`

### Implementation

- [ ] T007 [US2] In `apps/backend/src/ai/ollama.ts`, replace the java string entries (`'java '`, `'java,'`, `'java/'`, `'(java)'`, `' java)'`) and python entry (`'python'`) in `NEGATIVE_KEYWORDS` with regex constants defined above the array:
  ```ts
  const JAVA_RE = /\bjava\b/i;
  const PYTHON_RE = /\bpython\b/i;
  ```
  Remove those string literals from `NEGATIVE_KEYWORDS`.
- [ ] T008 [US2] Update `isNegativeJob()` in `apps/backend/src/ai/ollama.ts` to run regex tests before the string-includes loop:
  ```ts
  if (JAVA_RE.test(haystack) || PYTHON_RE.test(haystack)) return true;
  ```
  Keep existing `NEGATIVE_KEYWORDS.some(kw => haystack.includes(kw))` for all other entries.
- [ ] T009 [US2] Add unit tests in `apps/backend/src/ai/ollama.test.ts` for `isNegativeJob()` covering: `"Java+ Developer"` → true, `"Java/React Engineer"` → true, `"Fullstack (Java+React+TypeScript)"` → true, `"Python Data Engineer"` → true, `"JavaScript Developer"` → false, `"Node.js / TypeScript Developer"` → false

**Checkpoint**: `pnpm --filter @pl-jobhunter/backend test -- --grep "isNegativeJob"` → all pass including existing

---

## Phase 5: User Story 3 — NoFluffJobs Category Mapping (Priority: P2)

**Goal**: NoFluff scraper injects `[category:X]` description stub from `technology` field

**Independent Test**: `pnpm --filter @pl-jobhunter/backend test -- --grep "nofluff"`

### Implementation

- [ ] T010 [P] [US3] In `apps/backend/src/scrapers/nofluff.ts`, extend `NFPosting` interface: add `technology?: string[]`
- [ ] T011 [US3] In `apps/backend/src/scrapers/nofluff.ts`, inside the `jobs.push({...})` call: add `description: posting.technology?.[0] ? \`[category:${posting.technology[0].toLowerCase()}]\` : undefined` (depends on T010)
- [ ] T012 [US3] Add unit tests in `apps/backend/src/scrapers/nofluff.test.ts` (create file if not exists) covering: mock posting with `technology:["python"]` → description=`"[category:python]"`, mock with `technology:["javascript"]` → description=`"[category:javascript]"`, mock with no `technology` field → description=`undefined`

**Checkpoint**: `pnpm --filter @pl-jobhunter/backend test -- --grep "nofluff"` → all pass

---

## Phase 6: User Story 4 — Polish Seniority Blockers (Priority: P2)

**Goal**: `isRelevantJob()` blocks `Starszy`/`Lider`/`Ekspert` titles when profile targets junior/mid

**Independent Test**: `pnpm --filter @pl-jobhunter/backend test -- --grep "polish.seniority\|isRelevantJob"`

### Implementation

- [ ] T013 [P] [US4] In `apps/backend/src/ai/ollama.ts`, add Polish terms to `SENIOR_TITLE_KEYWORDS`:
  ```ts
  const SENIOR_TITLE_KEYWORDS = ['senior', 'lead', 'principal', 'staff', 'architect', 'expert', 'manager', 'head of', 'director', 'starszy', 'lider', 'ekspert'];
  ```
- [ ] T014 [US4] Add unit tests in `apps/backend/src/ai/ollama.test.ts` for `isRelevantJob()` with `target_seniority:["junior"]`: `"Starszy Developer Node.js"` → `{pass:false, reason:'seniority'}`, `"Lider Zespołu Frontend"` → `{pass:false, reason:'seniority'}`, `"Ekspert TypeScript"` → `{pass:false, reason:'seniority'}`. Also: no profile + `"Starszy Developer"` → `{pass:true}`

**Checkpoint**: `pnpm --filter @pl-jobhunter/backend test -- --grep "isRelevantJob"` → all pass

---

## Phase 7: User Story 5 — Frontend Override for Infrastructure Roles (Priority: P2)

**Goal**: Titles with `angular`/`react`/`frontend`/`typescript`/`vue`/`next.js` are NOT blocked by `platform engineer` blocklist

**Independent Test**: `pnpm --filter @pl-jobhunter/backend test -- --grep "platform engineer\|frontend override"`

### Implementation

- [ ] T015 [US5] In `apps/backend/src/ai/ollama.ts`, add a constant above `isNegativeJob`:
  ```ts
  const FRONTEND_OVERRIDE_KEYWORDS = ['angular', 'react', 'frontend', 'typescript', 'vue', 'next.js'];
  ```
- [ ] T016 [US5] Update `isNegativeJob()` in `apps/backend/src/ai/ollama.ts`: before returning `true` from the string-includes loop, check if the matched keyword is an infrastructure term AND the title contains a frontend override keyword — if so, skip the block. Implementation:
  ```ts
  const INFRA_BLOCKLIST = ['platform engineer', 'devops engineer', 'devops specialist', 'site reliability', 'sre ', 'cloud engineer', 'infrastructure engineer'];
  // in isNegativeJob, replace the return for NEGATIVE_KEYWORDS:
  const titleLower = job.title.toLowerCase();
  const hasFrontendOverride = FRONTEND_OVERRIDE_KEYWORDS.some(kw => titleLower.includes(kw));
  return NEGATIVE_KEYWORDS.some(kw => {
    if (!haystack.includes(kw)) return false;
    if (hasFrontendOverride && INFRA_BLOCKLIST.includes(kw)) return false;
    return true;
  });
  ```
- [ ] T017 [US5] Add unit tests in `apps/backend/src/ai/ollama.test.ts` for `isNegativeJob()`: `"Angular Web Platform Engineer"` → false, `"React Platform Engineer"` → false, `"Frontend Platform Engineer"` → false, `"TypeScript Platform Engineer"` → false, `"Cloud Platform Engineer"` → true, `"Platform Engineer"` → true

**Checkpoint**: `pnpm --filter @pl-jobhunter/backend test -- --grep "platform engineer\|frontend override"` → all pass

---

## Phase 8: Polish & Validation

**Purpose**: Full regression check + production log verification

- [ ] T018 Run full test suite `pnpm --filter @pl-jobhunter/backend test` — zero failures, zero regressions
- [ ] T019 [P] Run `pnpm --filter @pl-jobhunter/backend build` — TypeScript compiles clean, no strict-mode errors
- [ ] T020 [P] Run `pnpm spec:check` from monorepo root — passes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No deps — start immediately. T002/T003/T004 parallel.
- **Phase 3 (US1)**: No deps on other stories. Touches `etl.ts` only.
- **Phase 4 (US2)**: No deps on US1. Touches `ollama.ts` — complete after US1 if editing same file section.
- **Phase 5 (US3)**: Fully independent. Touches `nofluff.ts` only. Can run parallel with Phase 3.
- **Phase 6 (US4)**: Touches `ollama.ts` SENIOR_TITLE_KEYWORDS only. Can run parallel with Phase 5.
- **Phase 7 (US5)**: Touches `ollama.ts` isNegativeJob. Complete Phase 4 first to avoid conflicts.
- **Polish (Phase 8)**: After all story phases complete.

### Parallel Opportunities

- T002, T003, T004 (setup reads) — parallel
- T005 (etl.ts) + T010/T011 (nofluff.ts) + T013 (SENIOR_TITLE_KEYWORDS constant) — parallel (different files/sections)
- T006, T009, T012, T014, T017 (test additions) — parallel per story once implementation done
- T018, T019, T020 — T019 and T020 parallel after T018

---

## Implementation Strategy

### MVP (US1 + US2 — highest impact)

1. Phase 1: Setup baseline
2. Phase 3: Empty description guard in `etl.ts` → fixes template-copying bug
3. Phase 4: Word-boundary regex in `ollama.ts` → fixes java+ false negatives
4. **Validate**: Full test suite green
5. Deploy — already eliminates the two most damaging production gaps

### Full Delivery

5. Phase 5: NoFluff category mapping
6. Phase 6: Polish seniority blockers
7. Phase 7: Frontend override
8. Phase 8: Polish + regression check
9. Deploy production ETL run, verify via logs

---

## Notes

- T007+T008 are sequential — define regex constants first, then update `isNegativeJob`
- T015+T016 are sequential — define `FRONTEND_OVERRIDE_KEYWORDS` before updating `isNegativeJob`
- `nofluff.test.ts` may not exist yet — T012 creates it if needed
- All test tasks use Vitest syntax (`describe`, `it`, `expect`) consistent with existing `ollama.test.ts`
- Commit after each phase checkpoint to preserve bisectability
