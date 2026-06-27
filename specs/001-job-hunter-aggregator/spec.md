# Feature Specification: Job Hunter Aggregator

**Feature Branch**: `feat/001-job-hunter-aggregator`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "Build an automated Job Hunter system that aggregates vacancies from
JustJoin.it and NoFluffJobs, analyzes them using local Ollama AI model (qwen3.5) for tech stack
matching, and displays them on a Kanban board web UI with Telegram alerts for high-score jobs."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — View Scored Job Board (Priority: P1)

A solo developer opens the web application and sees all aggregated job offers displayed in a
Kanban board organized by status columns (New, Favorite, Applied, Archived). Each card shows
the job title, company, source, salary range, and an AI-generated match score. Cards are sorted
by match score descending so the best matches appear first.

**Why this priority**: The Kanban board is the primary value delivery — it is the interface
through which all other features are consumed. Without it nothing else is visible to the user.

**Independent Test**: Can be tested by seeding the database with sample jobs + AI analysis rows
and verifying the board renders cards with correct data in the correct columns, sorted by score.

**Acceptance Scenarios**:

1. **Given** the database contains jobs with AI analysis, **When** the user opens the app,
   **Then** all jobs appear as cards in the "New" column sorted by `match_score` descending.
2. **Given** a job has `status = FAVORITE`, **When** the board loads, **Then** that card
   appears in the "Favorite" column, not "New".
3. **Given** the user is not authenticated (missing or wrong token), **When** they open the app,
   **Then** they see an error state and no job data is exposed.

---

### User Story 2 — Move Jobs Between Kanban Columns (Priority: P2)

The user drags a job card from one status column to another (e.g., New → Applied). The card
moves immediately in the UI and the change persists in the database. On next page load, the card
remains in the column it was moved to.

**Why this priority**: Workflow management is the core interaction model — without it the board
is read-only and provides no organizational value.

**Independent Test**: Can be tested by dragging a card to a new column, refreshing the page,
and verifying the card remains in the target column.

**Acceptance Scenarios**:

1. **Given** a job card is in "New", **When** the user drags it to "Favorite",
   **Then** the card moves immediately and a PATCH request updates `status` to `FAVORITE`.
2. **Given** a PATCH request succeeds, **When** the user refreshes, **Then** the card is in
   the "Favorite" column.
3. **Given** the PATCH request fails (network error), **When** the drag completes,
   **Then** the card snaps back to its original column and an error message is shown.

---

### User Story 3 — Automated Job Ingestion via Scheduler (Priority: P3)

Without any manual action, the system automatically fetches new job offers from JustJoin.it and
NoFluffJobs on a recurring schedule (every 6 hours). New offers not already present in the
database are saved. Each new offer is sent to the AI layer for match scoring and the result is
stored alongside the job record.

**Why this priority**: Automation is what makes the tool useful long-term — manual refresh would
defeat the purpose of an aggregator.

**Independent Test**: Can be tested by triggering the ETL pipeline manually (single run), then
querying the database to confirm new rows appear in both `jobs` and `ai_analysis` tables.

**Acceptance Scenarios**:

1. **Given** the scheduler fires, **When** JustJoin.it returns 10 new offers, **Then** 10 rows
   are inserted into `jobs` and 10 rows into `ai_analysis` (no duplicates on re-run).
2. **Given** a job already exists in the database (same `id`), **When** the scheduler runs
   again, **Then** the duplicate is skipped (upsert or skip logic — no duplicate rows).
3. **Given** the AI service is unavailable, **When** ingestion runs, **Then** job rows are saved
   without AI analysis and the error is logged; the scheduler continues to the next job.

---

### User Story 4 — Telegram Alert for High-Score Jobs (Priority: P4)

When a newly ingested job receives an AI match score of 80 or above, the system automatically
sends a Telegram message to the configured admin chat. The message contains the job title,
company, match score, and a direct link to the job posting.

**Why this priority**: Proactive alerts remove the need to check the board constantly; they turn
the system into a push-based notification tool for the best matches.

**Independent Test**: Can be tested by inserting a job with `match_score >= 80` and verifying a
Telegram message is dispatched (captured via test bot or mock).

**Acceptance Scenarios**:

1. **Given** a job is scored at 85, **When** ingestion completes, **Then** a Telegram message
   is sent to the admin chat containing title, company, score (85), and job URL.
2. **Given** a job is scored at 60, **When** ingestion completes, **Then** no Telegram message
   is sent.
3. **Given** the Telegram API is unavailable, **When** a high-score job is processed,
   **Then** the error is logged but ingestion does not fail or retry indefinitely.

---

### Edge Cases

- What happens when JustJoin.it or NoFluffJobs changes their response schema?
  → ETL MUST log a parsing error per-record and skip the malformed record; valid records still persist.
- What happens when Ollama returns malformed JSON?
  → The backend MUST retry once, then log the error and persist the job without AI analysis.
- What happens when the database is unreachable during ingestion?
  → Ingestion MUST abort and log a fatal error; no partial writes should leave orphaned `jobs` rows without corresponding `ai_analysis` rows after a completed run.
- What happens when both sources return the same job (cross-platform duplicates)?
  → Jobs are deduplicated by `id` within each source; cross-source duplicates (same URL, different source) are stored as separate records.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST fetch job listings from JustJoin.it on a configurable recurring schedule (default every 6 hours).
- **FR-002**: System MUST fetch job listings from NoFluffJobs on the same schedule.
- **FR-003**: System MUST normalize fetched job data into the shared `Job` type defined in `packages/shared`.
- **FR-004**: System MUST persist only new jobs (skip duplicates by `id` per source).
- **FR-005**: System MUST submit each new job to the local AI service for match scoring and persist the result in `ai_analysis`.
- **FR-006**: System MUST send a Telegram notification for every job where `match_score >= 80`, containing title, company, score, and URL.
- **FR-007**: System MUST expose a `GET /api/jobs` endpoint returning all jobs joined with AI analysis, sorted by `match_score DESC`.
- **FR-008**: System MUST expose a `PATCH /api/jobs/:id` endpoint accepting a `status` field with values `NEW | FAVORITE | APPLIED | ARCHIVED`.
- **FR-009**: System MUST reject all API requests missing a valid `X-API-TOKEN` header with HTTP 401.
- **FR-010**: Web UI MUST display all jobs in a Kanban board with columns: New, Favorite, Applied, Archived.
- **FR-011**: Web UI MUST allow dragging job cards between columns; each drag MUST trigger a PATCH to persist the status change.
- **FR-012**: Web UI MUST sort job cards within each column by `match_score` descending.
- **FR-013**: Job card MUST display: title, company, source badge, salary range (B2B and/or UoP), match score, and a link to the original job posting.
- **FR-014**: Web UI MUST display an error state when the API token is missing or rejected.
- **FR-015**: AI match scoring MUST produce a numeric score in the range 0–100 and a `summary`, `tech_stack` array, and `why_good` explanation.

### Key Entities

- **Job**: A normalized vacancy record with id, title, company, URL, source, salary ranges (B2B min/max, UoP min/max), currency, status, and creation timestamp.
- **AIAnalysis**: AI-generated scoring record linked to a Job, containing match_score (0–100), summary text, tech_stack array, and why_good explanation.
- **JobStatus**: Enum of four values — `NEW`, `FAVORITE`, `APPLIED`, `ARCHIVED` — representing the user's workflow stage for a job.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All new job offers published in the last 6 hours on both sources appear in the system within 10 minutes of the scheduled run completing.
- **SC-002**: 100% of jobs stored in the database have a corresponding AI analysis record (or an explicit "analysis pending" marker if AI was unavailable).
- **SC-003**: Telegram alerts for high-score jobs are delivered within 60 seconds of ingestion completing.
- **SC-004**: Status changes made via drag-and-drop on the Kanban board persist correctly on page refresh in 100% of cases under normal network conditions.
- **SC-005**: The Kanban board loads and displays all jobs within 3 seconds on a standard broadband connection.
- **SC-006**: The system handles re-runs without creating duplicate job records for any source.
- **SC-007**: The web UI is fully usable by a single non-technical administrator without any documentation.

---

## Assumptions

- Single-user system: one administrator owns and operates the entire deployment; no multi-user auth or role management is needed.
- The AI match scoring prompt and user profile (tech preferences, seniority, location) are configured once at deployment time via environment variables or a config file; the spec does not require a UI for editing AI prompts.
- Salary normalization converts all values to PLN numbers; cross-currency conversion is out of scope for v1.
- The B2B tax calculator (Ryczałt 12%) referenced in the task matrix (FE-303) is a UI-only feature and does not affect stored data.
- "High-score" threshold for Telegram alerts is 80/100; this value is configurable via environment variable.
- JustJoin.it and NoFluffJobs are accessed via their public web APIs or documented endpoints; authentication tokens for these sources (if required) are provided via environment variables.
- The system is deployed to a single Oracle VPS behind Caddy; horizontal scaling is out of scope.
- Offline/PWA capability is out of scope.
