---
spec_id: SP-01
title: Core Architecture and Data Contracts
version: 1.0.0
status: APPROVED
---

# SP-01: System Architecture & Tech Stack

## 1. System Topology
- Monorepo Engine: `pnpm` workspaces
- Backend: Node.js LTS, Fastify, Telegraf (Telegram), node-cron
- Database: Oracle Autonomous DB (Thin Client connection via Wallet)
- AI layer: Ollama API (qwen3.5:9b) running on host local loop (127.0.0.1:11434)
- Frontend: Vite, React, Tailwind CSS deployed to Vercel

## 2. Shared Data Contract (packages/shared/src/types.ts)
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

## 3. Database Schema (Oracle SQL)
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

## 4. API & Security Contracts
- Protocol: HTTPS via Caddy Reverse Proxy on Oracle VPS.
- Authentication: Strict Token-based access. Every incoming client request (Vercel) must carry the `X-API-TOKEN` header.
- Endpoints:
  - `GET /api/jobs` - Returns all jobs joined with `ai_analysis`, sorted by `match_score DESC`.
  - `PATCH /api/jobs/:id` - Updates the `status` field of a specific job. Payload: { "status": "JobStatus" }.
