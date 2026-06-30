# Contract: Telegram Run Digest Message

**Feature**: 009-etl-audit-telegram-boost | **Date**: 2026-06-30

Defines the exact format of the end-of-run Telegram message sent by `sendRunDigest()` in `apps/backend/src/bot/telegram.ts`.

---

## Parse Mode

`HTML` — avoids MarkdownV2 escaping issues with job titles containing `-`, `.`, `(`, `)`.

---

## Full Template

```
📊 <b>ETL Run Complete</b>
🕐 {completedAt}
📥 Fetched: {rawTotal} | Filtered: {filtered} | New: {inserted} | Scored: {scored}{fallbackLine}

{jobsBlock}
```

### Field Substitutions

| Placeholder | Source | Format |
|-------------|--------|--------|
| `{completedAt}` | `ETLRunSummary.completedAt` | `"YYYY-MM-DD HH:mm UTC"` |
| `{rawTotal}` | `ETLRunSummary.rawTotal` | integer |
| `{filtered}` | `ETLRunSummary.filtered` | integer |
| `{inserted}` | `ETLRunSummary.inserted` | integer |
| `{scored}` | `ETLRunSummary.scored` | integer |
| `{fallbackLine}` | `ETLRunSummary.fallback` | omitted if 0; else ` \| ⚠ Fallback: {fallback}` |
| `{jobsBlock}` | `ETLRunSummary.topJobs` | see below |

---

## Jobs Block

### When `inserted > 0` and `topJobs.length > 0`

```
🔥 <b>Top New Jobs</b>
{job1}
{job2}
...
```

Each job entry (max 5):

```
{n}. <b>{title}</b> @ {company}
   💰 {salaryDisplay}  · ⭐ {score}
   🛠 {stack}
```

- `{salaryDisplay}` — omit the `💰` line entirely if null
- `{stack}` — omit the `🛠` line entirely if `stack` is empty array
- Salary format: `"13k–19k PLN (UoP)"` or `"20k–24k PLN (B2B)"` — prefer B2B if both present, suffix `(B2B)` or `(UoP)`
- Score: integer 0–100

### When `inserted = 0`

```
ℹ️ No new jobs this run.
```

---

## /status Command Response

Identical to the run digest above, prefixed with:

```
📊 <b>Last ETL Run</b>  (use "ETL Run Complete" only on post-run push)
```

When no run recorded:

```
ℹ️ No ETL run recorded yet.
```

---

## /scrape Acknowledgement (immediate, before ETL starts)

```
⚡ ETL triggered ✅
```

---

## /scrape Concurrent Guard

```
⏳ ETL already running — please wait.
```

---

## Error Digest (sent instead of normal digest on critical failure)

```
🚨 <b>ETL Run Failed</b>
🕐 {timestamp}
Source: {source}
Error: {errorMessage}
```

---

## Salary Short Format Function

`formatSalaryShort(min, max, currency, contractType)`:

1. If both `min` and `max` null → return `null`
2. Divide non-null values by 1000, round to 1 decimal if not whole
3. Format: `"{min}k–{max}k {currency} ({contractType})"` or `"{min}k {currency} ({contractType})"` if only one value

Examples:
- `(9000, 13000, 'PLN', 'UoP')` → `"9k–13k PLN (UoP)"`
- `(20000, 24000, 'PLN', 'B2B')` → `"20k–24k PLN (B2B)"`
- `(null, null, 'PLN', 'B2B')` → `null`
