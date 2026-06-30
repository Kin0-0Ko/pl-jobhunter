# Feature Specification: ETL Audit Fixes & Telegram Boost

**Feature Branch**: `009-etl-audit-telegram-boost`

**Created**: 2026-06-30

**Status**: Draft

**Input**: Production log audit + user request for Telegram bot enrichment and frontend tech_stack display

## User Scenarios & Testing *(mandatory)*

### User Story 1 - AI Output Quality Guard (Priority: P1)

After each ETL run the user opens the job board and sees real summaries and a populated `why_good` field for each scored job. Currently `summary` contains template-literal placeholders (e.g. `"<one sentence: what the company builds or needs>"`) and `why_good` is always a single space. The system must reject low-quality AI output and re-prompt or fall back gracefully.

**Why this priority**: Corrupted summaries are immediately visible on the board and destroy trust in the scoring system. Empty `why_good` means the second Ollama pass produces no useful output — the two-pass architecture delivers zero extra value.

**Independent Test**: Trigger ETL with a known job. Confirm `summary` in `ai_analysis` contains a real sentence (no `<` chars, ≥ 20 chars) and `why_good` is a non-empty, non-whitespace string.

**Acceptance Scenarios**:

1. **Given** Ollama returns a summary containing `<`, **When** ETL persists the analysis, **Then** summary is replaced with `job.title` as fallback and `match_score` is set to 10.
2. **Given** Ollama returns a summary shorter than 20 characters, **When** ETL persists the analysis, **Then** same fallback applies.
3. **Given** Ollama pass 2 returns `why_good = " "` or empty string, **When** ETL persists, **Then** `why_good` is stored as `null` / empty string (not whitespace) so the UI can hide it cleanly.
4. **Given** a valid Ollama response with good summary and why_good, **When** ETL runs, **Then** both fields are persisted verbatim.
5. **Given** Ollama pass 2 JSON repair fails, **When** fallback fires, **Then** the raw Ollama response text is logged at WARN level alongside the `[ETL] pass2: JSON repair failed` message.

---

### User Story 2 - tech_stack Populated on Board (Priority: P1)

The job board shows a tech stack badge list for each job card. Currently `tech_stack` is `[]` for every job even after AI scoring — the extraction pass does not write it. The user wants to see e.g. "React · Node.js · TypeScript" under each job title.

**Why this priority**: `tech_stack` is the primary signal a candidate uses to decide whether to click a job. Empty arrays make every card look identical.

**Independent Test**: After one ETL run, query `ai_analysis` for any scored job. Confirm `tech_stack` is a non-empty JSON array of strings. Open the frontend job card and confirm the tech badges render.

**Acceptance Scenarios**:

1. **Given** Ollama extraction pass returns `tech_stack: ["React", "Node.js"]`, **When** ETL upserts `ai_analysis`, **Then** `tech_stack` column stores `["React","Node.js"]`.
2. **Given** the frontend job card component, **When** `tech_stack` is non-empty, **Then** each item renders as a pill/badge below the job title.
3. **Given** the frontend job card component, **When** `tech_stack` is empty or null, **Then** no badge row is rendered (no empty space).
4. **Given** the job detail modal, **When** opened, **Then** full `tech_stack` list is visible (not truncated).

---

### User Story 3 - Salary Anomaly Detection (Priority: P1)

Several scraped jobs show `salary_b2b_min` values of 40–190 PLN — these are clearly hourly rates in EUR/USD mistakenly stored as monthly PLN. The board displays "40–45 PLN" which is nonsensical. The system must detect implausibly low monthly salaries and flag or normalize them.

**Why this priority**: A candidate seeing "45 PLN/month" will distrust the entire board. Salary is the second-most-scanned field after title.

**Independent Test**: Seed a job with `salary_b2b_min = 45`, `salary_b2b_max = 60`, `currency = "PLN"`. Confirm the UI renders a "⚠ rate?" badge or "~9k–12k PLN est." label instead of the raw value.

**Acceptance Scenarios**:

1. **Given** a job with `salary_b2b_min < 500` and `currency = "PLN"`, **When** the frontend renders the salary, **Then** it displays a warning badge (e.g. "⚠ hourly?") next to the value.
2. **Given** a job with `salary_b2b_min = 120` (hourly EUR), **When** the frontend renders it, **Then** it optionally shows an estimated monthly conversion (120 × 168h = ~20k PLN).
3. **Given** a job with `salary_b2b_min = 15000`, **When** the frontend renders the salary, **Then** no warning badge appears (normal monthly PLN).
4. **Given** `salary_b2b_min = null`, **When** the frontend renders, **Then** "Salary not specified" or similar is shown without any badge.

---

### User Story 4 - End-of-Run Telegram Summary (Priority: P2)

After an ETL run completes the user receives a single Telegram message with the full run summary and the top scored new jobs — including title, company, salary range, match score, and tech stack. Currently the bot sends one alert per high-scoring job *during* the run (spammy, no context) and `/status` shows only DB/Ollama health with no job data.

**Why this priority**: The bot is the primary mobile notification channel. Per-job alerts mid-run are noise; a single post-run digest is actionable. The user needs to see the board state *after* all scoring is done, not a stream of partial results.

**Independent Test**: Trigger ETL. Confirm only one Telegram message arrives (not one per job). Confirm it contains run stats and top 5 new jobs sorted by score. Send `/status` — confirm it returns the same digest.

**Acceptance Scenarios**:

1. **Given** ETL run completes with 48 new jobs, **When** run finishes, **Then** exactly one Telegram message is sent with fetched/filtered/inserted/scored/fallback counts and top 5 jobs by `match_score DESC`.
2. **Given** a job in top 5 has `tech_stack = ["React", "TypeScript"]`, **When** message renders it, **Then** stack line shows `Stack: React, TypeScript`.
3. **Given** a job has `salary_uop_min = 13000`, `salary_uop_max = 19000`, **When** rendered, **Then** salary shows as `13k–19k PLN`.
4. **Given** ETL run inserts 0 new jobs, **When** run finishes, **Then** message states "No new jobs this run" with fetched/filtered counts — still sent so the user knows the run happened.
5. **Given** `tech_stack` is empty for a job, **When** message renders it, **Then** stack line is omitted entirely.
6. **Given** user sends `/status` after a completed run, **When** command received, **Then** bot replies with the same digest format as the post-run message.
7. **Given** no ETL run has completed since backend start, **When** user sends `/status`, **Then** bot replies "No ETL run recorded yet."

---

### User Story 5 - /scrape In-Process with Follow-Up (Priority: P2)

When the user sends `/scrape`, the bot immediately acknowledges the command, runs the ETL pipeline in-process (not as a detached child), and sends the post-run digest when complete. Currently `/scrape` spawns a detached child process and has no way to notify the user when the run finishes.

**Why this priority**: The detached-child approach breaks the follow-up notification — the bot process cannot receive the ETL result. Running in-process allows the post-run message to fire reliably.

**Independent Test**: Send `/scrape`. Confirm: (1) immediate ACK within 2 seconds, (2) no individual per-job alerts during the run, (3) single follow-up digest message after the run completes.

**Acceptance Scenarios**:

1. **Given** user sends `/scrape`, **When** command is received, **Then** bot replies "⚡ ETL triggered ✅" within 2 seconds.
2. **Given** `/scrape` ETL run is in progress, **When** any high-scoring job is processed, **Then** no per-job Telegram alert is sent (suppressed until run end).
3. **Given** `/scrape` ETL run completes, **When** run finishes, **Then** bot sends the post-run digest to the same chat (identical format to the scheduled run message).
4. **Given** `/scrape` is sent while a run is already active, **When** command received, **Then** bot replies "⏳ ETL already running — please wait." and does not start a second run.
5. **Given** ETL fails mid-run with a critical error, **When** run aborts, **Then** bot sends an error summary instead of the normal digest.

---

### User Story 6 - Bind Backend to Localhost Only (Priority: P3)

Scanner bots are hitting the Fastify backend directly on the public IP:port (92.5.50.4:3000). Auth correctly returns 401 for all, but the surface should not be exposed at all. Fastify should bind to 127.0.0.1 only, with Caddy as the sole public-facing entry point.

**Why this priority**: Defense-in-depth. Even though auth blocks probes, binding to loopback eliminates the attack surface entirely and removes scanner noise from logs.

**Independent Test**: On the VPS, confirm `curl http://92.5.50.4:3000/` times out (connection refused). Confirm `curl http://127.0.0.1:3000/` returns the expected 401 (caddy still proxies correctly).

**Acceptance Scenarios**:

1. **Given** Fastify starts with host `127.0.0.1`, **When** a request arrives on the public IP:port directly, **Then** connection is refused (no response).
2. **Given** Caddy proxies to `localhost:3000`, **When** a valid API request comes through Caddy, **Then** request is forwarded and processed correctly.
3. **Given** the Docker container network, **When** Fastify binds to `0.0.0.0` is changed to `127.0.0.1`, **Then** Caddy container can still reach it via the Docker bridge network (may require `host.docker.internal` or shared network).

---

### Edge Cases

- What if Ollama returns valid JSON but `tech_stack` key is missing entirely? Treat as empty array, do not error.
- What if salary threshold (< 500 PLN) flags a legitimate junior part-time role? Badge should say "⚠ hourly?" not "invalid" — leaves room for ambiguity.
- What if `/scrape` is called while a run is already in progress? Bot replies "already running" — needs an `isRunning` boolean guard in the ETL module.
- What if the Telegram post-run digest fails to send (network error)? Log the failure — one attempt only, do not block ETL completion on Telegram success.
- What if the scheduled cron ETL and a `/scrape`-triggered ETL race? Same `isRunning` guard prevents double-run regardless of trigger source.
- What if `why_good` contains only whitespace variants (tabs, newlines)? Trim and treat as empty before persisting.
- What if `tech_stack` in the Ollama response is a string instead of an array (e.g. `"React, TypeScript"`)? Split on comma and trim each item to produce a proper array.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST reject any AI-generated `summary` that contains a `<` character or is shorter than 20 characters, falling back to `summary = job.title` and `match_score = 10`.
- **FR-002**: System MUST trim `why_good` and store `null` (or empty string) when the trimmed value is empty — never store whitespace-only values.
- **FR-003**: When Ollama pass 2 JSON repair fails, system MUST log the raw Ollama response text at WARN level alongside the existing failure message.
- **FR-004**: The ETL pipeline MUST correctly write the `tech_stack` array returned by Ollama pass 1 into the `ai_analysis` table for every scored job.
- **FR-005**: If Ollama returns `tech_stack` as a comma-separated string instead of an array, system MUST split and trim it into an array before persisting.
- **FR-006**: The frontend job card MUST display `tech_stack` items as visual badges when the array is non-empty.
- **FR-007**: The frontend job detail modal MUST display the full `tech_stack` list.
- **FR-008**: The frontend salary display MUST show a visual warning indicator when `salary_b2b_min < 500` and `currency = "PLN"`, without hiding the raw value.
- **FR-009**: The ETL pipeline MUST suppress all per-job Telegram alerts during a run and instead send a single post-run digest message when `runEtl()` completes.
- **FR-010**: The post-run digest MUST contain: run timestamp, fetched/filtered/inserted/scored/fallback counts, and top 5 new jobs sorted by `match_score DESC` (title, company, salary range, match_score, tech_stack if non-empty).
- **FR-011**: The digest MUST be sent even when `inserted = 0` (zero new jobs this run), stating "No new jobs this run" with the counts.
- **FR-012**: The Telegram `/status` command MUST return the last stored ETL run digest. If no run has completed since backend start, it MUST reply "No ETL run recorded yet."
- **FR-013**: The Telegram `/scrape` command MUST run ETL in-process (not as a detached child process) so the follow-up message fires reliably in the same Node.js process.
- **FR-014**: The `/scrape` command MUST reply "⚡ ETL triggered ✅" immediately (before ETL starts), then send the post-run digest when the run completes.
- **FR-015**: If `/scrape` is called while a run is already active, bot MUST reply "⏳ ETL already running — please wait." and not start a second instance.
- **FR-016**: Fastify MUST bind to `127.0.0.1` only (not `0.0.0.0`) so the backend port is not reachable on the public IP directly.
- **FR-017**: The `/status` and post-run digest MUST use Telegram MarkdownV2 formatting (bold headers, monospace counts).

### Key Entities

- **AIAnalysis**: Persisted scoring result per job — `match_score`, `summary`, `tech_stack` (JSON array), `why_good`. All four fields must be non-null/non-whitespace after a successful score.
- **ETLRunSummary**: In-memory (or lightweight persisted) record of the most recent ETL run — `started_at`, `rawTotal`, `filtered`, `inserted`, `scored`, `fallback`. Read by `/status` and the `/scrape` follow-up.
- **Job (frontend)**: Rendered entity combining `jobs` + `ai_analysis` join — must expose `tech_stack` to UI components for badge rendering and salary fields for anomaly detection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero jobs in `ai_analysis` have a `summary` containing `<` or shorter than 20 characters after a full ETL run — verified by DB query.
- **SC-002**: Zero jobs in `ai_analysis` have `why_good` equal to whitespace-only after a full ETL run.
- **SC-003**: At least 80% of Ollama-scored jobs have a non-empty `tech_stack` array after the next ETL run — verified by DB count query.
- **SC-004**: Every job card on the frontend renders tech stack badges when `tech_stack` is non-empty — verified visually and by component test.
- **SC-005**: Every job with `salary_b2b_min < 500 PLN` shows a warning badge in the frontend — verified by rendering a seeded fixture.
- **SC-006**: Exactly one Telegram message (the post-run digest) is sent per ETL run — zero per-job alert messages — verified by bot send-call count in tests.
- **SC-007**: `/status` reply arrives within 3 seconds and contains run stats plus ≥ 1 job entry when jobs were inserted in the last run.
- **SC-008**: `/scrape` acknowledgement reply arrives within 2 seconds; post-run digest arrives after ETL completes (no fixed cap — ETL runs 5–15 min).
- **SC-009**: `curl http://<public-ip>:3000/` returns connection refused on the VPS after the bind change — verified manually post-deploy.

## Assumptions

- The `ETLRunSummary` (timestamp, counts, top-5 jobs) is kept in-memory as a module-level variable — no new DB table needed. Resets to null on backend restart; `/status` replies "No ETL run recorded yet." in that case.
- The current `/scrape` spawns a detached child process (`spawn(..., { detached: true })`). This must change to an in-process async call (`runEtl()`) so the completion callback can send the follow-up digest. The scheduler cron already calls `runEtl()` in-process, so `/scrape` aligns with that pattern.
- Per-job `sendJobAlert` calls (currently fired per high-scoring job mid-run at etl.ts:265) are removed. The digest at run-end replaces them entirely.
- The salary anomaly threshold is `< 500 PLN` for monthly figures. Covers all observed hourly-rate anomalies (40–190) with margin above any realistic part-time monthly salary.
- Fastify bind change from `0.0.0.0` to `127.0.0.1` must be validated against the Docker network topology (Caddy may need `host.docker.internal` or shared bridge network to still reach the backend).
- All Telegram messages use `process.env.TELEGRAM_ADMIN_CHAT_ID` — same existing env var, no new config.
- `tech_stack` fix is a bug in the existing `persistAnalysis` call — the column exists in `ai_analysis`, data is just not being passed correctly from Ollama pass 1 output.
- Frontend salary warning is client-side rendering logic only — no backend API change needed.
- Top 5 jobs in the digest are drawn from the in-memory list of jobs inserted/scored in the current run, joined with their analysis results — no extra DB query needed at run-end.
