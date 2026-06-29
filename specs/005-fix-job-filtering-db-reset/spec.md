# Feature Specification: Fix Job Filtering & DB Reset

**Feature Branch**: `005-fix-job-filtering-db-reset`

**Created**: 2026-06-29

**Status**: Draft

**Input**: User description: "Fix filtering — AI scores everything 95-100 due to missing job descriptions in prompt; add pre-filter to block irrelevant jobs; add raw_jobs staging table; add --reset flag to clean dirty DB."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean DB & Re-run Fresh ETL (Priority: P1)

A developer needs to wipe dirty data from first test runs and start fresh with corrected pipeline logic. They run the reset command, confirm tables are cleared, then trigger ETL to repopulate with properly scored jobs.

**Why this priority**: Without a clean DB, all subsequent scoring improvements are invisible because dirty rows remain. This unblocks the entire fix.

**Independent Test**: Run reset command → verify `jobs` and `ai_analysis` are empty, `user_profile` preserved → run ETL once → confirm new rows appear with varied match scores.

**Acceptance Scenarios**:

1. **Given** dirty `jobs` and `ai_analysis` tables with test data, **When** `init-db --reset` is executed, **Then** both tables are dropped and recreated empty, `user_profile` row is preserved.
2. **Given** empty tables after reset, **When** ETL runs, **Then** new jobs are inserted and scored.
3. **Given** no `user_profile` row exists after reset, **When** init-db reset completes, **Then** a default profile with the 17 configured skills is seeded automatically.

---

### User Story 2 - Irrelevant Jobs Blocked Before Scoring (Priority: P1)

A job hunter only wants to see developer-relevant postings. Jobs like "CNC Machine Operator" or "PKP Audit Specialist" should never reach the AI scorer and should not appear in the main jobs feed.

**Why this priority**: Pre-filtering prevents wasted Ollama calls on a RAM-constrained VPS and keeps the jobs feed signal-to-noise ratio high.

**Independent Test**: Run ETL → confirm jobs with zero keyword overlap (CNC, audit, production worker) land only in `raw_jobs` and have no `ai_analysis` row.

**Acceptance Scenarios**:

1. **Given** a scraped job with title "Pracownik produkcji" and no matching tech keywords, **When** ETL processes it, **Then** job is stored in `raw_jobs` only — not in `jobs` or `ai_analysis`.
2. **Given** a scraped job with title "Senior Node.js Developer" and Node.js in the description, **When** ETL processes it, **Then** job is promoted to `jobs` and scored by Ollama.
3. **Given** a job that passes the keyword filter but Ollama is unavailable, **When** ETL processes it, **Then** job is inserted to `jobs` with no `ai_analysis` row (existing behavior preserved).

---

### User Story 3 - Accurate Match Scores Based on Job Description (Priority: P2)

A job hunter wants meaningful match scores — a TypeScript role should score high, a Python/Spark data engineer role should score low — so the sorted feed is actually useful for prioritizing applications.

**Why this priority**: This is the core UX fix. Without description context, the AI cannot differentiate jobs and scores everything near 100.

**Independent Test**: After ETL, verify score distribution: TypeScript/Node.js roles score ≥70, Python-only/Java-only roles score ≤40.

**Acceptance Scenarios**:

1. **Given** a job "Senior TypeScript Engineer" with TypeScript/Node.js description, **When** scored, **Then** `match_score` ≥ 70.
2. **Given** a job "Senior Data Engineer (Python, Spark, Azure)" with no TS/JS keywords, **When** scored, **Then** `match_score` ≤ 45.
3. **Given** a job with no description available (scraper returned empty), **When** scored, **Then** scoring proceeds on title alone with an explicit note in `why_good` that description was unavailable.
4. **Given** a score below the alert threshold, **When** persisted, **Then** no Telegram alert is sent.

---

### User Story 4 - All Raw Scraped Data Preserved (Priority: P3)

A developer wants the ability to re-score jobs later if the profile changes, without re-scraping. All scraped jobs — regardless of relevance — are stored in the staging table.

**Why this priority**: Data preservation for future re-scoring. Lower priority than the core fixes but valuable for long-term pipeline hygiene.

**Independent Test**: Run ETL → count rows in `raw_jobs` ≥ count rows in `jobs`. Verify a known-irrelevant job ID exists in `raw_jobs` but not in `jobs`.

**Acceptance Scenarios**:

1. **Given** ETL run with mixed relevant and irrelevant jobs, **When** complete, **Then** `raw_jobs` row count equals total scraped count; `jobs` row count equals only relevant-filtered count.
2. **Given** same job ID scraped twice across two ETL runs, **When** second run completes, **Then** `raw_jobs` has exactly one row for that ID (MERGE deduplication).

---

### Edge Cases

- What happens when pre-filter keywords list is empty? → All jobs pass through (fail-open behavior; log a warning).
- What happens when `--reset` is run but `user_profile` table does not exist? → Skip drop gracefully, recreate all tables.
- What happens when `description` field is null/empty from scraper? → Prompt is built from title + company only; scoring proceeds.
- What happens when Ollama JSON response is truncated (num_predict too low)? → JSON parse fails → existing retry logic handles; `num_predict` increased to 400 mitigates.
- What happens if `raw_jobs` insert fails? → Log error, skip that job (do not abort entire ETL run).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `--reset` CLI flag on the `init-db` script that drops `ai_analysis`, `jobs`, and `raw_jobs` tables (in dependency order) then recreates them, leaving `user_profile` intact.
- **FR-002**: System MUST seed a default `user_profile` row with the 17 configured skills during `--reset` if no profile row exists after recreation.
- **FR-003**: System MUST create a `raw_jobs` staging table with the same columns as `jobs` plus `description CLOB`, but without foreign key constraints.
- **FR-004**: ETL pipeline MUST insert every scraped job into `raw_jobs` regardless of relevance, before any filtering.
- **FR-005**: ETL pipeline MUST apply a keyword pre-filter (`isRelevantJob`) after `raw_jobs` insertion; only passing jobs are promoted to `jobs` and sent to the AI scorer.
- **FR-006**: Pre-filter MUST match against job title and `description` field using a configurable list of skill keywords (case-insensitive); minimum 1 match required to pass.
- **FR-007**: `buildPrompt` MUST include up to 1500 characters of `job.description` when available.
- **FR-008**: Ollama `num_predict` parameter MUST be increased from 200 to 400 to prevent JSON truncation.
- **FR-009**: `Job` shared type MUST include an optional `description` field; all scraper modules MUST map available body/requirements text into this field.
- **FR-010**: `jobs` table schema MUST include a `description CLOB` column for promoted jobs.
- **FR-011**: System MUST remain compliant with Oracle Thin Mode (no native client) for all new table operations.
- **FR-012**: TypeScript compilation MUST pass with `strict: true` after all changes.

### Key Entities

- **raw_jobs**: Staging table. Holds all scraped job postings regardless of relevance. No FK constraints. Fields mirror `jobs` plus `description`.
- **jobs**: Promoted table. Holds only keyword-filtered relevant jobs. Gains `description CLOB` column.
- **ai_analysis**: Unchanged schema. Populated only for jobs that pass pre-filter and receive an Ollama score.
- **user_profile**: Unchanged schema. Preserved across `--reset`. Seeded with default skills if empty post-reset.
- **isRelevantJob filter**: Pure function. Input: `Job`. Output: boolean. Uses hardcoded skill keyword array matching title + description.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After `--reset`, `jobs` and `ai_analysis` row counts are 0; `user_profile` has exactly 1 row with 17 skills.
- **SC-002**: After one ETL run, fewer than 20% of jobs in `jobs` table have `match_score` ≥ 95 (vs. ~100% before fix).
- **SC-003**: After one ETL run, `raw_jobs` row count is greater than `jobs` row count (irrelevant jobs blocked from promotion).
- **SC-004**: Jobs matching 0 profile keywords do not appear in `jobs` or `ai_analysis` tables.
- **SC-005**: TypeScript build completes with 0 errors after all changes.
- **SC-006**: Ollama call volume per ETL run decreases proportionally to pre-filter rejection rate (fewer wasted LLM calls).

## Assumptions

- Scrapers (justjoin, nofluff, theprotocol, rocketjobs) expose a body/description/requirements field in their API responses that can be mapped to `description`; if a scraper has no such field, `description` is left undefined.
- The 17-skill keyword list (TypeScript, JavaScript, Node.js, NestJS, Express.js, React, Next.js, Redux, PostgreSQL, MongoDB, Redis, RabbitMQ, TypeORM, AWS, Docker, GitHub Actions, CI/CD) is treated as the canonical pre-filter list and matches case-insensitively.
- `--reset` is a developer/admin operation, not exposed via the API or UI; it is run manually via CLI.
- Preserving `user_profile` across reset is required; no other tables need preservation.
- The Ollama model remains `qwen3.5:9b` (or `qwen2.5:0.5b` per env var override); prompt format changes are backward-compatible with both.
- `raw_jobs` is write-only from the ETL perspective in this feature; no UI reads from it yet.
- Oracle MERGE semantics handle deduplication for both `raw_jobs` and `jobs` (same pattern as current `mergeJob`).
