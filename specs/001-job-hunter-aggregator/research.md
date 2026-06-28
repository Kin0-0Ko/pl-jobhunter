# Research: Job Hunter Aggregator

**Date**: 2026-06-27 | **Feature**: specs/001-job-hunter-aggregator

---

## Decision 1: JustJoin.it Data Source

**Decision**: Use the unofficial public JSON API at `https://justjoin.it/api/offers` (no auth
required). Response is a flat array of offer objects. Each offer has a stable `id` field used
as the deduplication key.

**Rationale**: No official public API exists; the web app loads data from this endpoint directly.
It is the most reliable source used by existing open-source scrapers in the Polish dev community.

**Alternatives considered**:
- HTML scraping with Playwright — heavier, brittle against DOM changes, overkill for JSON data.
- Puppeteer headless — same objection.

**Key fields**: `id`, `title`, `companyName`, `employmentTypes[].salary`, `skills[]`,
`remoteInterview`, `offerUrl`.

**Normalization**: `source = 'justjoin'`; salary extracted from first `employmentTypes` entry;
salary type inferred from `type` field (`b2b` or `permanent`).

---

## Decision 2: NoFluffJobs Data Source

**Decision**: Use `https://nofluffjobs.com/api/search/posting` (POST) with a JSON body
containing `criteriaSearch` filters. Returns paginated results; fetch all pages until
`totalPages` exhausted.

**Rationale**: NoFluffJobs exposes a documented JSON search API consumed by their own SPA.
Pagination is straightforward (page param in body).

**Alternatives considered**:
- RSS feed — outdated, lacks salary and tech stack fields.

**Key fields**: `id`, `title`, `name` (company), `url`, `salary.from`, `salary.to`,
`salary.currency`, `salary.type`, `technology[]`.

**Normalization**: `source = 'nofluff'`; map `salary.type === 'b2b'` → `salary_b2b_*`,
else → `salary_uop_*`; currency passed through as-is.

---

## Decision 3: Ollama JSON-Mode Scoring

**Decision**: Use Ollama's `/api/generate` endpoint with `format: "json"` and model
`qwen3:5b` (corrected from `qwen3.5:9b` — actual Ollama tag). Prompt instructs the model to
return exactly `{ match_score, summary, tech_stack, why_good }`.

**Rationale**: Ollama's `format: "json"` constraint forces valid JSON output. `qwen3:5b` is
the correct Ollama model tag available locally. Structured output avoids regex parsing.

**Validation**: Response MUST be parsed with `JSON.parse()`; if it throws or required fields
are missing, retry once with a simplified prompt; on second failure, persist job without
analysis.

**Prompt structure**:
```
You are a senior developer evaluating job fit. Return JSON only.
Schema: { "match_score": number 0-100, "summary": string, "tech_stack": string[], "why_good": string }
User profile: {PROFILE}
Job: {JOB_JSON}
```

**User profile** is injected from `OLLAMA_USER_PROFILE` env var (plaintext description of
skills/preferences).

---

## Decision 4: Drag-and-Drop Library

**Decision**: `@dnd-kit/core` + `@dnd-kit/sortable` — accessibility-first, no DOM
manipulation, works with React 19.

**Rationale**: Most actively maintained DnD library for React as of 2026; supports touch,
keyboard, and pointer events. `react-beautiful-dnd` is deprecated; `react-dnd` requires
HTML5 backend setup incompatible with Vercel SSR constraints.

**Alternatives considered**:
- `react-beautiful-dnd` — deprecated, no React 18/19 support.
- Native HTML5 drag API — no accessibility, complex cross-browser.

---

## Decision 5: Frontend Token Delivery

**Decision**: `X-API-TOKEN` value stored in `VITE_API_TOKEN` environment variable (Vercel
project env). Injected at build time via `import.meta.env.VITE_API_TOKEN`. No runtime prompt.

**Rationale**: Single-user system; token never changes post-deploy. Build-time injection is
simpler than a login form and requires no session management.

**Security note**: Token is embedded in the compiled JS bundle. Acceptable for single-user
internal tool; not suitable for multi-user scenarios.

---

## Decision 6: ETL Idempotency

**Decision**: On each scraper run, attempt `INSERT` with `ON CONFLICT (id) DO NOTHING`
equivalent for Oracle: use `MERGE INTO jobs USING DUAL ON (id = :id) WHEN NOT MATCHED THEN INSERT ...`.

**Rationale**: Prevents duplicate rows on re-run. Simpler than pre-checking existence (avoids
race conditions). Oracle MERGE is the standard upsert mechanism.

---

## Decision 8: API Documentation — Fastify Swagger

**Decision**: `@fastify/swagger` (OpenAPI 3.0 schema generation) + `@fastify/swagger-ui` (Swagger
UI at `/docs`). Both registered in `apps/backend/src/index.ts` before route registration.

**Rationale**: Native Fastify plugins — zero friction with the existing server. OpenAPI schema
auto-derived from Fastify's JSON Schema route definitions. No separate spec file to maintain.
Available only in non-production (`NODE_ENV !== 'production'`) to avoid exposing internals.

**Alternatives considered**:
- `swagger-jsdoc` — requires JSDoc comments; incompatible with Fastify's schema-first approach.
- Manual OpenAPI YAML — too much maintenance burden.

**Config**:
```typescript
// Only register in dev/staging
if (process.env.NODE_ENV !== 'production') {
  await server.register(swagger, { openapi: { info: { title: 'PL-JobHunter API', version: '1.0.0' } } });
  await server.register(swaggerUi, { routePrefix: '/docs' });
}
```

---

## Decision 9: Unit Testing — vitest + msw

**Decision**: `vitest@2` as test runner (Jest-compatible API, native ESM, fast). `msw@2`
(Mock Service Worker) for intercepting Ollama HTTP calls at the network level — no dependency
injection or mock functions needed in production code.

**Rationale**: vitest runs in Node environment with ESM natively — no Babel transform. msw's
`http.post()` handlers intercept `fetch()` calls without modifying `ollama.ts` itself.
Tests are colocated (`*.test.ts`) so they stay close to the module they test.

**Test scope**:
- `ollama.test.ts` — mocks `POST /api/generate`, verifies parse + retry logic
- `justjoin.test.ts` — mocks JustJoin API response, verifies Job normalization
- `nofluff.test.ts` — mocks NoFluffJobs pagination, verifies Job normalization
- `jobs.test.ts` — tests Fastify route handlers with injected mock DB connection

**Config** (`apps/backend/vitest.config.ts`):
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } });
```

**Alternatives considered**:
- Jest — requires `ts-jest` transform config; slower on ESM projects.
- `@playwright/test` — overkill for unit/integration layer.

---

## Decision 10: Docker + docker-compose + CI/CD

**Decision**:

**Dockerfile** (`apps/backend/Dockerfile`) — two stages:
1. `builder`: `node:22-alpine`, copies workspace, runs `pnpm install --frozen-lockfile`,
   runs `pnpm exec tsc` → outputs `dist/`
2. `runner`: `node:22-alpine`, copies `dist/` + `node_modules/` (prod only via
   `pnpm deploy`), sets `CMD ["node", "dist/index.js"]`

**docker-compose.yml** (repo root) — two services:
- `backend`: built from `apps/backend/Dockerfile`, env_file `apps/backend/.env`,
  mounts `./apps/backend/wallet:/app/wallet:ro`, port `3000:3000`
- `ollama`: image `ollama/ollama`, volume `ollama_models:/root/.ollama`, port `11434:11434`

**GitHub Actions** (`.github/workflows/ci.yml`):
- `ci` job: `ubuntu-latest`, Node 22, pnpm install, `tsc --noEmit`, `vitest run`
- `deploy` job (on push to `main`): docker buildx + push to GHCR, SSH into Oracle VPS,
  `docker compose pull && docker compose up -d`

**Rationale**: Multi-stage keeps final image small (no dev deps, no TypeScript compiler).
docker-compose lets local dev spin up Ollama alongside backend without manual `ollama serve`.
GitHub Actions on GHCR is free for public repos and integrates with the existing git workflow.

**Alternatives considered**:
- Single-stage Dockerfile — final image 3× larger (includes tsc, tsx, @types).
- Self-hosted runner — unnecessary complexity for single-VPS deploy.
- Podman — no added value over Docker for this setup.

---

## Decision 7: Telegram Bot

**Decision**: Use `telegraf@4` in webhook-less polling mode (no webhook URL needed on VPS).
Send messages via `bot.telegram.sendMessage(chatId, text)` — no full bot startup required for
one-way dispatch.

**Rationale**: Webhook requires a public HTTPS endpoint with a registered domain. Since we
control the VPS and Caddy, webhook is possible but unnecessary for alert-only dispatch.
Fire-and-forget `sendMessage` call is simpler.

**Config**: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_ID` env vars.
