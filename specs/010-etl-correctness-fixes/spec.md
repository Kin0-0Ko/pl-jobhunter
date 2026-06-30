# Feature Specification: ETL Correctness & Efficiency Fixes

**Feature Branch**: `010-etl-correctness-fixes`

**Created**: 2026-06-30

**Status**: Draft

**Input**: User description: "ETL pipeline correctness & efficiency fixes from code audit. Fix bugs that regress scoring results and waste resources in the job-scraping ETL."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A single database hiccup must not wipe the whole run (Priority: P1)

The operator relies on the every-3-hour ETL run to keep the job board fresh. Today, if one job's database write fails for any transient reason, the entire run aborts and every job that had not yet been processed is silently dropped until the next run three hours later. The operator wants one bad write to cost at most that one job, not the whole batch.

**Why this priority**: This is the highest-impact correctness defect — a single transient fault discards hundreds of jobs and leaves the system flagged as failed even while it keeps running. It directly regresses the freshness and completeness the product exists to deliver.

**Independent Test**: Simulate a database write failure for one job mid-batch; confirm the remaining jobs in the batch are still processed, the run completes, the failed job is logged, and the process is not left in a failed state when running on a schedule.

**Acceptance Scenarios**:

1. **Given** a batch of many jobs, **When** the promotion write for one job fails transiently, **Then** that one job is skipped and logged and all subsequent jobs are still processed.
2. **Given** the run is triggered on the recurring schedule (not a one-shot), **When** a per-job write error occurs, **Then** the long-running service is NOT left marked as failed.
3. **Given** a genuinely fatal/repeated database fault, **When** it persists, **Then** the run still surfaces a critical alert so the operator is notified.

---

### User Story 2 - Stop re-fetching details for jobs we already have (Priority: P1)

For one source (JustJoin), the pipeline fetches the full job description from a secondary detail endpoint. Today it does this for every relevant job on every run — including jobs already stored and already scored — before checking whether the job is new. The operator wants the pipeline to skip already-complete jobs before spending a network round-trip on them.

**Why this priority**: Hundreds of redundant outbound detail calls per run create rate-limit exposure and materially slow each run. The wasted work scales with catalog size and grows every run.

**Independent Test**: Run the pipeline twice over the same source data; confirm the second run performs detail fetches only for jobs that are new or are missing a valid analysis, and performs zero detail fetches for jobs already stored with a valid analysis.

**Acceptance Scenarios**:

1. **Given** a source job already stored with a valid analysis, **When** the pipeline encounters it again, **Then** no detail fetch is performed for it.
2. **Given** a source job that is new or missing a valid analysis, **When** the pipeline encounters it, **Then** the detail fetch is performed and the enriched description is used for scoring.

---

### User Story 3 - Enriched and updated job data must actually be saved (Priority: P1)

When the pipeline enriches a job (replacing a placeholder category stub with the real description) or sees an updated salary on a re-posted job, that improved data is currently computed and then discarded because stored rows are never updated. The operator wants the stored record to reflect the best data the pipeline has seen.

**Why this priority**: Without this, the enrichment effort from User Story 2 is thrown away at the storage layer — stored rows keep a useless placeholder stub forever, degrading what the operator sees and what future runs reason about.

**Independent Test**: Store a job with a placeholder description, then run the pipeline when the real description is available; confirm the stored row now holds the real description (and updated salary where it changed), without creating a duplicate row.

**Acceptance Scenarios**:

1. **Given** a stored job whose description is still a placeholder stub, **When** the pipeline obtains the real description, **Then** the stored row's description is updated in place.
2. **Given** a re-posted job whose salary changed, **When** the pipeline processes it, **Then** the stored salary fields are updated without creating a duplicate row.

---

### User Story 4 - Stop wrongly rejecting good jobs (Priority: P2)

The pipeline maintains a blocklist of technologies that score a job to zero without further analysis. Today the blocklist is matched against the whole posting text, so incidental words inside a description (e.g. "let us go build", "we sap our energy") wrongly trigger the blocklist and a relevant job is zeroed out. The operator wants the blocklist to reject only jobs that are genuinely about a blocked technology.

**Why this priority**: False rejections silently hide jobs the operator wants. Lower than P1 because it degrades recall rather than wiping data, but it directly regresses scoring quality.

**Independent Test**: Feed jobs whose descriptions contain blocklist substrings as incidental words; confirm they are not zeroed, while jobs whose titles genuinely name a blocked technology are still zeroed.

**Acceptance Scenarios**:

1. **Given** a relevant job whose description incidentally contains a blocklist substring as part of an unrelated word, **When** it is evaluated, **Then** it is NOT auto-zeroed.
2. **Given** a job whose title genuinely names a blocked technology, **When** it is evaluated, **Then** it is still auto-zeroed without a scoring call.

---

### User Story 5 - Score using the full description we fetched (Priority: P2)

The pipeline fetches up to a larger amount of description text but then truncates to a smaller amount before scoring, discarding the remainder — which often contains the requirements and technology list most relevant to scoring. The operator wants scoring to consider the description text the pipeline actually obtained.

**Why this priority**: Discarding the most decision-relevant portion of a description degrades match-score accuracy. P2 because it lowers quality rather than losing jobs.

**Independent Test**: Provide a job whose key technologies appear only beyond the old truncation point; confirm those technologies are available to the scoring step.

**Acceptance Scenarios**:

1. **Given** a fetched description longer than the old scoring cap, **When** the job is scored, **Then** the scoring input includes the description up to the fetched amount, not an arbitrarily smaller slice.

---

### User Story 6 - Don't stall forever on a hung model, and fetch faster (Priority: P3)

Two efficiency concerns: (a) if the local scoring model hangs, the whole pipeline stalls indefinitely because scoring is serialized; and (b) the source fetches run one after another though they are independent. The operator wants a bounded wait on the model and faster fetching.

**Why this priority**: Reliability and speed improvements. P3 because the pipeline still produces correct results without them, just slower or, in the rare hang case, stuck.

**Independent Test**: (a) Make the model endpoint hang; confirm the scoring call gives up after a bounded time and the pipeline continues with its existing fallback behavior. (b) Confirm the sources are fetched concurrently and a single source failing still leaves the others' results intact.

**Acceptance Scenarios**:

1. **Given** the scoring model does not respond, **When** the bounded wait elapses, **Then** the scoring call aborts and the existing fallback record path is used.
2. **Given** multiple independent sources, **When** a run starts, **Then** they are fetched concurrently and one source failing does not prevent the others from contributing.

---

### Edge Cases

- A per-job write fails on the staging insert vs. on the promotion write — both must isolate to the single job.
- A job is new but its detail fetch fails — scoring proceeds with the best description available (existing fallback), not blocked.
- Reading the operator's matching profile fails mid-run — the run continues with the existing safe default rather than aborting.
- A re-posted job has fewer salary fields than before — updates must not clobber known values with nulls in a way that loses information the operator depends on. (See Assumptions.)
- The model endpoint responds slowly but within the bound — must not be aborted prematurely.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A failure writing a single job to the database MUST NOT abort processing of the remaining jobs in the run; the failing job MUST be skipped and logged.
- **FR-002**: When running on the recurring schedule, a per-job write failure MUST NOT leave the long-running service in a failed/poisoned state.
- **FR-003**: A genuinely fatal or repeated database fault MUST still raise a critical operator alert.
- **FR-004**: The pipeline MUST determine whether a job is already stored with a valid analysis BEFORE performing any secondary detail fetch for that job.
- **FR-005**: A secondary detail fetch MUST be performed only for jobs that are new or missing a valid analysis.
- **FR-006**: When the pipeline obtains a better description for an already-stored job, the stored row's description MUST be updated in place (no duplicate row).
- **FR-007**: When a re-posted job presents changed salary information, the stored salary fields MUST be updated without creating a duplicate row.
- **FR-008**: The technology blocklist MUST NOT auto-zero a job based on incidental substring matches in free-text; it MUST match only genuine technology references (e.g., title-scoped and/or word-boundary matching).
- **FR-009**: The blocklist MUST still auto-zero, without a scoring call, jobs that genuinely name a blocked technology.
- **FR-010**: The scoring step MUST receive description text up to the amount the pipeline actually fetched, not an arbitrarily smaller slice.
- **FR-011**: The operator matching profile MUST be read at most once per run and reused for every job, rather than re-read per job.
- **FR-012**: A scoring-model call MUST abort after a bounded maximum wait and fall back to the existing failure-record behavior.
- **FR-013**: Independent source fetches MUST run concurrently, and one source failing MUST NOT prevent other sources' results from being used.
- **FR-014**: All existing safeguards MUST be preserved: per-job error isolation, fallback record on scoring failure, the staging table capture of every scraped job, and the analysis upsert behavior.
- **FR-015**: Changes MUST be backward-compatible with the existing job, analysis, and staging tables; no schema change unless strictly required, and any such change MUST be additive and migration-safe.

### Key Entities *(include if feature involves data)*

- **Scraped Job**: A job posting captured from a source, with title, company, source, URL, description (possibly a placeholder stub initially), and salary fields. Mutable fields of interest: description, salary.
- **Job Analysis**: The match score, summary, technology list, and rationale derived for a job; upserted so re-scoring updates the existing record.
- **Staging Record**: A capture of every scraped job prior to filtering/promotion, used as an audit trail.
- **Operator Matching Profile**: The operator's seniority targets, experience ceiling, skills, and preferences used for filtering and scoring; read per run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a run where exactly one job's database write fails, 100% of the other jobs in the batch are still processed (no batch-wide abort).
- **SC-002**: On a second consecutive run over unchanged source data, the number of secondary detail fetches is zero for jobs already stored with a valid analysis.
- **SC-003**: After enrichment, zero stored jobs retain the placeholder category stub when a real description was available.
- **SC-004**: Jobs whose descriptions only incidentally contain blocklist substrings are no longer auto-zeroed (measured to zero false auto-zeros on a representative sample), while genuine blocked-technology jobs remain auto-zeroed.
- **SC-005**: The operator matching profile is read exactly once per run regardless of job count.
- **SC-006**: A hung scoring model causes a single job's scoring to abort within the configured bound and the run continues; the run is never stuck indefinitely on one job.
- **SC-007**: Source fetching wall-clock time for the fetch phase is reduced versus sequential fetching, and a single source failure leaves the other sources' contributions intact.

## Assumptions

- "Valid analysis" retains its current meaning: an analysis row exists with a non-empty technology list (the existing re-score trigger for empty/null stays in force).
- Salary updates apply changed values; the handling of a previously-known value becoming null is treated as "do not clobber a known value with an unknown" unless the source authoritatively clears it. This is the safe default chosen to avoid losing operator-relevant information.
- The scoring-model timeout bound is configurable via environment, with a sensible default, consistent with the existing single-concurrency constraint on the 1GB-RAM host.
- No database schema change is expected; the existing tables already hold description and salary columns, so the fixes are write-path changes, not migrations.
- Existing fallback, staging, and upsert behaviors are kept exactly; this feature changes ordering, scope of writes, matching precision, and resource bounds — not the overall pipeline shape.
- The recurring schedule (every 3 hours) and the manual trigger entry points both route through the same run logic and inherit all fixes.
