---
task_set: TS-01
target_version: 1.0.0
---

# TS-01: Master Task Matrix

## Infrastructure Setup
- [x] ID: INFRA-101 | Priority: CRITICAL | Status: DONE
  * Description: Setup pnpm workspace layouts and shared typescript typings file.
  * Acceptance: `pnpm install` initializes root, packages/shared is linkable.

- [x] ID: INFRA-102 | Priority: CRITICAL | Status: DONE | DependsOn: INFRA-101
  * Description: Integrate OCI Autonomous DB connector and initial migration scripts.
  * Acceptance: Database handshake script executes cleanly via /wallet credentials.

- [ ] ID: INFRA-103 | Priority: MEDIUM | Status: PENDING | DependsOn: INFRA-102
  * Description: Dockerize backend environment and attach Caddy reverse proxy layer.
  * Acceptance: Production build encapsulates internal services and triggers SSL automation.

## Backend Engineering (ETL Pipelines)
- [ ] ID: BE-201 | Priority: HIGH | Status: PENDING | DependsOn: INFRA-102
  * Description: Code JustJoin.it endpoint harvester with raw payload type casting.
  * Acceptance: Returns standard records arrays matching the shared type contracts.

- [ ] ID: BE-202 | Priority: HIGH | Status: PENDING | DependsOn: INFRA-102
  * Description: Code NoFluffJobs search body client extractor and Polish salary parsing filters.
  * Acceptance: Standardizes diverse localization currency streams smoothly into numbers.

- [ ] ID: BE-203 | Priority: CRITICAL | Status: PENDING | DependsOn: BE-201, BE-202
  * Description: Setup Ollama transformer execution script forcing JSON Mode schemas.
  * Acceptance: Safe prompt loops validation preventing structural application errors.

- [ ] ID: BE-204 | Priority: MEDIUM | Status: PENDING | DependsOn: BE-203
  * Description: Bind scheduling node-cron triggers and serve database via Fastify endpoint.
  * Acceptance: Background tasks function in cycles without threat of server execution locks.

- [ ] ID: BE-205 | Priority: HIGH | Status: PENDING | DependsOn: BE-204
  * Description: Build Telegram Notification Bot layer supporting interactive application callbacks.
  * Acceptance: Dispatch payload layouts safely to designated admin user chat IDs only.

## Frontend Engineering
- [ ] ID: FE-301 | Priority: HIGH | Status: PENDING | DependsOn: INFRA-101
  * Description: Set up Vite+React template layout integrating static token auth validations.
  * Acceptance: Client application safely errors out on unauthorized endpoint access.

- [ ] ID: FE-302 | Priority: HIGH | Status: PENDING | DependsOn: FE-301, BE-204
  * Description: Render multi-column Kanban job board managing instant server patch calls.
  * Acceptance: Real-time UI element shifts mutate database target status instantly.

- [ ] ID: FE-303 | Priority: MEDIUM | Status: PENDING | DependsOn: FE-302
  * Description: Embed Polish B2B tax calculator formatting Gross metrics to Netto equivalents.
  * Acceptance: Renders precise estimations based on the 12% Ryczałt flat tax model rules.
