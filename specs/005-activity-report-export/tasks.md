# Tasks: Activity Report Export

## TASK-501: Shared ActivityReport type
Status: DONE
Added `ActivityReport`/`ActivityReportTopMatch` to `packages/shared/src/types.ts`, exported from `index.ts`.

## TASK-502: Backend report route
Status: DONE
Implemented `GET /api/reports/activity` in `apps/backend/src/routes/reports.ts`.
Queries jobs+ai_analysis in last 2 months, aggregates totals, supports `?download=1`.
Registered in `apps/backend/src/index.ts`.

## TASK-503: Backend tests
Status: DONE
`apps/backend/src/routes/reports.test.ts` — empty range, aggregation, download header, auth. 4/4 passing.

## TASK-504: Frontend API client
Status: DONE
Added `downloadActivityReport()` to `apps/frontend/src/api/client.ts` (blob download via `<a>`).

## TASK-505: Frontend UI button
Status: DONE
Added "Download Report" button beside "Scan Market" button in `apps/frontend/src/App.tsx`.

## TASK-506: Spec check
Status: DONE
`pnpm -r build` (shared/backend/frontend) passes typecheck. `pnpm vitest run` in apps/backend: 7 files, 36 tests passed.
Commit hash: see git log after commit.
