# Research: Security, Refactoring & Performance Hardening

## Decision 1: Vulnerability Scanning Tool

**Decision**: Use `pnpm audit --audit-level=high` as the sole CVE scanner for this phase.

**Rationale**: pnpm audit queries the npm advisory database and covers all workspace packages in one command. It integrates natively with the existing pnpm monorepo setup with zero additional tooling. `--audit-level=high` sets the fail threshold to high/critical only, avoiding noise from low/moderate advisories that rarely affect this threat model.

**Alternatives considered**: `npm audit`, Snyk CLI, Socket.dev — all require additional install or accounts. pnpm audit is zero-overhead for the existing stack.

---

## Decision 2: Secret Detection Approach

**Decision**: Use `git grep` / `grep -r` patterns targeting token-like strings: patterns matching `password\s*=`, `token\s*=`, `DB_PASSWORD\s*=`, connection string patterns, base64-like long strings. Exclude `.env.example`, test fixtures, and spec files from results.

**Rationale**: A lightweight grep approach scans the full working tree without requiring a separate tool (truffleHog, detect-secrets) and is immediately actionable. The patterns are scoped to the known secret types in this project: Oracle credentials, Telegram tokens, API tokens.

**Alternatives considered**: truffleHog, git-secrets, detect-secrets — effective but add a new toolchain dependency. Grep is sufficient for the known secret surface of this project.

---

## Decision 3: Auth Hook Coverage Verification

**Decision**: Verify via code review + test that `server.addHook('preHandler', authHook)` is registered globally in `index.ts` before all route plugins, and that `/health` is the only documented exception (or confirm it also requires auth).

**Rationale**: Fastify's global `preHandler` hook registered on the root instance applies to all routes registered after it. If `authHook` is registered before `jobsRoutes` and `profileRoutes`, all their routes inherit it. The `/health` endpoint is currently protected (returns 401 without token per tests). Confirming registration order is sufficient — no per-route audit needed if the global hook order is correct.

**Alternatives considered**: Per-route schema `security` annotations — useful for Swagger docs but not the auth enforcement mechanism in Fastify. Global hook is the correct pattern.

---

## Decision 4: Docker Base Image

**Decision**: Both builder and runner stages use `node:22-alpine`. The runner stage additionally runs `npm prune --production` equivalent via `pnpm deploy --prod` to strip devDependencies.

**Rationale**: Alpine images are ~50MB vs ~350MB for Debian-based `node:22`. The `node:22-alpine` tag is the official Node.js Alpine variant, well-maintained and LTS-aligned. Distroless would further reduce size but lacks a shell for debugging; Alpine is the pragmatic middle ground for a VPS-deployed service.

**Alternatives considered**: `node:22-slim` (Debian slim, ~200MB), distroless (smallest but no shell). Alpine wins on size vs. debuggability tradeoff.

---

## Decision 5: noUncheckedIndexedAccess Rollout

**Decision**: Enable `noUncheckedIndexedAccess: true` in `tsconfig.base.json`. Fix all resulting errors using optional chaining (`?.`), explicit null guards, or typed array helpers. Do NOT suppress via `// @ts-ignore`.

**Rationale**: This flag catches a real class of runtime bugs: array[index] returns `T | undefined` but code often assumes `T`. The fix pattern is mechanical (add `?` or guard) and produces safer code. The codebase is small enough that all errors can be fixed in one task.

**Alternatives considered**: Per-file `// @ts-ignore` suppressions — rejected (masks bugs). Separate `tsconfig.strict.json` — rejected (creates two competing configs). Apply universally via base.

---

## Decision 6: Console.log Replacement Strategy

**Decision**: Replace all `console.log` / `console.warn` / `console.error` in non-test `src/` files with the appropriate pino logger. ETL already has `logger` (standalone pino instance). Fastify routes use `fastify.log` or the request's `request.log`. No new logger instances needed.

**Rationale**: Pino is already the structured logger in both Fastify and the ETL runner. Replacing `console.*` calls is a mechanical find-and-replace that makes all log output consistent (JSON in prod, pretty in dev) and respects `LOG_LEVEL`.

**Alternatives considered**: Keep `console.*` for dev convenience — rejected (inconsistent output format, ignores LOG_LEVEL).

---

## Decision 7: .gitignore Strategy

**Decision**: Overhaul the root `.gitignore` to be comprehensive. Add package-level `.gitignore` files for `apps/backend/` and `apps/frontend/` with path-specific exclusions. Use `!.env.example` negation to explicitly allow the example file while blocking all other `.env*` variants.

**Rationale**: A single root `.gitignore` is simpler but package-level files provide an additional safety net for paths that only make sense in context (e.g., `wallet/` is backend-specific). The `bash.exe.stackdump` file visible in `git status` confirms the current root `.gitignore` has gaps.

**Alternatives considered**: Single root-only `.gitignore` — insufficient for wallet/ which is relative to `apps/backend/`. Both levels needed.

---

## Decision 8: Unused Dependency Detection

**Decision**: Manual audit via `depcheck` output cross-referenced with source imports. Run `pnpm dlx depcheck` in each workspace package to identify declared-but-unused deps, then verify each flagged entry by searching imports before removing.

**Rationale**: `depcheck` gives a quick candidate list. Manual import verification prevents false positives (some deps are used indirectly, e.g., peer deps, type-only imports that don't appear as `import` statements).

**Alternatives considered**: `knip` (broader dead code detection) — viable but adds a new tool. depcheck is targeted and sufficient for the dependency audit goal.
