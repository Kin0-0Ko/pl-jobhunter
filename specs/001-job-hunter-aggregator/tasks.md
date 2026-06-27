---
description: "Task list for Job Hunter Aggregator — regenerated with Swagger/vitest/Docker/CI"
---

# Tasks: Job Hunter Aggregator

**Input**: Design documents from `specs/001-job-hunter-aggregator/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅ | quickstart.md ✅

**Tests**: vitest unit tests requested for ollama.ts, scrapers, and route handlers.

**Organization**: Tasks grouped by phase; user story phases follow foundational tooling.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelizable — different files, no incomplete dependencies
- **[Story]**: User story label (US1–US4)
- Paths relative to repo root

## Path Conventions

- Backend: `apps/backend/src/`
- Frontend: `apps/frontend/src/`
- Shared: `packages/shared/src/`
- CI: `.github/workflows/`

---

## Phase 1: Setup (DONE)

- [x] T001 INFRA-101 — pnpm workspace + `packages/shared/src/types.ts` (Job, AIAnalysis, JobStatus)
- [x] T002 INFRA-102 — `apps/backend/src/config/database.ts` oracledb Thin Mode pool + `apps/backend/src/config/init-db.ts` schema runner

---

## Phase 2: Foundation (DONE)

- [x] T003 Add `fastify@5` + `@fastify/cors` to `apps/backend/package.json`; run `pnpm install`
- [x] T004 Create `apps/backend/src/index.ts` — Fastify server with CORS, global auth preHandler, `/health` route, lazy DB pool, graceful shutdown
- [x] T005 [P] Create `apps/backend/src/middleware/auth.ts` — preHandler checks `X-API-TOKEN` header vs `API_TOKEN` env; returns 401 if missing/invalid
- [x] T006 [P] Update `apps/backend/.env.example` with all 12 required vars

---

## Phase 2b: Dev Tooling (Swagger + vitest + Docker + CI)

**Purpose**: Cross-cutting infrastructure that all subsequent phases depend on for docs, testing, and deployment.

**⚠️ CRITICAL**: Complete before any route or scraper implementation.

- [x] T007 Add `@fastify/swagger` + `@fastify/swagger-ui` to `apps/backend/package.json` deps; run `pnpm install`
- [x] T008 Register Swagger plugins in `apps/backend/src/index.ts` — add `@fastify/swagger` (OpenAPI 3.0, title "PL-JobHunter API", version "1.0.0") and `@fastify/swagger-ui` (routePrefix `/docs`) before route registration; gate behind `process.env.NODE_ENV !== 'production'`
- [x] T009 [P] Add `vitest@2` + `@vitest/coverage-v8` + `msw@2` to `apps/backend/package.json` devDependencies; run `pnpm install`
- [x] T010 [P] Create `apps/backend/vitest.config.ts` — `defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } })`; add `"test": "vitest run"` and `"test:coverage": "vitest run --coverage"` scripts to `apps/backend/package.json`
- [x] T011 [P] Create `apps/backend/src/test-setup/server.ts` — msw `setupServer()` export with empty initial handlers; used by all test files that mock HTTP
- [x] T012 Create `apps/backend/Dockerfile` — stage 1 `builder`: `node:22-alpine`, copy workspace root + `apps/backend/` + `packages/shared/`, run `pnpm install --frozen-lockfile`, run `pnpm exec tsc`; stage 2 `runner`: `node:22-alpine`, copy `dist/` + prod node_modules, `CMD ["node","dist/index.js"]`
- [x] T013 [P] Create root `docker-compose.yml` — service `backend`: build `./apps/backend`, env_file `./apps/backend/.env`, volume `./apps/backend/wallet:/app/wallet:ro`, port `3000:3000`, depends_on `ollama`; service `ollama`: image `ollama/ollama`, volume `ollama_models:/root/.ollama`, port `11434:11434`; named volume `ollama_models`
- [x] T014 [P] Create `.github/workflows/ci.yml` — trigger on push/PR to `dev` + `main`; job `ci`: `ubuntu-latest`, Node 22, pnpm install, `tsc --noEmit` for backend + shared, `vitest run`; job `deploy` (on push to `main` only): docker buildx + push to GHCR (`ghcr.io/${{ github.repository }}/backend`), SSH into Oracle VPS (`docker compose pull && docker compose up -d backend`)

**Checkpoint**: `pnpm --filter @pl-jobhunter/backend run test` passes (0 test files = pass for now). `GET /docs` returns Swagger UI at `http://localhost:3000/docs`. `docker build ./apps/backend` succeeds.

---

## Phase 3: User Story 1 — View Scored Job Board (Priority: P1) 🎯 MVP

**Goal**: `GET /api/jobs` returns all jobs joined with AI analysis sorted by score; React Kanban board renders them in correct columns with auth guard.

**Independent Test**: `quickstart.md` Scenario 3 (GET /api/jobs) + Scenario 4 (board renders).

### Implementation — US1

- [x] T015 [P] [US1] Create `apps/backend/src/routes/jobs.ts` — `GET /api/jobs` handler: LEFT JOIN `jobs` + `ai_analysis` via `getPool()`, ORDER BY `match_score DESC NULLS LAST`, return `JobWithAnalysis[]`; add Fastify JSON schema for OpenAPI generation
- [x] T016 [P] [US1] Create `apps/backend/src/routes/jobs.test.ts` — vitest tests for `GET /api/jobs`: mock DB pool with vi.mock, assert 200 + sorted array; assert 401 when no token (via Fastify inject)
- [x] T017 [US1] Register `/api/jobs` router in `apps/backend/src/index.ts` — import and register jobs plugin
- [x] T018 [P] [US1] Scaffold `apps/frontend/package.json` — add `vite@6`, `react@19`, `react-dom@19`, `tailwindcss@4`, `@dnd-kit/core`, `@dnd-kit/sortable`; set `"type":"module"`; add `dev`, `build`, `preview` scripts
- [x] T019 [P] [US1] Create `apps/frontend/tsconfig.json` extending `../../tsconfig.base.json` with `"jsx":"react-jsx"`, `"outDir":"./dist"`, `"rootDir":"./src"`
- [x] T020 [P] [US1] Create `apps/frontend/vite.config.ts` — `@vitejs/plugin-react`, proxy `/api` → `VITE_API_BASE_URL` (default `http://localhost:3000`)
- [x] T021 [P] [US1] Create `apps/frontend/index.html` — Vite entry HTML with `<div id="root">` and `<script type="module" src="/src/main.tsx">`
- [x] T022 [P] [US1] Create `apps/frontend/src/api/client.ts` — typed fetch wrapper injecting `X-API-TOKEN` from `import.meta.env.VITE_API_TOKEN`; exports `getJobs(): Promise<JobWithAnalysis[]>` and `patchJobStatus(id: string, status: JobStatus): Promise<void>`
- [x] T023 [P] [US1] Create `apps/frontend/src/hooks/useJobs.ts` — fetches jobs on mount; exposes `jobs`, `loading`, `error`; `updateStatus(id, status)` with optimistic update + rollback on failure
- [x] T024 [US1] Create `apps/frontend/src/components/JobCard.tsx` — renders title, company, source badge (`justjoin` / `nofluff`), salary range (B2B / UoP), match score chip, external link; accepts `JobWithAnalysis` prop
- [x] T025 [US1] Create `apps/frontend/src/components/KanbanColumn.tsx` — column header + `JobCard` list for one `JobStatus`; accepts `status: JobStatus`, `jobs: JobWithAnalysis[]`
- [x] T026 [US1] Create `apps/frontend/src/components/KanbanBoard.tsx` — 4 `KanbanColumn` instances (NEW, FAVORITE, APPLIED, ARCHIVED) fed from `useJobs`; wraps in `@dnd-kit/core` `DndContext`
- [x] T027 [US1] Create `apps/frontend/src/components/ErrorState.tsx` — renders human-readable message on 401 / network error
- [x] T028 [US1] Create `apps/frontend/src/App.tsx` — renders `KanbanBoard`; shows `ErrorState` on auth/network failure
- [x] T029 [US1] Create `apps/frontend/src/main.tsx` — React root mount with `createRoot`; imports Tailwind base CSS
- [x] T030 [P] [US1] Create `apps/frontend/.env.example` — `VITE_API_TOKEN=` and `VITE_API_BASE_URL=http://localhost:3000`
- [x] T031 [P] [US1] Add `apps/frontend` to `pnpm-workspace.yaml`; run `pnpm install` from root

**Checkpoint**: `pnpm --filter @pl-jobhunter/frontend run dev` opens board; seeded DB rows appear in correct columns sorted by score; missing token shows error state. Route test passes.

---

## Phase 4: User Story 2 — Move Jobs Between Kanban Columns (Priority: P2)

**Goal**: Drag card between columns fires `PATCH /api/jobs/:id`; status persists on refresh.

**Independent Test**: `quickstart.md` Scenario 3 (PATCH) + Scenario 4 (drag validation).

### Implementation — US2

- [x] T032 [US2] Add `PATCH /api/jobs/:id` handler in `apps/backend/src/routes/jobs.ts` — validate `status` ∈ JobStatus (400 if not), UPDATE `jobs` table, return `{id, status}` (404 if not found); add OpenAPI schema
- [x] T033 [P] [US2] Add PATCH tests to `apps/backend/src/routes/jobs.test.ts` — 200 on valid status, 400 on invalid, 404 on unknown id, 401 without token
- [x] T034 [US2] Implement drag-and-drop in `apps/frontend/src/components/KanbanBoard.tsx` — `DragEndEvent` calls `updateStatus(id, newColumn)`; optimistic move + rollback on PATCH failure
- [x] T035 [P] [US2] Add `useDroppable` to `apps/frontend/src/components/KanbanColumn.tsx` via `@dnd-kit/core`
- [x] T036 [P] [US2] Add `useDraggable` to `apps/frontend/src/components/JobCard.tsx` via `@dnd-kit/core`

**Checkpoint**: Drag NEW → FAVORITE; refresh; card stays in FAVORITE. Network off → card snaps back. PATCH tests pass.

---

## Phase 5: User Story 3 — Automated Job Ingestion (Priority: P3)

**Goal**: node-cron fires ETL every 6h; both scrapers run in parallel; new jobs persisted + AI-scored; no duplicates on re-run.

**Independent Test**: `quickstart.md` Scenario 2 (manual ETL) + Scenario 5 (idempotency).

### Implementation — US3

- [x] T037 [P] [US3] Add `node-cron@3` to `apps/backend/package.json` deps; run `pnpm install`
- [x] T038 [P] [US3] Create `apps/backend/src/scrapers/justjoin.ts` — fetch `https://justjoin.it/api/offers`, map each offer to `Job` (`source='justjoin'`, id prefix `jj-`); extract salary from `employmentTypes[0]`; skip + log malformed records; export `fetchJustJoin(): Promise<Job[]>`
- [x] T039 [P] [US3] Create `apps/backend/src/scrapers/justjoin.test.ts` — msw intercepts `GET https://justjoin.it/api/offers`; asserts correct `Job` normalization for b2b + uop salary; asserts malformed record skipped
- [x] T040 [P] [US3] Create `apps/backend/src/scrapers/nofluff.ts` — POST `https://nofluffjobs.com/api/search/posting`, paginate until `totalPages` done; map to `Job` (`source='nofluff'`, id prefix `nf-`); map `salary.type` to b2b/uop; skip + log malformed; export `fetchNoFluff(): Promise<Job[]>`
- [x] T041 [P] [US3] Create `apps/backend/src/scrapers/nofluff.test.ts` — msw intercepts POST; asserts pagination consumed; asserts salary mapping correct
- [x] T042 [US3] Create `apps/backend/src/ai/ollama.ts` — POST `${OLLAMA_BASE_URL}/api/generate` with `format:"json"` and `OLLAMA_MODEL`; inject `OLLAMA_USER_PROFILE` into prompt; `JSON.parse` response; validate shape; retry once on failure; return `OllamaScoreResult | null`
- [x] T043 [P] [US3] Create `apps/backend/src/ai/ollama.test.ts` — msw intercepts `POST http://127.0.0.1:11434/api/generate`; test: valid response parsed; malformed JSON triggers retry; second failure returns null
- [x] T044 [US3] Create `apps/backend/src/scheduler/etl.ts` — `runEtl()`: `Promise.all([fetchJustJoin(), fetchNoFluff()])`; for each job: MERGE INTO `jobs` (skip if id exists); if inserted → call `scoreJob()`; if score returned → INSERT `ai_analysis`; if `match_score >= threshold` → call `sendJobAlert()`; handle DB unreachable (abort + fatal log); handle Ollama unavailable (persist job, skip analysis, warn log); export `runEtl`
- [x] T045 [US3] Register node-cron in `apps/backend/src/index.ts` — `cron.schedule('0 */6 * * *', runEtl)`; also support `--run-once` CLI flag (`process.argv.includes('--run-once')` → `runEtl().then(process.exit)`)
- [x] T046 [P] [US3] Add `"etl:run": "tsx src/scheduler/etl.ts --run-once"` and `"db:init": "tsx src/config/init-db.ts"` scripts to `apps/backend/package.json`

**Checkpoint**: `pnpm --filter @pl-jobhunter/backend run etl:run` inserts rows in both tables; re-run produces same count. All 4 test files pass.

---

## Phase 6: User Story 4 — Telegram Alerts (Priority: P4)

**Goal**: Every newly ingested job with `match_score >= ALERT_SCORE_THRESHOLD` sends Telegram message to admin chat.

**Independent Test**: `quickstart.md` Scenario 2 (Telegram dispatched) + score < threshold → no message.

### Implementation — US4

- [ ] T047 [P] [US4] Add `telegraf@4` to `apps/backend/package.json` deps; run `pnpm install`
- [ ] T048 [US4] Create `apps/backend/src/bot/telegram.ts` — `Telegraf` instance with `TELEGRAM_BOT_TOKEN`; export `sendJobAlert(job: Job, score: number): Promise<void>` calling `bot.telegram.sendMessage(TELEGRAM_ADMIN_CHAT_ID, msg)`; format: `🎯 ${title} @ ${company}\nScore: ${score}/100\n${url}`; catch + log errors, do not rethrow
- [ ] T049 [US4] Wire `sendJobAlert` into `apps/backend/src/scheduler/etl.ts` — call after successful `ai_analysis` INSERT when `match_score >= Number(process.env.ALERT_SCORE_THRESHOLD ?? 80)`

**Checkpoint**: `sendJobAlert` fires for score ≥ 80; no message for score < 80; Telegram API error logged but ETL continues.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T050 [P] Run `pnpm --filter @pl-jobhunter/backend exec tsc --noEmit` — fix all errors
- [ ] T051 [P] Run `pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit` — fix all errors
- [ ] T052 [P] Run `pnpm --filter @pl-jobhunter/backend run test` — all tests green; run `test:coverage`, verify ollama.ts + scrapers > 80% line coverage
- [ ] T053 Add `wallet/` and `.env` to `apps/backend/.gitignore`; verify no secrets tracked
- [ ] T054 Run `docker build -t pl-jobhunter-backend ./apps/backend` — confirm multi-stage build succeeds
- [ ] T055 Run `docker compose up -d` from repo root — confirm backend + ollama containers start; `curl localhost:3000/health` returns 200 with valid token
- [ ] T056 Run `quickstart.md` full validation — all 8 scenarios (0, 0b, 0c, 1–5) pass
- [ ] T057 [P] Update `specs/001-job-hunter-aggregator/tasks.md` — check all completed boxes; verify no unchecked tasks remain before tagging

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** (DONE): No deps
- **Phase 2** (DONE): Depends on Phase 1
- **Phase 2b** (T007–T014): Depends on Phase 2 — BLOCKS phases 3–7
- **US1 / Phase 3** (T015–T031): Depends on Phase 2b
- **US2 / Phase 4** (T032–T036): Depends on US1 (extends jobs.ts + KanbanBoard)
- **US3 / Phase 5** (T037–T046): Depends on Phase 2b; independent of US1/US2 except shared DB
- **US4 / Phase 6** (T047–T049): Depends on US3 (wires into etl.ts)
- **Polish / Phase 7** (T050–T057): Depends on all stories complete

### Parallel Groups Within Phases

**Phase 2b**: T009+T010+T011+T013+T014 parallel with T007→T008 sequential
**US1**: T018–T023+T030+T031 all parallel; T024→T025→T026 sequential
**US2**: T035+T036 parallel
**US3**: T038+T039+T040+T041 parallel; T042+T043 parallel (after scrapers)
**US4**: T047 parallel with T048→T049 sequential
**Polish**: T050+T051+T052+T053 parallel

---

## Parallel Example: Phase 2b

```bash
# Sequential first:
Task T007: add @fastify/swagger + @fastify/swagger-ui deps
Task T008: register in apps/backend/src/index.ts

# Then all parallel:
Task T009: add vitest + msw deps
Task T010: create apps/backend/vitest.config.ts
Task T011: create apps/backend/src/test-setup/server.ts
Task T013: create docker-compose.yml
Task T014: create .github/workflows/ci.yml

# Then:
Task T012: create apps/backend/Dockerfile (needs tsc output path confirmed)
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 2b (T007–T014) — tooling foundation
2. Phase 3 (T015–T031) — API route + React Kanban board
3. **STOP + VALIDATE**: board renders; GET /api/jobs returns data; vitest green; Swagger at /docs
4. Deploy: `docker compose up -d`; frontend to Vercel

### Incremental Delivery

1. Phase 2b → Phase 3 (US1) → validate → deploy MVP
2. Phase 4 (US2) → drag-and-drop → deploy
3. Phase 5 (US3) → ETL running → deploy
4. Phase 6 (US4) → Telegram alerts → deploy
5. Phase 7 → full validation → tag v1.0.0

---

## Notes

- `[P]` = different files, safe to implement in parallel
- `[Story]` = maps task to spec.md user story for traceability
- All tasks have exact file paths — no ambiguity
- Commit per task on `feat/T<ID>` branch; `--no-ff` merge to `dev` (Constitution V)
- vitest runs without wallet or Ollama — msw intercepts all HTTP
- Swagger UI only in `NODE_ENV !== 'production'` (Decision 8 in research.md)
