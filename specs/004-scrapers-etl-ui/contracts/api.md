# API Contracts: Feature 004

## New Endpoint

### POST /api/etl/trigger

**Auth**: `X-API-TOKEN` required (same as all other endpoints)

**Request**: no body required

**Response 202**:
```json
{ "status": "started", "pid": 12345 }
```

**Response 401**: token missing/invalid (handled by global authHook)

**Response 500**: failed to spawn child process
```json
{ "error": "Failed to start ETL" }
```

**Behaviour**: Spawns `node dist/scheduler/etl.js --run-once` as detached child process. Returns 202 immediately. ETL runs in background; output goes to container stdout/stderr logs.

---

## Modified Endpoint

### PATCH /api/jobs/:id

**Change**: `status` field now accepts 7 values instead of 4.

```typescript
// Before
body: { status: 'NEW' | 'FAVORITE' | 'APPLIED' | 'ARCHIVED' }

// After
body: { status: 'NEW' | 'FAVORITE' | 'APPLIED' | 'INTERVIEWING' | 'OFFER' | 'REJECTED' | 'ARCHIVED' }
```

---

## Telegram Commands

### /status
Returns:
```
📊 System Status
DB: ✅ connected (or ❌ error message)
Ollama: ✅ reachable (or ❌ error message)
Time: 2026-06-28T15:00:00Z
```

### /scrape
Returns:
```
⚡ ETL started in background. Check back in ~5 minutes.
```
Spawns same child process as `POST /api/etl/trigger`.
