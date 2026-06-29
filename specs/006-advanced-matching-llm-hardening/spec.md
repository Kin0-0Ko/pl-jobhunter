# Feature Specification: Advanced Matching Engine, LLM Isolation, Strict Error Fallbacks, and Cron Optimization

**Feature Branch**: `006-advanced-matching-llm-hardening`

**Created**: 2026-06-29

**Status**: Draft

**Input**: User description: "Feature: Advanced Matching Engine, LLM Isolation, Strict Error Fallbacks, and Cron Optimization. Requirements: 1. User Profile Upgrades: target_seniority + max_experience_years. 2. Title & Seniority Filtering. 3. Smart Experience Parsing. 4. Cross-Training Wildcard. 5. LLM Prompt Correction. 6. Persistence Guardrails. 7. Cron Interval Update."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Profile-Driven Seniority Filtering (Priority: P1)

The job hunter has configured their profile with `target_seniority: ['junior', 'mid']` and `max_experience_years: 3`. When the ETL scrapes new job listings, any job with a title containing "Senior", "Lead", "Principal", "Staff", or "Architect" is silently discarded before reaching the AI analysis stage. The user only sees roles appropriate to their level.

**Why this priority**: The most common source of irrelevant results is seniority mismatch. Eliminating these at the cheapest stage (pre-filter) improves signal quality and reduces LLM token spend.

**Independent Test**: Seed a batch of 10 jobs — 5 with senior-level titles, 5 junior/mid. Run the ETL pre-filter. Verify only 5 jobs proceed to the AI stage.

**Acceptance Scenarios**:

1. **Given** a job title "Senior Backend Engineer", **When** the pre-filter runs with `target_seniority: ['junior']`, **Then** the job is discarded and never inserted into the database.
2. **Given** a job title "Junior Go Developer", **When** the pre-filter runs with `target_seniority: ['junior', 'mid']`, **Then** the job proceeds to AI analysis.
3. **Given** `target_seniority: ['junior', 'mid', 'senior']`, **When** a "Senior" role appears, **Then** the title filter does NOT discard it (all levels permitted).

---

### User Story 2 - Experience-Year Gate (Priority: P1)

The job description states "5+ years of experience required." The profile has `max_experience_years: 3`. The ETL's `isRelevantJob()` hook parses this requirement and discards the job without calling the LLM.

**Why this priority**: Prevents wasting LLM calls on hard-rejection candidates and reduces noise in the results list.

**Independent Test**: Provide a job description containing "5 lat doświadczenia". With `max_experience_years: 3`, verify the job is rejected. Change to "2 years experience" and verify it passes through.

**Acceptance Scenarios**:

1. **Given** a description with "5+ years experience", **When** `max_experience_years` is `3`, **Then** the job is discarded at the pre-filter stage.
2. **Given** a description with "2 lata doświadczenia", **When** `max_experience_years` is `3`, **Then** the job passes the experience gate.
3. **Given** a description with no experience mention, **When** the parser finds no match, **Then** the job passes through (no match = no discard).
4. **Given** a description with "3 years experience", **When** `max_experience_years` is `3`, **Then** the job passes (strict-greater-than comparison, equal is allowed).

---

### User Story 3 - Cross-Training Wildcard Pass-Through (Priority: P2)

A job description says "no previous Go knowledge required — we can teach you." The job otherwise fails the tech-stack keyword checks (user targets Node.js roles only). The cross-training wildcard detects the phrase and passes the job through to the review list regardless of keyword mismatch.

**Why this priority**: Cross-training opportunities are high-value edge cases. Missing them harms the user more than including occasional false positives.

**Independent Test**: Create a job with zero matching tech-stack keywords but containing "willing to cross-train from Node.js". Verify it appears in the output list with a marker indicating it passed via wildcard.

**Acceptance Scenarios**:

1. **Given** a job with no matching keywords but containing "open to retraining", **When** pre-filter runs, **Then** the job bypasses keyword checks and proceeds to review.
2. **Given** a job with no matching keywords and no cross-training phrases, **When** pre-filter runs, **Then** the job is discarded by keyword check as normal.
3. **Given** a job that already passes keyword checks and also contains a wildcard phrase, **When** pre-filter runs, **Then** the job proceeds normally (wildcard has no negative side effect).

---

### User Story 4 - LLM Outputs Objective Company Requirements (Priority: P2)

The AI analysis step calls the LLM to extract metadata about the job. The LLM returns structured data describing what the **company** requires (skills, experience range, responsibilities) — never first-person statements about the user ("I am a developer who..."). The extracted summary is always a non-null string.

**Why this priority**: First-person hallucinations produce nonsensical summaries that confuse the user and break downstream display logic. Null summaries crash the Oracle insert.

**Independent Test**: Send 10 varied job descriptions to the LLM via the updated prompt. Verify zero responses contain first-person language. Verify zero responses return a null or empty summary field.

**Acceptance Scenarios**:

1. **Given** any job description, **When** the LLM is invoked, **Then** the response summary describes the company's requirements in third person (e.g., "Company seeks a developer with 3+ years of Go experience.").
2. **Given** a malformed or empty LLM response, **When** the persistence layer processes the result, **Then** the summary field defaults to "Metadata extraction failed - pending manual review" before the DB insert.
3. **Given** a valid LLM response, **When** the summary is persisted, **Then** ORA-01400 (NOT NULL constraint violation) never occurs.

---

### User Story 5 - Reduced ETL Frequency (Priority: P3)

The scheduled ETL job runs every 3 hours instead of every 6 hours, doubling the freshness of job listings without requiring manual intervention.

**Why this priority**: More frequent scraping means newer opportunities appear sooner. Lower priority because it is a configuration change with no logic complexity.

**Independent Test**: Inspect the cron schedule registered at startup. Confirm the expression is `0 */3 * * *`.

**Acceptance Scenarios**:

1. **Given** the backend starts, **When** the ETL scheduler initializes, **Then** the cron expression is `0 */3 * * *`.
2. **Given** a 6-hour window, **When** the ETL runs on the new schedule, **Then** it fires exactly 2 times.

---

### Edge Cases

- What happens when `target_seniority` is empty or undefined? → No seniority filter is applied; all titles pass through.
- What happens when `max_experience_years` is `0` or undefined? → If `0`, only jobs with no experience requirement pass. If undefined, experience filter is skipped.
- What if the LLM returns a non-JSON response? → Treat as malformed; apply the fallback string; log the raw response for debugging.
- What if a job description contains both a cross-training phrase AND an experience requirement exceeding `max_experience_years`? → Cross-training wildcard takes precedence; the job passes (cross-training = high-potential override).
- What if the experience regex matches multiple numbers in one description? → Use the highest number found to be conservative (reject if any required experience exceeds the limit).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user profile schema MUST include `target_seniority` (array of strings, optional) and `max_experience_years` (positive number, optional).
- **FR-002**: The pre-filter phase MUST reject any job whose title contains "Senior", "Lead", "Principal", "Staff", or "Architect" when `target_seniority` is limited to junior/mid-only values.
- **FR-003**: The `isRelevantJob()` function MUST parse job descriptions for experience requirements using regex patterns covering English ("X years", "X+ years") and Polish ("X lata/lat doświadczenia") formats.
- **FR-004**: If the parsed experience requirement strictly exceeds `max_experience_years`, the job MUST be discarded before any LLM call is made.
- **FR-005**: The pre-filter MUST detect cross-training indicator phrases in job descriptions and, when found, bypass all tech-stack keyword checks for that job.
- **FR-006**: The LLM system prompt MUST explicitly instruct the model to output only objective, third-person descriptions of company requirements — never first-person statements about the user.
- **FR-007**: Before any Oracle DB insert, the persistence layer MUST validate that the `summary` (or equivalent) field is a non-null, non-empty string; if not, substitute "Metadata extraction failed - pending manual review".
- **FR-008**: The ETL cron schedule MUST be set to `0 */3 * * *` (every 3 hours).
- **FR-009**: When `target_seniority` is absent or empty, the title-seniority filter MUST be skipped entirely.
- **FR-010**: When `max_experience_years` is absent or undefined, the experience-year gate MUST be skipped entirely.

### Key Entities

- **UserProfile**: Represents the job seeker's matching preferences. Key attributes: `target_seniority: string[]`, `max_experience_years: number`. Consumed by the pre-filter and seniority-check logic.
- **Job (pre-filter stage)**: Raw scraped job record before DB persistence. Attributes: `title: string`, `description: string`. Passed through `isRelevantJob()` before any further processing.
- **AIAnalysis**: Structured LLM output attached to a job. Contains `summary: string` (non-nullable after guardrail), `match_score: number`, and related metadata. Persisted to `ai_analysis` table.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero jobs with senior-level titles (Senior/Lead/Principal/Staff/Architect) appear in the output list when `target_seniority` excludes senior roles — 100% filter accuracy on title check.
- **SC-002**: Jobs with a parsed experience requirement exceeding `max_experience_years` are rejected at the pre-filter stage — LLM call rate drops by at least the proportion of over-experience jobs in the dataset.
- **SC-003**: Jobs containing cross-training indicator phrases appear in the output list regardless of keyword mismatch — 0% false-negative rate for wildcard jobs.
- **SC-004**: Zero ORA-01400 errors occur during ETL runs after the persistence guardrail is applied.
- **SC-005**: Zero LLM responses containing first-person language ("I am", "I have", "I can") are persisted to the database.
- **SC-006**: ETL runs exactly 2 times per 6-hour window (confirms `0 */3 * * *` schedule is active).
- **SC-007**: Pre-filter decisions (accepted / rejected + reason) are observable in logs for every processed job.

---

## Assumptions

- `target_seniority` values use lowercase strings: `'junior'`, `'mid'`, `'senior'`. The title check is case-insensitive.
- "Junior/mid-only" is defined as `target_seniority` containing only values from `['junior', 'mid', 'trainee', 'intern']` — i.e., none of `['senior', 'lead', 'principal', 'staff', 'architect']`.
- The existing `isRelevantJob()` function is the correct extension point for experience parsing and cross-training wildcard logic (already used in the pre-filter pipeline per prior plan).
- The cross-training wildcard phrases are a hardcoded list (configurable in the future); no user-facing UI to manage them is in scope.
- The LLM model in use is `qwen2.5:0.5b` via Ollama at `127.0.0.1:11434` (per CLAUDE.md: `qwen3.5:9b` is the primary; constitution references `qwen3.5:9b` — the prompt fix targets whichever model is active in `ollama.ts`).
- Oracle DB schema for `ai_analysis` already has `summary` as NOT NULL or the guardrail prevents null inserts at the application layer regardless of DB constraint.
- Existing ETL scheduler uses `node-cron` syntax; changing the expression string is a single-line update.
- Frontend display is not affected by this feature — no new API fields or routes are added.
- The `UserProfile` config is stored in a backend config file or environment variable for now; no user-facing profile editor UI is in scope.
