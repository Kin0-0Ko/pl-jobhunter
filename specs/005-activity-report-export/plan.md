# Implementation Plan: Activity Report Export

## Architecture

- New backend route `apps/backend/src/routes/reports.ts` — `GET /api/reports/activity`
  - Query: `jobs` + `ai_analysis` joined, filtered `created_at >= SYSDATE - INTERVAL '2' MONTH`
  - Aggregate in JS after fetch (small dataset, consistent with existing `jobs.ts` pattern)
  - `?download=1` → set `Content-Disposition` header, same JSON body
- New shared type `ActivityReport` in `packages/shared/src/types.ts`, exported from `index.ts`
- Register `reportsRoutes` in `apps/backend/src/index.ts` (same pattern as `etlRoutes`)
- Frontend: `getActivityReport()` + `downloadActivityReport()` in `apps/frontend/src/api/client.ts`
  - Download path: fetch blob, create `<a>` with `URL.createObjectURL`, click, revoke
- UI: "Download Report" button next to "Scan Market" button (find its component first)

## Files Touched

| File | Change |
|---|---|
| `packages/shared/src/types.ts` | add `ActivityReport` type |
| `packages/shared/src/index.ts` | export `ActivityReport` |
| `apps/backend/src/routes/reports.ts` | new route |
| `apps/backend/src/index.ts` | register route |
| `apps/frontend/src/api/client.ts` | add `downloadActivityReport()` |
| wherever "Scan Market" button lives | add "Download Report" button |

## Test Plan

- `apps/backend/src/routes/reports.test.ts` mirroring `jobs.test.ts` style:
  - empty range → zeroed totals, 200
  - jobs in range vs out of range filtering
  - `download=1` sets `Content-Disposition`
  - missing/invalid `X-API-TOKEN` → 401 (auth hook)
