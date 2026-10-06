# Feature Specification: Penalize Thin Tech-Stack Postings in Match Scoring

**Feature ID**: 011 | **Status**: DONE | **Date**: 2026-10-06

## Problem Statement

No pre-filter exists before AI scoring (deliberate — a pre-filter risks dropping
legitimate corner-case jobs). The only gate is the scoring prompt itself
(`buildBatchPrompt` in `apps/backend/src/ai/ollama.ts`). Its previous step 4c:

> "If tech_stack is genuinely empty after step 2, judge covered/required by
> overall role fit instead."

combined with step 3's generosity instruction ("be generous — only 'no' for
jobs clearly unrelated to software development") let wrong-domain postings
with thin/no explicit tech mentions (e.g. a "Power BI Visualization Engineer"
role with no named technologies in its posting text) score 85-100 against a
TypeScript/Node.js profile purely on vague "role fit," despite zero skill
overlap. Confirmed via production `activity-report-2026-10-06.json`:
`avg_match_score: 30.76` while `top_matches` included non-Node.js roles at
match_score 95-100.

## User Story

As a job hunter with a specific tech profile (e.g. TypeScript/Node.js), I want
jobs with no named technologies overlapping my skills to score low, not be
scored generously on vague role-fit, so the top-matches list reflects actual
stack fit.

**Acceptance Criteria**:
- Prompt step 4c no longer instructs "judge covered/required by overall role
  fit instead" when `tech_stack` is empty.
- Instead: when `tech_stack` is empty after step 2, `match_score` is capped
  low (same cap already used for low-relevance: see `LOW_RELEVANCE_SCORE = 5`
  in `ollama.ts`) — unless the job title itself unambiguously matches the
  candidate's stack (e.g. title contains "Node.js", "TypeScript" verbatim),
  in which case normal scoring applies.
- No change to request count, batch size, or prompt token budget beyond the
  rewritten instruction text — NVIDIA free-tier rate limit (40 RPM
  account-wide) must not be affected.
- Existing `scoreJob` single-job path (`buildPrompt`/pass-1) is NOT touched —
  only the batch path (`buildBatchPrompt`) that actually assigns `match_score`
  needs the fix, per the bug's reproduction.
- Jobs with genuinely matching but thin postings (e.g. title says
  "Node.js Developer", no description) must NOT be penalized — title-level
  stack match stays a valid signal.

## Non-Goals
- No pre-filter / keyword gate before AI scoring (explicitly rejected —
  corner-case jobs must still reach the model)
- No change to seniority/experience profile fields (unrelated, separately
  unenforced by design per earlier investigation)
- No new API calls, no model/provider change
