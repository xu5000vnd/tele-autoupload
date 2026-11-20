# Operations reference

## Local infrastructure and setup

[Compose](../../docker-compose.yml) defines Redis 7 Alpine and PostgreSQL 15 Alpine, exposing 6379 and 5432 with persistent named volumes.
It does not define application containers, app healthchecks or a shared application staging volume.
The optional [Bot API overlay](../../docker-compose.bot-api.yml) builds Telegram's official server from pinned source using [this Dockerfile](../../docker/telegram-bot-api.Dockerfile). It runs in local mode for large-file downloads and exposes port 8081 on loopback only. Application processes still run on the host through PM2.
Use the [README](../../README.md) for setup and [scripts](scripts.md) for commands already configured in package manifests.
Application environment requirements live in [environment](environment.md).

## Bot setup and cutover

Use Node 22 or newer. Configure BOT_TOKEN, BOT_API_ROOT and an absolute BOT_API_CACHE_DIR in the application environment. Configure TG_API_ID/TG_API_HASH for the local API server; these application credentials require no human-account session. Leave LEGACY_TELEGRAM_ENABLED=false unless account-based campaigns/username lookup are explicitly needed.

Create the cache directory before starting Compose. The server and host downloader must see it at exactly the same absolute path. Set BOT_API_UID and BOT_API_GID to the downloader user's `id -u`/`id -g` so files are readable without exposing the cache to other users. The following directory is the development example; replace it everywhere when selecting persistent production storage:

```bash
mkdir -p /tmp/tele-bot-api
chmod 700 /tmp/tele-bot-api
docker compose -f docker-compose.yml -f docker-compose.bot-api.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.bot-api.yml up -d --build bot-api
```

The first image build compiles the pinned official Bot API 10.4 source and TDLib. The overlay deliberately leaves the existing database/Redis-only Compose invocation unchanged. On a different host, provision a shared filesystem with the same absolute mount path; the overlay is for the host-worker topology.

When moving an existing bot from Telegram's hosted API, stop the old poller and call the hosted API's `logOut` method before starting local bot traffic, following the [official migration procedure](https://github.com/tdlib/telegram-bot-api#switching). Do not drop pending updates or run a second poller for that token. This code does not automatically switch a production bot's endpoint.

Before restarting application workers, back up the database and inventory old queued/failed downloads. The additive migration preserves existing IDs and uploaded/staged records. A legacy row with a durable staged file can resume upload; an MTProto-only reference cannot be translated to a bot reference and requires resubmission. Media workers never fall back to a human session, even when account-based API operations are enabled.

Apply the checked-in migration and generate the client during deployment:

```bash
npx prisma migrate deploy
npm run prisma:generate
```

Add the bot manually to each existing database source group and give it visibility of ordinary media (administrator, or disabled group privacy with re-addition). An inactive group record blocks intake. Verify with one representative uploader and a file over 20 MB before enabling every source. Anonymous/channel-authored posts require an identifiable authorized human sender under the current eligibility policy.

Start/reload the ingestor, downloader, uploader and stats processes after the API server and volumes are ready. The ingestor is the sole polling owner; stats only sends scheduled summaries. Verify guarded health reports API availability and fresh receiver success, then check inbox outcomes and the normal upload state. A quiet chat does not prove lost permissions; test ordinary media and verify membership.

The application copies cache files without deleting the API server's source. Cache and captured-inbox retention are not automatically managed. Plan capacity and retention separately from staging cleanup. Telegram retains undelivered updates for at most 24 hours; a longer intake outage cannot be repaired by scanning old chat history. If cutover fails, pause dispatch and retain the inbox, queues, staging and API state; correct the bot path before resuming.

## PM2 supervision

[ecosystem.config.cjs](../../ecosystem.config.cjs) registers ingestor, downloader, uploader and stats using their TypeScript entry points.
Each uses one fork-mode instance, ts-node and tsconfig-paths registration, automatic restart, 30-second minimum uptime, ten unstable restart attempts, exponential restart backoff and a 10-second kill timeout.
It sets NODE_ENV=production. A selected Node executable supplies the interpreter.
The frontend is not a PM2 application; Redis/PostgreSQL are also outside that process list.
The configured pm2:start and pm2:reload scripts pass --update-env. PM2 installation and boot persistence are external deployment prerequisites, not automated by this repository.
Keep credentials out of the ecosystem file; local environment files are excluded by [.gitignore](../../.gitignore).

## Staging and destinations

[MediaService](../../packages/shared/src/services/media.service.ts) stages under a chat-specific directory and computes SHA-256.
[Filename helpers](../../packages/shared/src/utils/file-naming.ts) produce deterministic names from date, message ID, media type/index and resolved extension. Bot downloads use a unique attempt directory beneath the chat directory, preserving that basename and preventing a stale attempt overwriting a newer file.
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

Use [environment](environment.md) for leases, stale budgets and worker concurrency, and [reconciliation](../../.principles/code/reconciliation.md) for invariants.
The [ingestor](../../apps/ingestor/src/ingestor.service.ts) retains the leased ten-minute stale-media sweep. The [bot service](../../packages/shared/src/telegram/bot-telegram.service.ts) polls and dispatches separately, with retry scheduling for failed inbox processing and retained unmatched senders.
Relevant events include bot polling deferred, bot inbox update deferred, media download starting/completed and recovering stale media item. No bot history RPC or history checkpoint is used. Source-plan production throughput/lag targets remain unmeasured.

## Manual backfill procedure

Register/import active users, select a group and date bounds, and preview before choosing run mode in the admin UI. The existing backfill route now replays only messages captured by this bot and displays the recorded capture start/coverage.
The [replay specification](../../specs/manual-backfill.md) owns duplicate handling and safety. [API](api.md) owns transport fields. Capture start is a recorded intake boundary, not proof that Telegram delivered every message during outages or permission loss.

## User import and SQL source

The [target API](api.md) supports user creation/update and bulk import.
The retained [SQL guide](../CREATE-TU-USER-UPSERT-SQL.md) supplies an alternative CSV-to-SQL procedure; it is retained for review rather than prescribed as a verified command sequence.
Its CSV columns are tu_id, telegram_chat_id, telegram_username, telegram_user_id, tu_name and path.
Its intended SQL target/conflict key are user_tu/tu_id; updates replace imported fields and set updated_at.
Username normalization strips leading @ and lowercases; empty usernames become NULL and text quotes are escaped.
The guide's blank-numeric conversion conflicts with [required database columns](../../prisma/schema.prisma); that issue is owned by [status](../status.md).
SQLite validation in the source guide is not proof of PostgreSQL execution, transactions or production-input validity.
The original generation, validation and apply snippets stay in that retained source until separately reviewed; they are not executed by this migration.

## Bot summaries

The ingestion bot provides help and `/today` summaries through the ingestor's durable receiver. Private chats, the configured report chat and configured source chats can request summaries. The stats process's [BotService](../../apps/stats-api/src/bot.service.ts) only sends scheduled summaries; it does not poll.
Automatic reports additionally require BOT_REPORT_CHAT_ID. Daily/date-selected summary calculations preserve their existing UTC-day behavior.
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
