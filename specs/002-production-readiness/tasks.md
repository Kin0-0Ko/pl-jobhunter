---
description: "Task list for Production Readiness — Dynamic Profile, Filtering/Analytics, ETL Monitoring"
---

# Tasks: Production Readiness

**Input**: Design documents from `specs/002-production-readiness/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅ | quickstart.md ✅

**Tests**: vitest unit tests requested for profile routes and ETL alert logic.

**Organization**: Tasks grouped by user story; each phase is independently testable. IDs continue from existing `specs/001-job-hunter-aggregator/tasks.md` (last ID: T057).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelizable — different files, no incomplete dependencies
- **[Story]**: User story label (US1–US3)
- Paths relative to repo root

## Path Conventions

- Backend: `apps/backend/src/`
- Frontend: `apps/frontend/src/`
- Shared: `packages/shared/src/`

---

## Phase 8: Setup — Shared Foundation for All Three Stories

**Purpose**: Cross-cutting prerequisites that all three new user stories depend on.

**⚠️ CRITICAL**: Complete before any Phase 9–11 work.

- [ ] T058 Add `UserProfile` interface to `packages/shared/src/types.ts` — fields: `skills: string[]`, `resume_text: string | null`, `preferred_contract: 'b2b' | 'uop' | 'both'`, `search_preferences: string | null`, `updated_at: string`
- [ ] T059 Add `user_profile` table DDL to `apps/backend/src/config/init-db.ts` — `CREATE TABLE user_profile (id NUMBER DEFAULT 1 NOT NULL, skills CLOB NOT NULL, resume_text CLOB, preferred_contract VARCHAR2(10) DEFAULT 'both' NOT NULL, search_preferences CLOB, updated_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL, CONSTRAINT pk_user_profile PRIMARY KEY (id), CONSTRAINT chk_contract CHECK (preferred_contract IN ('b2b','uop','both')))` — use `EXECUTE IMMEDIATE` with `ORA-00955` guard (same pattern as existing tables)
- [ ] T060 [P] Configure pino structured logging in `apps/backend/src/index.ts` — run `pnpm --filter @pl-jobhunter/backend add -D pino-pretty`; replace `Fastify({ logger: true })` with `Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined } })`

**Checkpoint**: `UserProfile` type importable; `db:init` creates `user_profile` table; backend logs emit structured JSON in production mode.

---

## Phase 9: User Story 1 — Dynamic AI Profile Management (Priority: P1) 🎯

**Goal**: `GET /api/profile` + `PUT /api/profile` endpoints; React profile form; Ollama scorer reads profile from DB.

**Independent Test**: `quickstart.md` Scenarios P1a–P1d — write profile via API, read it back, confirm next ETL run uses DB profile; form persists across refresh.

### Implementation — US1

- [ ] T061 [US1] Create `apps/backend/src/routes/profile.ts` — Fastify plugin with `GET /api/profile` (SELECT from `user_profile` WHERE id=1; return row or `null`) and `PUT /api/profile` (validate: `skills` non-empty after whitespace-trim — `body.skills.filter(s => s.trim()).length === 0` → 400; validate `preferred_contract` enum; MERGE INTO user_profile; return updated row); add OpenAPI schema for both; protected by existing authHook
- [ ] T062 [P] [US1] Create `apps/backend/src/routes/profile.test.ts` — vitest tests with `vi.mock('../config/database.js')`: 200 GET returns profile; 200 GET returns null when no profile; 200 PUT upserts and returns updated profile; 400 PUT on empty skills array; 400 PUT on invalid preferred_contract; 401 without token
- [ ] T063 [P] [US1] Register `profileRoutes` in `apps/backend/src/index.ts` — import and `server.register(profileRoutes)` alongside existing `jobsRoutes`
- [ ] T064 [US1] Modify `apps/backend/src/ai/ollama.ts` — in `scoreJob()`, add `getProfileFromDb(): Promise<string>` helper that queries `SELECT skills, resume_text, preferred_contract, search_preferences FROM user_profile WHERE id=1`; build user profile string from result; fall back to `process.env.OLLAMA_USER_PROFILE` if no DB row; log which source was used
- [ ] T065 [P] [US1] Create `apps/frontend/src/hooks/useProfile.ts` — `useProfile()` hook: fetch `GET /api/profile` on mount with `X-API-TOKEN`; expose `profile: UserProfile | null`, `loading`, `error`, `updateProfile(data: Omit<UserProfile, 'updated_at'>): Promise<void>` (calls `PUT /api/profile`; optimistic update + rollback on error)
- [ ] T066 [P] [US1] Create `apps/frontend/src/api/client.ts` additions — add `getProfile(): Promise<UserProfile | null>` and `putProfile(data): Promise<UserProfile>` to existing client; inject `X-API-TOKEN` from `import.meta.env.VITE_API_TOKEN`
- [ ] T067 [US1] Create `apps/frontend/src/components/ProfileForm.tsx` — form with fields: skills (comma-separated textarea → splits to string[]), resume_text (textarea), preferred_contract (radio: b2b/uop/both), search_preferences (textarea); pre-populates from `useProfile`; Save button calls `updateProfile`; shows validation error if skills empty; shows success/error state after save
- [ ] T068 [US1] Update `apps/frontend/src/App.tsx` — add profile navigation tab/section; render `<ProfileForm />` when profile tab active; existing `<KanbanBoard />` remains default view

**Checkpoint**: `quickstart.md` P1a–P1d pass. Profile saves via UI, ETL reads from DB, form pre-populates on refresh.

---

## Phase 10: User Story 2 — Filtering, Search & Market Analytics (Priority: P2)

**Goal**: FilterBar with keyword/contract/salary/source controls; useFilter hook; AnalyticsWidget showing top 5 skills.

**Independent Test**: `quickstart.md` Scenarios P2a–P2g — apply each filter type individually and in combination; verify analytics widget updates; clear filters restores full board.

### Implementation — US2

- [ ] T069 [P] [US2] Create `apps/frontend/src/hooks/useFilter.ts` — `useFilter(jobs: JobWithAnalysis[])` hook: `FilterState` with `{ keyword: string, contractType: 'b2b'|'uop'|'both', salaryMin: number|null, salaryMax: number|null, source: 'justjoin'|'nofluff'|'both' }`; `filteredJobs` computed via `useMemo` with AND logic per `contracts/filter-state.md`; `topSkills: Array<{skill:string; count:number}>` aggregated from `filteredJobs` where `match_score >= 80`, top 5 by count; expose `setFilters(patch)` and `clearFilters()`
- [ ] T070 [P] [US2] Create `apps/frontend/src/components/FilterBar.tsx` — renders: text input for keyword (debounced 150ms); radio/select for contractType; two number inputs for salaryMin/salaryMax (PLN); radio/select for source; "Clear all filters" button; calls `setFilters()` / `clearFilters()` from `useFilter`; fully controlled (no local state — all state lives in hook)
- [ ] T071 [P] [US2] Create `apps/frontend/src/components/AnalyticsWidget.tsx` — receives `topSkills: Array<{skill:string;count:number}>`; renders ordered list of up to 5 skills with count badge; shows "No high-match jobs yet" when array is empty; no network calls (pure display component)
- [ ] T072 [US2] Update `apps/frontend/src/App.tsx` — instantiate `useFilter(jobs)` from `useJobs` result; pass `filteredJobs` to `KanbanBoard` instead of raw `jobs`; render `<FilterBar />` above the board; render `<AnalyticsWidget topSkills={topSkills} />` above FilterBar or in sidebar; implement T068 first (profile tab), then rebase this task on top to avoid App.tsx conflicts

**Checkpoint**: `quickstart.md` P2a–P2g pass. Filtering is instant, analytics updates reactively, clear resets board.

---

## Phase 11: User Story 3 — ETL Monitoring & Failure Alerts (Priority: P3)

**Goal**: Global ETL error catch; Telegram critical alert on fatal errors; structured logs with etl_run_id.

**Independent Test**: `quickstart.md` Scenarios P3a–P3d — structured JSON logs appear in production mode; simulated scraper 5xx triggers Telegram CRITICAL alert; Ollama failure remains warning + non-fatal; Telegram dispatch failure doesn't crash ETL.

### Implementation — US3

- [ ] T073 [P] [US3] Add two functions to `apps/backend/src/bot/telegram.ts` — (1) `sendCriticalAlert(source: string, err: Error): Promise<void>` sends `🚨 CRITICAL: ETL Pipeline Failed\nSource: ${source}\nError: ${err.message.slice(0, 200)}\nTime: ${new Date().toISOString()}`; (2) `sendOllamaWarning(jobId: string, err: Error): Promise<void>` sends `⚠️ WARNING: Ollama scoring failed\nJob: ${jobId}\nError: ${err.message.slice(0, 200)}\nJob persisted without score`; both functions catch and log Telegram dispatch errors (do NOT rethrow)
- [ ] T074 [US3] Refactor `apps/backend/src/scheduler/etl.ts` — (a) add top-level `import pino from 'pino'; const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })` (ETL runs as standalone script outside Fastify — do NOT use `fastify.log`); (b) generate `etl_run_id` via `crypto.randomUUID()` at start of `runEtl()`; include `{ etl_run_id }` in every `logger.*()` call; (c) wrap each scraper call in try/catch — on catch, call `sendCriticalAlert('justjoin'|'nofluff', err)` then abort + set `process.exitCode = 1` and return early; (d) wrap DB `mergeJob()` — on connection error, call `sendCriticalAlert('oracle', err)` then abort + return; (e) wrap `scoreJob()` — on null result or thrown error, call `sendOllamaWarning(job.id, err)`, persist job without score, continue loop; (f) wrap entire `runEtl()` body in outer try/catch as safety net — on unexpected error, call `sendCriticalAlert('etl-orchestrator', err)` then set exitCode 1
- [ ] T075 [P] [US3] Create `apps/backend/src/bot/telegram.test.ts` — vitest + msw: test `sendCriticalAlert` sends correct Telegram message format; test Telegram API 4xx/5xx does not throw (error swallowed + logged); test `sendJobAlert` still works for score >= threshold (regression)

**Checkpoint**: `quickstart.md` P3a–P3d pass. All fatal errors produce Telegram alerts. Ollama failure is a warning. Telegram failures never crash ETL. Logs are structured JSON.

---

## Phase 12: Polish & Cross-Cutting

- [ ] T076 [P] Run `pnpm --filter @pl-jobhunter/backend exec tsc --noEmit` — fix any type errors introduced by profile route, ollama.ts changes, etl.ts changes
- [ ] T077 [P] Run `pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit` — fix any type errors in FilterBar, AnalyticsWidget, ProfileForm, useFilter, useProfile, App.tsx
- [ ] T078 [P] Run `pnpm --filter @pl-jobhunter/backend run test` — all tests green (profile route tests + Telegram alert tests + existing 20 tests)
- [ ] T079 [P] Update `apps/backend/.env.example` — add `LOG_LEVEL=info` and `PINO_PRETTY=true` (dev hint) if not already present
- [ ] T080 [P] Run `quickstart.md` full validation — all P1–P4 scenarios pass against live backend + Oracle + Ollama
- [ ] T081 [P] Update `specs/002-production-readiness/tasks.md` — mark all completed boxes; verify no unchecked tasks remain

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 8** (Setup): No deps — start immediately after Phase 7 complete
- **Phase 9** (US1 — Profile): Depends on T058 (shared type) + T059 (DDL) + T060 (pino)
- **Phase 10** (US2 — Filtering): Depends on T058 (shared type) only; independent of Phase 9 except App.tsx wiring (T072 after T068)
- **Phase 11** (US3 — ETL Monitoring): Depends on T060 (pino) only; independent of Phases 9–10
- **Phase 12** (Polish): Depends on all Phases 8–11

### User Story Dependencies

- **US1 (P1)**: Blocked by T058+T059 (shared type + DDL)
- **US2 (P2)**: Blocked by T058 only (needs `UserProfile` type for `JobWithAnalysis` awareness); otherwise independent
- **US3 (P3)**: Blocked by T060 (pino) only; fully independent of US1 and US2

### Parallel Groups Within Phases

**Phase 8**: T058 → T059 → T060 (sequential — DDL depends on type existing; pino independent)
**Phase 9 (US1)**: T062+T063+T065+T066 parallel after T061; T067 after T065+T066; T068 after T067
**Phase 10 (US2)**: T069+T070+T071 all parallel; T072 after all three
**Phase 11 (US3)**: T073+T075 parallel; T074 after T073
**Phase 12**: T076+T077+T078+T079 all parallel; T080+T081 after

---

## Parallel Example: Phase 9 (US1)

```bash
# After T061 (profile.ts route) is done — launch in parallel:
Task T062: apps/backend/src/routes/profile.test.ts
Task T063: register profileRoutes in apps/backend/src/index.ts
Task T065: apps/frontend/src/hooks/useProfile.ts
Task T066: apps/frontend/src/api/client.ts additions

# Then sequentially:
Task T064: apps/backend/src/ai/ollama.ts DB profile read
Task T067: apps/frontend/src/components/ProfileForm.tsx  (after T065+T066)
Task T068: apps/frontend/src/App.tsx  (after T067)
```

---

## Implementation Strategy

### MVP First (User Story 1 — Profile Management)

1. Complete Phase 8 (T058–T060)
2. Complete Phase 9 (T061–T068)
3. **STOP and VALIDATE**: `quickstart.md` P1a–P1d pass
4. Proceed to Phase 10 or 11 independently

### Incremental Delivery

1. Phase 8 (Setup) → foundation ready for all three stories
2. Phase 9 (Profile) → ETL scoring personalized; form works in UI
3. Phase 10 (Filtering) → board usable at scale; analytics visible
4. Phase 11 (ETL Monitoring) → zero silent failures in production
5. Phase 12 (Polish) → all checks green; scenarios validated

### Parallel Strategy (if working concurrently)

After Phase 8 complete:
- Track A: Phase 9 (US1 — Profile) — backend routes + frontend form
- Track B: Phase 10 (US2 — Filtering) — pure frontend, no backend changes
- Track C: Phase 11 (US3 — ETL Monitoring) — backend only, no frontend changes

All three tracks are file-disjoint (except App.tsx — coordinate T068 + T072 merge).
