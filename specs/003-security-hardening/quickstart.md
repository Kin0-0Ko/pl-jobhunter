# Quickstart Validation: Security, Refactoring & Performance Hardening

**Purpose**: Runnable verification checklist to confirm all hardening tasks pass.

**Prerequisites**:
- `pnpm install` completed at repo root
- Docker daemon running (for Docker tests)
- `.env` configured (not committed — for backend tsc and test runs)

---

## Scenario S1 — Vulnerability Audit

**Goal**: Confirm zero high/critical CVEs.

```bash
# From repo root:
pnpm audit --audit-level=high
```

**Expected**: Exit code 0. No output lines containing `high` or `critical`.

**Failure response**: Check `pnpm audit --json` for affected package. Either upgrade the package or add to `pnpm.overrides` in root `package.json` with a patched version.

---

## Scenario S2 — Secret Scan

**Goal**: Confirm no hardcoded secrets in source.

```bash
# From repo root (PowerShell):
git grep -i -E "(password|token|secret|DB_PASSWORD|API_KEY)\s*=" -- "*.ts" "*.tsx" "*.js" "*.json" ":!*.env.example" ":!*.test.*" ":!specs/"
```

**Expected**: Zero matches (or only matches inside `.env.example` placeholder comments).

---

## Scenario S3 — Auth Hook Coverage

**Goal**: Every route enforces token or is explicitly whitelisted.

```bash
# Verify hook registered before routes in index.ts:
grep -n "authHook\|jobsRoutes\|profileRoutes\|healthRoute" apps/backend/src/index.ts
```

**Expected**: `authHook` line number is lower than all route plugin registration lines.

```bash
# Functional check (requires running backend):
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/jobs
# Expected: 401

curl -s -o /dev/null -w "%{http_code}" -H "X-API-TOKEN: $API_TOKEN" http://localhost:3000/api/jobs
# Expected: 200
```

---

## Scenario S4 — Git History Clean

**Goal**: No `.env` or wallet files in git history.

```bash
git log --all --full-history -- "*.env" "*/wallet/*" "*cwallet*" "*tnsnames*" "*sqlnet*"
```

**Expected**: No output (empty — no commits match).

---

## Scenario S5 — Dependency Audit

**Goal**: No unused packages in any workspace.

```bash
pnpm dlx depcheck --skip-missing apps/backend
pnpm dlx depcheck --skip-missing apps/frontend
```

**Expected**: `depcheck` reports no unused dependencies.

---

## Scenario S6 — Docker Build (Alpine)

**Goal**: Backend image uses `node:22-alpine`, `.dockerignore` present, build succeeds.

```bash
# From repo root:
docker build -f apps/backend/Dockerfile -t pl-jobhunter-hardened . 2>&1 | head -5

docker inspect pl-jobhunter-hardened --format '{{.Config.Labels}}'
# Or check base via: docker history pl-jobhunter-hardened | tail -3
```

**Expected**: Build completes without error. Image base is `node:22-alpine`.

```bash
# Verify .dockerignore works (node_modules not in context):
docker build -f apps/backend/Dockerfile -t pl-jobhunter-hardened . 2>&1 | grep "node_modules"
```

**Expected**: No `node_modules` transfer log lines — they're excluded.

---

## Scenario S7 — No console.* in Production Paths

**Goal**: Zero `console.log/warn/error` in non-test source files.

```bash
# PowerShell:
grep -rn "console\.(log|warn|error)" apps/backend/src/ apps/frontend/src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

**Expected**: Zero matches.

---

## Scenario S8 — TypeScript Strict Mode

**Goal**: `noUncheckedIndexedAccess` enabled, both packages compile clean.

```bash
pnpm --filter @pl-jobhunter/backend exec tsc --noEmit
pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit
```

**Expected**: Both exit 0 with no output.

```bash
# Confirm flag is set:
grep "noUncheckedIndexedAccess" tsconfig.base.json
```

**Expected**: `"noUncheckedIndexedAccess": true`

---

## Scenario S9 — .gitignore Coverage

**Goal**: Sensitive files correctly ignored at all levels.

```bash
git check-ignore -v wallet/
git check-ignore -v apps/backend/.env
git check-ignore -v apps/backend/wallet/cwallet.sso
git check-ignore -v apps/frontend/dist/
```

**Expected**: Each command prints the matching `.gitignore` rule — no line means the file is NOT ignored (failure).

```bash
# Final check — no sensitive files untracked:
git status --short | grep -E "\.env$|wallet|\.log$|stackdump"
```

**Expected**: Zero matches.

---

## Scenario S10 — Full Test Suite Green

**Goal**: All 32 existing tests pass after all hardening changes.

```bash
pnpm --filter @pl-jobhunter/backend run test
```

**Expected**: `32 passed | 0 failed` (or higher if new tests added).

---

## Validation Summary

| Scenario | Command | Pass Condition |
|----------|---------|----------------|
| S1 Vuln audit | `pnpm audit --audit-level=high` | Exit 0 |
| S2 Secret scan | `git grep -E "password\|token..."` | Zero matches |
| S3 Auth coverage | grep index.ts + curl | authHook first; 401 without token |
| S4 Git history | `git log --all -- *.env` | No output |
| S5 Unused deps | `depcheck` | No unused reported |
| S6 Docker build | `docker build` + inspect | node:22-alpine, build success |
| S7 No console.* | grep src/ exclude tests | Zero matches |
| S8 TS strict | `tsc --noEmit` both packages | Exit 0 |
| S9 .gitignore | `git check-ignore -v` | Rule printed for each |
| S10 Tests green | `pnpm run test` | 32+ passed, 0 failed |
