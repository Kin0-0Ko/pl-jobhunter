# Data Model: Fix Job Filtering & DB Reset

## Entities

### raw_jobs (new table)

Staging table. All scraped jobs land here before filtering.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | VARCHAR2(100) | PRIMARY KEY | Same ID format as jobs (e.g., `jj-<guid>`) |
| title | VARCHAR2(255) | NOT NULL | |
| company | VARCHAR2(255) | NOT NULL | |
| url | VARCHAR2(500) | NOT NULL | |
| source | VARCHAR2(50) | NOT NULL | justjoin / nofluff / rocketjobs |
| description | CLOB | nullable | Populated when scrapers provide it (future) |
| salary_b2b_min | NUMBER | nullable | |
| salary_b2b_max | NUMBER | nullable | |
| salary_uop_min | NUMBER | nullable | |
| salary_uop_max | NUMBER | nullable | |
| currency | VARCHAR2(10) | DEFAULT 'PLN' | |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

**No FK constraints.** No `status` column (raw_jobs has no workflow state).

---

### jobs (schema delta)

Adds `description CLOB` column. All existing columns unchanged.

| Column | Type | Change |
|---|---|---|
| description | CLOB | **NEW** — nullable, populated when available |

---

### Job (shared TypeScript type — `packages/shared/src/types.ts`)

Adds optional field:

```ts
description?: string;   // NEW — job body text when available from scraper
```

---

### user_profile (unchanged schema)

No schema changes. Added: **seed behavior on `--reset`** — if no row exists after tables are recreated, insert default row:

```json
{
  "id": 1,
  "skills": ["TypeScript","JavaScript","Node.js","NestJS","Express.js","React","Next.js","Redux","PostgreSQL","MongoDB","Redis","RabbitMQ","TypeORM","AWS","Docker","GitHub Actions","CI/CD"],
  "preferred_contract": "b2b",
  "resume_text": null,
  "search_preferences": null
}
```

---

## ETL State Transitions

```
scraped Job
    │
    ▼
MERGE → raw_jobs        ← all jobs, always
    │
    ▼
isRelevantJob()?
    │
    ├─ NO  → stop (job stays in raw_jobs only)
    │
    └─ YES → MERGE → jobs
                 │
                 ▼
             scoreJob() via Ollama
                 │
                 ├─ null/error → log warning, skip ai_analysis
                 │
                 └─ result → MERGE → ai_analysis
                                  │
                                  └─ match_score ≥ threshold → Telegram alert
```

---

## Pre-filter Keyword List

Defined as a constant in `apps/backend/src/ai/ollama.ts`:

```ts
const PROFILE_KEYWORDS = [
  'typescript', 'javascript', 'node.js', 'nodejs', 'nestjs', 'nest',
  'express', 'react', 'next.js', 'nextjs', 'redux',
  'postgresql', 'postgres', 'mongodb', 'mongo', 'redis',
  'rabbitmq', 'typeorm', 'aws', 'docker',
  'github actions', 'ci/cd', 'cicd',
  'fullstack', 'full-stack', 'full stack',
  'backend', 'frontend', 'devops',
  'software engineer', 'software developer', 'web developer', 'developer',
];
```

Match is case-insensitive against `job.title`. Minimum 1 match = pass.
