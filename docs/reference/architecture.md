# Architecture reference

## Pipeline

```
Telegram Group
     │
     │  (photos / videos)
     ▼
┌─────────────┐  persist + enqueue  ┌─────────────────┐
│  Ingestor   │ ───────────────────►│ Download queue  │
│ Bot inbox   │                     └────────┬────────┘
└──────┬──────┘                              │
       │ PostgreSQL                           ▼
       ▼                            ┌─────────────────┐
┌─────────────┐                     │   Downloader    │
│ Media state │                     │ stage + hash    │
└─────────────┘                     └────────┬────────┘
                                             │ enqueue upload
                                             ▼
                                    ┌─────────────────┐     ┌─────────────┐
                                    │ Upload queue    │ ──► │  Uploader   │ ──► Google Drive
                                    └─────────────────┘     └─────────────┘
```

## Applications

| Process | Entry and ownership |
| --- | --- |
| Ingestor | [Bootstrap](../../apps/ingestor/src/main.ts), [service](../../apps/ingestor/src/ingestor.service.ts): sole bot polling owner, durable new/edited updates, uploader matching and stale-media recovery |
| Downloader | [Bootstrap](../../apps/worker-downloader/src/main.ts), [service](../../apps/worker-downloader/src/downloader.service.ts): consumes download work and delegates to MediaService |
| Uploader | [Bootstrap](../../apps/worker-uploader/src/main.ts), [service](../../apps/worker-uploader/src/uploader.service.ts): selected strategy, staging cleanup and notification batching |
| Stats API | [Bootstrap](../../apps/stats-api/src/main.ts), [module](../../apps/stats-api/src/app.module.ts): Fastify routes, captured replay, optional account campaigns/reminders and send-only daily bot reports |
| Web admin | [Router](../../apps/web-admin/src/main.ts), [API client](../../apps/web-admin/src/services/api.ts): Vue pages using the stats API |

## Shared state and communication

[SharedModule](../../packages/shared/src/services/shared.module.ts) registers Prisma, queues, media, Telegram, notifier and strategy providers in each importing Nest application.
Each process gets its own application context; an injected gateway is not one in-memory client shared across processes.
[PostgreSQL](../../prisma/schema.prisma) stores durable media, group, user, campaign and reminder state.
[QueueService](../../packages/shared/src/queue/queue.service.ts) transports download/upload jobs through Redis/BullMQ and coordinates leases/request permits.
[Job payloads](../../packages/shared/src/types/jobs.ts) contain a media item ID for download; upload also carries the staged path and string metadata.
Workers also load database state rather than treating queue payloads as the sole record.
Download and upload processes need access to the same staged files; the configured deployment must provide that filesystem visibility.
The [bot service](../../packages/shared/src/telegram/bot-telegram.service.ts) receives updates from the local Bot API server, commits each accepted batch and receipt offset in one PostgreSQL transaction, then dispatches the durable inbox separately. Bot-scoped Redis leases coordinate polling and dispatch. Dispatch retries and unmatched uploader capture do not block acknowledgment of durably stored updates.
The local API server and downloader must see the API file cache at the same absolute path. The downloader copies completed cache files to isolated attempt directories in staging without fetching messages through a user account. Each stored bot reference carries its owning bot and receipt revision; legacy references remain explicitly legacy.

## Control plane

The [stats module](../../apps/stats-api/src/app.module.ts) registers auth, statistics/dashboard, messages/targets, backfill and reminder controllers.
[MessagesService](../../apps/stats-api/src/messages.service.ts) persists targets and, when the legacy capability is enabled, campaigns with in-process dispatch; it does not enqueue campaigns into the media queues.
[ReminderSchedulesService](../../apps/stats-api/src/reminder-schedules.service.ts) creates campaigns from scheduled target selection.
[BotService](../../apps/stats-api/src/bot.service.ts) sends daily summaries through the local API. `/start` and `/today` are dispatched by the ingestor using the shared [summary service](../../packages/shared/src/services/upload-summary.service.ts); stats API never polls the token. GramJS is reserved for explicitly enabled account operations.
The frontend has a separate [manifest](../../apps/web-admin/package.json) and [development proxy](../../apps/web-admin/vite.config.ts).

## Storage map

| Schema area | Purpose |
| --- | --- |
| GroupState / UserTu | Group reconciliation state and registered uploaders |
| MediaItem / JobEventLog | Attachment lifecycle and per-item event records |
| BotReceiverState / BotUpdateInbox / BotChatCapture | Receipt offsets/epochs and ownership, durable ordered updates with retry outcomes, configured-chat capture and observed membership |
| DriveDateFolderCache | Persisted destination mapping records |
| MessageCampaign / MessageCampaignMedia / MessageCampaignTarget | Outbound message content, staged attachments and delivery state |
| ReminderSchedule / ReminderScheduleRun | Scheduling configuration and deduplicated scheduled runs |

[Schema](../../prisma/schema.prisma) owns fields and constraints; [API reference](api.md) owns HTTP contracts.
[Operations](operations.md) owns launch/destination details; [status](../status.md) owns implementation gaps.

## Sources

Pipeline diagram migrated from README; process responsibilities consolidated from [PROCESS-SUMMARY](../../PROCESS-SUMMARY.md) and [requirements](../../requirement.md), corrected against the linked modules and services.
