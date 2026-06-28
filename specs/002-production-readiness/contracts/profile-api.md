# API Contract: User Profile Endpoints

**Base URL**: `http://localhost:3000` (dev) / `https://<vps-domain>` (prod)
**Auth**: All requests require `X-API-TOKEN: <token>` header. Missing/invalid → 401.

---

## GET /api/profile

Returns the current user profile.

**Request**: No body. No query params.

**Responses**:

| Status | Body | When |
|--------|------|------|
| 200 | `UserProfile` object (see schema below) | Profile exists |
| 200 | `null` | No profile saved yet |
| 401 | _(empty)_ | Missing or invalid X-API-TOKEN |
| 500 | `{ "error": "string" }` | DB error |

**200 Body Schema**:
```json
{
  "skills": ["TypeScript", "Node.js"],
  "resume_text": "Senior backend engineer...",
  "preferred_contract": "b2b",
  "search_preferences": "Remote only, Poland-based companies",
  "updated_at": "2026-06-27T10:00:00.000Z"
}
```

**OpenAPI tags**: `profile`

---

## PUT /api/profile

Upserts (create or replace) the user profile.

**Request Body** (`Content-Type: application/json`):
```json
{
  "skills": ["TypeScript", "React", "Node.js"],
  "resume_text": "5 years Node.js...",
  "preferred_contract": "b2b",
  "search_preferences": "Remote B2B, 15k–22k PLN"
}
```

**Field rules**:
| Field | Required | Type | Validation |
|-------|----------|------|------------|
| `skills` | Yes | `string[]` | Non-empty array; at least 1 element |
| `resume_text` | No | `string \| null` | Max 10,000 chars |
| `preferred_contract` | Yes | `'b2b' \| 'uop' \| 'both'` | Enum |
| `search_preferences` | No | `string \| null` | Max 2,000 chars |

**Responses**:

| Status | Body | When |
|--------|------|------|
| 200 | `UserProfile` object (updated values + new `updated_at`) | Success |
| 400 | `{ "error": "string" }` | Validation failure (empty skills, invalid contract) |
| 401 | _(empty)_ | Missing or invalid X-API-TOKEN |
| 500 | `{ "error": "string" }` | DB error |

**Idempotency**: Calling `PUT /api/profile` twice with the same body produces the same result (pure upsert via MERGE INTO).

**OpenAPI tags**: `profile`
