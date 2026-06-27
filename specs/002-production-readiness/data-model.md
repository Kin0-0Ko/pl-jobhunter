# Data Model: Production Readiness

**Date**: 2026-06-27 | **Plan**: [plan.md](plan.md)

---

## New Database Table: `user_profile`

Single-row table. `id` is always `1` (fixed). `PUT /api/profile` uses `MERGE INTO` upsert.

```sql
CREATE TABLE user_profile (
  id               NUMBER         DEFAULT 1    NOT NULL,
  skills           CLOB                        NOT NULL,  -- JSON array: ["TypeScript","Node.js",...]
  resume_text      CLOB,                                  -- freeform markdown/text
  preferred_contract VARCHAR2(10) DEFAULT 'both' NOT NULL, -- 'b2b' | 'uop' | 'both'
  search_preferences CLOB,                               -- freeform text
  updated_at       TIMESTAMP      DEFAULT SYSTIMESTAMP   NOT NULL,
  CONSTRAINT pk_user_profile PRIMARY KEY (id),
  CONSTRAINT chk_contract CHECK (preferred_contract IN ('b2b','uop','both'))
)
```

**Row lifecycle**: Inserted on first `PUT /api/profile`. Subsequent PUTs merge (update). `GET /api/profile` returns the single row or `null` if never set.

**Migration**: Added to `apps/backend/src/config/init-db.ts` alongside existing `jobs` + `ai_analysis` DDL. Graceful `CREATE TABLE IF NOT EXISTS` pattern (Oracle: `EXECUTE IMMEDIATE` with exception for `ORA-00955`).

---

## Updated Shared Type: `UserProfile`

Added to `packages/shared/src/types.ts`:

```typescript
export interface UserProfile {
  skills: string[];
  resume_text: string | null;
  preferred_contract: 'b2b' | 'uop' | 'both';
  search_preferences: string | null;
  updated_at: string; // ISO 8601
}
```

**Existing types unchanged**: `Job`, `AIAnalysis`, `JobStatus`, `JobWithAnalysis` — no modifications.

---

## Client-Side Filter State

Not persisted. Lives in `useFilter` React hook. Shape (for documentation purposes):

```typescript
interface FilterState {
  keyword: string;              // matches job.title or tech_stack (case-insensitive substring)
  contractType: 'b2b' | 'uop' | 'both';  // default: 'both'
  salaryMin: number | null;     // PLN; null = no lower bound
  salaryMax: number | null;     // PLN; null = no upper bound
  source: 'justjoin' | 'nofluff' | 'both';  // default: 'both'
}
```

**Filter combination logic** (AND):
- `keyword`: `job.title.toLowerCase().includes(kw)` OR `job.tech_stack?.some(t => t.toLowerCase().includes(kw))`
- `contractType === 'b2b'`: `job.salary_b2b_min !== null`
- `contractType === 'uop'`: `job.salary_uop_min !== null`
- `salaryMin/Max`: when `contractType === 'b2b'`, applies to `salary_b2b_min/max`; when `'uop'`, to `salary_uop_min/max`; when `'both'`, either range satisfies
- `source`: exact match on `job.source`

---

## Analytics Aggregation

Input: filtered `JobWithAnalysis[]` where `match_score >= 80`

Algorithm (client-side, O(n)):
1. For each qualifying job, parse `tech_stack` (already a `string[]` on `JobWithAnalysis`)
2. Count occurrences of each skill string (case-insensitive normalization)
3. Sort by count descending, take top 5
4. Output: `Array<{ skill: string; count: number }>` (max length 5)

Widget shows "No high-match jobs yet" when the input array is empty.

---

## ETL Monitoring: Log Schema

Structured pino log fields (JSON lines in production):

| Field | Type | Description |
|---|---|---|
| `level` | string | `'info'` \| `'warn'` \| `'error'` |
| `time` | number | Unix epoch ms |
| `msg` | string | Human-readable message |
| `etl_run_id` | string | UUID per ETL run (for correlation) |
| `jobs_fetched` | number | Total scraped (info log at end) |
| `jobs_inserted` | number | New rows merged |
| `jobs_scored` | number | Successfully scored |
| `error` | object | Serialized error (on warn/error logs) |

**Critical alert payload** (Telegram markdown):

```
🚨 CRITICAL: ETL Pipeline Failed
Source: <scraper name | 'oracle' | 'ollama'>
Error: <err.message, max 200 chars>
Time: <ISO timestamp>
```
