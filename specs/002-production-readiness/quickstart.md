# Quickstart Validation Guide: Production Readiness

**Purpose**: End-to-end validation scenarios for the three new feature areas.

**Prerequisites**: All Phase 1–7 tasks complete. Backend running with Oracle wallet + `.env` populated. Ollama running locally.

---

## Scenario P1: Profile API (no wallet needed for unit tests)

### P1a — Unit tests pass

```bash
pnpm --filter @pl-jobhunter/backend run test
```

**Expected**: Profile route tests pass (200 GET, 200 PUT, 400 on empty skills, 401 without token). All 20+ existing tests still green.

### P1b — Live profile read/write

Start backend: `pnpm --filter @pl-jobhunter/backend run dev`

```bash
# Write profile
curl -X PUT \
  -H "X-API-TOKEN: your_token" \
  -H "Content-Type: application/json" \
  -d '{"skills":["TypeScript","React"],"preferred_contract":"b2b","resume_text":"5yr Node.js"}' \
  http://localhost:3000/api/profile

# Read it back
curl -H "X-API-TOKEN: your_token" http://localhost:3000/api/profile
```

**Expected**: PUT returns 200 with `updated_at` timestamp. GET returns same object.

### P1c — ETL uses DB profile

Confirm the next ETL run reads from DB (check logs for "Using profile from DB" vs "Using fallback env profile").

```bash
pnpm --filter @pl-jobhunter/backend exec tsx src/scheduler/etl.ts --run-once
```

**Expected**: Log line shows DB profile was used for Ollama prompt.

### P1d — Profile form UI

Start frontend: `pnpm --filter @pl-jobhunter/frontend run dev`

Open `http://localhost:5173`, navigate to Settings/Profile tab.

**Expected**:
1. Form loads pre-populated with saved profile values
2. Edit skills, click Save → success toast/indicator
3. Refresh page → changes persist (reads from backend)
4. Clear skills field, click Save → validation error appears, no save occurs

---

## Scenario P2: Filtering & Analytics

Start both backend and frontend.

### P2a — Keyword filter

**Expected**: Typing "React" instantly filters board to only jobs containing "React" in title or tech_stack. No network request fired.

### P2b — Contract type filter

**Expected**: Selecting "B2B only" hides all jobs without `salary_b2b_min`. Selecting "UoP only" hides all without `salary_uop_min`.

### P2c — Salary range filter

**Expected**: Setting min=15000 hides jobs where the active contract type salary is below 15000. Setting max=20000 hides jobs above 20000.

### P2d — Source filter

**Expected**: Selecting "JustJoin only" shows only `source='justjoin'` jobs. Selecting "NoFluff only" shows only `source='nofluff'`.

### P2e — Filter combination

**Expected**: With keyword "TypeScript" + B2B + min=12000 active simultaneously, only jobs matching ALL three criteria appear.

### P2f — Analytics widget

**Expected**: "Top 5 Skills" widget shows aggregated skill counts from visible jobs with `match_score >= 80`. Changing keyword filter updates the widget immediately. Empty state message appears when no high-match jobs match current filters.

### P2g — Clear filters

**Expected**: "Clear all filters" button restores full job board.

---

## Scenario P3: ETL Monitoring & Alerts

### P3a — Structured log format

```bash
pnpm --filter @pl-jobhunter/backend run dev 2>&1 | head -5
```

**Expected**: Log lines are newline-delimited JSON objects with `level`, `time`, `msg` fields (pino format).

### P3b — Simulated scraper failure

Temporarily modify `justjoin.ts` to throw `new Error('Simulated 500')` at the top of `fetchJustJoin`, then run ETL.

```bash
pnpm --filter @pl-jobhunter/backend exec tsx src/scheduler/etl.ts --run-once
```

**Expected**:
- Telegram admin chat receives: `🚨 CRITICAL: ETL Pipeline Failed` with error snippet within 30 seconds
- ETL exits with non-zero code
- Revert `justjoin.ts` after test

### P3c — Ollama failure (non-fatal)

Temporarily stop Ollama (`ollama stop` or kill process), then run ETL.

**Expected**:
- ETL continues running (does not crash)
- Jobs are inserted into DB without `ai_analysis` rows
- Log shows warnings for each skipped scoring
- A Telegram **warning** (not critical) is sent once Ollama is detected unavailable
- No `🚨 CRITICAL` alert fires (Ollama failure is non-fatal by spec)

### P3d — Telegram dispatch failure safety

Set `TELEGRAM_BOT_TOKEN` to an invalid value in `.env`, then trigger a simulated ETL error.

**Expected**:
- ETL does not crash due to Telegram failure
- Telegram error is logged at `error` level
- ETL sets non-zero exit code from the original ETL error, not from the Telegram failure
