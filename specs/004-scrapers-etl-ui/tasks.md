---
description: "Task list for Scrapers, ETL Control & UI Enhancements"
---

# Tasks: Scrapers, ETL Control & UI Enhancements

**Input**: Design documents from `specs/004-scrapers-etl-ui/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | quickstart.md ✅

**Tests**: No new test files required. Existing 32 tests must remain green.

**Organization**: Tasks grouped by user story; IDs continue from `specs/003-security-hardening/tasks.md` (last ID: T104).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelizable — different files, no incomplete dependencies
- **[Story]**: User story label (US1–US5)
- Paths relative to repo root

## Path Conventions

- Backend: `apps/backend/src/`
- Frontend: `apps/frontend/src/`
- Shared: `packages/shared/src/`

---

## Phase 1: Foundational — JobStatus Extension (Priority: BLOCKS ALL)

**Purpose**: `JobStatus` type change must land in `packages/shared` FIRST per Constitution Principle II. All downstream tasks depend on this.

**Independent Test**: `pnpm --filter @pl-jobhunter/shared build` exits 0; `grep 'INTERVIEWING' packages/shared/src/types.ts` returns a match.

- [x] T105 Update `JobStatus` union in `packages/shared/src/types.ts` — add `'INTERVIEWING' | 'OFFER' | 'REJECTED'` to the existing `'NEW' | 'FAVORITE' | 'APPLIED' | 'ARCHIVED'` union; run `pnpm --filter @pl-jobhunter/shared build` and confirm exit 0
- [x] T106 Update `PATCH /api/jobs/:id` status validation in `apps/backend/src/routes/jobs.ts` — find the hardcoded status enum array (e.g., `['NEW','FAVORITE','APPLIED','ARCHIVED']`) and add `'INTERVIEWING'`, `'OFFER'`, `'REJECTED'`; confirm `pnpm --filter @pl-jobhunter/backend exec tsc --noEmit` exits 0

**Checkpoint**: Shared package builds. Backend accepts new status values. Existing tests still pass.

---

## Phase 2: User Story 1 — Working Scrapers (Priority: P1) 🎯

**Goal**: At least one scraper returns real jobs so ETL can populate the DB.

**Independent Test**: `docker exec pl-jobhunter-backend-1 node dist/scheduler/etl.js --run-once` logs `[ETL] Run complete` with `inserted > 0` and does NOT abort when one scraper fails.

### Implementation — US1

- [x] T107 [US1] Fix `apps/backend/src/scrapers/justjoin.ts` — replace dead `GET https://justjoin.it/api/offers` with `POST https://justjoin.it/api/offers-with-filters` using body `{ "page": 1, "pageSize": 100, "sortBy": "newest", "orderBy": "DESC", "with_filters": true }` and headers `{ "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }`; update `JJOffer` interface if response shape differs; keep existing mapping logic; wrap in try/catch returning `[]` on any error with `logger.warn`
- [x] T108 [P] [US1] Fix `apps/backend/src/scrapers/nofluff.ts` — add required headers to existing POST call: `"User-Agent": "Mozilla/5.0"`, `"Origin": "https://nofluffjobs.com"`, `"Referer": "https://nofluffjobs.com/"` and append query params `?salaryCurrency=PLN&salaryPeriod=month` to the URL; wrap entire function body in try/catch returning `[]` on any error with `logger.warn`
- [x] T109 [P] [US1] Create `apps/backend/src/scrapers/theprotocol.ts` — export `async function fetchTheProtocol(): Promise<Job[]>` that immediately returns `[]` and logs `logger.warn('theprotocol: skipped — Cloudflare protected, no lightweight API available')`; import `Job` from `@pl-jobhunter/shared`
- [x] T110 [US1] Refactor `apps/backend/src/scheduler/etl.ts` — replace the current fatal `Promise.all([fetchJustJoin(), fetchNoFluff()])` block (which calls `sendCriticalAlert` and `return` on any scraper error) with individual non-fatal fetches: call each scraper in sequence with `try/catch`, log `logger.warn` on failure, push results to `jobs` array, import and call `fetchTheProtocol()`; ETL must continue even if all scrapers return `[]` — log `[ETL] Run complete` with `inserted: 0` rather than aborting

**Checkpoint**: `--run-once` completes without abort. At least NoFluff or JustJoin returns jobs. Logs show `[ETL] Run complete`.

---

## Phase 3: User Story 2 — ETL HTTP Trigger (Priority: P1)

**Goal**: `POST /api/etl/trigger` returns 202 immediately and runs ETL in background.

**Independent Test**: `curl -X POST http://localhost:3000/api/etl/trigger -H "X-API-TOKEN: $API_TOKEN"` returns 202 `{ "status": "started", "pid": N }` within 200ms; ETL output appears in `docker compose logs backend` within 5s.

### Implementation — US2

- [x] T111 [US2] Create `apps/backend/src/routes/etl.ts` — export `async function etlRoutes(fastify: FastifyInstance)` with one route: `fastify.post('/api/etl/trigger', ...)` that uses `child_process.spawn('node', ['dist/scheduler/etl.js', '--run-once'], { detached: true, stdio: 'inherit' })`, calls `child.unref()`, and returns `reply.code(202).send({ status: 'started', pid: child.pid })`; add Fastify schema with `tags: ['etl']`, response 202 shape, and 500 error shape; wrap spawn in try/catch → 500 on failure
- [x] T112 [US2] Register `etlRoutes` in `apps/backend/src/index.ts` — import `etlRoutes` from `./routes/etl.js` and add `await server.register(etlRoutes)` after existing route registrations; confirm `pnpm --filter @pl-jobhunter/backend exec tsc --noEmit` exits 0

**Checkpoint**: `POST /api/etl/trigger` with valid token returns 202. Without token returns 401 (global authHook). `docker compose logs backend` shows ETL output ~5s after trigger.

---

## Phase 4: User Story 3 — Telegram Bot Commands (Priority: P2)

**Goal**: `/status` and `/scrape` commands active in Telegram.

**Independent Test**: Send `/status` to bot → reply within 5s with DB and Ollama status. Send `/scrape` → reply "ETL started in background".

### Implementation — US3

- [x] T113 [US3] Extend `apps/backend/src/bot/telegram.ts` — add `export async function startBot(): Promise<void>` that: (a) calls `getBot().command('status', async (ctx) => { ... })` — handler checks DB by calling `getPool()` with 3s timeout, checks Ollama by `fetch('http://127.0.0.1:11434/api/tags')` with 3s timeout, replies with formatted status string; (b) calls `getBot().command('scrape', async (ctx) => { ... })` — handler spawns `node dist/scheduler/etl.js --run-once` detached (same pattern as T111), replies "⚡ ETL started in background"; (c) calls `getBot().launch()` and returns; import `spawn` from `child_process` and `getPool` from `../config/database.js`
- [x] T114 [US3] Call `startBot()` in `apps/backend/src/index.ts` — import `startBot` from `./bot/telegram.js`; after `await server.listen(...)`, add `startBot().catch((err) => logger.error({ err }, 'telegram bot failed to start'))` (non-fatal — bot failure must not crash the server); confirm `pnpm --filter @pl-jobhunter/backend exec tsc --noEmit` exits 0

**Checkpoint**: Bot responds to `/status` and `/scrape`. Server starts normally even if `TELEGRAM_BOT_TOKEN` is unset.

---

## Phase 5: User Story 4 — Extended Kanban UI (Priority: P2)

**Goal**: 7-column Kanban board matching the full hiring funnel.

**Independent Test**: Open frontend URL → see 7 columns: New, Liked, Applied, Interviewing, Offer, Rejected, Archived. Drag a card to `INTERVIEWING` column → `PATCH /api/jobs/:id` called with `status: "INTERVIEWING"` → card stays in column on refresh.

### Implementation — US4

- [x] T115 [P] [US4] Update `apps/frontend/src/components/KanbanBoard.tsx` — change `STATUSES` array from `['NEW', 'FAVORITE', 'APPLIED', 'ARCHIVED']` to `['NEW', 'FAVORITE', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED']`; `JobStatus` import from `@pl-jobhunter/shared` already covers new values after T105
- [x] T116 [P] [US4] Update `apps/frontend/src/components/KanbanColumn.tsx` — add a `COLUMN_LABELS` map: `{ NEW: '🆕 New', FAVORITE: '❤️ Liked', APPLIED: '📨 Applied', INTERVIEWING: '🗣️ Interviewing', OFFER: '🎉 Offer', REJECTED: '❌ Rejected', ARCHIVED: '📦 Archived' }`; use `COLUMN_LABELS[status]` as the column header instead of the raw status string; confirm `pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit` exits 0

**Checkpoint**: Frontend compiles. 7 columns visible. Drag-and-drop to new columns works and persists.

---

## Phase 6: User Story 5 — Scan Market Button (Priority: P3)

**Goal**: UI button triggers ETL and shows loading state.

**Independent Test**: Click "⚡ Scan Market" → button disabled + spinner shown → after 10s jobs list refreshes → button re-enabled.

### Implementation — US5

- [x] T117 [US5] Add `triggerEtl()` to `apps/frontend/src/api/client.ts` — export `async function triggerEtl(): Promise<void>` that calls `fetch(\`${BASE_URL}/api/etl/trigger\`, { method: 'POST', headers: { 'X-API-TOKEN': API_TOKEN } })`; throw on non-2xx
- [x] T118 [US5] Add scanning state and button to `apps/frontend/src/App.tsx` — add `const [scanning, setScanning] = useState(false)`; add `async function handleScan() { setScanning(true); await triggerEtl(); setTimeout(() => { void refetch(); setScanning(false); }, 10000); }` where `refetch` is exposed from `useJobs`; render `<button onClick={handleScan} disabled={scanning}>{ scanning ? '⏳ Scanning…' : '⚡ Scan Market' }</button>` near the top of the layout; import `triggerEtl` from `./api/client.js`; confirm `pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit` exits 0
- [x] T119 [US5] Expose `refetch` from `apps/frontend/src/hooks/useJobs.ts` — add `refetch: () => void` to the `UseJobsResult` interface and return the internal fetch trigger function so `App.tsx` can call it after the 10s delay

**Checkpoint**: Button visible in UI. Click triggers 202 from backend. Spinner shows for 10s. Job list refreshes.

---

## Phase 7: Polish & Verification

**Purpose**: Compile checks, existing tests green, profile bug fix merged, docker-compose committed.

- [x] T120 Commit pending changes already on branch — `apps/backend/src/routes/profile.ts` (JSON.parse fix) + `docker-compose.yml` (ollama:latest) + `vercel.json` (proxy + output dir); run `pnpm --filter @pl-jobhunter/backend run test` → confirm 32+ passed
- [x] T121 [P] Run full type check: `pnpm --filter @pl-jobhunter/shared build && pnpm --filter @pl-jobhunter/backend exec tsc --noEmit && pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit` — all must exit 0; fix any errors introduced by T105–T119
- [x] T122 [P] Run `pnpm audit --audit-level=high` from repo root — must exit 0
- [x] T123 Update `specs/004-scrapers-etl-ui/tasks.md` — mark all completed task checkboxes; verify no unchecked tasks remain

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** (JobStatus extension): No deps — start immediately; BLOCKS T106, T115, T116
- **Phase 2** (Scrapers): No deps on Phase 1 — parallel with Phase 1
- **Phase 3** (ETL trigger): No deps — parallel with Phases 1–2
- **Phase 4** (Telegram): No deps — parallel with all above
- **Phase 5** (Kanban UI): Depends on T105 (JobStatus) for type safety; otherwise independent
- **Phase 6** (Scan button): Depends on T111 (ETL route) and T119 (refetch hook)
- **Phase 7** (Polish): After all phases complete

### Parallel Groups Within Phases

**Phase 2**: T107 → T108+T109 parallel → T110 (after all three)
**Phase 3**: T111 → T112
**Phase 4**: T113 → T114
**Phase 5**: T115+T116 parallel (different files)
**Phase 6**: T119 → T117+T118 parallel (T118 imports T117, but T119 is independent)
**Phase 7**: T120 → T121+T122 parallel → T123

---

## Parallel Example: Phase 2 (US1 — Scrapers)

```bash
# T107 sequentially first (justjoin interface may affect ETL):
Task T107: Fix justjoin.ts endpoint + response mapping

# Then in parallel:
Task T108: Fix nofluff.ts headers + query params
Task T109: Create theprotocol.ts stub

# Then sequentially:
Task T110: Refactor etl.ts non-fatal multi-source
```

---

## Implementation Strategy

### MVP Scope (P1 Stories — US1 + US2)

1. Complete Phase 1 (T105–T106) — JobStatus foundation
2. Complete Phase 2 (T107–T110) — Working scrapers
3. Complete Phase 3 (T111–T112) — ETL HTTP trigger
4. **STOP and VALIDATE**: Run ETL via `POST /api/etl/trigger`, confirm jobs in DB, confirm Kanban loads
5. Proceed to Phases 4–6 for P2/P3 features

### Full Delivery Order

P1: Phase 1 → Phase 2 → Phase 3
P2: Phase 4 (Telegram) + Phase 5 (Kanban UI) — parallel
P3: Phase 6 (Scan button)
Polish: Phase 7
