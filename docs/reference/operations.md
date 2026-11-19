# Operations reference

## Local infrastructure and setup

[Compose](../../docker-compose.yml) defines Redis 7 Alpine and PostgreSQL 15 Alpine, exposing 6379 and 5432 with persistent named volumes.
It does not define application containers, app healthchecks or a shared application staging volume.
Use the [README](../../README.md) for setup and [scripts](scripts.md) for commands already configured in package manifests.
Application environment requirements live in [environment](environment.md).

## PM2 supervision

[ecosystem.config.cjs](../../ecosystem.config.cjs) registers ingestor, downloader, uploader and stats using their TypeScript entry points.
Each uses one fork-mode instance, ts-node and tsconfig-paths registration, automatic restart, 30-second minimum uptime, ten unstable restart attempts, exponential restart backoff and a 10-second kill timeout.
It sets NODE_ENV=production. A selected Node executable supplies the interpreter.
The frontend is not a PM2 application; Redis/PostgreSQL are also outside that process list.
The configured pm2:start and pm2:reload scripts pass --update-env. PM2 installation and boot persistence are external deployment prerequisites, not automated by this repository.
Keep credentials out of the ecosystem file; local environment files are excluded by [.gitignore](../../.gitignore).

## Staging and destinations

[MediaService](../../packages/shared/src/services/media.service.ts) stages under a chat-specific directory and computes SHA-256.
[Filename helpers](../../packages/shared/src/utils/file-naming.ts) produce deterministic names from date, message ID, media type/index and resolved extension.
The uploader and downloader must see the same staging files; multi-host storage topology is [to confirm](../status.md#waiting-for-a-decision).

| Strategy | Current destination behavior | Evidence |
| --- | --- | --- |
| drive_desktop | Requires mapped user path in the uploader; creates a date/bucket subdirectory beneath the sync root and resolved user path | [Desktop strategy](../../packages/shared/src/drive/drive-desktop.strategy.ts), [uploader](../../apps/worker-uploader/src/uploader.service.ts) |
| drive_api | Uses configured Drive root as parent; computed group/date path is descriptive rather than remote folder creation | [API strategy](../../packages/shared/src/drive/drive-api.strategy.ts) |
| playwright | Destination description exists; upload is incomplete | [Playwright strategy](../../packages/shared/src/drive/playwright.strategy.ts) |

The desktop uploader can correct a missing path by matching bracketed tu_id beneath its base folder, then persist the corrected path; ambiguous matches fail.
[Status](../status.md) owns completion-verification, buffering, disk-protection and incomplete-strategy problems.
Do not infer remote sync confirmation from the uploaded database status.

## Cleanup and shutdown

The uploader removes its staged source after its successful processing path.
A fifteen-minute sweep deletes retained staged files for uploaded/skipped records older than the configured cleanup age, then clears localPath; each query selects up to 1000 rows.
[UploaderService](../../apps/worker-uploader/src/uploader.service.ts) owns both paths.
[Process lifecycle](../../.principles/delivery/process-lifecycle.md) owns shutdown rules; PM2's kill timeout is not evidence that every large active job completes before termination.

## Reconciliation operations

Use [environment](environment.md) for budgets, leases, paging, overlap and concurrency settings, and [reconciliation](../../.principles/code/reconciliation.md) for invariants.
The [ingestor](../../apps/ingestor/src/ingestor.service.ts) emits selected/completed/deferred chat counts, page/message counts, duration, deadline and lease-loss metadata.
Relevant events include reconciliation run started/completed, history page failed with no cursor advance, media download starting/completed and recovering stale media item.
The source plan recommends starting concurrency at 1 in an unmeasured deployment; this is an operating recommendation, not proof of tested production capacity.
The plan's percentile/lag targets and load scenarios remain [to confirm](../status.md#waiting-for-a-decision); no measured results are stored here.
There are no implemented flags for disabling a new scheduling/download path as described by the source rollout plan.

## Manual backfill procedure

Register/import active users, select a group and date bounds, and preview before choosing run mode in the admin UI.
The [backfill specification](../../specs/manual-backfill.md) owns duplicate handling, safety and the actual history boundary.
[API](api.md) owns transport fields. A successful preview is not evidence that messages outside its returned history page were scanned.

## User import and SQL source

The [target API](api.md) supports user creation/update and bulk import.
The retained [SQL guide](../CREATE-TU-USER-UPSERT-SQL.md) supplies an alternative CSV-to-SQL procedure; it is retained for review rather than prescribed as a verified command sequence.
Its CSV columns are tu_id, telegram_chat_id, telegram_username, telegram_user_id, tu_name and path.
Its intended SQL target/conflict key are user_tu/tu_id; updates replace imported fields and set updated_at.
Username normalization strips leading @ and lowercases; empty usernames become NULL and text quotes are escaped.
The guide's blank-numeric conversion conflicts with [required database columns](../../prisma/schema.prisma); that issue is owned by [status](../status.md).
SQLite validation in the source guide is not proof of PostgreSQL execution, transactions or production-input validity.
The original generation, validation and apply snippets stay in that retained source until separately reviewed; they are not executed by this migration.

## Optional summary bot

Create a bot through BotFather, configure the optional bot settings and add it to the intended chat.
[BotService](../../apps/stats-api/src/bot.service.ts) provides help and daily/date-selected summaries using long polling; it is not the media-ingestion transport.
The bot requires its token; automatic reports additionally require the configured report chat.
Its Cron expression is 0 9 * * * with no timezone option. Host-timezone intent is [to confirm](../status.md#waiting-for-a-decision).
Sample output migrated from README:

```
📊 Summary — 2026-02-25

👤 John Doe (@john_doe)
   🖼 100 images  🎬 10 videos  📦 Total: 110
   ✅ Uploaded: 90  ❌ Failed: 10
```

## Health and logs

[API](api.md) owns the guarded health route and its response shape; [status](../status.md) records the limits of its Telegram/Drive health reporting.
[Logger](../../packages/shared/src/utils/logger.ts) uses Winston, console output and rotating files, serializing bigint and Error values.
Log directory creation occurs when the logger module initializes; importing application modules is not a read-only documentation-generation technique.

## Sources

Consolidated from README setup/PM2/bot sections, [PROCESS-SUMMARY](../../PROCESS-SUMMARY.md), [requirements](../../requirement.md), [SQL guide](../CREATE-TU-USER-UPSERT-SQL.md) and [reconciliation plan](../reconciliation-scaling-implementation-plan.md), corrected against the linked implementation.
