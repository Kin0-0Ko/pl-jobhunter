# Quickstart Validation: Feature 004

## Prerequisites
- Backend running locally or on VPS
- `.env` configured with valid `API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`
- `pnpm --filter @pl-jobhunter/shared build` run before type checks

---

## S1 — ETL runs with at least 1 job

```bash
docker exec pl-jobhunter-backend-1 node dist/scheduler/etl.js --run-once
# Expected: logs show "[ETL] Run complete" with inserted > 0
```

---

## S2 — ETL trigger endpoint

```bash
curl -X POST http://localhost:3000/api/etl/trigger \
  -H "X-API-TOKEN: $API_TOKEN"
# Expected: 202 { "status": "started", "pid": N }

curl http://localhost:3000/api/etl/trigger \
  # No token — Expected: 401
```

---

## S3 — New JobStatus values accepted

```bash
# Assuming job ID exists:
curl -X PATCH http://localhost:3000/api/jobs/nf-test-1 \
  -H "X-API-TOKEN: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "INTERVIEWING"}'
# Expected: 200 with updated job

curl -X PATCH http://localhost:3000/api/jobs/nf-test-1 \
  -H "X-API-TOKEN: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "OFFER"}'
# Expected: 200
```

---

## S4 — Kanban shows 7 columns

Open frontend URL. Expected: 7 columns visible: New, Liked, Applied, Interviewing, Offer, Rejected, Archived.

---

## S5 — Scan Market button

Click "⚡ Scan Market" in UI. Expected: spinner appears, button disabled, jobs refresh after ~10s.

---

## S6 — Telegram /status

Send `/status` to bot. Expected: reply with DB and Ollama status within 5s.

---

## S7 — Telegram /scrape

Send `/scrape` to bot. Expected: "ETL started in background" reply. After ~5 min, new jobs appear.

---

## S8 — TypeScript compiles clean

```bash
pnpm --filter @pl-jobhunter/shared build
pnpm --filter @pl-jobhunter/backend exec tsc --noEmit
pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit
# All exit 0
```

---

## S9 — Tests pass

```bash
pnpm --filter @pl-jobhunter/backend run test
# 32+ passed, 0 failed
```
