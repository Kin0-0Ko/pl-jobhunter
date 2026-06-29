# Phase 0 Research: Bulletproof ETL Pipeline

All decisions resolved from codebase inspection + the four production failure modes. No open `NEEDS CLARIFICATION`.

---

## R1 — LLM Strategy: local small model vs. external edge endpoint

**Decision**: Keep **`qwen2.5:0.5b` local via Ollama** as the default. Add an `OLLAMA_BASE_URL` / `OLLAMA_MODEL` env override (already present) so an external OpenAI-compatible endpoint can be swapped in without code change, but do **not** make external the default.

**Rationale**:

| Option | RAM on VPS | Latency | Reliability | Cost | Verdict |
|---|---|---|---|---|---|
| `qwen2.5:0.5b` (local, q4) | ~350–500 MB resident | ~1–3 s/job, no network | No rate limit, no egress dep | $0 | **Chosen** — fits 1 GB beside Node+oracledb |
| `llama3.2:1b` (local, q4) | ~800 MB–1.1 GB resident | ~2–5 s/job | OOM risk beside Fastify+oracledb | $0 | Rejected — peak RSS overshoots budget; this *is* the OOM cause |
| Groq free | ~0 MB | fast | hard daily/min rate limits, network dep | $0 (capped) | Fallback override only |
| Cloudflare Workers AI | ~0 MB | fast | account/neuron limits | $0 (capped) | Fallback override only |
| OpenRouter free | ~0 MB | variable | per-model free-tier throttling | $0 (capped) | Fallback override only |

The 1 GB ceiling is the binding constraint. `llama3.2:1b` quantized peaks near the whole budget *before* Node's heap and the oracledb thin client are counted — exactly the OOM/token-exhaustion failure in production logs. The 0.5b model leaves headroom. External endpoints remove the RAM pressure entirely but introduce a network dependency and rate limits that violate "pipeline must complete unattended each cron window"; they are kept as a configurable escape hatch (override env), guarded by the same `repairAndParse` + fallback path so a 429/timeout degrades to a fallback record, never an abort.

**Alternatives considered**: running the model only during a low-traffic window (rejected — cron already 3-hourly, no traffic correlation); batching multiple jobs per prompt (rejected — multiplies truncation risk on a 0.5b model, the opposite of what Layer 4 needs).

---

## R2 — Token-conservation prompt strategy

**Decision**: Keep the existing tight prompt shape (006) and tighten further: cap description slice at 1,500 chars, demand the exact 3-field object, keep `num_predict: 400`, and add an explicit *negative* instruction against first-person. Do **not** add few-shot examples (they cost output budget and the 0.5b model copies them verbatim).

**Rationale**: Output truncation is driven by `num_predict` exhaustion mid-string. Minimising required output fields (3, no `why_good` in the model contract) and forbidding prose keeps generations short and inside the token budget, reducing — but not eliminating — truncation. Layer 4 catches the residue.

**Alternatives considered**: raising `num_predict` (rejected — more tokens = more RAM + more truncation surface, not less); JSON-schema-constrained decoding via Ollama `format` (already `format: 'json'`; insufficient alone — the model still truncates inside a valid-prefix string).

---

## R3 — Memory-bounded batching: chunk size

**Decision**: Process scraped jobs in **chunks of 50** (env `ETL_CHUNK_SIZE`, default 50). Keep `pLimit(1)` for Ollama. Recommend launching the ETL process with `--max-old-space-size=256` as a hard heap guard documented in quickstart.

**Rationale**: ~1,500 `Job` objects with descriptions sliced to ≤1,500 chars is on the order of a few MB — the array itself is not the OOM driver; the Ollama model is. But chunking (a) bounds the live working set, (b) lets per-chunk `await` yield to GC between groups, and (c) gives a natural place to log progress and free references. 50 balances DB round-trip overhead against memory. Concurrency stays at 1 because two concurrent 0.5b generations would double model working memory.

**Alternatives considered**: chunk of 1 (rejected — needless DB/connection churn); chunk of 200 (rejected — larger live set, less frequent GC yield); worker threads (rejected — extra RAM per thread on a 1 GB box).

---

## R4 — Self-healing JSON repair strategy (Layer 4)

**Decision**: Stateless `repairAndParse(raw: string)` applying an ordered, regex-based pipeline, returning a discriminated union `{ ok: true; value } | { ok: false; reason }`:

1. Strip ` ```json ... ``` ` / ` ``` ` fences and any `<think>…</think>` blocks.
2. Extract the first balanced `{ … }` block by scanning brace depth (boundary extraction).
3. `JSON.parse` the extracted block. On success → `ok`.
4. On failure, attempt bounded repairs: close an unterminated string (append `"`), close missing `}`/`]` by depth count, strip a trailing comma. Re-parse once.
5. Still failing → `{ ok: false, reason }`. **Never throw.**

**Rationale**: The observed errors (`Unterminated string in JSON`, `Expected ',' or '}'`) are exactly truncation at the output-token boundary. Boundary extraction + delimiter-closing recovers the common cases deterministically without an LLM round-trip. The union return forces the caller to handle the unrepairable case → fallback record. Statelessness keeps it unit-testable against a fixed corpus.

**Alternatives considered**: third-party `jsonrepair` lib (rejected — extra dependency on a 1 GB box; the failure set here is narrow and known); re-prompting the model on parse failure (rejected — doubles RAM/time pressure, can re-truncate, breaks the cron budget).

---

## R5 — First-person inversion detection (Layer 3)

**Decision**: Deterministic detector `isFirstPersonInverted(summary)` — case-insensitive match on leading/standalone first-person markers (`\bI am\b`, `\bI have\b`, `\bI can\b`, `\bI'm\b`, `\bmy \b` at sentence start, `looking for a role`). If matched → caller replaces summary with the review-fallback placeholder.

**Rationale**: The 0.5b model occasionally inverts user-context into the summary despite the prompt. A cheap regex post-check is more reliable than prompt-only mitigation. Detection feeds the *same* fallback path as parse failure — one recovery channel, not two.

**Alternatives considered**: second LLM judging pass (rejected — cost/RAM); discarding the job (rejected — loses a possibly-relevant role; spec requires flag-for-review instead).

---

## R6 — Fallback record encoding (Layer 4 persistence)

**Decision**: `buildFallbackRecord()` returns `{ match_score: -1, summary: 'Analysis unavailable — pending manual review', tech_stack: [], why_good: ' ' }`. `-1` is the review sentinel (valid range is 0–100, so `-1` is unambiguous and sortable to the bottom). Summary is a fixed non-empty string → satisfies the CLOB-non-NULL constraint. `why_good` stays a single space (existing CLOB-empty workaround).

**Rationale**: The current code `continue`s on Ollama failure, persisting **nothing** — the job is lost and never reviewed (violates FR-016/017). Always writing a sentinel row makes failures visible, queryable (`WHERE match_score = -1`), and review-flagged without a schema change. Match-score normalization also clamps any model value to `0–100` before persist; only the fallback path uses `-1`.

**Alternatives considered**: a new boolean `needs_review` column (rejected — schema change violates "no migration"); `match_score = 0` for fallback (rejected — collides with the legitimate negative-keyword `0` score, making failures indistinguishable from deterministic rejects).

---

## R7 — Loud preference resolution (Layer 1)

**Decision**: Split `getFilterProfile()` outcomes into three: **resolved** (parsed object), **absent** (no row / null field → return `{}` quietly, this is legitimate "no prefs"), and **malformed** (field present but `JSON.parse` throws, or shape invalid → `logger.warn` with the raw value + error, return a safe default `{}`). Add uppercase/lowercase key tolerance when reading the row.

**Rationale**: Today a single `try/catch` collapses *all* outcomes to silent `{}`, so a malformed blob looks identical to "no preferences" and the operator never learns filtering was bypassed (the production symptom: `filterProfile: {}`). Separating malformed-and-loud from absent-and-quiet satisfies FR-002/SC-001. Oracle `OUT_FORMAT_OBJECT` returns uppercase keys; the casing fallback guards against driver/format drift.

**Alternatives considered**: throwing on malformed (rejected — would abort the whole run for one bad config row; spec wants degrade-and-warn).
