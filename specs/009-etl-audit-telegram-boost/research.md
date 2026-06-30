# Research: ETL Audit Fixes & Telegram Boost

**Date**: 2026-06-30 | **Feature**: 009-etl-audit-telegram-boost

All decisions resolved from direct code inspection — no external unknowns.

---

## Decision 1: why_good is hardcoded ' ' (whitespace) — root cause

**Finding**: `ollama.ts` line 364 — `scoreJob()` returns `why_good: ' '` unconditionally. Pass 2 only extracts `match_score` (see `buildPass2Prompt` which asks for `{"match_score":<int>}` only). There is no third Ollama pass for `why_good`.

**Decision**: Extend pass 2 prompt to also return `why_good` as a short sentence explaining candidate fit, OR accept that `why_good` is unused and store it as `null`/empty string. Given the existing two-pass latency (~50s/job), adding a third pass is not justified. **Store `why_good = null` (empty) — remove the whitespace stub.** The UI already guards with `{analysis?.why_good && ...}` pattern (modal doesn't render it currently — safe to leave null).

**Rationale**: Whitespace-only `why_good` causes DB rows to carry junk. Null is honest and UI-safe. Adding pass 3 adds ~50s/job × 48 jobs = 40 min to ETL runtime — rejected.

**Alternative considered**: Add why_good to pass 2 prompt. Rejected — doubles pass 2 output tokens, increases JSON repair risk, and pass 2 is already under tight `num_predict: 50` budget.

---

## Decision 2: summary quality guard — threshold and approach

**Finding**: Pass 1 prompt template `"<one sentence: what the company builds or needs>"` leaks into output when Ollama echoes the prompt back. Also produces summaries like `"Frontend Engineer for a JavaScript company"` (too generic/short).

**Decision**: In `scoreJob()`, after `callPass1()` returns, validate:
1. If `summary` contains `<` → it's a prompt echo — fallback to `job.title`, set `match_score = 10`
2. If `summary.trim().length < 20` → too short/generic — same fallback

**Rationale**: These are unambiguous quality failures. `match_score = 10` (not 0) keeps the job visible for manual review without surfacing it as a recommended job.

**Alternative**: Re-prompt Ollama on bad summary. Rejected — adds latency and the root cause (model echoing) makes retry unreliable.

---

## Decision 3: tech_stack empty — root cause

**Finding**: `scoreJob()` correctly assembles `tech_stack: pass1.tech_stack` at line 362–365 and passes it to `persistAnalysis()` which calls `JSON.stringify(techStack)`. The API response at `/api/jobs` joins `jobs` with `ai_analysis`. The issue must be in how the Oracle column is read back.

**Action**: Verify `ai_analysis.tech_stack` column type in `init-db.ts` and the API SELECT statement in `routes/jobs.ts`. If stored as CLOB and not fetched with `fetchInfo: { type: oracledb.STRING }`, it returns as a stream object rather than a string.

**Decision**: Add `fetchInfo` for `tech_stack` column in the jobs query (same pattern as `SEARCH_PREFERENCES` in `getFilterProfile`). Also verify `JSON.parse` on the fetched string before returning.

---

## Decision 4: ETLRunSummary — in-memory vs DB

**Decision**: In-memory module-level variable in `etl.ts`:

```typescript
interface ETLRunSummary {
  completedAt: Date;
  rawTotal: number;
  filtered: number;
  inserted: number;
  scored: number;
  fallback: number;
  topJobs: Array<{ title: string; company: string; salary: string | null; score: number; stack: string[] }>;
}
let lastRunSummary: ETLRunSummary | null = null;
```

**Rationale**: No persistence needed. `/status` only needs last run. If backend restarts, "No ETL run recorded yet" is correct behavior. A DB table would require schema migration — violates the no-schema-change constraint.

**Alternative**: Write to a `etl_runs` DB table. Rejected — schema change, migration required, overkill for 1 user.

---

## Decision 5: /scrape — in-process vs detached child

**Finding**: Current `telegram.ts` line 106-113 uses `spawn('node', ['dist/scheduler/etl.js', '--run-once'], { detached: true })`. This means the child process runs independently and cannot communicate back to send the follow-up digest.

**Decision**: Replace `spawn` with direct `runEtl()` call (imported from `etl.ts`). Add `isRunning` boolean exported from `etl.ts` to prevent concurrent runs. The `/scrape` handler becomes:

```
await ctx.reply('⚡ ETL triggered ✅');
if (isRunning) { await ctx.reply('⏳ already running'); return; }
runEtl().then(() => sendRunDigest(chatId)).catch(...);
// don't await — return to Telegram immediately
```

**Rationale**: `runEtl()` is already called in-process by the cron scheduler (`index.ts` line 65). Aligning `/scrape` with that pattern is the obvious fix.

**Risk**: If ETL throws uncaught exception, the bot handler catches it via `.catch()`. Handled.

---

## Decision 6: Fastify HOST bind — Docker networking

**Finding**: `index.ts` line 54: `const host = process.env.HOST ?? '0.0.0.0'`. Changing default to `127.0.0.1` means the Docker container's Fastify will only accept connections on the loopback interface inside the container.

**Decision**: Change default to `127.0.0.1`. Caddy runs in a separate container but connects via Docker bridge network using the container's internal IP — NOT via `127.0.0.1`. Therefore the `HOST` env var in `docker-compose.yml` must be explicitly set to `0.0.0.0` (or the container's internal IP) for Caddy to reach the backend.

**Implementation note**: Change the code default to `127.0.0.1`, AND add `HOST=0.0.0.0` to `docker-compose.yml`'s backend env section. This way: direct public IP:port → refused (no Docker port binding), Caddy → reaches backend via Docker network (container-level 0.0.0.0 means all container interfaces, not the host's public IP). The port should NOT be published in `docker-compose.yml` (no `ports:` mapping for backend).

**Rationale**: The scanner bots are hitting `92.5.50.4:3000` — they can reach it because the Docker container publishes port 3000 to the host. Removing the `ports:` mapping from `docker-compose.yml` is the correct fix. The `HOST` change is secondary defense-in-depth.

---

## Decision 7: Salary anomaly threshold

**Decision**: `< 500` for `salary_b2b_min` or `salary_uop_min` when `currency === 'PLN'`. All observed anomalies are 40–193 PLN. No legitimate monthly PLN salary would be under 500.

**Frontend implementation**: Pure rendering logic in `JobCard.tsx` and `JobDetailModal.tsx` — no backend change. Function `isHourlySalary(min, currency)` returns boolean.

---

## Decision 8: Telegram message format

**Decision**: Use Telegram `parse_mode: 'HTML'` (not MarkdownV2). HTML is simpler — no escaping of special characters like `-`, `.`, `(`, `)` which appear in job titles. MarkdownV2 requires escaping every `.` and `_` which is error-prone.

**Format**:
```
📊 <b>ETL Run Complete</b>
🕐 2026-06-30 14:00 UTC
📥 Fetched: 1532 | Filtered: 1452 | New: 48 | Scored: 48

🔥 <b>Top New Jobs</b>
1. <b>Fullstack IoT Engineer</b> @ Reply Polska
   💰 9k–13k PLN (UoP) · Score: 100
   🛠 React, Node.js

2. <b>Fullstack Developer – AI/GenAI</b> @ Reply Polska
   💰 13k–19k PLN (UoP) · Score: 100
```

**Salary formatting**: `formatSalaryShort(min, max)` → `"9k–13k PLN"` (divide by 1000, round). Show B2B if available, else UoP. Show nothing if both null.
