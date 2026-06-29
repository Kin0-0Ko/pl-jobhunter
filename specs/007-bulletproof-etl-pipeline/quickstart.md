# Quickstart & Validation Guide: Bulletproof ETL Pipeline

Reproduce each of the four production failures, then verify the fix. Run from repo root.

## Prerequisites

- `pnpm install` done; `.env` with DB wallet + `OLLAMA_BASE_URL` set.
- Ollama running with `qwen2.5:0.5b` pulled (`ollama pull qwen2.5:0.5b`).
- A `user_profile` row with `id = 1`.

## Build / typecheck

```bash
pnpm --filter @pl-jobhunter/shared exec tsc --noEmit
pnpm --filter @pl-jobhunter/backend exec tsc --noEmit
```

## Unit tests (Layer 4 + Layer 1)

```bash
pnpm --filter @pl-jobhunter/backend test
```

Expected: `json-repair.test.ts` passes the full broken-output corpus; `ollama.test.ts` covers inversion detection, score clamp, loud-fail preference resolution.

---

## Scenario 1 — Empty filter config (FR-001/002, SC-001)

**Reproduce**: set a malformed blob.

```sql
UPDATE user_profile SET search_preferences = '{"target_seniority":[' WHERE id = 1;  -- truncated JSON
```

**Run** (single pass, memory-guarded):

```bash
node --max-old-space-size=256 apps/backend/dist/scheduler/etl.js --run-once
```

**Pass**: log shows a `WARN` naming the parse error and the raw value — **not** a silent `filterProfile: {}` at `info`. Filtering applies a safe default.

**Healthy config**:

```sql
UPDATE user_profile SET search_preferences = '{"target_seniority":["junior","mid"],"max_experience_years":3}' WHERE id = 1;
```

Re-run → log shows resolved profile; ~80% of the batch rejected with per-job `reason`.

---

## Scenario 2 — Memory bound (FR-008, SC-003)

**Run** a full batch and watch RSS:

```bash
/usr/bin/time -v node --max-old-space-size=256 apps/backend/dist/scheduler/etl.js --run-once 2>&1 | grep -E 'Maximum resident'
```

**Pass**: process completes; no OOM kill (exit 0); per-chunk progress logs `{ chunk, processed, total }`; Maximum resident set comfortably under the instance budget alongside Ollama.

---

## Scenario 3 — Malformed AI output (FR-014/015/016, SC-004/005)

The repair corpus is exercised by unit tests (no live model needed). To prove end-to-end durability, point at a stub that returns truncated JSON:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:9999 node apps/backend/dist/scheduler/etl.js --run-once
# (stub server returns {"response":"{\"match_score\":80,\"summary\":\"Looking for a develo"})
```

**Pass**: no unhandled `SyntaxError`; affected jobs persist a fallback row (`match_score = -1`, non-empty summary); zero `ORA-01400`; run exits 0.

---

## Scenario 4 — First-person inversion (FR-011, SC-006)

Stub the model to return `{"match_score":70,"summary":"I am a TypeScript developer looking for a role","tech_stack":[]}`.

**Pass**: persisted summary is the review placeholder, not the inverted text. Query:

```sql
SELECT COUNT(*) FROM ai_analysis WHERE LOWER(summary) LIKE 'i am %';  -- expect 0
```

---

## Post-run audit queries

```sql
-- fallback / needs-review rows
SELECT COUNT(*) FROM ai_analysis WHERE match_score = -1;
-- deterministic negative rejects (distinct from fallback)
SELECT COUNT(*) FROM ai_analysis WHERE match_score = 0;
-- constraint integrity: no empty summaries
SELECT COUNT(*) FROM ai_analysis WHERE summary IS NULL;  -- expect 0
```

## Acceptance gate (maps to plan Verification)

| # | Check | FR / SC |
|---|---|---|
| 1 | typecheck clean | — |
| 2 | malformed prefs → loud WARN + default | FR-002 / SC-001 |
| 3 | ~80% pre-filtered, reason logged | FR-006 / SC-002 |
| 4 | full batch, no OOM | FR-008 / SC-003 |
| 5 | broken corpus → repaired or fallback, no throw | FR-014/015 / SC-004 |
| 6 | zero null summaries | FR-016 / SC-005 |
| 7 | zero inverted summaries persisted | FR-011 / SC-006 |
| 8 | every fallback flagged (`-1`) | FR-017 / SC-007 |
