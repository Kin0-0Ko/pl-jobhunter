# Feature Specification: Activity Report Export (Last 2 Months)

**Feature ID**: 005 | **Status**: DONE | **Date**: 2026-10-06

## Problem Statement

User wants a summary report of job-hunt activity over the last 2 calendar months
(jobs scraped, status breakdown, applications, AI match stats) as a downloadable
JSON file from the web app. No such endpoint or UI control exists today.

## User Stories

### US1 — Report Generation Endpoint
As a user, I want the backend to compute a report of the last 2 months of job
activity on demand.

**Acceptance Criteria**:
- `GET /api/reports/activity` returns JSON body with:
  - `period.from`, `period.to` (ISO dates, 2 months back to now)
  - `generated_at`
  - `totals.jobs_scraped`, `totals.jobs_by_source`, `totals.jobs_by_status`
  - `totals.applied`, `totals.interviewing`, `totals.offers`, `totals.rejected`
  - `ai.avg_match_score`, `ai.top_matches` (top 10 by match_score, id/title/company/score)
- Only includes jobs where `created_at >= (now - 2 months)`
- Protected by `X-API-TOKEN` (reuses existing auth hook)
- Returns `200` with empty totals (zeros/empty arrays) when no jobs in range, not an error

### US2 — Downloadable JSON File
As a user, I want to download the report as a `.json` file from the web app.

**Acceptance Criteria**:
- `GET /api/reports/activity?download=1` sets
  `Content-Disposition: attachment; filename="activity-report-<YYYY-MM-DD>.json"`
- "Download Report" button in frontend (near existing "Scan Market" button)
  triggers browser download of the file, using the current date in filename
- No page navigation / no loss of Kanban board state when downloading

## Non-Goals
- No scheduling / emailing of reports
- No PDF/CSV export (JSON only)
- No historical report storage (computed on demand from `jobs`/`ai_analysis` tables)
