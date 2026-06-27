# API Contract: Job Hunter Backend

**Base URL**: `https://<vps-domain>/api` (Caddy reverse proxy → Fastify on port 3000)

**Auth**: Every request MUST include `X-API-TOKEN: <token>` header.
Missing or invalid token → `401 Unauthorized` (no body).

---

## GET /api/jobs

Returns all jobs LEFT JOINed with ai_analysis, sorted by `match_score DESC` (NULLs last).

### Request

```
GET /api/jobs
X-API-TOKEN: <token>
```

No query parameters in v1.

### Response 200

```json
[
  {
    "id": "jj-abc123",
    "title": "Senior TypeScript Developer",
    "company": "Acme Corp",
    "url": "https://justjoin.it/offers/acme-typescript",
    "source": "justjoin",
    "salary_b2b_min": 18000,
    "salary_b2b_max": 24000,
    "salary_uop_min": null,
    "salary_uop_max": null,
    "currency": "PLN",
    "status": "NEW",
    "created_at": "2026-06-27T14:00:00.000Z",
    "match_score": 87,
    "summary": "Strong TypeScript role with Node.js backend focus.",
    "tech_stack": ["TypeScript", "Node.js", "PostgreSQL"],
    "why_good": "Matches your Node.js and TypeScript expertise at senior level."
  }
]
```

Jobs without AI analysis have `match_score`, `summary`, `tech_stack`, `why_good` = `null`.

### Response 401

No body. Triggered when `X-API-TOKEN` is absent or does not match `API_TOKEN` env var.

---

## PATCH /api/jobs/:id

Updates the `status` field of a specific job.

### Request

```
PATCH /api/jobs/jj-abc123
X-API-TOKEN: <token>
Content-Type: application/json

{ "status": "FAVORITE" }
```

### Response 200

```json
{ "id": "jj-abc123", "status": "FAVORITE" }
```

### Response 400

```json
{ "error": "Invalid status value. Must be one of: NEW, FAVORITE, APPLIED, ARCHIVED" }
```

### Response 404

```json
{ "error": "Job not found" }
```

### Response 401

No body. Same auth rule as above.

---

## Error Format (non-auth errors)

```json
{ "error": "<human-readable message>" }
```

HTTP status codes used: `200`, `400`, `401`, `404`, `500`.
