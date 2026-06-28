# Research: Production Readiness

**Date**: 2026-06-27 | **Plan**: [plan.md](plan.md)

---

## Decision 1: pino integration with Fastify

**Decision**: Configure Fastify's built-in pino logger explicitly instead of adding a second logger instance.

**Rationale**: Fastify uses pino internally when `logger: true` is passed. Switching to `logger: { level: 'info' }` (or passing a pino instance directly) gives full pino structured JSON output with zero additional dependencies. Adding a parallel `pino()` instance would create two log streams and break Fastify's request-id correlation.

**Alternatives considered**:
- `winston` — heavier, not native to Fastify, no benefit for single-user VPS deployment
- Separate `pino()` instance alongside Fastify — creates duplicate/split log streams
- Keeping `logger: true` — works but outputs semi-structured logs without guaranteed JSON format in production

**Implementation note**: Replace `Fastify({ logger: true })` with `Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined } })`. In production (Docker) this emits newline-delimited JSON; in dev it pretty-prints.

---

## Decision 2: user_profile table — single-row upsert pattern

**Decision**: `user_profile` table stores exactly one row (id = 1, fixed). `PUT /api/profile` uses `MERGE INTO` upsert.

**Rationale**: The system is single-user by spec. A fixed primary key of `1` eliminates row selection complexity. MERGE INTO is already used in `etl.ts` for idempotent job insertion — same pattern, proven working with Oracle Thin Mode.

**Alternatives considered**:
- Multiple profile rows keyed by user_id — over-engineered for single-user system
- JSON blob in a single column — harder to query individual fields from ETL scorer; worse schema evolution
- File-based profile (JSON on disk) — not transactional, not accessible to distributed deployments

---

## Decision 3: client-side filtering approach

**Decision**: Pure derived computation in a `useFilter` hook — no `useState` per filter applied against a memoized `jobs` array. Use `useMemo` for the filtered+analytics result.

**Rationale**: At ≤500 jobs, JavaScript array filtering is sub-millisecond. Server-side filtering would require extra API round-trips, pagination, and query parameter plumbing — all complexity with no benefit at this scale. `useMemo` with the filter state as dependency ensures analytics widget always reflects the current filtered set.

**Alternatives considered**:
- Server-side filtering via query params — unnecessary latency + backend complexity for <500 records
- Third-party filter library (react-table, TanStack) — overkill; adds bundle weight for a simple case
- `useReducer` for filter state — valid but more complex than simple `useState` per filter field; no benefit without undo/redo

---

## Decision 4: ETL global error catch boundary

**Decision**: Wrap the entire `runEtl()` body in a `try/catch`. On catch, call `sendCriticalAlert()` (a new function in `telegram.ts`) then re-throw or set `process.exitCode = 1`.

**Rationale**: Individual error handling already exists for DB and Ollama. The global catch is a safety net for unexpected errors (e.g., network stack crash, OOM, unhandled promise rejection outside the ETL loop). Sending the alert before exiting ensures operator visibility even on completely unexpected failures.

**Alternatives considered**:
- `process.on('uncaughtException')` — too broad, catches errors outside ETL scope; can mask other issues
- External monitoring (Datadog, Sentry) — valid for multi-service but adds SaaS dependency; Telegram is already integrated and sufficient for single-operator system
- Restart-on-crash via PM2 — complements but does not replace alerting; operator still needs to know

---

## Decision 5: analytics widget scope (filtered vs. all)

**Decision**: The Top-5 skills widget aggregates from the **currently filtered** job set where `match_score >= 80`, not from all jobs.

**Rationale**: When a user applies a "React" keyword filter, they want to see which skills are most demanded among their high-match React jobs — not all jobs. This makes the widget contextually relevant and updates reactively as filters change. Since `tech_stack` is already a JSON-serialized string array in `ai_analysis`, parsing happens client-side with `JSON.parse`.

**Alternatives considered**:
- Aggregate from all jobs regardless of filters — less useful; ignores user's current search context
- Server-side aggregation endpoint — unnecessary; all data is already in the client's `JobWithAnalysis[]` array
- Separate "market overview" page — out of scope per spec; widget is a lightweight addition above the board

---

## All NEEDS CLARIFICATION markers: None

Spec had zero clarification markers. All decisions above are internally consistent with existing architecture.
