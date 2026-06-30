# Quickstart: ETL Audit Fixes & Telegram Boost

**Feature**: 009-etl-audit-telegram-boost | **Date**: 2026-06-30

Validation guide — confirms all 6 fixes and 2 enhancements work end-to-end.

## Prerequisites

- Backend running locally or on VPS with Ollama available
- Telegram bot token + admin chat ID set in `.env`
- Oracle DB connected

---

## 1. Verify AI Output Quality Guard

**Trigger a job with a bad summary:**

```bash
# On VPS — check ai_analysis for any row where summary contains '<'
# Before fix this returns rows; after fix it should return 0
docker exec pl-jobhunter-backend-1 node -e "
const oracledb = require('oracledb');
// Quick sanity: query ai_analysis for summaries with '<'
"
```

**Simpler: check via API after ETL run:**
```bash
curl -H "x-api-token: $API_TOKEN" https://your-domain/api/jobs | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); \
  const bad=JSON.parse(d).filter(j=>j.summary?.includes('<')); \
  console.log('Bad summaries:', bad.length, bad.map(j=>j.summary))"
```

**Expected**: 0 jobs with `<` in summary after the fix.

---

## 2. Verify tech_stack Populated

```bash
curl -H "x-api-token: $API_TOKEN" https://your-domain/api/jobs | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); \
  const jobs=JSON.parse(d); \
  const withStack=jobs.filter(j=>Array.isArray(j.tech_stack)&&j.tech_stack.length>0); \
  console.log('Jobs with stack:', withStack.length, '/', jobs.length); \
  console.log('Example:', withStack[0]?.title, withStack[0]?.tech_stack)"
```

**Expected**: ≥ 80% of scored jobs have non-empty `tech_stack`.

---

## 3. Verify why_good Clean Storage

```bash
# After ETL run — no rows should have why_good = ' ' (single space)
curl -H "x-api-token: $API_TOKEN" https://your-domain/api/jobs | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); \
  const bad=JSON.parse(d).filter(j=>j.why_good===' '); \
  console.log('Whitespace why_good rows:', bad.length)"
```

**Expected**: 0 rows with whitespace-only `why_good`.

---

## 4. Verify Telegram Digest (end-of-run, not per-job)

1. Trigger ETL via `/scrape` in Telegram
2. Count Telegram messages received during the run
3. **Expected**: Exactly 2 messages total — immediate ACK + 1 post-run digest
4. Digest must contain: run stats line + at least 1 job entry (if new jobs exist)

**Sample expected digest:**
```
📊 ETL Run Complete
🕐 2026-06-30 14:00 UTC
📥 Fetched: 1532 | Filtered: 1452 | New: 48 | Scored: 48

🔥 Top New Jobs
1. Fullstack IoT Engineer @ Reply Polska
   💰 9k–13k PLN (UoP) · ⭐ 100
   🛠 React, Node.js
...
```

---

## 5. Verify /status Command

1. After ETL completes, send `/status` to bot
2. **Expected**: Same digest format as post-run message
3. Send `/status` before any ETL run (fresh backend restart)
4. **Expected**: "ℹ️ No ETL run recorded yet."

---

## 6. Verify /scrape Concurrency Guard

1. Send `/scrape` while ETL is already running (trigger two rapid /scrape commands)
2. **Expected**: Second command replies "⏳ ETL already running — please wait."

---

## 7. Verify Salary Anomaly Badge (Frontend)

1. Open the job board
2. Find a job with B2B salary 40–200 PLN (visible in RawJobsPage or board)
3. **Expected**: A `⚠ hourly?` badge appears next to the anomalous salary value
4. Find a job with normal salary (e.g. 15,000 PLN)
5. **Expected**: No badge

---

## 8. Verify tech_stack Badges on Job Cards

1. Open the job board after ETL fix is deployed
2. Open any scored job card
3. **Expected**: Pill badges below the summary (e.g. "React" "Node.js" "TypeScript")
4. Click card to open detail modal
5. **Expected**: Same badges visible in "Tech Stack" section

---

## 9. Verify Localhost Bind

On VPS (after docker-compose deploy):

```bash
# Should be connection refused — port not bound on host network
curl --connect-timeout 3 http://92.5.50.4:3000/ 
# Expected: curl: (7) Failed to connect

# Caddy should still proxy correctly
curl https://your-domain/api/jobs -H "x-api-token: $API_TOKEN"
# Expected: 200 JSON response
```
