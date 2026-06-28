# Research: Scrapers, ETL Control & UI

## Scraper API Status (verified 2026-06-28)

### JustJoin.it
- **Dead**: `GET /api/offers` → 404
- **HTML scraping**: `GET https://justjoin.it` → 200 but no `__NEXT_DATA__` script tag (Next.js client-only render, data loaded via XHR)
- **Decision**: Use `https://justjoin.it/api/offers-with-filters` (undocumented but active internal endpoint used by the SPA) with `POST` and JSON body. Fallback: skip JustJoin, log warning.
- **Rationale**: Public API killed. Internal API still serves the SPA. No cheerio needed — pure JSON fetch.

### NoFluffJobs
- **Endpoint**: `POST https://nofluffjobs.com/api/search/posting` with query params `salaryCurrency=PLN&salaryPeriod=month`
- **Status**: Requires `Origin: https://nofluffjobs.com` + `Referer` headers. Returns 400 without `salaryCurrency`/`salaryPeriod`, 500 with them (CORS/session enforcement changed)
- **Decision**: Wrap existing scraper in try/catch, add required headers. If 4xx/5xx, log warning and return empty array (non-fatal). Current scraper code already exists — just needs header fix.
- **Rationale**: API is CORS-protected. Without a valid session cookie it will keep returning errors. Non-fatal approach keeps ETL running for other sources.

### TheProtocol.it
- **Status**: 403 Cloudflare behind all endpoints without browser fingerprint
- **Decision**: Skip for now. Add as a stub that returns `[]` with a warning log. Can be revisited with RSS feed or job board aggregator.
- **Rationale**: No lightweight HTTP approach bypasses Cloudflare JS challenge without headless browser (forbidden by constraints).

## Scraper Strategy: Non-Fatal Multi-Source

Each scraper is wrapped independently:
```
[justjoin fetch] → catch → log warn → []
[nofluff fetch]  → catch → log warn → []
[theprotocol]    → returns [] immediately (stub)
```
ETL continues with whatever jobs were fetched. If all fail, ETL logs 0 jobs and exits cleanly.

**This replaces the current fatal `Promise.all` abort behaviour in `runEtl()`.**

## ETL Trigger Endpoint

- **Pattern**: `POST /api/etl/trigger` → spawn `node dist/scheduler/etl.js --run-once` as detached child process via Node.js `child_process.spawn`
- **Response**: 202 `{ "status": "started", "pid": N }`
- **Non-blocking**: child process inherits stdio to container logs, parent returns immediately
- **Rationale**: Avoids blocking Fastify event loop. ETL can take 2–10 min on 1 GB VPS.

## Telegram Bot Commands

- **Pattern**: `bot.command('status', handler)` + `bot.command('scrape', handler)` in `telegram.ts`
- **Bot launch**: `bot.launch()` must be called in `index.ts` after server starts
- **Decision**: Add `startBot()` export to `telegram.ts`, call from `index.ts`
- **Rationale**: Current bot is send-only (no `launch()`). Commands require polling loop.

## JobStatus Extension

Current: `'NEW' | 'FAVORITE' | 'APPLIED' | 'ARCHIVED'`
New: `'NEW' | 'FAVORITE' | 'APPLIED' | 'INTERVIEWING' | 'OFFER' | 'REJECTED' | 'ARCHIVED'`

- `packages/shared/src/types.ts` — update union type
- `init-db.ts` — Oracle `VARCHAR2(50)` column already accepts any string, no ALTER needed
- `PATCH /api/jobs/:id` — remove hardcoded status enum validation OR update it
- Frontend `KanbanBoard.tsx` — add 3 new columns

## JustJoin Internal API Research

Endpoint found via browser DevTools on justjoin.it:
`POST https://justjoin.it/api/offers-with-filters`

Body:
```json
{
  "page": 1,
  "pageSize": 100,
  "sortBy": "newest",
  "orderBy": "DESC",
  "with_filters": true
}
```

Headers needed: `Content-Type: application/json`, `User-Agent: Mozilla/5.0`

**Note**: This is an undocumented internal API. May break without notice. Treat as best-effort.
