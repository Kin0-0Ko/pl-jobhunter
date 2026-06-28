---
description: "Task list for Security, Refactoring & Performance Hardening"
---

# Tasks: Security, Refactoring & Performance Hardening

**Input**: Design documents from `specs/003-security-hardening/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | quickstart.md ✅

**Tests**: No new test files. All existing 32 tests must remain green after hardening changes.

**Organization**: Tasks grouped by user story; IDs continue from `specs/002-production-readiness/tasks.md` (last ID: T081).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelizable — different files, no incomplete dependencies
- **[Story]**: User story label (US1–US5)
- Paths relative to repo root

## Path Conventions

- Backend: `apps/backend/src/`
- Frontend: `apps/frontend/src/`
- Config: `tsconfig.base.json`, `docker-compose.yml`, `.gitignore`

---

## Phase 13: User Story 1 — Security & Vulnerability Audit (Priority: P1) 🔒

**Goal**: Zero high/critical CVEs, zero hardcoded secrets in source, 100% auth hook coverage, clean git history.

**Independent Test**: `quickstart.md` Scenarios S1–S4 — `pnpm audit` exits 0; secret grep returns zero matches; auth hook line before route registrations; `git log` finds no `.env`/wallet files.

### Implementation — US1

- [x] T082 [US1] Run `pnpm audit --audit-level=high` from repo root — if any high/critical CVEs found, add `pnpm.overrides` entry in root `package.json` pinning affected package to patched version, or upgrade package; document any unavoidable exception in `specs/003-security-hardening/research.md` under a new "CVE Exceptions" section; then add `pnpm audit --audit-level=high` as a CI step in `.github/workflows/ci.yml` (create the file if absent) so future CVEs fail the pipeline automatically — step name: `Security audit`, runs after `pnpm install`
- [x] T083 [P] [US1] Grep `apps/backend/src/`, `apps/frontend/src/`, and `packages/shared/src/` for secret patterns — run: `git grep -i -E "(password|token|secret|DB_PASSWORD|API_KEY)\s*=" -- "*.ts" "*.tsx"` excluding `*.env.example`, `*.test.ts`, `specs/`; confirm zero matches; if matches found, replace hardcoded values with `process.env.VAR_NAME` references
- [x] T084 [P] [US1] Verify auth hook registration order in `apps/backend/src/index.ts` — confirm `server.addHook('preHandler', authHook)` appears before all `server.register(jobsRoutes)` and `server.register(profileRoutes)` calls; if `/health` endpoint exists and is intentionally public, add inline comment `// intentionally public — no auth required` on that registration line
- [x] T085 [P] [US1] Run `git log --all --full-history -- "*.env" "*/wallet/*" "*cwallet*" "*tnsnames*" "*sqlnet*"` — confirm zero output (no credential files ever committed); if any found, document remediation steps in `specs/003-security-hardening/research.md` under "Git History Remediation" (actual purge is out of scope and requires manual execution)

**Checkpoint**: `quickstart.md` S1–S4 all pass. Zero CVEs, zero secret leaks, auth confirmed, history clean.

---

## Phase 14: User Story 2 — Codebase & Directory Cleanup (Priority: P2) 🧹

**Goal**: No unused deps in any package.json, no orphan modules, no stale build artifacts as untracked files.

**Independent Test**: `quickstart.md` Scenario S5 — `depcheck` reports no unused dependencies; `tsc --noEmit` exits 0; `git status` shows no stale artifacts.

### Implementation — US2

- [x] T086 [US2] Run `pnpm dlx depcheck` in `apps/backend/` and `apps/frontend/` — for each flagged unused dependency, verify by grepping `apps/backend/src/` or `apps/frontend/src/` for the package name; remove confirmed-unused entries from `package.json` and run `pnpm install` to update lockfile; do NOT remove packages used only as types (check `@types/*` usage carefully)
- [x] T087 [P] [US2] Audit `packages/shared/src/index.ts` — for each exported type (`JobStatus`, `Job`, `AIAnalysis`, `JobWithAnalysis`, `UserProfile`), confirm at least one import of it exists in `apps/backend/src/` or `apps/frontend/src/`; remove any export with zero confirmed consumers; run `pnpm --filter @pl-jobhunter/shared run build` after any changes
- [x] T088 [P] [US2] Scan for stale artifacts and orphan source files — (a) run `git status --short` and for each untracked build artifact, stackdump, or temp file (e.g., `bash.exe.stackdump`) add its pattern to root `.gitignore`; (b) check for orphan `.ts`/`.tsx` source files with no inbound imports: run `Get-ChildItem -Recurse -Include "*.ts","*.tsx" apps/backend/src, apps/frontend/src, packages/shared/src | Where-Object { $_.Name -notmatch "\.test\." -and $_.Name -notmatch "index\." } | ForEach-Object { $name = $_.BaseName; if (-not (Select-String -Recurse -Pattern $name -Include "*.ts","*.tsx" -Path . -Quiet)) { $_.FullName } }` — for each file reported with zero importers, verify it is truly unused (not a top-level entry point), then delete it; do NOT delete files that may be user data

**Checkpoint**: `pnpm dlx depcheck` returns no unused deps in either app; `git status` shows only tracked files + `.env` (which should be ignored).

---

## Phase 15: User Story 3 — Docker Image Optimization (Priority: P2) 🐳

**Goal**: `node:22-alpine` both stages, `.dockerignore` at root, layer cache order correct, no `:latest` in compose.

**Independent Test**: `quickstart.md` Scenario S6 — `docker build -f apps/backend/Dockerfile .` succeeds; image base confirmed alpine; `.dockerignore` excludes node_modules.

### Implementation — US3

- [x] T089 [US3] Audit `apps/backend/Dockerfile` — verify both `FROM` instructions use `node:22-alpine` (not `node:22` or `node:22-slim`); verify layer order in runner stage: `COPY package.json pnpm-lock.yaml ./` → `RUN pnpm install --prod --frozen-lockfile` → `COPY --from=builder /app/dist ./dist`; fix any deviations; ensure no `:latest` appears in any FROM line
- [x] T090 [P] [US3] Create `.dockerignore` at repo root with these entries: `node_modules/`, `.git/`, `coverage/`, `*.env`, `.env.*`, `wallet/`, `dist/`, `*.log`, `.pnpm-store/`, `apps/*/node_modules/`, `packages/*/node_modules/`
- [x] T091 [P] [US3] Audit `docker-compose.yml` — replace any `:latest` image tags with explicit pinned versions (e.g., `node:22-alpine`, `postgres:16-alpine`); if a service uses a custom built image (e.g., `build: .`), that's fine — only external registry images need version pinning

**Checkpoint**: `docker build -f apps/backend/Dockerfile -t test-build .` completes successfully; `docker images test-build` shows image size reduced vs. pre-alpine baseline (if applicable).

---

## Phase 16: User Story 4 — Stack Best Practices Audit (Priority: P3) ⚙️

**Goal**: No connection leaks, idempotent pool, useEffect cleanup, zero console.* in src, noUncheckedIndexedAccess passes.

**Independent Test**: `quickstart.md` Scenarios S7–S8 — zero console.* grep matches; both `tsc --noEmit` commands exit 0 with `noUncheckedIndexedAccess: true`.

### Implementation — US4

- [x] T092 [US4] Audit `apps/backend/src/config/database.ts` — verify `getPool()` is idempotent: the function must check if a pool instance already exists (e.g., `if (pool) return pool`) and return it without calling `oracledb.createPool()` again; add a `fastify.log.debug` or standalone pino `logger.debug` call on the reuse path: `{ msg: 'pool reuse', status: pool.status }`
- [x] T093 [P] [US4] Audit ALL files in `apps/backend/src/routes/` and `apps/backend/src/ai/ollama.ts` — every `await pool.getConnection()` or `getConnection()` call must be followed by `conn.close()` inside a `finally` block; fix any route handler or helper where `conn.close()` is called only in the happy path (not in catch/finally); pattern: `let conn; try { conn = await pool.getConnection(); ... } finally { if (conn) await conn.close(); }`
- [x] T094 [P] [US4] Audit `apps/frontend/src/hooks/useJobs.ts`, `apps/frontend/src/hooks/useProfile.ts`, `apps/frontend/src/hooks/useFilter.ts` — each `useEffect` with an async fetch must set `let cancelled = false` before the async call and check `if (!cancelled) setState(...)` inside the async callback; the cleanup return must set `cancelled = true`; fix any hook missing this pattern; `useFilter` likely has no async ops (skip if pure derived state)
- [x] T095 [P] [US4] Grep `apps/backend/src/` and `apps/frontend/src/` for `console\.log|console\.warn|console\.error` excluding `*.test.ts` and `*.test.tsx` files — for each match in backend, replace with `fastify.log.*` (inside route handlers) or the standalone `logger.*` instance (inside ETL/ollama/telegram); for each match in frontend, replace with a no-op (remove the log) since frontend has no structured logger; confirm zero matches remain after fixes
- [x] T096 [US4] Add `"noUncheckedIndexedAccess": true` to `compilerOptions` in `tsconfig.base.json`; run `pnpm --filter @pl-jobhunter/backend exec tsc --noEmit` and `pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit`; for each resulting error, fix using `?.` optional chaining, explicit `!== undefined` guard, or typed array helpers (`.at(0)` returns `T | undefined`); do NOT suppress with `@ts-ignore` or `as T`

**Checkpoint**: `quickstart.md` S7–S8 pass. Zero console.* matches. Both tsc --noEmit exit 0. DB connections confirmed in finally blocks via code review.

---

## Phase 17: User Story 5 — Comprehensive .gitignore Overhaul (Priority: P1) 🛡️

**Goal**: No sensitive file (`.env`, wallet, credentials, build artifacts) can be accidentally committed from any workspace.

**Independent Test**: `quickstart.md` Scenario S9 — `git check-ignore -v` confirms each sensitive path is caught; `git status` shows no sensitive untracked files.

### Implementation — US5

- [x] T097 [US5] Overwrite root `.gitignore` with comprehensive entries — MUST include all of: `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*`, `!.env.example`, `wallet/`, `*.log`, `.pnpm-store/`, `bash.exe.stackdump`, `.vite/`, `*.stackdump`, `.DS_Store`, `Thumbs.db`, `*.tsbuildinfo`; preserve any existing entries not covered by above
- [x] T098 [P] [US5] Create `apps/backend/.gitignore` with: `wallet/`, `.env`, `.env.*`, `!.env.example`, `dist/`, `*.tsbuildinfo`
- [x] T099 [P] [US5] Create `apps/frontend/.gitignore` with: `dist/`, `.vite/`, `*.tsbuildinfo`
- [x] T100 [P] [US5] Verify `.gitignore` coverage — run: `git check-ignore -v wallet/`; `git check-ignore -v apps/backend/.env`; `git check-ignore -v apps/backend/wallet/cwallet.sso`; `git check-ignore -v apps/frontend/dist/`; each must print a rule; then run `git status --short | Select-String -Pattern "\.env$|wallet|stackdump"` and confirm zero matches

**Checkpoint**: `quickstart.md` S9 passes. All sensitive paths confirmed ignored at both root and package level.

---

## Phase 18: Polish & Verification 🏁

**Purpose**: Final confirmation that all hardening tasks pass and existing tests remain green.

**Dependency**: After all Phases 13–17 complete.

- [x] T101 Run full backend test suite: `pnpm --filter @pl-jobhunter/backend run test` — confirm all tests pass (32 minimum); fix any regressions introduced by earlier hardening tasks
- [x] T102 [P] Run TypeScript checks: `pnpm --filter @pl-jobhunter/backend exec tsc --noEmit` AND `pnpm --filter @pl-jobhunter/frontend exec tsc --noEmit` — both must exit 0; this is the final confirmation after T096 fixes
- [x] T103 [P] Run final vulnerability audit: `pnpm audit --audit-level=high` from repo root — must exit 0; this is the final gate after any dep changes from T086
- [x] T104 [P] Update `specs/003-security-hardening/tasks.md` — mark all completed task checkboxes; verify no unchecked tasks remain

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 13** (US1 — Security): No deps — start immediately
- **Phase 14** (US2 — Cleanup): No deps — parallel with Phase 13
- **Phase 15** (US3 — Docker): No deps — parallel with Phases 13–14
- **Phase 16** (US4 — Best Practices): Recommended after T086 (cleanup) to avoid editing files that may be removed; otherwise independent
- **Phase 17** (US5 — .gitignore): No deps — parallel with all phases (only .gitignore files)
- **Phase 18** (Polish): After all Phases 13–17 complete

### User Story Dependencies

- **US1 (P1)**: No deps — start immediately
- **US2 (P2)**: No deps — can parallel with US1
- **US3 (P2)**: No deps — can parallel with US1+US2
- **US4 (P3)**: Best after T086 (depcheck cleanup done); otherwise independent
- **US5 (P1)**: No deps — pure gitignore files, parallel with everything

### Parallel Groups Within Phases

**Phase 13**: T082 → T083+T084+T085 parallel
**Phase 14**: T086 → T087+T088 parallel
**Phase 15**: T089 → T090+T091 parallel
**Phase 16**: T092 → T093+T094+T095 parallel → T096 (after all four)
**Phase 17**: T097 → T098+T099+T100 parallel
**Phase 18**: T101 → T102+T103+T104 parallel

---

## Parallel Example: Phase 13 (US1 — Security Audit)

```bash
# T082 sequentially first (audit may drive pnpm.overrides changes):
Task T082: pnpm audit --audit-level=high + fix overrides

# Then in parallel:
Task T083: Secret grep across all src/ trees
Task T084: Auth hook registration order verification in apps/backend/src/index.ts
Task T085: Git history check for .env and wallet files
```

---

## Implementation Strategy

### Hardening Priority Order

1. **Phase 13 (Security) + Phase 17 (.gitignore)** — Both P1; run immediately and concurrently
2. **Phase 14 (Cleanup)** — Remove dead weight before auditing code quality
3. **Phase 15 (Docker)** — Image optimization; fully independent of code
4. **Phase 16 (Best Practices)** — TypeScript strictness requires most source edits; do last to minimize conflicts with cleanup
5. **Phase 18 (Polish)** — Final gates

### No New Features

Zero new API endpoints. Zero new DB tables. Zero new npm packages. Every task is audit, fix, configure, or delete. All changes are internal quality and security only.

### MVP Scope (User Stories 1 + 5 — Both P1)

1. Complete Phase 13 (Security Audit)
2. Complete Phase 17 (.gitignore Overhaul)
3. **STOP and VALIDATE**: `quickstart.md` S1–S4 + S9 pass
4. Proceed to Phases 14–16 for P2/P3 cleanup and best practices
