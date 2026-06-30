# Tasks: ETL Audit Fixes & Telegram Boost

**Input**: Design documents from `specs/009-etl-audit-telegram-boost/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Organization**: Tasks grouped by user story — each phase is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking deps)
- **[Story]**: Maps to user story from spec.md (US1–US6)
- Exact file paths in all descriptions

---

## Phase 1: Setup

**Purpose**: Read current source files to establish baseline before any edits.

- [ ] T001 Read `apps/backend/src/ai/ollama.ts` — identify pass1/pass2 functions, `scoreJob()` return, line numbers for summary, why_good, JSON repair failure path
- [ ] T002 Read `apps/backend/src/scheduler/etl.ts` — locate `sendJobAlert()` call, `runEtl()` body, ETL completion log line
- [ ] T003 Read `apps/backend/src/bot/telegram.ts` — locate `/status` handler, `/scrape` handler, `sendJobAlert` import
- [ ] T004 [P] Read `apps/backend/src/routes/jobs.ts` — locate the SELECT query joining `jobs` + `ai_analysis`, check for `fetchInfo` on `tech_stack` column
- [ ] T005 [P] Read `apps/frontend/src/components/JobCard.tsx` — locate salary render, summary render, identify insertion point for tech_stack badges and salary anomaly badge
- [ ] T006 [P] Read `apps/frontend/src/components/JobDetailModal.tsx` — locate salary render and header chip row for anomaly badge insertion

**Checkpoint**: All source locations mapped — implementation can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Fix the Oracle CLOB `tech_stack` fetch bug — blocks US2 frontend work and the Telegram digest (stack field).

**⚠️ CRITICAL**: US2 frontend badges and US4 Telegram stack display depend on `tech_stack` being a real string array from the API.

- [ ] T007 Fix `tech_stack` CLOB fetch in `apps/backend/src/routes/jobs.ts` — add `fetchInfo: { TECH_STACK: { type: oracledb.STRING } }` to the `ai_analysis` join query, then `JSON.parse` the result before returning; handle null/invalid JSON as `[]`

**Checkpoint**: `GET /api/jobs` returns `tech_stack: ["React", ...]` for scored jobs. Verify with `curl -H "x-api-token: $TOKEN" http://localhost:3000/api/jobs | node -e "..."` (see quickstart.md §2).

---

## Phase 3: User Story 1 — AI Output Quality Guard (Priority: P1) 🎯 MVP

**Goal**: Bad Ollama summaries and whitespace `why_good` never reach the DB. JSON repair failures log raw output.

**Independent Test**: After one ETL run, zero `ai_analysis` rows have `summary` containing `<` or shorter than 20 chars; zero rows have `why_good = ' '`.

### Implementation

- [ ] T008 [US1] Add summary quality guard in `apps/backend/src/ai/ollama.ts` — in `scoreJob()`, after `callPass1()` returns: if `summary.includes('<')` OR `summary.trim().length < 20`, set `summary = job.title` and `match_score = 10`
- [ ] T009 [US1] Fix `why_good` storage in `apps/backend/src/ai/ollama.ts` — in `scoreJob()` return statement (currently line ~364): replace hardcoded `why_good: ' '` with `why_good: null` (pass 2 never extracts it; null is correct, whitespace is corrupt)
- [ ] T010 [US1] Add raw Ollama text logging on pass2 JSON repair failure in `apps/backend/src/ai/ollama.ts` — in the `callPass2()` JSON repair failure branch, log `rawText` at WARN level alongside the existing `[ETL] pass2: JSON repair failed` message

**Checkpoint**: Trigger ETL. Confirm via `quickstart.md §1` and `§3` — zero bad summaries, zero whitespace why_good.

---

## Phase 4: User Story 2 — tech_stack Badges on Board (Priority: P1)

**Goal**: Tech stack pills render on every job card and in the detail modal.

**Independent Test**: Open job board after ETL run. Job cards with scored jobs show pill badges (e.g. "React · Node.js"). Detail modal shows full stack list.

**Dependency**: Requires T007 (CLOB fix) — badges need real data from API.

### Implementation

- [ ] T011 [P] [US2] Add `tech_stack` badge pills to `apps/frontend/src/components/JobCard.tsx` — below the summary text, render `<span>` pills for each item in `tech_stack` when array is non-empty; render nothing when empty/null
- [ ] T012 [P] [US2] Verify `tech_stack` in `apps/frontend/src/components/JobDetailModal.tsx` — per plan.md, modal already renders tech_stack in "Tech Stack" section (lines 87–98); confirm no change needed or add if missing

**Checkpoint**: Open job board — tech badges visible on cards. Open detail modal — stack section populated.

---

## Phase 5: User Story 3 — Salary Anomaly Detection (Priority: P1)

**Goal**: Jobs with `salary_b2b_min < 500 PLN` show a "⚠ hourly?" warning badge.

**Independent Test**: Find job with `salary_b2b_min = 45` and `currency = "PLN"`. Confirm "⚠ hourly?" badge renders. Find job with `salary_b2b_min = 15000` — no badge.

### Implementation

- [ ] T013 [P] [US3] Add salary anomaly badge to `apps/frontend/src/components/JobCard.tsx` — add `isHourlySalary(min, currency)` helper (`min !== null && min < 500 && currency === 'PLN'`); render "⚠ hourly?" badge next to B2B and/or UoP salary display when condition true
- [ ] T014 [P] [US3] Add salary anomaly badge to `apps/frontend/src/components/JobDetailModal.tsx` — in header chip row, apply same `isHourlySalary()` check and render "⚠ hourly?" badge inline with salary display

**Checkpoint**: Open board with known anomalous job — badge visible. Normal salary job — no badge.

---

## Phase 6: User Story 4 — End-of-Run Telegram Digest (Priority: P2)

**Goal**: Single post-run Telegram message replaces per-job alerts. `/status` returns last run digest.

**Independent Test**: Trigger ETL. Count Telegram messages — exactly 1 (no per-job alerts). Message contains run stats + top 5 jobs. Send `/status` — same format returned.

**Dependency**: Builds on US1 (quality summary) and US2 (tech_stack data). Can implement independently of frontend stories (US2/US3).

### Implementation

- [ ] T015 [US4] Define `ETLRunSummary` interface and `let lastRunSummary: ETLRunSummary | null = null` module var in `apps/backend/src/scheduler/etl.ts`; export `isRunning: boolean` flag (initially `false`)
- [ ] T016 [US4] Add `ETLRunSummary` accumulator in `apps/backend/src/scheduler/etl.ts` — reset at start of `runEtl()`; increment `rawTotal`, `filtered`, `inserted`, `scored`, `fallback` at the right points; collect top 5 jobs into `topJobs` array (sorted `match_score DESC`) from jobs inserted this run with their analysis result
- [ ] T017 [US4] Remove per-job `sendJobAlert()` call from `apps/backend/src/scheduler/etl.ts` (currently line ~265) — delete or comment out; do not delete the `sendJobAlert` function itself yet (US5 removes the import)
- [ ] T018 [US4] Add `sendRunDigest(summary: ETLRunSummary)` function to `apps/backend/src/bot/telegram.ts` — formats HTML message per `contracts/telegram-digest.md` template; uses `formatSalaryShort()` helper; sends to `process.env.TELEGRAM_ADMIN_CHAT_ID` with `parse_mode: 'HTML'`; add `formatSalaryShort(min, max, currency, contractType)` helper in same file
- [ ] T019 [US4] Call `sendRunDigest(lastRunSummary)` at end of `runEtl()` in `apps/backend/src/scheduler/etl.ts` (after current line ~278 logger.info run-complete log); wrap in try/catch — digest send failure MUST NOT throw or block ETL completion
- [ ] T020 [US4] Replace `/status` handler body in `apps/backend/src/bot/telegram.ts` (currently lines 77–102) — check `lastRunSummary`; if null reply "ℹ️ No ETL run recorded yet."; else format and reply with same HTML digest (header: "📊 <b>Last ETL Run</b>")

**Checkpoint**: Trigger ETL via cron or test. One Telegram message. `/status` returns digest. `/status` before any run returns "No ETL run recorded yet."

---

## Phase 7: User Story 5 — /scrape In-Process with Follow-Up (Priority: P2)

**Goal**: `/scrape` ACKs within 2s, runs ETL in-process, sends post-run digest. Concurrent `/scrape` blocked.

**Independent Test**: Send `/scrape`. Count messages: ACK + digest = 2 total. Send `/scrape` again during a run — blocked reply.

**Dependency**: Requires T015 (`isRunning` export) and T016–T019 (ETL accumulator + `sendRunDigest`).

### Implementation

- [ ] T021 [US5] Replace `/scrape` handler in `apps/backend/src/bot/telegram.ts` (currently lines 106–113) — remove `spawn(..., { detached: true })` block; replace with: `await ctx.reply('⚡ ETL triggered ✅')`; check `isRunning` guard (reply "⏳ ETL already running — please wait." and return if true); call `runEtl()` non-awaited (`.then(() => sendRunDigest(lastRunSummary!)).catch(e => ctx.reply('🚨 ETL failed: ' + e.message))`; import `runEtl` and `isRunning` from `../scheduler/etl`
- [ ] T022 [US5] Set `isRunning = true` at start of `runEtl()` and `isRunning = false` in a `finally` block at end in `apps/backend/src/scheduler/etl.ts` — ensures guard works for both cron and `/scrape` triggers

**Checkpoint**: `/scrape` sends ACK immediately. ETL runs. Digest sent when done. Rapid double `/scrape` — second blocked.

---

## Phase 8: User Story 6 — Bind Backend to Localhost (Priority: P3)

**Goal**: Fastify not reachable on public IP:port. Caddy still proxies via Docker bridge.

**Independent Test**: On VPS — `curl http://92.5.50.4:3000/` → connection refused. `curl https://your-domain/api/jobs -H "x-api-token: $TOKEN"` → 200.

### Implementation

- [ ] T023 [US6] Change `HOST` default in `apps/backend/src/index.ts` (line 54) from `'0.0.0.0'` to `'127.0.0.1'`
- [ ] T024 [US6] Add `HOST=0.0.0.0` to backend service `environment:` section in `docker-compose.yml` — required so Caddy container can reach backend via Docker bridge network (Fastify inside container must still accept connections from Docker bridge, not just loopback); remove `ports:` mapping for backend service (prevents host-level port exposure)

**Checkpoint**: Deploy. `curl http://92.5.50.4:3000/` → connection refused. Caddy proxy → 200.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T025 [P] Run `quickstart.md` validation scenarios §1–§9 end-to-end and confirm all pass
- [ ] T026 [P] Verify TypeScript strict mode — run `pnpm -F backend tsc --noEmit` and `pnpm -F frontend tsc --noEmit` — zero errors
- [ ] T027 Verify `ETLRunSummary` type is imported from `apps/backend/src/scheduler/etl.ts` by `apps/backend/src/bot/telegram.ts` — not duplicated; if `TopJobEntry` needs sharing across modules, define once in `etl.ts` and re-export
- [ ] T028 [P] Check `sendJobAlert` function in `apps/backend/src/bot/telegram.ts` — if no longer called anywhere after T017 and T021, remove the function and its import from `etl.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No deps — read-only, start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 reads of `routes/jobs.ts` (T004)
- **Phase 3 (US1)**: Depends on Phase 1 reads of `ollama.ts` (T001)
- **Phase 4 (US2)**: Depends on T007 (CLOB fix must be done before badges show real data)
- **Phase 5 (US3)**: Depends on Phase 1 reads of frontend components (T005, T006) — independent of backend phases
- **Phase 6 (US4)**: Depends on Phase 1 reads of `etl.ts` and `telegram.ts` (T002, T003) — independent of frontend phases
- **Phase 7 (US5)**: Depends on T015 (`isRunning`), T016–T019 (digest infrastructure)
- **Phase 8 (US6)**: Depends on Phase 1 read of `index.ts` (covered by T002 area) — independent of all other phases
- **Phase 9 (Polish)**: Depends on all phases complete

### User Story Dependencies

- **US1 (AI quality)**: Independent — only needs `ollama.ts` read
- **US2 (tech_stack UI)**: Depends on T007 (foundational CLOB fix)
- **US3 (salary badge)**: Independent of backend stories — frontend-only
- **US4 (run digest)**: Depends on US1 (clean summaries in topJobs)
- **US5 (/scrape in-process)**: Depends on US4 (ETLRunSummary + sendRunDigest)
- **US6 (localhost bind)**: Fully independent

### Parallel Opportunities

After Phase 2 (T007) completes:
- US1 (T008–T010) + US3 (T013–T014) + US6 (T023–T024) can all run in parallel
- US2 (T011–T012) can run alongside US3 after T007 done
- US4 starts after US1; US5 starts after US4

---

## Parallel Example: P1 Stories After Foundational

```
# After T007 completes, launch in parallel:
Task A: T008 ollama.ts summary guard         [US1]
Task B: T013 JobCard.tsx salary anomaly      [US3]
Task C: T023 index.ts HOST default change    [US6]

# Then when T008–T010 done:
Task D: T011 JobCard.tsx tech_stack badges   [US2]

# Then when T015–T019 done:
Task E: T021 /scrape in-process handler      [US5]
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3 — the P1 stories)

1. Complete Phase 1 (read all source files)
2. Complete Phase 2 (T007 — CLOB fix, unblocks US2)
3. Complete Phase 3 (T008–T010 — AI quality guard)
4. Complete Phase 4 (T011–T012 — tech_stack badges)
5. Complete Phase 5 (T013–T014 — salary anomaly badges)
6. **VALIDATE**: All three P1 stories working — job board is trustworthy
7. Complete Phase 6 (T015–T020 — run digest)
8. Complete Phase 7 (T021–T022 — /scrape in-process)
9. Complete Phase 8 (T023–T024 — localhost bind)
10. Complete Phase 9 (T025–T028 — polish)

### Commit Cadence

Commit after each phase completes. Minimum 9 commits for this feature.

---

## Notes

- No new dependencies — all changes use existing imports
- No schema changes — `tech_stack` column already exists; fix is in the fetch layer
- `ETLRunSummary` lives in `etl.ts` as a module-level var — not in `packages/shared` (backend-only concern)
- `isRunning` must be in the same module as `runEtl()` to be atomic w.r.t. the event loop
- Telegram `parse_mode: 'HTML'` — avoids escaping `-`, `.`, `(`, `)` in job titles (see research.md §8)
- Salary anomaly `< 500 PLN` covers all observed anomalies (40–193) with margin
- `why_good` stores `null` — UI already guards with `{analysis?.why_good && ...}` pattern
