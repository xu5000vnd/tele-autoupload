# Status

## Known problems

| ID | Current problem | Evidence |
| --- | --- | --- |
| P1 | Desktop upload returns pending_sync after a local copy, but the uploader marks uploaded and removes staging without verification. | [Desktop strategy](../packages/shared/src/drive/drive-desktop.strategy.ts), [uploader](../apps/worker-uploader/src/uploader.service.ts) |
| P2 | Disk watermark values affect reported health; the download path has no implemented watermark pause/resume or emergency cleanup. | [Stats](../apps/stats-api/src/stats.service.ts), [download worker](../apps/worker-downloader/src/downloader.service.ts), [media download](../packages/shared/src/services/media.service.ts) |
| P3 | Media download obtains a full Buffer before writing to staging. | [Gateway](../packages/shared/src/telegram/telegram-gateway.ts) |
| P4 | Drive API destination construction does not create the described group/date folders; Playwright upload throws an unimplemented error. | [Drive API](../packages/shared/src/drive/drive-api.strategy.ts), [Playwright](../packages/shared/src/drive/playwright.strategy.ts) |
| P5 | Manual backfill fetches one capped history page from message ID zero before filtering dates; narrowing dates does not reach later pages. | [Backfill](../apps/stats-api/src/media-backfill.service.ts), [gateway](../packages/shared/src/telegram/telegram-gateway.ts) |
| P6 | RECONCILIATION_INTERVAL_MIN affects windows/budget validation, but scheduling uses a fixed ten-minute Cron decorator. | [Ingestor](../apps/ingestor/src/ingestor.service.ts), [environment schema](../packages/shared/src/config/env.ts) |
| P7 | dev expands the start wildcard to include web; dev:all includes that wildcard and adds web again. | [Manifest](../package.json); wildcard expansion inspected in installed concurrently, without starting servers |
| P8 | Overview reports telegram_connected as a literal true. Health checks PostgreSQL, Redis and staging, not the claimed live Telegram/Drive probes. | [Stats service](../apps/stats-api/src/stats.service.ts) |
| P9 | Campaign dispatch is scheduled in process; startup connects Telegram but does not resume stored pending campaigns. | [Messages service](../apps/stats-api/src/messages.service.ts) |
| P10 | The retained SQL guide converts empty numeric fields to NULL, while both Telegram ID columns are required. | [SQL source](CREATE-TU-USER-UPSERT-SQL.md), [schema](../prisma/schema.prisma) |
| P11 | daily_stats, drive_folder_map and group_user_filter are absent from current schema and explicitly dropped by a migration; retained source plans still describe them. | [Drop migration](../prisma/migrations/20260225162553/migration.sql), [schema](../prisma/schema.prisma) |
| P12 | Source-plan daily/hourly aggregates, failed-queue inspection/requeue and detailed Telegram/Drive statistics routes are not registered. | [Stats controller](../apps/stats-api/src/stats.controller.ts), [API inventory](reference/api.md) |

## Waiting for a decision

Every entry below is **to confirm**; none is an implementation rule or approved feature commitment.

| ID | To confirm | Evidence or owner |
| --- | --- | --- |
| D1 | Does uploaded need confirmed remote synchronization, or is desktop local-copy completion intentional? | P1; [operations](reference/operations.md) |
| D2 | Should manual backfill paginate the entire requested range? | P5; [backfill specification](../specs/manual-backfill.md) |
| D3 | Should reconciliation honor the interval setting, and what timezone should the bot Cron use? | P6; [bot](../apps/stats-api/src/bot.service.ts) |
| D4 | Which source-plan commitments remain desired: disk control, streaming, remote folders/resumability, Playwright, richer metrics, sender blacklist, subtype exclusions, cross-group dedupe, alerting and hot reload? | [Retained requirements](../requirement.md), P2–P4/P11–P12; no capacity or external quota claims are adopted |
| D5 | What production host/shared staging/frontend serving topology, single-ingestor policy and campaign restart guarantees are required? | [Architecture](reference/architecture.md), P9; one configured instance is not proof of a universal prohibition |
| D6 | What is the canonical dummy environment for clean-checkout application tests? Are CI, branch protections or review gates maintained externally? | [Vitest](../vitest.config.ts), [import-time config](../packages/shared/src/config/env.ts); external settings not inspected |
| D7 | What policy should replace blank-numeric SQL generation, and should the untracked bot-ingestion proposal enter this documentation scope? | P10; [migration map](migration-map.md); that proposal is left untouched |
| D8 | Should groupMedia responses explicitly serialize Prisma bigint fields? | [Raw item response](../apps/stats-api/src/stats.service.ts); live HTTP serialization is not verified |
| D9 | Are reporting time boundaries intentional, and are production-scale reconciliation latency/lag targets supported by measurements? | [Reporting principle](../.principles/code/reporting-time.md), [source scaling targets](reconciliation-scaling-implementation-plan.md) |

## Decisions on record

| Decision | Authority and canonical owner |
| --- | --- |
| AGENTS is the canonical harness entry; CLAUDE files import the adjacent guide. | User-approved structure; [root guide](../AGENTS.md) |
| Rules, lookup material and current product behavior have separate owners; unresolved intent stays here. | User-approved structure; [principles](../.principles/README.md), [reference](reference), [specifications](../specs/INDEX.md) |
| Documentation synchronization is required; checks must distinguish measured results from inspection. | User approval; [docs-sync](../.principles/practice/docs-sync.md), [verification](../.principles/quality/verification.md) |
| This migration uses a requested new branch, changes no application code and adds only the explicitly requested documentation test as executable source. | User task; [migration map](migration-map.md) |
| Source documents stay until content coverage and deletion candidates are reviewed. | User task; [migration map](migration-map.md) |
