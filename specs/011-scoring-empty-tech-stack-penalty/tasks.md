# Tasks: Penalize Thin Tech-Stack Postings

## TASK-1101: Rewrite buildBatchPrompt step 4c
Status: DONE
Edited `apps/backend/src/ai/ollama.ts` step 4c — replaced "judge
covered/required by overall role fit instead" with explicit title-match
carve-out (base=60) / low-score fallback (base=5, same constant value as
existing `LOW_RELEVANCE_SCORE`).

## TASK-1102: Tests
Status: DONE
Added test in `ollama.test.ts` capturing the batch prompt sent to the mocked
NVIDIA endpoint, asserting "overall role fit" is gone and new wording present.

## TASK-1103: Verify + typecheck
Status: DONE
`pnpm --filter @pl-jobhunter/backend build` clean. Full backend suite:
11 files, 115 tests passed. Commit hash: see git log after commit.
