# Quickstart & Validation Guide: Fix Job Filtering & DB Reset

## Prerequisites

- Oracle DB wallet mounted, `.env` configured
- Ollama running at `OLLAMA_BASE_URL` with model available
- `pnpm build` completed (or `tsx` available for direct TS execution)

---

## Step 1: Reset Dirty DB

```bash
cd apps/backend
node dist/config/init-db.js --reset
# OR during dev:
npx tsx src/config/init-db.ts --reset
```

**Expected output**:
```
init-db: dropping ai_analysis...
init-db: dropping jobs...
init-db: dropping raw_jobs...
init-db: created table jobs
init-db: created table raw_jobs
init-db: created table ai_analysis
init-db: seeded default user_profile (skills: 17)
init-db: schema reset complete
```

**Verify**:
```sql
SELECT COUNT(*) FROM jobs;       -- 0
SELECT COUNT(*) FROM ai_analysis; -- 0
SELECT COUNT(*) FROM raw_jobs;   -- 0
SELECT COUNT(*), skills FROM user_profile; -- 1 row, 17 skills JSON
```

---

## Step 2: Run ETL Once

```bash
node dist/scheduler/etl.js --run-once
# OR:
npx tsx src/scheduler/etl.ts --run-once
```

**Expected log output** (key lines):
```
[ETL] Fetched jobs total=450 justjoin=200 nofluff=150 rocketjobs=100
[ETL] raw_jobs: inserted=450
[ETL] pre-filter: passed=~80, blocked=~370
[ETL] Run complete inserted=80 scored=75
```

**Verify filtering**:
```sql
-- raw_jobs has all scraped jobs
SELECT COUNT(*) FROM raw_jobs;   -- ~450

-- jobs has only filtered-in dev roles
SELECT COUNT(*) FROM jobs;       -- ~80 (much less than raw_jobs)

-- CNC/audit/production jobs NOT in jobs
SELECT COUNT(*) FROM jobs WHERE LOWER(title) LIKE '%cnc%';     -- 0
SELECT COUNT(*) FROM jobs WHERE LOWER(title) LIKE '%audit%';   -- 0
SELECT COUNT(*) FROM jobs WHERE LOWER(title) LIKE '%produkcj%'; -- 0
```

---

## Step 3: Verify Score Distribution

```sql
-- Should NOT be all 95-100 anymore
SELECT match_score, COUNT(*) 
FROM ai_analysis 
GROUP BY match_score 
ORDER BY match_score DESC;

-- Should have varied scores
SELECT MIN(match_score), MAX(match_score), AVG(match_score) FROM ai_analysis;
-- Expect: min ~20, max ~98, avg ~65 (not all clustered at 95+)
```

---

## Step 4: Spot-check Known Good/Bad Jobs

```sql
-- Good match: Senior TypeScript Engineer should score high
SELECT j.title, a.match_score, a.why_good
FROM jobs j JOIN ai_analysis a ON j.id = a.job_id
WHERE LOWER(j.title) LIKE '%typescript%'
ORDER BY a.match_score DESC;
-- Expect: match_score >= 70

-- Weak match: Python/Spark/Azure data roles should score low
SELECT j.title, a.match_score
FROM jobs j JOIN ai_analysis a ON j.id = a.job_id  
WHERE LOWER(j.title) LIKE '%python%' OR LOWER(j.title) LIKE '%spark%';
-- Expect: match_score <= 45, or no rows if pre-filter blocks them
```

---

## Step 5: TypeScript Compilation Check

```bash
cd packages/shared && npx tsc --noEmit
cd ../../apps/backend && npx tsc --noEmit
```

**Expected**: 0 errors.

---

## Rollback

If something goes wrong, reset again:
```bash
node dist/config/init-db.js --reset
```
No data loss risk — `user_profile` is preserved by the reset procedure.
