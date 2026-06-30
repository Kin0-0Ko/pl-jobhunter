# Quickstart: Validating ETL Correctness & Efficiency Fixes

Validation guide proving each fix end-to-end. Implementation lives in `tasks.md` / source.

## Prerequisites

- `pnpm install` at repo root.
- Backend workspace builds: `pnpm --filter @pl-jobhunter/backend build` (or repo build).
- Oracle wallet + `.env` configured (Thin Mode) for integration checks; unit checks run without DB.
- Ollama reachable at `127.0.0.1:11434` for live scoring; unit checks mock it.

## Unit validation (no DB / no network) — primary gate

Run the backend test suite:

```bash
pnpm --filter @pl-jobhunter/backend test
```

Expected new/updated coverage:

- **H2 (`isNegativeJob`)**: title `"Senior Go Developer"` → blocked; relevant Node title with description `"let's go build"` / `"we sap resources"` → NOT blocked.
- **M2 (`scoreJob`)**: called with explicit `profile` → no `user_profile` read (mock asserts DB not hit).
- **M4 (`callOllamaRaw`)**: a never-resolving fetch mock → call rejects within `OLLAMA_TIMEOUT_MS`.
- **H4 (Pass-1 prompt)**: description with a tech token at offset ~1500 → token present in built prompt.
- **C3/H1 (`mergeJob`)**: matched path updates `description` (stub → real) and salary via NVL; leaves `status`/`created_at` untouched.

## Integration validation (DB + live sources)

### SC-001 — one DB failure doesn't abort the batch (C1)

1. Inject a forced failure for one job's promotion write (test hook / fault-injection).
2. Run `node ... --run-once` (or trigger `POST /api/etl/trigger`).
3. **Expected**: run completes; the one job is logged as skipped; all other jobs scored; service not left failed when scheduled.

### SC-002 — zero redundant detail fetches on re-run (C2)

1. Run the ETL once over current JustJoin data (populates `jobs` + `ai_analysis`).
2. Instrument/count calls to `api.justjoin.it/v1/offers/*`.
3. Run again immediately.
4. **Expected**: second run performs **0** detail fetches for jobs already stored with a valid analysis.

### SC-003 — enrichment persists (C3/H1)

1. Confirm a JustJoin row whose `description` is a `[category:*]` stub.
2. Run ETL when the real description is fetchable.
3. Query the row.
4. **Expected**: `description` now holds the real text; no duplicate row; `status`/`created_at` unchanged.

### SC-005 — profile read once per run (M2)

1. Enable DB query logging or a counter around the `user_profile` SELECT.
2. Run ETL over N jobs.
3. **Expected**: exactly **one** `user_profile` read regardless of N.

### SC-006 — hung model doesn't stall (M4)

1. Point `OLLAMA_BASE_URL` at a stub that accepts the connection but never responds.
2. Set `OLLAMA_TIMEOUT_MS` low (e.g. 3000) and run ETL over a few jobs.
3. **Expected**: each scoring call aborts ~3s, fallback record (`match_score === -1`) persisted, run continues, never stuck.

### SC-007 — concurrent fetch, isolated failure (M1)

1. Make one scraper endpoint fail (e.g. bad URL via env).
2. Run ETL.
3. **Expected**: other three sources still contribute; fetch phase wall-clock lower than the previous sequential baseline (compare logs).

## Spec compliance

```bash
pnpm spec:check
```

Expected: exit 0 with this feature's tasks tracked.
