# Research: Fix Job Filtering & DB Reset

## Decision 1: Description Field Source

**Decision**: Pre-filter and prompt enrichment use **title only** (no description field).

**Rationale**: None of the 3 active scrapers (justjoin, nofluff, rocketjobs) return a description/body in their list API responses. Fetching per-job detail endpoints would require 500+ additional HTTP calls per ETL run on a 1GB RAM VPS — too expensive. TheProtocol is already disabled (Cloudflare blocked).

**Alternatives considered**:
- Per-job detail fetch: rejected — 500+ HTTP calls × 3 scrapers per run, memory/latency risk on constrained VPS.
- Lazy description fetch on job click: rejected — out of scope for this feature; requires frontend changes.
- Web scraping via Playwright: rejected — heavyweight dependency, VPS memory constraint.

**Impact on spec**: `description?: string` field on `Job` type is still added (for future use / detail endpoint when discovered), but scrapers leave it undefined for now. `buildPrompt` includes it only when present. Pre-filter operates on title only.

---

## Decision 2: Pre-filter Strategy

**Decision**: Keyword match on **job title only**, case-insensitive. At least 1 match from the skill keyword list required to pass. Fail-open is NOT used — if keyword list is empty, log warning and pass all jobs.

**Rationale**: Title is the only reliable signal available at list-fetch time. Job titles like "CNC Operator", "Audit Specialist", "Senior Product Manager" clearly signal non-developer roles and can be rejected cheaply. Titles like "Senior TypeScript Engineer", "Node.js Developer", "Fullstack React/Node" pass through.

**Keyword list** (hardcoded, extracted from user profile):
```
typescript, javascript, node.js, nodejs, nestjs, nest, express, react, next.js, nextjs, redux,
postgresql, postgres, mongodb, mongo, redis, rabbitmq, typeorm, aws, docker, github actions,
ci/cd, cicd, fullstack, full-stack, backend, frontend, devops, software engineer, software developer,
web developer, developer
```

**Note**: Generic terms ("developer", "software engineer", "fullstack") are included intentionally to catch roles that don't mention specific tech in the title but are clearly dev roles. This trades precision for recall — some non-matching dev roles (e.g., "Data Engineer") may pass, which is acceptable (Ollama will score them low).

**Alternatives considered**:
- Reject-list approach (block known non-dev terms): more brittle, Polish job titles need separate list.
- Category/tag filtering via API params: JustJoin API supports category filter but adds complexity and may miss cross-category postings.

---

## Decision 3: Staging Table (raw_jobs)

**Decision**: Add `raw_jobs` table. ETL merges ALL scraped jobs here first, then runs pre-filter, promotes passing jobs to `jobs`.

**Rationale**: Preserves full scrape history for future re-scoring if profile changes. Allows debugging/auditing which jobs were filtered out. No FK constraints so it never blocks due to constraint violations.

**Schema delta from `jobs`**: Same columns + `description CLOB` (for when scrapers eventually provide it). No `status` column (raw staging has no workflow state). No FK to `ai_analysis`.

**Alternatives considered**:
- Log filtered-out jobs to file: no queryability.
- Skip irrelevant jobs entirely: loses data, can't re-score later.

---

## Decision 4: --reset Flag Behavior

**Decision**: `init-db --reset` drops `ai_analysis` → `jobs` → `raw_jobs` (dependency order, CASCADE handled by Oracle FK), then recreates all 3 tables + seeds `user_profile` if row is absent.

**Rationale**: FK constraint `fk_job` on `ai_analysis` references `jobs`, so must drop `ai_analysis` first. `raw_jobs` has no FK so can be dropped in any order. `user_profile` has no FK dependencies — preserve it always.

**Seed profile on reset**: Upsert (MERGE) skills row with the 17-skill list if `user_profile` is empty post-reset. Ensures `getProfileFromDb()` never falls back to the generic env var string.

---

## Decision 5: Prompt Fix Without Description

**Decision**: Even without `job.description`, fix `buildPrompt` to:
1. Be **strict** — instruct model that match_score < 30 is valid and expected for poor matches.
2. Remove the hallucination invitation — current prompt says "why this matches the user" which biases the model toward positive framing even for unrelated jobs.
3. Add explicit instruction: "If the job title suggests a non-developer role, return match_score: 0."
4. Keep `num_predict: 400` to prevent JSON truncation.

**Rationale**: The current prompt has two hallucination vectors: (a) no job content so model invents, (b) the `why_good` field name biases toward positive framing. Fixing the prompt instruction reduces hallucination even without description context. Pre-filter handles the gross mismatches before Ollama sees them.
