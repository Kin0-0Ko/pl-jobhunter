# Feature Specification: Production Readiness — Profile Management, Job Filtering & Analytics, ETL Monitoring

**Feature Branch**: `feat/002-production-readiness`

**Created**: 2026-06-27

**Status**: Draft

**Input**: Three new feature sets: Dynamic AI Profile Management, Filtering/Search/Market Analytics, ETL Monitoring and Failure Alerts

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Dynamic Profile Management (Priority: P1)

A developer/admin wants to update their resume, skills, and job-search preferences directly from the web interface so that the AI scoring engine reflects their current situation without requiring server restarts or environment variable edits.

**Why this priority**: The current hardcoded env-var approach breaks every time the user's skills or preferences change. This is the core personalization feature that makes AI scores accurate and actionable.

**Independent Test**: Navigate to the profile settings page, update skills list and preferred contract type, save, then trigger an ETL run (manual) and verify the next set of scored jobs reflects the updated profile.

**Acceptance Scenarios**:

1. **Given** no profile exists, **When** the user opens the settings page, **Then** a blank form is displayed with placeholder guidance text.
2. **Given** a saved profile exists, **When** the user opens settings, **Then** the form is pre-populated with the current values.
3. **Given** the user edits skills and saves, **When** the ETL scorer runs next, **Then** it reads the updated profile from the database (not from the env variable).
4. **Given** the user submits an empty profile, **When** saving, **Then** the system rejects with a clear validation error and does not overwrite the existing profile.
5. **Given** no profile exists in the database, **When** the ETL scorer runs, **Then** it falls back gracefully to the env-var default and logs a warning.

---

### User Story 2 — Job Filtering, Search, and Market Analytics (Priority: P2)

A user with hundreds of fetched jobs wants to quickly narrow the Kanban board to relevant postings and see aggregate market insights about which technologies are most demanded among their high-match jobs.

**Why this priority**: At scale (hundreds of jobs), an unfiltered board becomes unusable. Filtering is essential for daily workflow; analytics provides strategic career value on top of existing data.

**Independent Test**: With a seeded dataset of 50+ jobs from both sources and mixed scores, apply a B2B contract filter and verify only B2B jobs remain visible; then check that the analytics widget updates to reflect only the filtered set with score ≥ 80.

**Acceptance Scenarios**:

1. **Given** 100 jobs loaded, **When** the user types "React" in the keyword search, **Then** only jobs with "React" in tech_stack or title are shown, instantly without a page reload.
2. **Given** mixed B2B and UoP jobs, **When** the user selects "B2B only", **Then** only jobs with non-null B2B salary fields are shown.
3. **Given** jobs with varying salary ranges, **When** the user drags the salary slider to 15,000–25,000 PLN, **Then** only jobs with B2B or UoP salary in that range are shown.
4. **Given** jobs from both JustJoin and NoFluff, **When** the user selects "JustJoin only", **Then** only jobs with source='justjoin' are shown.
5. **Given** jobs with match_score ≥ 80, **When** the analytics widget renders, **Then** it shows the top 5 technologies most frequently appearing across those high-match jobs.
6. **Given** no filters are active, **When** the board loads, **Then** all jobs are visible and filters default to "show all".
7. **Given** filters are active, **When** the user clicks "Clear all filters", **Then** all jobs return to view.

---

### User Story 3 — ETL Monitoring and Failure Alerts (Priority: P3)

A developer running the system overnight wants to be immediately notified via Telegram if the ETL pipeline encounters a fatal error (external API down, database unreachable, Ollama OOM crash) so they can investigate and fix the issue before the next morning.

**Why this priority**: Silent ETL failures mean stale job data and broken scores with no indication to the operator. Proactive alerting prevents extended undetected outages.

**Independent Test**: Simulate a DB connection drop during an ETL run and verify that a Telegram message is received within 30 seconds containing the error type and a snippet of the error message.

**Acceptance Scenarios**:

1. **Given** a JustJoin or NoFluff API returns 5xx, **When** ETL runs, **Then** a Telegram critical alert is dispatched with the error type and HTTP status.
2. **Given** Oracle DB connection drops mid-run, **When** ETL detects the failure, **Then** ETL aborts and sends a Telegram alert with "DB connection lost" and the error snippet.
3. **Given** Ollama returns an OOM error or crashes, **When** ETL processes a scoring call, **Then** a Telegram warning is sent, the affected job is persisted without a score, and ETL continues for remaining jobs.
4. **Given** all services healthy, **When** ETL runs, **Then** no alert is sent and structured logs show success with job count.
5. **Given** a Telegram dispatch failure itself, **When** the alert cannot be sent, **Then** the error is written to structured logs and does not crash the ETL process.

---

### Edge Cases

- What happens when the profile form is submitted with only whitespace? (must be treated as empty/invalid)
- What happens when `OLLAMA_USER_PROFILE` env var is also set alongside a DB profile? (DB profile wins)
- What if the user clears all filter criteria? (board returns to full unfiltered state)
- What if the analytics widget has no jobs with score ≥ 80? (shows "No high-match jobs yet" message)
- What if both a scraper API and the DB are down simultaneously? (single consolidated Telegram alert, not two)
- What if the Telegram bot token is invalid when sending a critical alert? (log the failure, do not crash ETL)

---

## Requirements *(mandatory)*

### Functional Requirements

**Profile Management**
- **FR-001**: System MUST store user profile data (resume text, skills list, preferred contract type, job search preferences) persistently in the database.
- **FR-002**: System MUST expose a read endpoint that returns the current saved profile.
- **FR-003**: System MUST expose an update endpoint that replaces the current profile with validated input.
- **FR-004**: System MUST validate that a profile update is not empty before persisting.
- **FR-005**: The AI scoring engine MUST read the profile from the database at ETL run time; the env-var value MUST only be used as a fallback when no DB profile exists.
- **FR-006**: The profile settings page MUST pre-populate with current values when a profile exists.
- **FR-007**: All profile endpoints MUST require the same API token authentication as existing endpoints.

**Filtering & Analytics**
- **FR-008**: System MUST provide keyword search filtering over job title and technology stack fields without a server round-trip.
- **FR-009**: System MUST provide contract type filtering (B2B / UoP / Both).
- **FR-010**: System MUST provide salary range filtering via min/max inputs or sliders.
- **FR-011**: System MUST provide source filtering (JustJoin / NoFluff / Both).
- **FR-012**: All filters MUST combine with AND logic (a job must satisfy all active filters to appear).
- **FR-013**: Filtering MUST operate entirely client-side over the already-fetched job array.
- **FR-014**: System MUST display a "Top 5 demanded skills" widget aggregated from jobs where match_score ≥ 80, updating whenever filters change.
- **FR-015**: System MUST provide a "Clear all filters" control that resets all filters to their default (show all) state.

**ETL Monitoring**
- **FR-016**: System MUST use structured logging (pino or equivalent) for all backend log output.
- **FR-017**: ETL orchestrator MUST wrap the full run in a top-level error handler that catches unexpected exceptions.
- **FR-018**: On a fatal scraper error (5xx response from external API), System MUST send a Telegram critical alert containing the source name, HTTP status, and timestamp.
- **FR-019**: On a DB connection failure during ETL, System MUST abort the run and send a Telegram alert containing "DB connection lost" and the error message snippet.
- **FR-020**: On an Ollama failure (crash, OOM, timeout), System MUST log a warning, skip scoring for the affected job, persist the job without a score, and send a Telegram warning (not a fatal alert).
- **FR-021**: Telegram dispatch failures MUST be caught, logged, and MUST NOT propagate to crash the ETL process.

### Key Entities

- **UserProfile**: Represents the operator's professional profile used by the AI scorer. Key attributes: skills (list of strings), resume_text (freeform), preferred_contract (b2b | uop | both), search_preferences (freeform). Single-row table; upsert on update.
- **FilterState**: Client-side only. Tracks active keyword, contract type, salary range, and source selection. No persistence required.
- **ETLRunResult**: Implicit — captured in structured logs. Fields: run_start, run_end, jobs_fetched, jobs_inserted, jobs_scored, errors[].

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can update their profile and see the change reflected in the next ETL scoring run without any server restart or config file edit.
- **SC-002**: Filtering 200 jobs by keyword, contract type, salary, and source responds in under 100ms on a mid-range device.
- **SC-003**: The analytics widget correctly identifies the top 5 skills across high-match jobs and updates immediately when filter state changes.
- **SC-004**: A simulated fatal ETL error (DB drop, scraper 5xx) produces a Telegram alert within 30 seconds of the error occurring.
- **SC-005**: Zero ETL crashes caused by Telegram dispatch failures — monitoring must not become a new single point of failure.
- **SC-006**: All backend logs are machine-parseable structured JSON after pino integration.

---

## Assumptions

- Single-user system: the profile table has exactly one row (the operator's profile); no multi-user or role separation is required.
- The existing `X-API-TOKEN` auth mechanism is sufficient for profile endpoints — no additional auth layer is needed.
- Filtering is client-side only; no server-side pagination or search index is required at this scale (hundreds of jobs).
- Salary filter uses the B2B salary range when B2B is selected and UoP range when UoP is selected; when "Both" is selected it filters by whichever salary field is non-null.
- The `tech_stack` field in `ai_analysis` is a JSON-encoded string array; the frontend parses it for both filtering and analytics aggregation.
- pino replaces Fastify's default logger (`logger: true`) — Fastify's built-in logger is already pino under the hood, so this is a configuration change, not a library swap.
- Telegram alert format for critical errors: `🚨 CRITICAL: ETL Pipeline Failed\n<error type>\n<snippet>\n<timestamp>`.
- Ollama errors during scoring are warnings, not fatal — the system was already designed to handle Ollama unavailability gracefully (Phase 5 implementation).
