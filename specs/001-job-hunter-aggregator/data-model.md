# Data Model: Job Hunter Aggregator

**Date**: 2026-06-27 | **Feature**: specs/001-job-hunter-aggregator

All types are canonical in `packages/shared/src/types.ts`. SQL schema is canonical in
`specs/001-job-hunter-aggregator/architecture-reference.md`.

---

## Entities

### Job

Represents a normalized vacancy record from either source.

| Field | Oracle Type | TS Type | Notes |
|---|---|---|---|
| `id` | `VARCHAR2(100) PK` | `string` | Source-specific stable ID |
| `title` | `VARCHAR2(255) NOT NULL` | `string` | Position title |
| `company` | `VARCHAR2(255) NOT NULL` | `string` | Company name |
| `url` | `VARCHAR2(500) NOT NULL` | `string` | Link to original posting |
| `source` | `VARCHAR2(50) NOT NULL` | `'justjoin' \| 'nofluff'` | Origin scraper |
| `salary_b2b_min` | `NUMBER` | `number \| null` | B2B monthly gross min (PLN) |
| `salary_b2b_max` | `NUMBER` | `number \| null` | B2B monthly gross max (PLN) |
| `salary_uop_min` | `NUMBER` | `number \| null` | UoP monthly gross min (PLN) |
| `salary_uop_max` | `NUMBER` | `number \| null` | UoP monthly gross max (PLN) |
| `currency` | `VARCHAR2(10) DEFAULT 'PLN'` | `string` | Currency code |
| `status` | `VARCHAR2(50) DEFAULT 'NEW'` | `JobStatus` | Workflow stage |
| `created_at` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | `string` (ISO) | Ingest time |

**State machine** for `status`:

```
NEW → FAVORITE → APPLIED → ARCHIVED
NEW → APPLIED
NEW → ARCHIVED
FAVORITE → APPLIED
FAVORITE → ARCHIVED
(any) → NEW  [reset allowed]
```

### AIAnalysis

AI-generated scoring record, 1:1 with Job via FK.

| Field | Oracle Type | TS Type | Notes |
|---|---|---|---|
| `job_id` | `VARCHAR2(100) PK FK→jobs.id` | `string` | References Job |
| `match_score` | `NUMBER NOT NULL` | `number` | 0–100 integer |
| `summary` | `CLOB NOT NULL` | `string` | 1–3 sentence AI summary |
| `tech_stack` | `CLOB NOT NULL` | `string[]` | JSON-serialized array stored as CLOB |
| `why_good` | `CLOB NOT NULL` | `string` | AI explanation of fit |

**Constraint**: `fk_job` CASCADE DELETE — deleting a Job removes its AIAnalysis.

### JobStatus (enum)

```
NEW       — freshly ingested, not yet reviewed
FAVORITE  — marked for closer review
APPLIED   — application submitted
ARCHIVED  — dismissed / not relevant
```

---

## Relationships

```
jobs (1) ──────── (0..1) ai_analysis
              CASCADE DELETE
```

One job may have zero AI analysis records (when Ollama was unavailable at ingest time).
The API join uses `LEFT OUTER JOIN` so jobs without analysis are still returned with null
score fields.

---

## Derived / Runtime Types

### JobWithAnalysis (API response shape)

Used exclusively in `GET /api/jobs` response — not stored.

```typescript
interface JobWithAnalysis extends Job {
  match_score: number | null;
  summary: string | null;
  tech_stack: string[] | null;
  why_good: string | null;
}
```

### OllamaScoreResult (internal)

Transient — parsed from Ollama response, mapped to AIAnalysis before persist.

```typescript
interface OllamaScoreResult {
  match_score: number;     // 0–100
  summary: string;
  tech_stack: string[];
  why_good: string;
}
```

---

## Validation Rules

| Field | Rule |
|---|---|
| `match_score` | Integer, 0 ≤ value ≤ 100; reject if outside range |
| `status` PATCH | Must be one of `NEW \| FAVORITE \| APPLIED \| ARCHIVED`; 400 otherwise |
| `tech_stack` | Stored as JSON string in CLOB; parse on read |
| `id` | Max 100 chars; source prefix not enforced but recommended (`jj-<id>`, `nf-<id>`) |
