# Research: Filter Edge-Case Patches

**Date**: 2026-06-30 | **Plan**: [plan.md](./plan.md)

All decisions resolved from direct production audit — no external research required.

---

## Decision 1: Empty Description Threshold

**Decision**: Guard fires when `!job.description || job.description.length < 30`

**Rationale**: JustJoin category stubs like `[category:javascript]` are 22 characters — under 30. Real job descriptions are always >100 chars. Threshold of 30 cleanly separates stubs from content without risk of false positives. Boundary: exactly 30 chars passes (guard is strict `<`).

**Alternatives considered**:
- `< 50` — risks catching very short real descriptions from some scrapers; 30 is safer
- `=== null || === undefined` only — misses stub-only descriptions that still mislead the model
- Category-tag detection regex — brittle; threshold is universal

---

## Decision 2: Baseline match_score for Empty-Description Jobs

**Decision**: `match_score = 10`

**Rationale**: Non-zero so the job appears on the board for manual review. Low enough to sort below any AI-scored job. Distinct from `0` (negative-blocked) and `-1` (AI fallback), preserving score semantics.

**Alternatives considered**:
- `match_score = -1` (fallback) — conflates "AI failed" with "no description"; hides intent
- `match_score = 0` — visually identical to blocked jobs; loses distinction
- `match_score = 50` — too high; pulls stub-jobs above legitimately scored ones

---

## Decision 3: Word-Boundary Regex Strategy

**Decision**: Add regex-based matchers alongside (or replacing) string entries for java/python. Use `/\bjava\b/i` for java and `/\bpython\b/i` for python. These do NOT match `javascript` because `\b` treats the word boundary after `java` as being adjacent to `s` (a word char) — no match.

**Rationale**: Production audit found `"Java+"`, `"Java/React"`, `"Fullstack (Java+React+TypeScript)"` all slip through `.includes('java ')` because punctuation follows java instead of a space. Word-boundary regex catches all these.

**Alternatives considered**:
- `/java[+/,()]/i` — catches some punctuation but misses `(java)` opener, incomplete
- Expanding string list (`'java+'`, `'java/'`, etc.) — combinatorial, fragile
- Full title normalization before matching — overly complex for this patch scope

---

## Decision 4: Frontend Override Keyword Set

**Decision**: Exempt from infrastructure blocklist if title (lowercased) contains any of: `angular`, `react`, `frontend`, `typescript`, `vue`, `next.js`

**Rationale**: These are the highest-confidence frontend signals. A title containing "Angular Platform Engineer" is almost certainly a frontend role that needs the infrastructure tooling, not an infra role that happens to mention Angular. The same logic applies to React, TypeScript, etc.

**Alternatives considered**:
- Only `angular` and `react` — misses TypeScript-tagged roles
- Full `PROFILE_KEYWORDS` set as overrides — too broad; "postgresql" shouldn't override "platform engineer"
- DB-configurable override list — over-engineered for a 6-keyword constant

---

## Decision 5: NoFluffJobs Category Field Name

**Decision**: The NF API response includes a `technology` array at the top level of each posting object (confirmed by inspecting production API shape). Use `posting.technology?.[0]` as the category value, lowercased. Fall back to `undefined` if absent.

**Rationale**: JustJoin uses `categoryName` on the offer; NF uses `technology` array. Taking index 0 gives the primary specialization. This mirrors the JustJoin `[category:X]` description stub exactly.

**Alternatives considered**:
- Join all technology values — produces stubs like `[category:javascript,typescript]` which is harder to match in negative/positive filters; single primary category is sufficient
- Use `posting.category` — NF API does not expose a `category` string field at the top level; `technology` is the correct field

---

## Decision 6: Polish Seniority Check Scope

**Decision**: Apply Polish terms (`starszy`, `lider`, `ekspert`) to title-only check, case-insensitive, same gate as English terms — only active when profile targets junior/mid.

**Rationale**: Consistent with current English seniority check which only reads `job.title.toLowerCase()`. Checking description too risks false positives (e.g., a job requiring "ekspert" knowledge in some area vs. an "Ekspert" seniority title).

**Alternatives considered**:
- Title + description — too many false positives from requirement text
- Separate list with different gate logic — unnecessary complexity; same gate condition applies
