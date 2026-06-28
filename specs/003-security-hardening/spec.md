# Feature Specification: Security, Refactoring & Performance Hardening

**Feature Branch**: `003-security-hardening`

**Created**: 2026-06-28

**Status**: Draft

**Input**: Final hardening phase covering security audit, codebase cleanup, Docker optimization, stack best practices, and gitignore overhaul.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Security & Vulnerability Audit (Priority: P1)

A developer runs a full security sweep of the monorepo: dependency vulnerabilities are scanned, the codebase is checked for hardcoded secrets, API authentication coverage is verified, and git history is confirmed to contain no committed credentials or wallet files.

**Why this priority**: Security issues can expose real user data, Oracle credentials, or Telegram tokens. A single leaked API token or committed wallet is a critical incident. This must be the first gate before any deployment.

**Independent Test**: Run `pnpm audit` → 0 high/critical findings. Run secret grep → 0 matches. Review auth hook coverage → every route either requires `X-API-TOKEN` or is explicitly documented as public. Run `git log --all -- '*.env' '*/wallet/*'` → 0 results.

**Acceptance Scenarios**:

1. **Given** the monorepo has all dependencies installed, **When** `pnpm audit --audit-level=high` runs, **Then** it exits 0 with no high or critical CVEs reported.
2. **Given** the full codebase, **When** a secret pattern grep runs (tokens, passwords, connection strings), **Then** zero matches appear outside `.env.example` placeholder files.
3. **Given** the Fastify server, **When** any request arrives at any route without `X-API-TOKEN`, **Then** it receives HTTP 401 — no route silently bypasses the auth hook.
4. **Given** the git repository history, **When** checked for committed `.env`, wallet files, or credential files, **Then** none are found tracked or in history.

---

### User Story 2 — Codebase & Directory Cleanup (Priority: P2)

A developer audits the monorepo for dead weight: unused files, orphan imports, redundant dependencies, and stale artifacts that slow builds and create maintenance confusion.

**Why this priority**: Dead code and unused dependencies expand the attack surface, bloat CI times, and confuse contributors. Cleanup should follow the security audit but precede Docker work.

**Independent Test**: After cleanup, `pnpm install` installs only actually-used packages. No TypeScript import errors. `packages/shared/src/index.ts` exports only types confirmed used by at least one consumer.

**Acceptance Scenarios**:

1. **Given** all `package.json` files, **When** every listed dependency is checked against actual import statements in source, **Then** no unused dependencies remain in `dependencies` or `devDependencies`.
2. **Given** the monorepo source tree, **When** every file is checked for at least one import pointing to it, **Then** no orphan `.ts` / `.tsx` files exist that are never imported.
3. **Given** the git working tree after cleanup, **When** `git status` runs, **Then** no build artifacts, coverage directories, or temp files appear as untracked or modified.
4. **Given** `packages/shared/src/index.ts`, **When** each exported type is traced to its consumers, **Then** every export is used by at least one package.

---

### User Story 3 — Docker Image Optimization (Priority: P2)

A developer reviews and tightens the Docker build pipeline: base images are pinned to secure minimal variants, layer caching is structured for maximum CI speed, a `.dockerignore` prevents bloat, and `docker-compose.yml` uses pinned image tags.

**Why this priority**: Unpinned `latest` tags and full Debian base images introduce silent version drift and inflate image size. Alpine-based images reduce the attack surface by eliminating unneeded OS packages.

**Independent Test**: `docker build -f apps/backend/Dockerfile .` completes and the final image uses `node:22-alpine`. `docker images pl-jobhunter-backend` shows image size reduced vs. current. A `.dockerignore` exists and excludes `node_modules`, `.git`, `coverage`, `*.env`, `wallet/`. `docker-compose.yml` has no `:latest` tags.

**Acceptance Scenarios**:

1. **Given** the Dockerfile, **When** inspected, **Then** both builder and runner stages use `node:22-alpine`, not a full Debian image.
2. **Given** the build context, **When** `.dockerignore` is present, **Then** `node_modules`, `.git`, `coverage/`, `*.env`, and `wallet/` are excluded from the build context.
3. **Given** the Dockerfile layer order, **When** only source files change (not `package.json`), **Then** the dependency install layer is served from cache — build time under 60s for source-only changes.
4. **Given** `docker-compose.yml`, **When** inspected, **Then** all service images use explicit version tags (no `:latest`).

---

### User Story 4 — Stack Best Practices Audit (Priority: P3)

A developer audits the codebase against best practices for each technology in use: DB connections always released in `finally` blocks, the Oracle pool never re-initialized, React hooks have proper cleanup, all logging goes through pino (no raw `console.*`), and TypeScript strictness is maximized.

**Why this priority**: Resource leaks (DB connections), stale React closures, and console pollution in production are bugs waiting to happen in production traffic. TypeScript strictness gaps allow runtime errors that the compiler should have caught.

**Independent Test**: Code review shows all DB `conn.close()` calls in `finally` blocks. `getPool()` is idempotent (second call returns existing pool). All `useEffect` hooks with async operations have cancel flags. Grep for `console.log|console.warn|console.error` in `src/` returns 0 matches in non-test files. `noUncheckedIndexedAccess` enabled and `tsc --noEmit` exits 0.

**Acceptance Scenarios**:

1. **Given** all Fastify route handlers and ETL functions, **When** reviewed, **Then** every `conn.getConnection()` call has a corresponding `conn.close()` in a `finally` block — no code path skips it.
2. **Given** the Oracle pool initialization, **When** `getPool()` is called a second time before the first pool is closed, **Then** it returns the existing pool without creating a new one.
3. **Given** all React hooks (`useJobs`, `useProfile`, `useFilter`), **When** a component unmounts before an async fetch completes, **Then** the hook's cleanup function cancels the pending update (no setState on unmounted component).
4. **Given** all non-test source files, **When** grepped for `console.log`, `console.warn`, `console.error`, **Then** zero matches — all logging goes through the pino logger instance.
5. **Given** `tsconfig.base.json` with `noUncheckedIndexedAccess: true`, **When** `tsc --noEmit` runs across all packages, **Then** it exits 0 with no new type errors.

---

### User Story 5 — Comprehensive .gitignore Overhaul (Priority: P1)

A developer audits and rewrites all `.gitignore` files in the monorepo to ensure no secrets, build artifacts, wallet files, cache directories, or environment configs can ever be accidentally committed.

**Why this priority**: A missing `.gitignore` entry for `wallet/` or `.env` is a one-command mistake away from committing credentials to a public or shared repo. This is co-priority with the security audit.

**Independent Test**: After overhaul, `git status` shows no untracked sensitive files. `git check-ignore -v wallet/` confirms it's ignored. `git check-ignore -v apps/backend/.env` confirms it's ignored. A dry-run `git add .` shows no `.env`, `dist/`, `node_modules`, `coverage/`, or `wallet/` files staged.

**Acceptance Scenarios**:

1. **Given** the root `.gitignore`, **When** checked, **Then** it covers: `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*`, `!.env.example`, `wallet/`, `*.log`, `.pnpm-store/`, `bash.exe.stackdump`.
2. **Given** `apps/backend/.gitignore`, **When** checked, **Then** it covers: `wallet/`, `.env`, `dist/`.
3. **Given** `apps/frontend/.gitignore`, **When** checked, **Then** it covers: `dist/`, `.vite/`.
4. **Given** the full repo after overhaul, **When** `git status` runs, **Then** no sensitive file (`.env`, wallet file, private key) appears as untracked or staged.

---

### Edge Cases

- What if `pnpm audit` reports vulnerabilities with no available patch? → Document CVE, pin to last safe version or add `pnpm.overrides` resolution, record exception with rationale.
- What if a `console.log` is inside a test file? → Test files are excluded from the production-paths pino audit; only `src/` non-test files in scope.
- What if removing an "unused" dep breaks a transitive import? → Verify with `tsc --noEmit` and full test run before removing; restore if tests fail.
- What if `noUncheckedIndexedAccess` causes widespread errors? → Fix all errors — do not relax the flag; use optional chaining (`?.`) and explicit guards.
- What if wallet files were committed in an earlier commit? → Use `git filter-repo` or BFG to purge from history; rotate all credentials immediately.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The CI pipeline MUST fail if `pnpm audit --audit-level=high` reports any high or critical vulnerability.
- **FR-002**: The codebase MUST contain zero hardcoded secrets, tokens, passwords, or connection strings outside placeholder `.env.example` files.
- **FR-003**: Every Fastify route MUST enforce `X-API-TOKEN` authentication or be explicitly listed as a public whitelist exception with documented rationale.
- **FR-004**: The git repository MUST contain no tracked `.env` files, wallet files, or credential files (neither in working tree nor in any commit).
- **FR-005**: All `package.json` files MUST list only dependencies that are directly imported in source files — no unused entries in `dependencies` or `devDependencies`.
- **FR-006**: No orphan source files MUST exist that are never imported by any other module in the monorepo.
- **FR-007**: `packages/shared/src/index.ts` MUST export only types that are actively used by at least one consumer package.
- **FR-008**: The backend Dockerfile runner stage MUST use `node:22-alpine` as its base image.
- **FR-009**: A `.dockerignore` file MUST exist at the repo root excluding `node_modules/`, `.git/`, `coverage/`, `*.env`, and `wallet/`.
- **FR-010**: `docker-compose.yml` MUST NOT use `:latest` image tags for any service.
- **FR-011**: Every database connection obtained via `pool.getConnection()` MUST be released via `conn.close()` in a `finally` block — no exception.
- **FR-012**: `getPool()` MUST be idempotent — calling it multiple times MUST return the same pool instance without re-initialization.
- **FR-013**: All `useEffect` hooks performing async operations MUST implement cancellation to prevent state updates on unmounted components.
- **FR-014**: Zero calls to `console.log`, `console.warn`, or `console.error` MUST exist in non-test source files — all logging MUST use the pino logger instance.
- **FR-015**: `tsconfig.base.json` MUST enable `noUncheckedIndexedAccess: true`; all packages MUST pass `tsc --noEmit` with this flag active.
- **FR-016**: The root `.gitignore` MUST cover `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*` (with `!.env.example` exception), `wallet/`, `*.log`, `.pnpm-store/`, and `bash.exe.stackdump`.
- **FR-017**: Package-level `.gitignore` files MUST exist for `apps/backend/` and `apps/frontend/` with appropriate path-specific exclusions.

### Key Entities

- **Vulnerability Report**: Output of `pnpm audit` — CVE IDs, severity levels, affected packages, fix availability.
- **Secret Pattern**: Regex-detectable strings matching token/password/connection string patterns in source code.
- **Docker Layer Cache**: Ordered sequence of Dockerfile instructions whose invalidation cascades to subsequent layers.
- **Orphan Module**: A source file with no import pointing to it from any other file in the monorepo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm audit --audit-level=high` exits 0 with zero high or critical CVEs across all workspace packages.
- **SC-002**: Secret pattern scan returns zero matches in all non-example source files.
- **SC-003**: Auth coverage audit confirms 100% of routes either enforce token auth or are explicitly whitelisted — 0 unprotected routes.
- **SC-004**: Dependency cleanup removes all unused packages; `pnpm install` installs only entries with confirmed import usage.
- **SC-005**: Docker backend image size decreases by at least 20% vs. pre-optimization baseline; build time for source-only changes under 60 seconds with warm cache.
- **SC-006**: `tsc --noEmit` exits 0 across all packages with `noUncheckedIndexedAccess: true` — zero new type errors.
- **SC-007**: Zero `console.*` calls in non-test source files after pino migration.
- **SC-008**: `git status` after `.gitignore` overhaul shows zero sensitive files (`.env`, wallet, credentials) as untracked or staged.

## Assumptions

- All hardening work targets the existing `dev` branch codebase; no new features are introduced in this phase.
- The `/health` endpoint is the only candidate for auth whitelist; all other routes require the token.
- `pnpm audit` is the sole vulnerability scanning tool; no additional SAST tool is required in this phase.
- Wallet files (`*.sso`, `*.p12`, `cwallet.sso`, `tnsnames.ora`, `sqlnet.ora`) are never legitimately committed — any presence in history is treated as an incident.
- TypeScript `noUncheckedIndexedAccess` may require adding null guards to array/object accesses; the fix is guards, not flag relaxation.
- Docker layer cache optimization assumes the CI runner persists the Docker build cache between runs (standard for GitHub Actions with `cache-from`).
- This phase produces no user-visible feature changes — it is purely internal quality and security work.
