# Quickstart Validation Guide: Job Hunter Aggregator

**Purpose**: End-to-end validation scenarios to confirm the feature works after implementation.

---

## Prerequisites

- Oracle wallet files in `apps/backend/wallet/` (populated from Oracle Cloud Console)
- Ollama running locally: `ollama serve` + model pulled (`ollama pull qwen3:5b`)
- `apps/backend/.env` created from `.env.example` with real values
- `pnpm install` run from repo root

### Minimum `.env` for backend

```env
DB_USER=your_user
DB_PASSWORD=your_password
DB_CONNECTION_STRING=your_connection_string
TNS_ADMIN=./wallet
API_TOKEN=your_secret_token
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_chat_id
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:5b
OLLAMA_USER_PROFILE="Senior TypeScript developer, 5 years Node.js, interested in remote B2B roles in Poland"
ALERT_SCORE_THRESHOLD=80
```

---

## Scenario 0: Unit Tests (no wallet, no Ollama needed)

```bash
pnpm --filter @pl-jobhunter/backend run test
```

**Expected**: All vitest tests pass. Ollama HTTP calls are intercepted by msw — no real
Ollama process required. Output: `✓ N tests passed`.

```bash
pnpm --filter @pl-jobhunter/backend run test:coverage
```

**Expected**: Coverage report generated; key modules (ollama.ts, scrapers) > 80% line coverage.

---

## Scenario 0b: Swagger UI (dev mode)

Start backend: `pnpm --filter @pl-jobhunter/backend run dev`

Open `http://localhost:3000/docs` in browser.

**Expected**: Swagger UI renders with `GET /api/jobs` and `PATCH /api/jobs/:id` endpoints
documented. Auth header field visible. Requests executable from UI.

---

## Scenario 0c: Docker Build

```bash
docker build -t pl-jobhunter-backend ./apps/backend
```

**Expected**: Build completes in two stages; final image based on `node:22-alpine`.

```bash
docker compose up -d
```

**Expected**: `backend` and `ollama` containers start. Backend reachable at `http://localhost:3000`.
Ollama reachable at `http://localhost:11434`.

---

## Scenario 1: Database Schema Initialization

```bash
pnpm --filter @pl-jobhunter/backend run db:init
```

**Expected**: Console prints `[init-db] Created table: jobs` and `[init-db] Created table: ai_analysis`
(or "already exists" on re-run). Exit code 0.

**Edge case**: With empty `wallet/` dir, expect:
```
[init-db] WARNING: Could not connect to Oracle DB — wallet may be empty or credentials missing.
```
Exit code 0 still.

---

## Scenario 2: Manual ETL Trigger (single run)

```bash
pnpm --filter @pl-jobhunter/backend exec tsx src/scheduler/etl.ts --run-once
```

**Expected**:
- Console shows fetch log for JustJoin.it and NoFluffJobs
- Rows appear in `jobs` and `ai_analysis` Oracle tables
- Jobs with score ≥ 80 trigger a Telegram message to admin chat

**Verify in DB** (via any Oracle SQL client):
```sql
SELECT COUNT(*) FROM jobs;
SELECT COUNT(*) FROM ai_analysis;
```

**Verify Telegram**: Admin chat receives message with format:
```
🎯 New high-match job!
Senior TypeScript Developer @ Acme Corp
Score: 87/100
https://justjoin.it/offers/...
```

---

## Scenario 3: API Endpoints

Start backend: `pnpm --filter @pl-jobhunter/backend run dev`

### GET /api/jobs — authenticated

```bash
curl -H "X-API-TOKEN: your_secret_token" http://localhost:3000/api/jobs
```

**Expected**: JSON array of jobs, sorted by `match_score DESC`. HTTP 200.

### GET /api/jobs — unauthenticated

```bash
curl http://localhost:3000/api/jobs
```

**Expected**: HTTP 401, no body.

### PATCH /api/jobs/:id — valid status

```bash
curl -X PATCH \
  -H "X-API-TOKEN: your_secret_token" \
  -H "Content-Type: application/json" \
  -d '{"status":"FAVORITE"}' \
  http://localhost:3000/api/jobs/<job-id>
```

**Expected**: `{"id":"<job-id>","status":"FAVORITE"}`, HTTP 200.

### PATCH /api/jobs/:id — invalid status

```bash
curl -X PATCH \
  -H "X-API-TOKEN: your_secret_token" \
  -H "Content-Type: application/json" \
  -d '{"status":"INVALID"}' \
  http://localhost:3000/api/jobs/<job-id>
```

**Expected**: `{"error":"Invalid status value..."}`, HTTP 400.

---

## Scenario 4: Kanban Board UI

Start frontend: `pnpm --filter @pl-jobhunter/frontend run dev`

Open `http://localhost:5173` in browser.

**Validate**:
1. Board displays 4 columns: New, Favorite, Applied, Archived
2. Job cards appear in correct columns based on `status`
3. Cards sorted by `match_score` descending within each column
4. Each card shows: title, company, source badge, salary range, match score, link
5. Drag a card from "New" to "Favorite" → card moves immediately
6. Refresh page → card remains in "Favorite" column
7. Set `VITE_API_TOKEN` to wrong value → board shows error state, no data exposed

---

## Scenario 5: Scheduler 6h Cycle

```bash
pnpm --filter @pl-jobhunter/backend run start
```

**Validate**: Server starts, logs show cron job registered for 6-hour interval.
Let run for one cycle (or advance system clock); confirm new records appear without duplicates.

---

## Re-run Idempotency Check

Run ETL twice back-to-back:

```bash
pnpm --filter @pl-jobhunter/backend exec tsx src/scheduler/etl.ts --run-once
pnpm --filter @pl-jobhunter/backend exec tsx src/scheduler/etl.ts --run-once
```

**Expected**: `SELECT COUNT(*) FROM jobs` returns same count after both runs (no duplicates).
