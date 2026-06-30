# Feature Specification: Filter Edge-Case Patches

**Feature Branch**: `008-filter-edge-case-patches`

**Created**: 2026-06-30

**Status**: Draft

**Input**: User description: "Edge-Case Patching for Pre-Filter Regex, Localization, and Empty Description Guard Clauses"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Empty Description Guard (Priority: P1)

A job listing arrives with no description or a description shorter than 30 characters (e.g., JustJoin stub "[category:javascript]"). The system must not invoke the AI scoring pipeline for that job and instead fall back gracefully.

**Why this priority**: Without this guard, the AI model receives a near-empty prompt and copies the prompt template verbatim as the summary — a data quality regression that corrupts the board view.

**Independent Test**: Run ETL with a seeded job that has `description = null` (or length < 30). Confirm the AI pipeline is never called and the job receives `summary = job.title` with a deterministic baseline score.

**Acceptance Scenarios**:

1. **Given** a job with `description = null`, **When** ETL processes it, **Then** Ollama is never called and the job is persisted with `summary = job.title` and `match_score = 10`.
2. **Given** a job with `description = "[category:javascript]"` (22 chars), **When** ETL processes it, **Then** same fallback applies — Ollama is not invoked.
3. **Given** a job with a 31-character description, **When** ETL processes it, **Then** normal two-pass Ollama flow proceeds unchanged.

---

### User Story 2 - Word-Boundary Regex for Java/Python (Priority: P1)

Job titles like "Java+" or "Fullstack (Java+React+TypeScript)" or "Java/React Developer" must be correctly identified as non-target roles and blocked before the AI pipeline. Current string-include checks miss punctuation-adjacent variants.

**Why this priority**: False negatives waste Ollama tokens and pollute the board with irrelevant roles. Fixing regex precision has zero risk of false positives when anchored by word boundaries.

**Independent Test**: Feed a list of known-problematic titles through the negative filter. All Java/Python-primary titles must be blocked; JS/TS-only titles must pass.

**Acceptance Scenarios**:

1. **Given** title `"Java+ Developer"`, **When** negative filter runs, **Then** job is blocked (`match_score = 0`).
2. **Given** title `"Fullstack (Java+React+TypeScript)"`, **When** negative filter runs, **Then** job is blocked.
3. **Given** title `"Java/React Engineer"`, **When** negative filter runs, **Then** job is blocked.
4. **Given** title `"JavaScript Developer"`, **When** negative filter runs, **Then** job passes (no false positive).
5. **Given** title `"Python Data Engineer"`, **When** negative filter runs, **Then** job is blocked.

---

### User Story 3 - NoFluffJobs Category Mapping (Priority: P2)

NoFluffJobs API responses include native category or specialization fields (e.g., `"Python"`, `"DevOps"`). These must be extracted and surfaced as a description stub so the keyword/negative filters can intercept non-JS/TS roles before Ollama scoring.

**Why this priority**: Without category propagation, Python-category jobs from CloudFerro and similar companies pass the keyword filter on company name / generic title alone and consume Ollama capacity.

**Independent Test**: Mock a NoFluffJobs API response with category `"python"`. Confirm the scraped job carries `[category:python]` in description. Confirm ETL then blocks it via negative filter before Ollama.

**Acceptance Scenarios**:

1. **Given** a NoFluffJobs listing with category `"python"`, **When** scraper runs, **Then** job description contains `[category:python]`.
2. **Given** a NoFluffJobs listing with category `"javascript"`, **When** scraper runs, **Then** job description contains `[category:javascript]` and passes keyword filter.
3. **Given** a NoFluffJobs listing with no category field, **When** scraper runs, **Then** description is set to `undefined` (no stub injected).

---

### User Story 4 - Polish Seniority Blockers (Priority: P2)

Job titles in Polish use "Starszy" (Senior), "Lider" (Lead), and "Ekspert" (Expert). These must be rejected by the seniority filter just as English equivalents are, when the user profile targets junior/mid roles.

**Why this priority**: Polish-language listings from Polish job boards bypass the current English-only seniority check, causing senior roles to reach the board when they should be filtered.

**Independent Test**: With a user profile targeting `["junior", "mid"]`, feed a job titled `"Starszy Programista TypeScript"`. Confirm it is blocked with reason `seniority`.

**Acceptance Scenarios**:

1. **Given** profile `target_seniority: ["junior"]` and title `"Starszy Developer Node.js"`, **When** relevance filter runs, **Then** job is blocked with reason `seniority`.
2. **Given** profile `target_seniority: ["mid"]` and title `"Lider Zespołu Frontend"`, **When** relevance filter runs, **Then** job is blocked.
3. **Given** profile `target_seniority: ["junior"]` and title `"Ekspert TypeScript"`, **When** relevance filter runs, **Then** job is blocked.
4. **Given** no seniority profile configured and title `"Starszy Developer"`, **When** relevance filter runs, **Then** job passes (filter only active when profile targets junior/mid).

---

### User Story 5 - False Negative Prevention for Frontend Roles (Priority: P2)

Some job titles combine an infrastructure label (e.g., "Platform Engineer") with a front-end technology keyword (e.g., "Angular Platform Engineer"). The current blocklist incorrectly rejects these. The system must pass jobs where a highly-relevant frontend keyword co-occurs in the title.

**Why this priority**: Blocking "Angular Platform Engineer" is a direct false negative — the role is clearly frontend-relevant. The current approach sacrifices precision for simplicity.

**Independent Test**: Feed title `"Angular Web Platform Engineer"` through the negative filter. Confirm it passes. Feed `"Cloud Platform Engineer"` (no frontend keyword). Confirm it is blocked.

**Acceptance Scenarios**:

1. **Given** title `"Angular Web Platform Engineer"`, **When** negative filter runs, **Then** job passes (not blocked).
2. **Given** title `"React Platform Engineer"`, **When** negative filter runs, **Then** job passes.
3. **Given** title `"Frontend Platform Engineer"`, **When** negative filter runs, **Then** job passes.
4. **Given** title `"TypeScript Platform Engineer"`, **When** negative filter runs, **Then** job passes.
5. **Given** title `"Cloud Platform Engineer"` (no frontend keyword), **When** negative filter runs, **Then** job is blocked.

---

### Edge Cases

- What if a job description is exactly 30 characters — should it pass or be guarded? (Boundary: `< 30` means 29 chars or less is guarded; 30 chars passes.)
- What if a NoFluffJobs listing has a category array vs. a single string? Scraper should handle both by taking the first element or joining.
- What if "Starszy" appears in a company name, not the title? Filter should check title only to avoid false positives on company names like "Starszy & Partners".
- What if a title contains both "Angular" and "DevOps Engineer"? Frontend override takes precedence — job passes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST skip AI scoring for any job whose description is absent or shorter than 30 characters, and persist `summary = job.title` with `match_score = 10`.
- **FR-002**: System MUST use word-boundary-aware matching (case-insensitive) to detect "java" and "python" in job titles/descriptions, including punctuation-adjacent forms (`java+`, `java/`, `(java)`).
- **FR-003**: System MUST block a job via the negative filter when "java" or "python" appear as standalone technology identifiers in the title, regardless of surrounding punctuation.
- **FR-004**: System MUST NOT block a job that contains "javascript" purely because "java" is a substring — the word-boundary regex must exclude that case.
- **FR-005**: The NoFluffJobs scraper MUST extract the native category/specialization field from the API response and store it as a `[category:<value>]` stub in the job description, mirroring the JustJoin behavior.
- **FR-006**: System MUST add Polish senior-role keywords ("Starszy", "Lider", "Ekspert") to the seniority rejection check applied to job titles, active only when the user profile targets junior or mid seniority.
- **FR-007**: System MUST NOT block a job via the infrastructure-role blocklist (e.g., "platform engineer") if the same job title also contains a high-priority frontend keyword ("Angular", "React", "Frontend", "TypeScript", "Vue", "Next.js").
- **FR-008**: All existing negative and relevance filter behaviors must remain intact for roles not affected by these five patches.

### Key Entities

- **Job**: A scraped job listing with title, company, description (nullable), source, and derived category tag. The description field may carry a `[category:X]` stub injected by scrapers.
- **FilterProfile**: User preferences including target seniority levels and maximum experience years. Drives seniority and experience gating.
- **Analysis**: Persisted AI scoring result (match_score, summary, tech_stack). The empty-description guard produces a deterministic analysis record without AI involvement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero jobs with an empty or stub-only description trigger an AI scoring call — verified by ETL logs showing no `[ETL] pass1` entries for such jobs.
- **SC-002**: 100% of Java/Python-primary job titles (including `java+`, `java/`, `(java)` variants) are blocked by the negative filter — verified by running a fixed set of 20 known-problematic titles through the filter function.
- **SC-003**: CloudFerro-style Python roles from NoFluffJobs are blocked before Ollama in the next production ETL run, with no Python-category NoFluffJobs job reaching the board.
- **SC-004**: Polish-titled senior roles (Starszy / Lider / Ekspert) do not appear on the board when the user profile targets junior/mid — verified by inspecting ETL filter logs post-run.
- **SC-005**: Frontend-keyword-qualified "platform engineer" titles are no longer false-negatives — at least 1 such role reaches the board in the next ETL run if present in scraper output.
- **SC-006**: No regression in existing correct-positive or correct-negative filter decisions — verified by unit tests covering the unchanged paths.

## Assumptions

- The baseline `match_score` for empty-description jobs is set to `10` (low but non-zero, visible on the board for manual review). This avoids hiding the job entirely while signaling low confidence.
- "Frontend keywords" that override the infrastructure blocklist are: Angular, React, Frontend, TypeScript, Vue, Next.js — this list is fixed for this patch and does not require DB configuration.
- Polish seniority terms are matched case-insensitively on the job title only (not description), consistent with how English seniority terms are checked.
- NoFluffJobs API provides a `category` or `technology` field at the top level of each listing object. If absent, no stub is injected.
- Word-boundary regex for java/python replaces only the space-padded string entries in NEGATIVE_KEYWORDS; other entries (`.net`, `php`, etc.) are unchanged.
- The empty-description guard runs after the negative filter but before the Ollama call — jobs still pass through isNegativeJob and can receive score=0 if they match the blocklist, even with short descriptions.
