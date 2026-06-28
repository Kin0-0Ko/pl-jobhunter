# Data Model: Security, Refactoring & Performance Hardening

**Note**: This phase introduces **no new database tables or schema changes**. All data model entities from previous phases remain unchanged.

## Existing Entities (unchanged)

| Entity | Table | Notes |
|--------|-------|-------|
| `Job` | `jobs` | No changes |
| `AIAnalysis` | `ai_analysis` | No changes |
| `UserProfile` | `user_profile` | Added in Phase 8 (002-production-readiness) |

## Configuration Entities (non-DB)

### Vulnerability Report (audit output — not persisted)

| Field | Type | Source |
|-------|------|--------|
| cve_id | string | pnpm audit JSON output |
| severity | 'low' \| 'moderate' \| 'high' \| 'critical' | pnpm audit |
| package_name | string | pnpm audit |
| fix_available | boolean | pnpm audit |
| resolution | string \| null | manual — pnpm.overrides or upgrade |

This is a runtime artifact only. Any exceptions are documented in `specs/003-security-hardening/research.md`, not persisted to DB.

### Docker Layer Cache Model (conceptual)

Correct layer order for `apps/backend/Dockerfile` runner stage:

```
1. FROM node:22-alpine          ← base (cached until tag changes)
2. COPY package.json pnpm-lock.yaml ← invalidates only when deps change
3. RUN pnpm install --prod      ← cached when layer 2 unchanged
4. COPY dist/ .                 ← invalidates on every source build
5. CMD [...]
```

This ordering ensures source-only changes (most CI runs) skip the expensive `pnpm install` layer.

## TypeScript Type Changes

### `tsconfig.base.json` additions

```json
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true
  }
}
```

No new TypeScript types are introduced. Existing types may require null-guard additions after enabling `noUncheckedIndexedAccess`.

## State Transitions

No new state machines. The `JobStatus` enum (`NEW | FAVORITE | APPLIED | ARCHIVED`) is unchanged.
