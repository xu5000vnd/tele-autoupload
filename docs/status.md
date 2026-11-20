# Status

## Known problems

| ID | Current problem | Evidence |
| --- | --- | --- |
| P1 | Desktop upload returns pending_sync after a local copy, but the uploader marks uploaded and removes staging without verification. | [Desktop strategy](../packages/shared/src/drive/drive-desktop.strategy.ts), [uploader](../apps/worker-uploader/src/uploader.service.ts) |
| P2 | Disk watermark values affect reported health; the download path has no implemented watermark pause/resume or emergency cleanup. | [Stats](../apps/stats-api/src/stats.service.ts), [download worker](../apps/worker-downloader/src/downloader.service.ts), [media download](../packages/shared/src/services/media.service.ts) |
| P3 | The retained account gateway download helper obtains a full Buffer; the active bot download path copies local API cache files without a full Buffer. | [Legacy helper](../packages/shared/src/telegram/telegram-gateway.ts), [bot download](../packages/shared/src/telegram/bot-telegram.service.ts) |
| P4 | Drive API destination construction does not create the described group/date folders; Playwright upload throws an unimplemented error. | [Drive API](../packages/shared/src/drive/drive-api.strategy.ts), [Playwright](../packages/shared/src/drive/playwright.strategy.ts) |
| P5 | Manual replay can recover only captured bot messages. A capture timestamp does not establish complete delivery during outages or permission loss; old Telegram history is outside the confirmed scope. | [Replay](../apps/stats-api/src/media-backfill.service.ts), [specification](../specs/manual-backfill.md) |
| P6 | RECONCILIATION_INTERVAL_MIN affects stale thresholds/budget validation, but recovery scheduling uses a fixed ten-minute Cron decorator. | [Ingestor](../apps/ingestor/src/ingestor.service.ts), [environment schema](../packages/shared/src/config/env.ts) |
| P7 | dev expands the start wildcard to include web; dev:all includes that wildcard and adds web again. | [Manifest](../package.json); wildcard expansion inspected in installed concurrently, without starting servers |
| P8 | Telegram readiness checks the local API, receiver freshness and observed membership loss; initial permissions still require a live pilot. Drive readiness remains unprobed by HTTP health. | [Stats service](../apps/stats-api/src/stats.service.ts), [bot readiness](../packages/shared/src/telegram/bot-telegram.service.ts) |
| P9 | Campaign dispatch is scheduled in process; startup connects Telegram but does not resume stored pending campaigns. | [Messages service](../apps/stats-api/src/messages.service.ts) |
| P10 | The retained SQL guide converts empty numeric fields to NULL, while both Telegram ID columns are required. | [SQL source](CREATE-TU-USER-UPSERT-SQL.md), [schema](../prisma/schema.prisma) |
| P11 | daily_stats, drive_folder_map and group_user_filter are absent from current schema and explicitly dropped by a migration; retained source plans still describe them. | [Drop migration](../prisma/migrations/20260225162553/migration.sql), [schema](../prisma/schema.prisma) |
| P12 | Source-plan daily/hourly aggregates, failed-queue inspection/requeue and detailed Telegram/Drive statistics routes are not registered. | [Stats controller](../apps/stats-api/src/stats.controller.ts), [API inventory](reference/api.md) |

## Waiting for a decision

Every entry below is **to confirm**; none is an implementation rule or approved feature commitment.

| ID | To confirm | Evidence or owner |
| --- | --- | --- |
| D1 | Does uploaded need confirmed remote synchronization, or is desktop local-copy completion intentional? | P1; [operations](reference/operations.md) |
| D3 | Should reconciliation honor the interval setting, and what timezone should the bot Cron use? | P6; [bot](../apps/stats-api/src/bot.service.ts) |
| D4 | Which source-plan commitments remain desired: disk control, streaming, remote folders/resumability, Playwright, richer metrics, sender blacklist, subtype exclusions, cross-group dedupe, alerting and hot reload? | [Retained requirements](../requirement.md), P2–P4/P11–P12; no capacity or external quota claims are adopted |
| D5 | What production host/shared staging/frontend serving topology, single-ingestor policy and campaign restart guarantees are required? | [Architecture](reference/architecture.md), P9; one configured instance is not proof of a universal prohibition |
| D6 | Are CI, branch protections or review gates maintained externally? | [Vitest](../vitest.config.ts) now supplies dummy application settings; external settings not inspected |
| D7 | What policy should replace blank-numeric SQL generation? | P10; [migration map](migration-map.md) |
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
| Bot capture targets new media from existing database source chats controlled by the operator, including files over 20 MB. The operator adds the bot manually; the local API server handles large files. | Horison's confirmed scope; [implementation plan](bot-media-ingestion-implementation-plan.md), [operations](reference/operations.md) |
| Account campaigns, reminders and username lookup are opt-in. Media workers never use account fallback. Captured-message retention remains indefinite pending an operational policy. | Implemented [configuration](../packages/shared/src/config/env.ts), [bot inbox](../packages/shared/src/telegram/bot-telegram.service.ts) |
