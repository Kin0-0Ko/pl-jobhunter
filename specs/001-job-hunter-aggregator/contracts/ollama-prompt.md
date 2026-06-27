# Ollama Prompt Contract: Job Scoring

**Endpoint**: `POST http://127.0.0.1:11434/api/generate`
**Model**: `qwen3:5b`
**Mode**: `"format": "json"` (Ollama JSON mode — forces valid JSON output)

---

## Request Schema

```json
{
  "model": "qwen3:5b",
  "format": "json",
  "stream": false,
  "prompt": "<see prompt template below>"
}
```

## Prompt Template

```
You are a senior software developer evaluating job fit for a candidate.
Respond with JSON only. No explanation outside the JSON object.

Required JSON schema:
{
  "match_score": <integer 0-100>,
  "summary": "<1-3 sentence description of the role>",
  "tech_stack": ["<tech1>", "<tech2>"],
  "why_good": "<1-2 sentence explanation of why this job fits the candidate>"
}

Candidate profile:
{OLLAMA_USER_PROFILE}

Job offer:
{JOB_JSON}

Return only the JSON object.
```

`{OLLAMA_USER_PROFILE}` — injected from `OLLAMA_USER_PROFILE` env var.
`{JOB_JSON}` — serialized subset: `{ title, company, source, tech_stack_hint }`.

---

## Response Schema

```json
{
  "response": "{\"match_score\":87,\"summary\":\"...\",\"tech_stack\":[\"TypeScript\"],\"why_good\":\"...\"}"
}
```

The `response` field is a JSON-encoded string. Parse with `JSON.parse(response.response)`.

## Expected Parsed Shape

```typescript
{
  match_score: number;    // 0–100 integer
  summary: string;        // non-empty
  tech_stack: string[];   // may be empty array
  why_good: string;       // non-empty
}
```

---

## Validation & Retry Policy

1. Parse `JSON.parse(response.response)`.
2. Validate: `match_score` is 0–100 integer; `summary` + `why_good` are non-empty strings;
   `tech_stack` is an array.
3. On parse error or validation failure: retry **once** with a simplified prompt (job title +
   company only).
4. On second failure: log warning, persist job without AI analysis record.

---

## Environment Variables

| Var | Description | Default |
|---|---|---|
| `OLLAMA_BASE_URL` | Ollama server URL | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Model tag | `qwen3:5b` |
| `OLLAMA_USER_PROFILE` | Candidate skills/preferences plaintext | (required) |
| `ALERT_SCORE_THRESHOLD` | Min score for Telegram alert | `80` |
