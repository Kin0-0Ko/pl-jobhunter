# Phase 1 Data Model: Bulletproof ETL Pipeline

No database schema changes. These are **application-layer** shapes and the validation rules that guard the existing `ai_analysis` table.

---

## Existing tables (unchanged)

- `user_profile(id, skills, resume_text, preferred_contract, search_preferences, updated_at)` — `search_preferences` is a stringified JSON blob (CLOB).
- `raw_jobs(...)` — staging; all scraped jobs land here first.
- `jobs(...)` — promoted (relevant) jobs.
- `ai_analysis(job_id, match_score, summary, tech_stack, why_good)` — `summary` and `why_good` are CLOB; **empty string is stored as NULL by Oracle**, and the column is NOT NULL → the ORA-01400 trap.

---

## Application shapes

### FilterProfile

| Field | Type | Notes |
|---|---|---|
| `target_seniority` | `string[] \| undefined` | from parsed `search_preferences.target_seniority` |
| `max_experience_years` | `number \| undefined` | from parsed `search_preferences.max_experience_years` |

**Resolution outcomes** (R7):

| Outcome | Condition | Action |
|---|---|---|
| resolved | row present, field parses, shape valid | return populated `FilterProfile` |
| absent | no row, or field null/empty | return `{}` **quietly** (legitimate) |
| malformed | field present but `JSON.parse` throws or shape invalid | `logger.warn({ raw, err })`, return safe default `{}` |

Key read must tolerate both `row.SEARCH_PREFERENCES` (Oracle uppercase) and `row.search_preferences`.

### RepairResult (discriminated union — output of `repairAndParse`)

```text
{ ok: true;  value: RawModelObject }
{ ok: false; reason: 'no-json' | 'unrepairable' | 'invalid-shape' }
```

`RawModelObject` = `{ match_score: number; summary: string; tech_stack: string[] }` (the model contract — `why_good` is added downstream, not requested from the model).

### AIAnalysisRecord (validated, ready to persist)

| Field | Type | Validation rule |
|---|---|---|
| `match_score` | `number` | clamped to integer `0–100` (model path); `-1` only via fallback |
| `summary` | `string` | non-empty after trim; **not** first-person-inverted; ≤ reasonable length |
| `tech_stack` | `string[]` | array (possibly empty) |
| `why_good` | `string` | non-empty; defaults to `' '` (CLOB-empty workaround) |

### FallbackRecord (R6) — a constrained AIAnalysisRecord

```text
{
  match_score: -1,                                  // review sentinel, sorts to bottom
  summary: 'Analysis unavailable — pending manual review',
  tech_stack: [],
  why_good: ' '
}
```

Produced when: Ollama times out / errors after retry, `repairAndParse` returns `ok:false`, parsed shape invalid, **or** summary fails the inversion check. One recovery channel for all of these.

---

## Validation pipeline (order matters)

```text
raw model string
  → repairAndParse                → ok:false ─────────────────┐
      │ ok:true                                               │
      ▼                                                       │
  normalizeScore (clamp 0–100)                                │
      ▼                                                       │
  isFirstPersonInverted(summary)? ── yes ────────────────────┤
      │ no                                                    │
      ▼                                                       ▼
  ensureNonEmptySummary                              buildFallbackRecord()
      ▼                                                       │
  AIAnalysisRecord ◀────────────────────────────────────────┘
      ▼
  persistAnalysis  (summary guaranteed non-empty → no ORA-01400)
```

---

## Invariants

1. **No silent drop after promotion**: every job written to `jobs` produces exactly one `ai_analysis` row (scored, negative-zero, or fallback).
2. **Summary never empty**: `persistAnalysis` is only ever called with a trimmed, non-empty `summary`.
3. **Score domain**: persisted `match_score ∈ {-1} ∪ [0,100]`; `-1` ⇔ needs manual review; `0` ⇔ deterministic negative-keyword reject (distinct meanings).
4. **Loud malformed config**: a malformed `search_preferences` always emits a `WARN`; a resolved-empty profile never does.
