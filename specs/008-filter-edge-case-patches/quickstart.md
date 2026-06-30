# Quickstart Validation Guide: Filter Edge-Case Patches

**Date**: 2026-06-30 | **Plan**: [plan.md](./plan.md)

## Prerequisites

- `pnpm install` from monorepo root
- `apps/backend` builds cleanly (`pnpm --filter @pl-jobhunter/backend build`)
- Vitest available (`pnpm --filter @pl-jobhunter/backend test`)

---

## Scenario 1: Empty Description Guard

**What to verify**: Jobs with null or stub-only description skip Ollama entirely.

**Run**:
```bash
pnpm --filter @pl-jobhunter/backend test -- --grep "empty description"
```

**Expected**:
- Test with `description = null` → `scoreJob` never called, analysis persisted with `match_score = 10`, `summary = job.title`
- Test with `description = "[category:javascript]"` (22 chars) → same fallback
- Test with `description` of 30+ chars → normal two-pass flow runs

---

## Scenario 2: Word-Boundary Regex — Java/Python Blocking

**What to verify**: `isNegativeJob()` correctly blocks java/python variants without false-positiving on javascript.

**Run**:
```bash
pnpm --filter @pl-jobhunter/backend test -- --grep "isNegativeJob"
```

**Expected** (blocked → `true`):
- `"Java+ Developer"` → true
- `"Java/React Engineer"` → true
- `"Fullstack (Java+React+TypeScript)"` → true
- `"Python Data Engineer"` → true

**Expected** (must NOT block → `false`):
- `"JavaScript Developer"` → false
- `"Node.js / TypeScript Developer"` → false

---

## Scenario 3: NoFluffJobs Category Stub

**What to verify**: Scraper extracts `technology` field and writes `[category:X]` to description.

**Run**:
```bash
pnpm --filter @pl-jobhunter/backend test -- --grep "nofluff.*category"
```

**Expected**:
- Mock posting with `technology: ["python"]` → job.description = `"[category:python]"`
- Mock posting with `technology: ["javascript"]` → job.description = `"[category:javascript]"`
- Mock posting with no `technology` field → job.description = `undefined`

**Integration check** (manual, next ETL run):
- CloudFerro-style Python listing from NoFluff → ETL log shows `[ETL] Negative-list: score 0` for that job

---

## Scenario 4: Polish Seniority Blocking

**What to verify**: `isRelevantJob()` blocks Polish senior titles when profile targets junior/mid.

**Run**:
```bash
pnpm --filter @pl-jobhunter/backend test -- --grep "isRelevantJob.*polish\|polish.*seniority"
```

**Expected** (profile `target_seniority: ["junior"]`):
- `"Starszy Developer Node.js"` → `{ pass: false, reason: 'seniority' }`
- `"Lider Zespołu Frontend"` → `{ pass: false, reason: 'seniority' }`
- `"Ekspert TypeScript"` → `{ pass: false, reason: 'seniority' }`

**Expected** (no profile configured):
- `"Starszy Developer"` → `{ pass: true }` (filter inactive without profile)

---

## Scenario 5: Frontend Override for Infrastructure Roles

**What to verify**: `isNegativeJob()` does NOT block titles containing both an infra label and a frontend keyword.

**Run**:
```bash
pnpm --filter @pl-jobhunter/backend test -- --grep "frontend override\|platform engineer"
```

**Expected** (must NOT block → `false`):
- `"Angular Web Platform Engineer"` → false
- `"React Platform Engineer"` → false
- `"Frontend Platform Engineer"` → false
- `"TypeScript Platform Engineer"` → false

**Expected** (must block → `true`):
- `"Cloud Platform Engineer"` → true
- `"Platform Engineer"` → true

---

## Full Unit Test Run

```bash
pnpm --filter @pl-jobhunter/backend test
```

All existing tests must continue to pass. Zero regressions.
