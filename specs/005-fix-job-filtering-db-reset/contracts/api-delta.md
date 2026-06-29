# API Contract Delta: Fix Job Filtering & DB Reset

This feature has **no new API endpoints**. Existing endpoints are unchanged.

## Behavioral Changes (no contract break)

### GET /api/jobs

No schema change. `match_score` was already nullable via LEFT JOIN.

After this feature:
- Jobs that fail the pre-filter will never have an `ai_analysis` row → `match_score: null`
- Sorted last (ORDER BY match_score DESC NULLS LAST — unchanged)
- These jobs will appear in the feed with null scores unless frontend filters them

### No new endpoints

- `raw_jobs` table is internal to ETL pipeline only — not exposed via API in this feature.
- `--reset` is a CLI-only operation, no HTTP endpoint added.
