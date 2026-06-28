# Feature Specification: Scrapers, ETL Control & UI Enhancements

**Feature ID**: 004 | **Status**: IN_PROGRESS | **Date**: 2026-06-28

## Problem Statement

The app is live in production but returns no jobs because:
1. JustJoin.it killed their public `/api/offers` endpoint
2. NoFluffJobs `/api/search/posting` now requires session cookies + `salaryCurrency`/`salaryPeriod` query params (internal API, CORS-protected)
3. TheProtocol.it is Cloudflare-protected (403 without browser session)
4. No HTTP endpoint exists to trigger ETL manually
5. Telegram bot has no status or scrape commands
6. Kanban statuses (`NEW|FAVORITE|APPLIED|ARCHIVED`) don't match the desired hiring funnel (`NEW|FAVORITE|APPLIED|INTERVIEWING|OFFER|REJECTED|ARCHIVED`)

## User Stories

### US1 — Working Scrapers
As a user, I want the ETL pipeline to fetch real job listings so the Kanban board has data.

**Acceptance Criteria**:
- At least one scraper produces jobs on `--run-once`
- Jobs appear in Oracle DB after ETL run
- Failed scrapers log warning and continue (non-fatal) — ETL doesn't abort if one source is down

### US2 — ETL HTTP Trigger
As a user, I want to trigger a job scan from the web UI or curl without SSH access.

**Acceptance Criteria**:
- `POST /api/etl/trigger` returns 202 immediately
- ETL runs as background process (non-blocking)
- Endpoint is protected by `X-API-TOKEN`

### US3 — Telegram Bot Commands
As a user, I want `/status` and `/scrape` commands in Telegram.

**Acceptance Criteria**:
- `/status` reports: DB connectivity, Ollama reachability, last ETL timestamp
- `/scrape` triggers ETL in background and replies with "ETL started"

### US4 — Extended JobStatus + Kanban
As a user, I want a full hiring funnel on the Kanban board.

**Acceptance Criteria**:
- `JobStatus` includes: `NEW | FAVORITE | APPLIED | INTERVIEWING | OFFER | REJECTED | ARCHIVED`
- Kanban shows all 7 columns
- DB `status` column accepts new values (backwards-compatible: existing `NEW|FAVORITE|APPLIED|ARCHIVED` rows unaffected)
- `PATCH /api/jobs/:id` accepts new status values

### US5 — "Scan Market" Button
As a user, I want a button in the UI to trigger ETL and see a loading state.

**Acceptance Criteria**:
- Button calls `POST /api/etl/trigger`
- Shows spinner while waiting
- Refreshes job list after 10s (ETL duration estimate)
