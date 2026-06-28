# Architecture Reference: SP-01

> Migrated from `.specify/specs/01_architecture.md` on 2026-06-27.
> This document records decisions already implemented in INFRA-101 and INFRA-102.

## System Topology

- Monorepo Engine: `pnpm` workspaces
- Backend: Node.js LTS, Fastify, Telegraf (Telegram), node-cron
- Database: Oracle Autonomous DB (Thin Client connection via Wallet)
- AI layer: Ollama API (qwen3.5:9b) at `127.0.0.1:11434`
- Frontend: Vite + React + Tailwind CSS, deployed to Vercel

## Shared Data Contract

Canonical types live in `packages/shared/src/types.ts`. Reproduced here for reference:

```typescript
export type JobStatus = 'NEW' | 'FAVORITE' | 'APPLIED' | 'ARCHIVED';

export interface Job {
  id: string;
  title: string;
  company: string;
  url: string;
  source: 'justjoin' | 'nofluff';
  salary_b2b_min: number | null;
  salary_b2b_max: number | null;
  salary_uop_min: number | null;
  salary_uop_max: number | null;
  currency: string;
  status: JobStatus;
  created_at: string;
}

export interface AIAnalysis {
  job_id: string;
  match_score: number;
  summary: string;
  tech_stack: string[];
  why_good: string;
}
```

## Oracle SQL Schema

Implemented via `apps/backend/src/config/init-db.ts`:

```sql
CREATE TABLE jobs (
    id VARCHAR2(100) PRIMARY KEY,
    title VARCHAR2(255) NOT NULL,
    company VARCHAR2(255) NOT NULL,
    url VARCHAR2(500) NOT NULL,
    source VARCHAR2(50) NOT NULL,
    salary_b2b_min NUMBER,
    salary_b2b_max NUMBER,
    salary_uop_min NUMBER,
    salary_uop_max NUMBER,
    currency VARCHAR2(10) DEFAULT 'PLN',
    status VARCHAR2(50) DEFAULT 'NEW',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_analysis (
    job_id VARCHAR2(100) PRIMARY KEY,
    match_score NUMBER NOT NULL,
    summary CLOB NOT NULL,
    tech_stack CLOB NOT NULL,
    why_good CLOB NOT NULL,
    CONSTRAINT fk_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
```

## API Contracts

- `GET /api/jobs` — all jobs joined with `ai_analysis`, sorted by `match_score DESC`
- `PATCH /api/jobs/:id` — updates `status` field; payload: `{ "status": "JobStatus" }`
- Auth: `X-API-TOKEN` header required on every request; reject with HTTP 401 if missing/invalid

## Implementation Progress

| Task | Status | Covers |
|---|---|---|
| INFRA-101 | DONE | pnpm workspace, packages/shared types |
| INFRA-102 | DONE | oracledb Thin Mode pool, init-db.ts schema runner |
