# Documentation migration review

## Reading this map

This is a content-coverage and deletion-review manifest, not a ticket history.
The maintained entry is [AGENTS](../AGENTS.md); current problems and undecided requirements live in [status](status.md).
Retained source documents below are review inputs, not implementation instructions.
Their original bodies remain intact. A source banner points readers to the current documentation.
No old file is deleted by this change.

## What moved where

Source sections below refer to the original heading names, not line numbers shifted by review banners.
"Consolidated" means duplicated descriptions have one maintained owner; incorrect claims are recorded as problems or questions rather than reproduced as facts.

| Source | Source sections | Maintained home and treatment |
| --- | --- | --- |
| README | How It Works, Services, Project Structure, Database Schema | [Architecture](reference/architecture.md): original pipeline diagram reused; app/storage maps corrected from source |
| README | Prerequisites, Setup, credentials | [README](../README.md): source wording and configured commands retained; unsupported session-expiry assurance omitted |
| README | PM2, strategies, reconciliation operations, bot example | [Operations](reference/operations.md): sample response copied; current semantics corrected |
| README | Environment Variables, Stats API | [Environment](reference/environment.md), [API](reference/api.md): inventories extracted from code/manifests; missing-route claims moved to [status](status.md) |
| [PROCESS-SUMMARY](../PROCESS-SUMMARY.md) | System at a glance, Process details, Data flow | [Architecture](reference/architecture.md), [operations](reference/operations.md); reconciliation/cleanup are scheduled tasks inside apps |
| [PROCESS-SUMMARY](../PROCESS-SUMMARY.md) | Lifecycle, Concurrency/scaling | [Media lifecycle](../.principles/code/media-lifecycle.md), [reconciliation](../.principles/code/reconciliation.md), [environment](reference/environment.md); incorrect limits become status entries |
| [PROCESS-SUMMARY](../PROCESS-SUMMARY.md) | Ports, Environment quick reference | [Operations](reference/operations.md), [environment](reference/environment.md) |
| [Requirements](../requirement.md) | Scope, architecture, modules, tech choices (sections 1–3) | [Media specification](../specs/media-ingestion.md), [architecture](reference/architecture.md), [scripts](reference/scripts.md); implementation choices take precedence |
| [Requirements](../requirement.md) | Data model, naming, queues (4–6) | [Schema link in architecture](reference/architecture.md), [media principle](../.principles/code/media-lifecycle.md), [operations](reference/operations.md), [job payload source](../packages/shared/src/types/jobs.ts); illustrative stale payloads not adopted |
| [Requirements](../requirement.md) | Ingest, filtering, operations (7–9) | [Media specification](../specs/media-ingestion.md), [Telegram rules](../.principles/code/telegram-access.md), [operations](reference/operations.md); unimplemented filtering/protection/alerts become questions in status |
| [Requirements](../requirement.md) | API and statistics (10) | [API reference](reference/api.md); proposed routes/removed tables are classified in status |
| [Requirements](../requirement.md) | Shutdown, cross-group dedupe, reconnection (11–13) | [Process lifecycle](../.principles/delivery/process-lifecycle.md), [media specification](../specs/media-ingestion.md), [status](status.md); no unsupported reconnect/DB-retry guarantees |
| [Requirements](../requirement.md) | External limits, backpressure, capacity (14–16) | [Status](status.md): unresolved targets and proposals; external service quotas and sizing estimates are not verified/current operational guarantees |
| [Requirements](../requirement.md) | Testing, deployment, config (17–19) | [Verification](../.principles/quality/verification.md), [scripts](reference/scripts.md), [operations](reference/operations.md), [environment](reference/environment.md) |
| [Requirements](../requirement.md) | Milestones, checklist, configuration decisions (20, A–L) | Implemented behaviors map to the owners above; outstanding intent is grouped under D4–D6 in [status](status.md); scheduling estimates and unchecked completion lists are not live rules |
| [Requirements](../requirement.md) | Upload strategies and comparisons | [Operations](reference/operations.md), [environment](reference/environment.md), [status](status.md); proposed heuristics/fallbacks/hot switching are not presented as implemented |
| [Backfill requirements](MANUAL-BACKFILL-REQUIREMENTS.md) | Business goal, functional requirements, safety, acceptance | [Backfill specification](../specs/manual-backfill.md): sections extracted directly; current cap and slot identity corrected from source |
| [Backfill requirements](MANUAL-BACKFILL-REQUIREMENTS.md) | Duplicate rules, MVP scope | [Backfill specification](../specs/manual-backfill.md), [status](status.md): smaller ranges do not bypass the actual one-page scan |
| [Username plan](TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md) | Goal, decisions, scope, backend behavior | [API boundaries](../.principles/code/api-boundaries.md), [Telegram access](../.principles/code/telegram-access.md); bulk-import behavior checked against current code |
| [Username plan](TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md) | API contract/errors | [API reference](reference/api.md): request/response examples and error table extracted directly |
| [Username plan](TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md) | UI, compatibility, test/verification/acceptance | [Web guide](../apps/web-admin/AGENTS.md), [API boundaries](../.principles/code/api-boundaries.md), [verification](../.principles/quality/verification.md); implementation sequence is not a standing rule |
| [Scaling plan](reconciliation-scaling-implementation-plan.md) | Implemented behavior, invariants, implementation areas | [Reconciliation principle](../.principles/code/reconciliation.md), [architecture](reference/architecture.md); successful-page wording retained |
| [Scaling plan](reconciliation-scaling-implementation-plan.md) | Config/operating limits, telemetry | [Environment](reference/environment.md), [operations](reference/operations.md) |
| [Scaling plan](reconciliation-scaling-implementation-plan.md) | Goals/phases, metrics/testing, rollout, milestones | [Verification](../.principles/quality/verification.md), [status](status.md) D5/D9; no absent rollback flags or unmeasured percentile claims adopted |
| [SQL guide](CREATE-TU-USER-UPSERT-SQL.md) | Input/output, normalization, upsert intent | [Operations](reference/operations.md); blank numeric conflict recorded in status |
| [SQL guide](CREATE-TU-USER-UPSERT-SQL.md) | Executable generation, SQLite validation, PostgreSQL application and SQL shape | Retained in source pending validation; NOT claimed fully migrated or approved for deletion |

## Proposed deletions for review

These are candidates only; none is deleted or scheduled for automatic deletion.
Review residual examples, acceptance statements and coverage before authorizing removal.

| Candidate | Review condition |
| --- | --- |
| [PROCESS-SUMMARY.md](../PROCESS-SUMMARY.md) | Confirm consolidated architecture/operations and status dispositions cover the intended content |
| [requirement.md](../requirement.md) | Confirm disposition of unimplemented requirements and external estimates under D4–D6/D9 |
| [Backfill requirements](MANUAL-BACKFILL-REQUIREMENTS.md) | Confirm corrected current specification and desired pagination boundary |
| [Username plan](TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md) | Confirm contract/principle migration and whether manual verification steps need a separate runbook |
| [Scaling plan](reconciliation-scaling-implementation-plan.md) | Confirm retained targets/rollout intent before removing source proposals |
| [SQL guide](CREATE-TU-USER-UPSERT-SQL.md) | Blocked: generation/validation/application procedure is retained and not yet independently migrated/verified |

## Scope and exceptions

The existing untracked bot-ingestion proposal and user data/SQL/log files are untouched and are not deletion candidates.
The requested documentation test is the only executable-source addition; package manifests, runtime code and migrations are unchanged.
The proposed committed documentation generator is omitted to respect documentation-only scope.
The two routing tables are mirrored manually and checked by the test; reference tables are extracted during this migration.
[Verification record](documentation-verification.md) lists structural checks, ten source spot-checks and limitations.
