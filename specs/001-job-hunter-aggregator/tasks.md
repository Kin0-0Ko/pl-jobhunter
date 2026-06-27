---
description: "Task list for Job Hunter Aggregator implementation"
---

# Tasks: Job Hunter Aggregator

**Input**: Design documents from `specs/001-job-hunter-aggregator/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅

**Tests**: Not requested — no test tasks generated.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Paths relative to repo root

## Path Conventions

- Backend source: `apps/backend/src/`
- Frontend source: `apps/frontend/src/`
- Shared types: `packages/shared/src/`

---

## Phase 1: Setup (Already Completed)

**Purpose**: Monorepo scaffold and Oracle DB connector — DONE per INFRA-101 + INFRA-102.

- [x] T001 INFRA-101 — pnpm workspace + `packages/shared/src/types.ts` (Job, AIAnalysis, JobStatus)
- [x] T002 INFRA-102 — `apps/backend/src/config/database.ts` oracledb Thin Mode pool + `apps/backend/src/config/init-db.ts` schema runner

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Fastify server entrypoint + auth middleware that ALL user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 Add Fastify + @fastify/cors dependencies to `apps/backend/package.json` and run `pnpm install`
- [ ] T004 Create Fastify server entrypoint `apps/backend/src/index.ts` — register plugins, auth hook, routes, start on `PORT` env var (default 3000)
- [ ] T005 [P] Create auth middleware `apps/backend/src/middleware/auth.ts` — Fastify preHandler that reads `X-API-TOKEN` header and returns 401 if missing or not equal to `API_TOKEN` env var
- [ ] T006 [P] Update `apps/backend/.env.example` with all required vars: `DB_USER`, `DB_PASSWORD`, `DB_CONNECTION_STRING`, `TNS_ADMIN`, `API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_USER_PROFILE`, `ALERT_SCORE_THRESHOLD`

**Checkpoint**: `pnpm --filter @pl-jobhunter/backend run dev` starts Fastify; unauthenticated `GET /` returns 401.

---

## Phase 3: User Story 1 — View Scored Job Board (Priority: P1) 🎯 MVP

**Goal**: `GET /api/jobs` returns all jobs joined with AI analysis sorted by score; frontend Kanban board renders them in correct columns.

**Independent Test**: See `quickstart.md` Scenario 3 (GET /api/jobs) + Scenario 4 (board renders).

### Implementation for User Story 1

- [ ] T007 [P] [US1] Create jobs repository `apps/backend/src/routes/jobs.ts` — implement `GET /api/jobs` handler: LEFT JOIN `jobs` + `ai_analysis`, ORDER BY `match_score DESC NULLS LAST`, return `JobWithAnalysis[]`
- [ ] T008 [US1] Register jobs router in `apps/backend/src/index.ts` — mount at `/api/jobs` with auth preHandler applied globally
- [ ] T009 [P] [US1] Scaffold frontend package `apps/frontend/package.json` — add vite, react, react-dom, tailwindcss, @dnd-kit/core, @dnd-kit/sortable; set `"type": "module"`
- [ ] T010 [P] [US1] Create `apps/frontend/tsconfig.json` extending `../../tsconfig.base.json` with `"jsx": "react-jsx"`
- [ ] T011 [P] [US1] Configure Vite `apps/frontend/vite.config.ts` — React plugin, proxy `/api` to `VITE_API_BASE_URL`
- [ ] T012 [P] [US1] Create typed API client `apps/frontend/src/api/client.ts` — fetch wrapper that injects `X-API-TOKEN` from `import.meta.env.VITE_API_TOKEN`; exports `getJobs(): Promise<JobWithAnalysis[]>` and `patchJobStatus(id, status): Promise<void>`
- [ ] T013 [P] [US1] Create `apps/frontend/src/hooks/useJobs.ts` — fetches jobs on mount, exposes `jobs`, `loading`, `error` state; provides `updateStatus(id, status)` with optimistic update + rollback on failure
- [ ] T014 [US1] Create `apps/frontend/src/components/JobCard.tsx` — renders title, company, source badge, salary range (B2B / UoP), match score chip, link to posting; accepts `JobWithAnalysis` prop
- [ ] T015 [US1] Create `apps/frontend/src/components/KanbanColumn.tsx` — renders column header + list of `JobCard` components for a given `JobStatus`; accepts `status`, `jobs[]` props
- [ ] T016 [US1] Create `apps/frontend/src/components/KanbanBoard.tsx` — renders 4 `KanbanColumn` instances (NEW, FAVORITE, APPLIED, ARCHIVED); distributes jobs from `useJobs` hook; integrates `@dnd-kit/core` DndContext
- [ ] T017 [US1] Create `apps/frontend/src/components/ErrorState.tsx` — displayed when API returns 401 or network error; shows human-readable message
- [ ] T018 [US1] Create `apps/frontend/src/App.tsx` — renders `KanbanBoard`; wraps with `ErrorState` on auth failure
- [ ] T019 [US1] Create `apps/frontend/src/main.tsx` — React root mount; import Tailwind base CSS
- [ ] T020 [P] [US1] Add `apps/frontend/.env.example` with `VITE_API_TOKEN=` and `VITE_API_BASE_URL=http://localhost:3000`

**Checkpoint**: Board loads at `http://localhost:5173`; seeded jobs appear in correct columns sorted by score; 401 error state shown when token wrong.

---

## Phase 4: User Story 2 — Move Jobs Between Kanban Columns (Priority: P2)

**Goal**: Drag-and-drop card between columns fires `PATCH /api/jobs/:id`; status persists on refresh.

**Independent Test**: See `quickstart.md` Scenario 3 (PATCH endpoint) + Scenario 4 (drag validation).

### Implementation for User Story 2

- [ ] T021 [US2] Add `PATCH /api/jobs/:id` route in `apps/backend/src/routes/jobs.ts` — validate `status` is valid `JobStatus` value (400 if not), UPDATE `jobs` table, return `{id, status}` (404 if row not found)
- [ ] T022 [US2] Implement drag-and-drop in `apps/frontend/src/components/KanbanBoard.tsx` — use `@dnd-kit/core` `DragEndEvent` to call `updateStatus(id, newStatus)`; card moves optimistically; snaps back on PATCH failure
- [ ] T023 [P] [US2] Add drag handle + droppable zone styling in `apps/frontend/src/components/KanbanColumn.tsx` using `@dnd-kit/sortable` `useDroppable`
- [ ] T024 [P] [US2] Add drag source to `apps/frontend/src/components/JobCard.tsx` using `@dnd-kit/sortable` `useDraggable`

**Checkpoint**: Drag card from NEW → FAVORITE; refresh; card remains in FAVORITE; drag with network off → card snaps back.

---

## Phase 5: User Story 3 — Automated Job Ingestion via Scheduler (Priority: P3)

**Goal**: node-cron triggers ETL every 6 hours; new jobs from both sources persisted + AI-scored; no duplicates.

**Independent Test**: See `quickstart.md` Scenario 2 (manual ETL trigger) + Scenario 5 (idempotency).

### Implementation for User Story 3

- [ ] T025 [P] [US3] Add scraper + AI + cron deps to `apps/backend/package.json`: `node-cron`, `node-fetch` (or use built-in `fetch` on Node 22)
- [ ] T026 [P] [US3] Create JustJoin.it scraper `apps/backend/src/scrapers/justjoin.ts` — fetch `https://justjoin.it/api/offers`, map each offer to `Job` type (`source='justjoin'`; id prefixed `jj-`; extract salary from `employmentTypes[0]`; skip malformed records with per-record log)
- [ ] T027 [P] [US3] Create NoFluffJobs scraper `apps/backend/src/scrapers/nofluff.ts` — POST `https://nofluffjobs.com/api/search/posting`, paginate until `totalPages` exhausted, map each posting to `Job` type (`source='nofluff'`; id prefixed `nf-`; map `salary.type` to b2b/uop fields; skip malformed with log)
- [ ] T028 [US3] Create Ollama AI scorer `apps/backend/src/ai/ollama.ts` — POST to `OLLAMA_BASE_URL/api/generate` with `format:"json"`, inject `OLLAMA_USER_PROFILE` into prompt template from `contracts/ollama-prompt.md`; parse + validate response; retry once on failure; return `OllamaScoreResult | null`
- [ ] T029 [US3] Create ETL orchestrator `apps/backend/src/scheduler/etl.ts` — runs both scrapers in parallel (`Promise.all`); for each new job: MERGE INTO `jobs` (skip if id exists); if inserted, call Ollama scorer; if score returned, insert into `ai_analysis`; if `match_score >= ALERT_SCORE_THRESHOLD`, call Telegram dispatcher; handle DB unreachable (abort + log fatal); handle Ollama unavailable (persist job, skip analysis, log warning)
- [ ] T030 [US3] Register node-cron job in `apps/backend/src/index.ts` — schedule ETL every 6 hours (`0 */6 * * *`); also expose `--run-once` CLI flag for manual trigger (check `process.argv`)
- [ ] T031 [P] [US3] Add `db:init` and `etl:run` scripts to `apps/backend/package.json`

**Checkpoint**: `pnpm --filter @pl-jobhunter/backend exec tsx src/scheduler/etl.ts --run-once` inserts rows in both tables; re-run produces same count (no duplicates).

---

## Phase 6: User Story 4 — Telegram Alert for High-Score Jobs (Priority: P4)

**Goal**: Every newly ingested job with `match_score >= 80` sends Telegram message to admin chat.

**Independent Test**: See `quickstart.md` Scenario 2 (Telegram message dispatched for high-score job).

### Implementation for User Story 4

- [ ] T032 [P] [US4] Add `telegraf` dependency to `apps/backend/package.json` and run `pnpm install`
- [ ] T033 [US4] Create Telegram dispatcher `apps/backend/src/bot/telegram.ts` — instantiate `Telegraf` with `TELEGRAM_BOT_TOKEN`; export `sendJobAlert(job: Job, score: number): Promise<void>` that calls `bot.telegram.sendMessage(TELEGRAM_ADMIN_CHAT_ID, message)`; format: title, company, score, URL; catch and log errors without rethrowing
- [ ] T034 [US4] Wire `sendJobAlert` into ETL orchestrator `apps/backend/src/scheduler/etl.ts` — call after successful AI analysis insert when `match_score >= Number(process.env.ALERT_SCORE_THRESHOLD ?? 80)`

**Checkpoint**: Insert job manually with `match_score=85`; `sendJobAlert` sends Telegram message; insert with score 60 → no message.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T035 [P] Add `apps/frontend` to `pnpm-workspace.yaml` if not already included; run `pnpm install` from root
- [ ] T036 [P] Add `"build": "vite build"` and `"preview": "vite preview"` scripts to `apps/frontend/package.json`; add `"build": "pnpm -r build"` to root `package.json`
- [ ] T037 [P] Create `apps/frontend/index.html` Vite entry HTML with `<div id="root">` and script import
- [ ] T038 Run `pnpm --filter @pl-jobhunter/backend exec tsc --noEmit` and `pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit`; fix all TypeScript errors
- [ ] T039 [P] Add `wallet/` to `apps/backend/.gitignore`; verify `.env` files not tracked
- [ ] T040 Run `quickstart.md` full end-to-end validation; confirm all 5 scenarios pass
- [ ] T041 Run `pnpm spec:check`; confirm INFRA-101 and INFRA-102 show DONE; update remaining task statuses in `.specify/tasks/02_tasks.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Complete ✅
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — no dependency on US2/US3/US4
- **US2 (Phase 4)**: Depends on US1 (`PATCH` route extends jobs.ts; DnD extends KanbanBoard)
- **US3 (Phase 5)**: Depends on Foundational — independent of US1/US2 except shared DB
- **US4 (Phase 6)**: Depends on US3 (wires into ETL orchestrator)
- **Polish (Phase 7)**: Depends on all user stories complete

### Within Each User Story

- Backend route → before frontend integration
- Models/DB access → before service layer
- Service → before endpoint handler
- Endpoint → before frontend hook
- Hook → before component consuming it

### Parallel Opportunities

- T005 (auth middleware) + T006 (.env.example) — parallel in Phase 2
- T009–T013 (frontend scaffold + types) — all parallel in Phase 3
- T026 (JustJoin scraper) + T027 (NoFluffJobs scraper) — parallel in Phase 5
- T023 + T024 (DnD column + card) — parallel in Phase 4
- T035–T037 + T039 (polish housekeeping) — parallel in Phase 7

---

## Parallel Example: User Story 3

```bash
# Launch scrapers in parallel (independent files):
Task: "JustJoin.it scraper in apps/backend/src/scrapers/justjoin.ts"  # T026
Task: "NoFluffJobs scraper in apps/backend/src/scrapers/nofluff.ts"   # T027
# Then sequentially:
Task: "Ollama scorer in apps/backend/src/ai/ollama.ts"                # T028 (after T026/T027 define Job shape)
Task: "ETL orchestrator in apps/backend/src/scheduler/etl.ts"         # T029 (after T026-T028)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T003–T006)
2. Complete Phase 3: US1 (T007–T020)
3. **STOP and VALIDATE**: `GET /api/jobs` returns data; board renders in browser
4. Deploy backend to VPS; deploy frontend to Vercel

### Incremental Delivery

1. Phase 2 → Phase 3 (US1) → Validate board renders → Deploy MVP
2. Phase 4 (US2) → Validate drag-and-drop persists → Deploy
3. Phase 5 (US3) → Validate ETL runs + no duplicates → Deploy
4. Phase 6 (US4) → Validate Telegram alert → Deploy
5. Phase 7 → Full quickstart.md validation → Tag v1.0.0

---

## Notes

- `[P]` tasks operate on different files — safe to implement simultaneously
- `[Story]` label maps task to spec.md user story for traceability
- All tasks reference exact file paths — no ambiguity about where code goes
- Commit after each task or logical group; branch per task per Constitution Principle V
- Run `pnpm spec:check` after every task completion
- No automated test suite in v1 — validate via `quickstart.md` scenarios
