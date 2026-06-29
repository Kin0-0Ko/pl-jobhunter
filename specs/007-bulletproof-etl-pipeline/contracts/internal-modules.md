# Phase 1 Contracts: Internal Modules

This feature exposes **no HTTP endpoints** — it is internal ETL hardening. Contracts below are the behavioural specifications for the functions to implement/modify. Every contract maps to functional requirements and is unit-testable.

---

## `getFilterProfile(): Promise<FilterProfile>` — `ai/ollama.ts` (modify)

**Maps to**: FR-001, FR-002

| Given | Then |
|---|---|
| no `user_profile` row / `SEARCH_PREFERENCES` null | return `{}`, **no** warning |
| valid JSON blob with `target_seniority` + `max_experience_years` | return populated `FilterProfile` |
| field present under lowercase key only | still resolved (casing fallback) |
| field present but `JSON.parse` throws | `logger.warn({ raw, err })`, return `{}` |
| field parses but shape invalid (e.g. number where array expected) | warn, return `{}` (drop invalid fields) |

**Must not**: collapse malformed and absent into one silent path.

---

## `repairAndParse(raw: string): RepairResult` — `ai/json-repair.ts` (new, pure)

**Maps to**: FR-014, FR-015

| Given | Then |
|---|---|
| clean JSON object | `{ ok:true, value }` |
| object wrapped in ```` ```json ... ``` ```` fences | fences stripped, `{ ok:true, value }` |
| `<think>…</think>` preamble then object | preamble stripped, `{ ok:true, value }` |
| trailing prose after `}` | first balanced block extracted, `{ ok:true, value }` |
| unterminated trailing string | string closed, re-parsed, `{ ok:true }` if recoverable |
| missing closing `}` / `]` | delimiters closed by depth, `{ ok:true }` if recoverable |
| trailing comma before `}` | comma stripped, `{ ok:true }` |
| no `{` at all | `{ ok:false, reason:'no-json' }` |
| garbage beyond repair | `{ ok:false, reason:'unrepairable' }` |
| any input | **never throws** |

Stateless, no I/O, no logging — caller logs.

---

## `isFirstPersonInverted(summary: string): boolean` — `ai/ollama.ts` (new, pure)

**Maps to**: FR-011

| Given | Then |
|---|---|
| `"The company seeks a TypeScript developer…"` | `false` |
| `"I am a TypeScript developer looking for a role"` | `true` |
| `"I'm experienced in React"` | `true` |
| `"My background includes…"` (sentence start) | `true` |
| summary mentioning "I/O" or "I18n" | `false` (word-boundary markers only) |

---

## `normalizeScore(n: unknown): number` — `ai/ollama.ts` (new, pure)

**Maps to**: FR-017

| Given | Then |
|---|---|
| `73` | `73` |
| `150` | `100` (clamp) |
| `-5` | `0` (clamp; `-1` sentinel never comes from model path) |
| `"80"` | `80` (coerce) or `0` if NaN |
| `NaN` / non-numeric | `0` |

---

## `buildFallbackRecord(): OllamaScoreResult` — `ai/ollama.ts` (new, pure)

**Maps to**: FR-016, FR-017

Returns exactly:

```text
{ match_score: -1, summary: 'Analysis unavailable — pending manual review', tech_stack: [], why_good: ' ' }
```

`summary` non-empty (no ORA-01400); `match_score = -1` (review sentinel).

---

## `scoreJob(job): Promise<OllamaScoreResult>` — `ai/ollama.ts` (modify)

**Maps to**: FR-011, FR-013, FR-015, FR-016, FR-017

Behaviour change: **never returns `null`**. The recovery union collapses to a record.

| Given | Then |
|---|---|
| model returns repairable, non-inverted JSON | normalized `AIAnalysisRecord` |
| model returns inverted summary | `buildFallbackRecord()` |
| `repairAndParse` → `ok:false` | `buildFallbackRecord()` |
| Ollama HTTP error / timeout after retry | `buildFallbackRecord()` |

Caller (`etl.ts`) therefore always has a persistable record.

---

## ETL chunked loop — `scheduler/etl.ts` (modify)

**Maps to**: FR-008, FR-009, FR-010, FR-016

| Requirement | Contract |
|---|---|
| chunking | iterate scraped jobs in slices of `ETL_CHUNK_SIZE` (default 50); process a slice fully before the next |
| concurrency | keep `pLimit(1)` Ollama gate (in `ollama.ts`) |
| isolation | a thrown error on one job is caught; loop continues to next job |
| always-persist | on the Ollama path, **replace** the current `continue`-without-persist with `persistAnalysis(buildFallbackRecord())` so a promoted job always yields a row |
| logging | per-reject `reason`; per-chunk progress `{ chunk, processed, total }`; fallback count in run summary |

**Removed behaviour**: the `if (!analysis) { …; continue; }` drop and the `scoreJob threw → continue` drop. Both become fallback persists.

---

## Test corpus (for `json-repair.test.ts` + `ollama.test.ts`)

Must include, at minimum:
- clean object
- markdown-fenced object
- `<think>` preamble
- trailing-prose object
- `{"match_score":80,"summary":"Looking for a develo` (unterminated string)
- `{"match_score":80,"summary":"ok","tech_stack":["ts"` (missing closes)
- `{"match_score":80,"summary":"ok",}` (trailing comma)
- `I am a developer looking for a role` (inverted, no JSON)
- `` (empty) → fallback
- `{"match_score":80,"summary":""}` (empty summary → non-empty enforced)
- `{"match_score":150,"summary":"ok","tech_stack":[]}` (score clamp)
