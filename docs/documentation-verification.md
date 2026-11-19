# Documentation verification record

## Scope

The maintained documentation is checked against the current checkout.
Retained source documents carry review banners; their contradictory original claims are not current guidance.
The [migration map](migration-map.md) records content dispositions and deletion-review conditions.
Application code, manifests and database migrations are unchanged; the requested [documentation test](../tests/documentation.spec.ts) is the sole executable-source addition.

## Structural checks

Run the commands listed in [scripts](reference/scripts.md).
Passed with Node v22.23.3: the focused Vitest run reports one test passed; the whitespace check reports no errors.
The root guide is 83 lines; scoped AGENTS guides are at most 22 lines, below their respective 150/300-line budgets.
The test scans Git-listed tracked and nonignored untracked Markdown, excluding ignored frameworks/dependencies through Git's file selection.
It checks inline/reference-style local links and heading/source-line fragments, adjacent CLAUDE imports, identical routing blocks and agent budgets.
External URLs and the semantics of source-document proposals are not validated by link resolution.
Separate inventory checks confirm script table commands match both manifests, environment-table names match the base schema, and the route index matches controller decorators.
All six retained source bodies match HEAD exactly after removing their review banners.
No old file is deleted; the proposed deletions and SQL procedure hold are in the migration map.

## Ten statements checked against source

These are static source spot-checks, not live integration results or proof that every statement is correct.

| # | Documentation statement | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Root manifest requires Node >=22. | [Source](../package.json#L29) | Matches source |
| 2 | Attachment slot has a schema uniqueness constraint. | [Source](../prisma/schema.prisma#L121) | Matches source |
| 3 | Downloaded state is retained after downstream handoff failure. | [Source](../packages/shared/src/services/media.service.ts#L588) | Matches source |
| 4 | Download attempts default to 8. | [Source](../packages/shared/src/config/env.ts#L67) | Matches source |
| 5 | Reconciliation uses a fixed ten-minute Cron decorator. | [Source](../apps/ingestor/src/ingestor.service.ts#L212) | Matches source |
| 6 | The history page implementation caps requests at 100. | [Source](../packages/shared/src/telegram/telegram-gateway.ts#L479) | Matches source |
| 7 | Desktop copy reports pending_sync. | [Source](../packages/shared/src/drive/drive-desktop.strategy.ts#L36) | Matches source |
| 8 | Playwright upload throws an unimplemented error. | [Source](../packages/shared/src/drive/playwright.strategy.ts#L18) | Matches source |
| 9 | Explicit username resolution returns the ID as a string. | [Source](../apps/stats-api/src/messages.service.ts#L473) | Matches source |
| 10 | The backend reporting cycle starts on day 20. | [Source](../apps/stats-api/src/reporting-cycle.ts#L1) | Matches source |

## Not verified

- Live Telegram, Google Drive/Desktop, Redis or PostgreSQL behavior; no network/service/database actions are performed.
- Browser flows, frontend deployment routing and process-manager startup/shutdown in production.
- Production throughput, percentile latency, request quotas, storage sizing or external service limits.
- External CI/branch protections/review settings, remote URLs and clean-checkout application-test environment.
- SQL generation/application snippets retained in the source guide.
- Backend/frontend builds and the full application test suite: not run for this documentation-only change.
- Every application behavior by execution; this change does not repair the problems in [status](status.md).

## Files created or changed

Line counts include review banners; pre-existing untracked user files are excluded.

| File | Action | Lines |
| --- | --- | ---: |
| [.principles/README.md](../.principles/README.md) | Created | 55 |
| [.principles/code/api-boundaries.md](../.principles/code/api-boundaries.md) | Created | 21 |
| [.principles/code/media-lifecycle.md](../.principles/code/media-lifecycle.md) | Created | 21 |
| [.principles/code/reconciliation.md](../.principles/code/reconciliation.md) | Created | 20 |
| [.principles/code/reporting-time.md](../.principles/code/reporting-time.md) | Created | 19 |
| [.principles/code/telegram-access.md](../.principles/code/telegram-access.md) | Created | 19 |
| [.principles/delivery/process-lifecycle.md](../.principles/delivery/process-lifecycle.md) | Created | 19 |
| [.principles/guardrails.md](../.principles/guardrails.md) | Created | 12 |
| [.principles/practice/docs-sync.md](../.principles/practice/docs-sync.md) | Created | 31 |
| [.principles/quality/verification.md](../.principles/quality/verification.md) | Created | 21 |
| [.principles/workspace/change-scope.md](../.principles/workspace/change-scope.md) | Created | 21 |
| [.principles/workspace/typescript-boundaries.md](../.principles/workspace/typescript-boundaries.md) | Created | 20 |
| [AGENTS.md](../AGENTS.md) | Created | 83 |
| [CLAUDE.md](../CLAUDE.md) | Created | 1 |
| [PROCESS-SUMMARY.md](../PROCESS-SUMMARY.md) | Changed | 364 |
| [README.md](../README.md) | Changed | 59 |
| [apps/stats-api/AGENTS.md](../apps/stats-api/AGENTS.md) | Created | 22 |
| [apps/stats-api/CLAUDE.md](../apps/stats-api/CLAUDE.md) | Created | 1 |
| [apps/web-admin/AGENTS.md](../apps/web-admin/AGENTS.md) | Created | 21 |
| [apps/web-admin/CLAUDE.md](../apps/web-admin/CLAUDE.md) | Created | 1 |
| [docs/CREATE-TU-USER-UPSERT-SQL.md](../docs/CREATE-TU-USER-UPSERT-SQL.md) | Changed | 205 |
| [docs/MANUAL-BACKFILL-REQUIREMENTS.md](../docs/MANUAL-BACKFILL-REQUIREMENTS.md) | Changed | 70 |
| [docs/TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md](../docs/TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md) | Changed | 259 |
| [docs/documentation-verification.md](../docs/documentation-verification.md) | Created | 94 |
| [docs/migration-map.md](../docs/migration-map.md) | Created | 65 |
| [docs/reconciliation-scaling-implementation-plan.md](../docs/reconciliation-scaling-implementation-plan.md) | Changed | 229 |
| [docs/reference/api.md](../docs/reference/api.md) | Created | 145 |
| [docs/reference/architecture.md](../docs/reference/architecture.md) | Created | 69 |
| [docs/reference/environment.md](../docs/reference/environment.md) | Created | 108 |
| [docs/reference/operations.md](../docs/reference/operations.md) | Created | 92 |
| [docs/reference/scripts.md](../docs/reference/scripts.md) | Created | 73 |
| [docs/status.md](../docs/status.md) | Created | 44 |
| [packages/shared/AGENTS.md](../packages/shared/AGENTS.md) | Created | 22 |
| [packages/shared/CLAUDE.md](../packages/shared/CLAUDE.md) | Created | 1 |
| [requirement.md](../requirement.md) | Changed | 1287 |
| [specs/AGENTS.md](../specs/AGENTS.md) | Created | 20 |
| [specs/INDEX.md](../specs/INDEX.md) | Created | 12 |
| [specs/manual-backfill.md](../specs/manual-backfill.md) | Created | 66 |
| [specs/media-ingestion.md](../specs/media-ingestion.md) | Created | 40 |
| [tests/documentation.spec.ts](../tests/documentation.spec.ts) | Created | 71 |
