# Implementation Plan: Penalize Thin Tech-Stack Postings

## Change

Single file: `apps/backend/src/ai/ollama.ts`, `buildBatchPrompt()`.

Replaced step 4c's "judge by overall role fit" instruction with an explicit
low-score rule, plus a title-match carve-out so legitimately thin-but-relevant
postings (title alone names the candidate's stack) aren't punished.

Before (bug):
```
c. base = round(100 * covered / required). If tech_stack is genuinely empty after step 2, judge covered/required by overall role fit instead.
```

After:
```
c. base = round(100 * covered / required). If tech_stack is genuinely empty after step 2: base = 60 if the job TITLE itself names one of the candidate's skills verbatim (e.g. title says "Node.js Developer" and candidate lists Node.js); otherwise base = 5 — do not infer fit from overall role similarity when no concrete technology was found.
```

Same JSON output shape, same batch size, same number of NVIDIA API calls —
only prompt wording changed, so token count and rate-limit exposure are
unaffected.

## Files Touched

| File | Change |
|---|---|
| `apps/backend/src/ai/ollama.ts` | rewrote step 4c in `buildBatchPrompt()` |
| `apps/backend/src/ai/ollama.test.ts` | added prompt-content assertion test |

## Test Plan

- Assert `buildBatchPrompt()` output (captured via mocked NVIDIA endpoint) no
  longer contains "overall role fit"
- Assert it contains the title-match carve-out (`base = 60`) and the
  low-score fallback (`base = 5`)
- Full backend suite run to confirm no regressions in existing `scoreJobsBatch`
  tests (mocked at the HTTP/SDK boundary)

## Risk / Rollback

Pure prompt-text change. If the model responds worse (e.g. starts defaulting
everything thin to 5 even when title match should apply), revert this one
string change — no schema, no API surface, no other file touched.
