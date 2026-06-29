# Feature Specification: Bulletproof Resource-Constrained ETL & AI Pipeline

**Feature Branch**: `007-bulletproof-etl-pipeline`

**Created**: 2026-06-29

**Status**: Draft

**Input**: User description: "Bulletproof, high-performance, resource-constrained ETL & AI pipeline for pl-jobhunter on 1GB Oracle Free Tier VPS. Fix four production failures: empty filter config (SEARCH_PREFERENCES stringified JSON never parsed), LLM first-person hallucination/inversion, JSON syntax truncation from OOM/token exhaustion, and ORA-01400 crash on null SUMMARY. Design four layers: LLM strategy & resource optimization, memory-bounded staging & batching, smart deterministic regex pre-filtering, and defensive self-healing JSON parsing."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Filter preferences are actually applied (Priority: P1)

The job-seeker has configured search preferences (target seniority of junior/mid, maximum 3 years of required experience). On every pipeline run, the system reads those preferences correctly and uses them to discard jobs that do not fit, so the job-seeker only sees roles that match their stated career stage.

**Why this priority**: Today 100% of scraped jobs bypass filtering because preferences resolve to an empty object. This is the root failure — every other layer depends on preferences being available. Without it the user is flooded with senior/irrelevant roles and the expensive AI stage is wasted on jobs that should never have reached it.

**Independent Test**: Configure preferences, run the pipeline against a batch containing known senior and over-experienced postings, and confirm those postings are absent from the final reviewable list while matching junior/mid postings are present. Verifiable on its own with no AI involvement.

**Acceptance Scenarios**:

1. **Given** preferences are stored as a stringified JSON blob, **When** the pipeline reads them, **Then** the resolved preferences contain the populated seniority list and experience cap (never an empty object).
2. **Given** valid preferences, **When** a batch of ~1,500 raw jobs is processed, **Then** roughly 80% are discarded by deterministic rules before any AI evaluation occurs.
3. **Given** preferences cannot be resolved or are malformed, **When** the pipeline starts, **Then** the run logs an explicit warning identifying the misconfiguration and applies a safe default rather than silently passing all jobs through.

### User Story 2 - Pipeline survives the 1 GB memory limit (Priority: P1)

The pipeline processes a full batch of ~1,500 scraped listings on a 1 GB VPS that also runs the API service, the database client, and the local AI model, without the operating system killing any process for running out of memory.

**Why this priority**: An out-of-memory kill aborts the entire run, leaving the user with no fresh jobs and corrupting partial state. Memory safety is a hard precondition for the pipeline completing at all.

**Independent Test**: Run a full batch on a constrained 1 GB instance and confirm the run completes end-to-end with no out-of-memory termination and peak memory staying within budget.

**Acceptance Scenarios**:

1. **Given** ~1,500 raw items, **When** the pipeline runs, **Then** items are processed in bounded groups so that total resident memory never exceeds the instance budget.
2. **Given** the AI stage is in progress, **When** evaluations run, **Then** no more than a fixed small number proceed concurrently, preventing memory spikes.
3. **Given** a single item fails mid-batch, **When** processing continues, **Then** remaining items still complete and the failure does not abort the whole run.

### User Story 3 - AI output describes the company, never the user (Priority: P2)

For every job that reaches AI evaluation, the generated summary objectively describes what the employer is seeking, in third person. It never adopts the job-seeker's voice or produces first-person text such as "I am a TypeScript developer looking for a role."

**Why this priority**: First-person inversion makes summaries useless and confusing, eroding trust in the entire product, but it only affects jobs that already passed filtering — a smaller blast radius than P1 failures.

**Independent Test**: Submit a set of postings, inspect every generated summary, and confirm none contain first-person self-description and each reads as an objective statement of employer requirements.

**Acceptance Scenarios**:

1. **Given** a job posting plus the user's skills, **When** the AI produces a summary, **Then** the summary is written in third person about the employer's requirements.
2. **Given** the AI nonetheless returns first-person text, **When** the output is post-processed, **Then** the inverted output is detected and replaced with a safe fallback rather than persisted as-is.

### User Story 4 - No malformed AI output ever crashes the run or the database (Priority: P1)

When the AI returns broken output — truncated mid-sentence, wrapped in markdown, missing closing braces, or with a null/empty summary — the system repairs what it can, falls back to a safe record when it cannot, and always writes a valid, complete record. No malformed output aborts the run, and no missing field violates a mandatory database column.

**Why this priority**: Truncation errors and null-summary database violations are observed in production logs aborting runs and crashing execution threads. This guarantees durability of the whole pipeline regardless of model misbehaviour.

**Independent Test**: Feed the parsing stage a corpus of deliberately broken AI responses (truncated, markdown-wrapped, null fields) and confirm every one results in either a successfully repaired record or a safe fallback record, with zero unhandled errors and zero rejected database writes.

**Acceptance Scenarios**:

1. **Given** AI output wrapped in markdown fences or trailing commentary, **When** it is parsed, **Then** the embedded record is extracted and parsed successfully.
2. **Given** AI output truncated mid-string, **When** repair runs, **Then** the system either reconstructs a valid record or substitutes a safe fallback — it never throws an unhandled error.
3. **Given** a resolved record with a null or empty summary, **When** it is persisted, **Then** a non-empty placeholder summary is written so the mandatory column constraint is never violated.
4. **Given** any AI or parsing failure for an item, **When** the item is persisted, **Then** a complete fallback record is written and the item is flagged for manual review.

### User Story 5 - Cross-training roles are surfaced, not filtered out (Priority: P3)

When a posting signals it welcomes candidates without prior experience in a given technology (e.g., "willing to train", "open to cross-train", "no previous experience needed"), the system bypasses the strict technology-keyword block and promotes the job to the user's review list even if the exact stack does not match.

**Why this priority**: Captures opportunity the strict filters would otherwise discard, valuable for a junior/career-changing job-seeker, but it is an enhancement on top of the core filtering rather than a failure fix.

**Independent Test**: Submit postings containing cross-training language with non-matching tech stacks and confirm they appear in the review list rather than being rejected by keyword rules.

**Acceptance Scenarios**:

1. **Given** a posting whose required stack does not match the user but whose text contains a cross-training phrase, **When** filtering runs, **Then** the posting bypasses the keyword block and is promoted to review.
2. **Given** a posting with a cross-training phrase but a seniority or experience level above the user's cap, **When** filtering runs, **Then** the higher-priority seniority/experience rules still reject it (the wildcard does not override those).

### Edge Cases

- Preferences field present but contains invalid JSON → log explicit warning, apply safe default, do not pass all jobs through.
- Preferences field returned under an unexpected (uppercase) key casing → resolution must still find and parse it.
- Job has no description text → experience and cross-training rules are skipped gracefully; seniority rule still applies on the title.
- Experience phrase gives a range (e.g., "3-5 lat") → the higher bound is used for the cap comparison.
- Multiple experience phrases in one posting → the maximum stated requirement governs the decision.
- AI service unavailable or times out → item gets a safe fallback record and is flagged for review; run continues.
- AI returns valid JSON but with an out-of-range or non-numeric match score → value is clamped/normalized to the valid range.
- External AI endpoint (if used) rate-limits or fails → pipeline degrades to a safe fallback per item without aborting.

## Requirements *(mandatory)*

### Functional Requirements

#### Layer 1 — Preference Resolution & Pre-Filtering

- **FR-001**: System MUST resolve stored search preferences regardless of the casing of the returned field key and MUST parse the stringified JSON blob into a structured object before use.
- **FR-002**: System MUST treat an unresolved, empty, or malformed preference object as a misconfiguration: it MUST log an explicit warning identifying the problem and MUST apply a safe default instead of allowing all jobs to bypass filtering.
- **FR-003**: System MUST reject a posting whose title indicates a seniority above the user's target seniority (negative list including Senior, Lead, Principal, Architect, Staff) when the user's target is junior/mid.
- **FR-004**: System MUST extract the required years of experience from posting text in both English and Polish phrasings (e.g., "3+ years", "min. 2 lata", "3-5 lat doświadczenia") and MUST reject postings whose required experience exceeds the user's maximum, using the highest stated value when several appear.
- **FR-005**: System MUST bypass the strict technology-keyword block and promote a posting to user review when the posting text contains a cross-training signal, except where higher-priority seniority or experience rules already reject it.
- **FR-006**: The deterministic pre-filter MUST run before any AI evaluation and MUST be capable of discarding roughly 80% of a typical batch, so the AI stage processes only the residual relevant subset.
- **FR-007**: System MUST log, per discarded job, the rule that caused rejection (seniority, experience, or keyword) for observability.

#### Layer 2 — Memory-Bounded Staging & Batching

- **FR-008**: System MUST process a full batch (~1,500 items) in bounded groups so that total resident memory stays within the 1 GB instance budget shared with the API service, database client, and AI model.
- **FR-009**: System MUST cap the number of concurrent AI evaluations to a fixed small pool to prevent memory spikes.
- **FR-010**: System MUST isolate per-item failures so that one failing item does not abort the remainder of the batch.

#### Layer 3 — LLM Strategy & Output Integrity

- **FR-011**: System MUST produce job summaries written in objective third person describing the employer's requirements, and MUST NOT persist first-person/inverted summaries; detected inversions MUST be replaced with a safe fallback.
- **FR-012**: System MUST constrain AI output to the minimal required schema (match score, summary, technology list) and minimise generated output length to reduce truncation risk and resource use.
- **FR-013**: The selected AI approach MUST operate within the instance budget; the specification permits either a local small model or an external endpoint, and the chosen approach MUST degrade safely (per-item fallback) when the AI is unavailable, slow, or rate-limited. *(Comparative evaluation of local vs. external options is captured in planning.)*

#### Layer 4 — Defensive Parsing & Persistence Fallbacks

- **FR-014**: System MUST sanitize raw AI text before parsing — stripping markdown fences, trailing commentary, and extraneous tokens, and extracting the intended record by block boundaries.
- **FR-015**: System MUST attempt structured repair of incomplete output (e.g., truncated strings, missing closing delimiters) and, when repair is not possible, MUST substitute a complete safe fallback record rather than raising an unhandled error.
- **FR-016**: System MUST guarantee every persisted record satisfies all mandatory field constraints; in particular the summary field MUST always be a non-empty value, eliminating the null-summary database violation.
- **FR-017**: System MUST normalize the match score to the valid range and MUST flag any item resolved via fallback for manual review.

### Key Entities *(include if feature involves data)*

- **Search Preferences**: The job-seeker's filtering configuration — target seniority levels and maximum acceptable years of experience. Stored as a serialized blob and resolved into a structured object at pipeline start.
- **Raw Job**: A scraped listing with at least a title, employer, and optional description text; the input to the pre-filter.
- **Filtered Job**: A raw job that survived deterministic pre-filtering and is eligible for AI evaluation.
- **AI Analysis Record**: The structured result for a job — match score, third-person summary, technology list, and a review flag — guaranteed complete and constraint-valid before persistence.
- **Fallback Record**: A complete, constraint-valid AI Analysis Record produced when AI output is missing, malformed, or unrepairable, always flagged for manual review.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of pipeline runs resolve non-empty search preferences when preferences are configured (zero runs where filtering is silently bypassed due to an empty preference object).
- **SC-002**: At least ~80% of a typical batch is discarded by deterministic rules before AI evaluation, reducing AI workload to the residual relevant subset.
- **SC-003**: Zero out-of-memory process terminations across full-batch runs on the 1 GB instance.
- **SC-004**: Zero pipeline runs aborted by malformed AI output; every item ends with either a valid record or a safe fallback.
- **SC-005**: Zero database write rejections caused by missing mandatory fields (no null-summary constraint violations).
- **SC-006**: Zero persisted summaries containing first-person/inverted self-description.
- **SC-007**: Every item resolved via fallback is flagged for manual review, so no silent data loss occurs.
- **SC-008**: A full batch of ~1,500 items completes end-to-end within the scheduled interval without manual intervention.

## Assumptions

- Search preferences are configured by the job-seeker and stored as a serialized JSON blob in the existing profile store; this feature reads and parses them but does not add a configuration UI.
- Scraper output volume is ~1,500 items per batch run; descriptions may be absent for some sources, so description-dependent rules degrade gracefully.
- The deployment target remains a single 1 GB Oracle Free Tier VPS shared by the API service, database client, and AI workload; no infrastructure upsize is in scope.
- The existing database schema (mandatory summary column, analysis table) is unchanged; this feature adapts application behaviour to satisfy existing constraints rather than altering them.
- "Junior/mid" with a 3-year experience cap is the representative user profile for acceptance, but rules are driven by the resolved preference values, not hardcoded.
- The choice between a local small model and an external AI endpoint is a planning decision; the specification requires only that the chosen approach fit the memory budget and degrade safely.
- Polish and English are the languages present in posting text relevant to experience extraction; other languages are out of scope for the experience extractor.
