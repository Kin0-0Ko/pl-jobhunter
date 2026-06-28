# Data Model: Scrapers, ETL Control & UI

## Changed Types

### `JobStatus` (packages/shared/src/types.ts)

```typescript
// Before
export type JobStatus = 'NEW' | 'FAVORITE' | 'APPLIED' | 'ARCHIVED';

// After
export type JobStatus = 'NEW' | 'FAVORITE' | 'APPLIED' | 'INTERVIEWING' | 'OFFER' | 'REJECTED' | 'ARCHIVED';
```

**DB impact**: Oracle `VARCHAR2(50)` — no schema change needed. Existing rows with old statuses remain valid.

**API impact**: `PATCH /api/jobs/:id` body validation must accept new values.

## No New Tables

No new Oracle tables. No migrations. Backwards-compatible.

## New API Shapes

### `POST /api/etl/trigger` — Response 202
```typescript
{
  status: 'started';
  pid: number;
}
```

### `GET /api/jobs` — unchanged
### `PATCH /api/jobs/:id` — body `{ status: JobStatus }` — union extended

## Kanban Column Order

```
NEW → FAVORITE → APPLIED → INTERVIEWING → OFFER → REJECTED → ARCHIVED
```

Visual label mapping:
| Value | Display Label |
|---|---|
| NEW | 🆕 New |
| FAVORITE | ❤️ Liked |
| APPLIED | 📨 Applied |
| INTERVIEWING | 🗣️ Interviewing |
| OFFER | 🎉 Offer |
| REJECTED | ❌ Rejected |
| ARCHIVED | 📦 Archived |
