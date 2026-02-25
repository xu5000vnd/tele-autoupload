# Telegram → Queue → Download → Google Drive Uploader (Client Session, Event-driven)

> Goal: Realtime ingest media (images/videos) from ~100 Telegram groups, optionally filtered by specific sender user IDs, then download and upload to Google Drive with dedupe, retries, and observability.

### Scope

**In scope:**
- Photos, videos, and documents (PDF, ZIP, etc.)
- Groups, supergroups, and channels in the allowlist
- Sender-based filtering (whitelist/blacklist per group)
- Media albums (grouped messages) — each item processed individually, linked by `grouped_id`

**Out of scope (for now):**
- Stickers, GIFs (animations), voice messages, video notes, contacts, locations
- Bot commands or inline bot results
- Text-only messages (no media)
- Real-time message editing sync (edited media is treated as a new event only if the media attachment changes)
- Cross-group content deduplication (same media forwarded to multiple groups is stored per-group; see section 11 for future options)

---

## 1) Why this architecture (vs UI automation / polling)

- **No 15–20 min polling**: Telegram client session (MTProto) receives **push updates** in near-realtime.
- Scales well for **100 groups**: ingest is lightweight; heavy work is download/upload.
- **Reliable**: queue + idempotency means you can retry safely and resume after crashes.
- **Decoupled**: ingest, download, and upload can scale independently and fail independently without cascading.

---

## 2) High-level architecture

```
Telegram (100 groups)
     |
     | (MTProto client session: realtime updates)
     v
[telegram-ingestor] ---> [Queue (BullMQ/Redis)] ---> [Downloader Workers] ---> [Uploader Workers] ---> Google Drive
        |                         |                         |                     |
        +-------------------------+-------------------------+---------------------+
                                  |
                               [DB: state + dedupe + logs]
                                  |
                          [Reconciliation Job]
                          (safety net, every 5-10 min)
```

### Modules

1) **telegram-ingestor**
- Maintains MTProto client session (acts like Telegram Desktop account).
- Subscribes to new message updates.
- Extracts media + metadata (including `grouped_id` for albums).
- Applies filter rules (by group, senderId, media type).
- Enqueues download jobs.
- Handles reconnection on disconnect (see section 12).

2) **media-downloader-worker**
- Downloads media from Telegram to local staging (stream if possible).
- Computes hash (optional but recommended for robust dedupe).
- Checks disk space before download; pauses if below threshold (see section 14).
- Updates DB status to `downloaded`.
- Enqueues upload jobs.

3) **drive-uploader-worker**
- Uploads to Google Drive via pluggable strategy (API / Desktop Sync / Playwright).
- Creates folder structure as needed.
- Writes `drive_file_id`, marks uploaded.
- Deletes local staging files after successful upload.

4) **reconciliation-job**
- Periodic safety net (every 5–10 min).
- Detects missed messages during downtime or network glitches.
- Enqueues any missing media.

5) **control-plane (optional)**
- Health checks, dashboards, requeue endpoints, and config management.

---

## 3) Recommended tech choices (Node-first)

- **Runtime**: Node.js 20+ (LTS)
- **Language**: TypeScript (strict mode)
- **Telegram client**: gramjs (MTProto client)
- **Queue**: BullMQ + Redis 7+
- **DB**: Postgres 15+ (prod) or SQLite (MVP via `better-sqlite3`)
- **ORM / query builder**: Prisma (schema-first) or Knex (migration-first)
- **Google Drive**: `googleapis` (Drive v3)
- **Logging**: pino + `pino-pretty` (dev) + structured JSON (prod)
- **Config**: `dotenv` + `zod` for runtime validation of env vars
- **Process manager**: PM2 (dev/single-server) or Docker Compose (prod)
- **Testing**: Vitest + MSW (mock Telegram/Drive HTTP) + Testcontainers (Redis/Postgres)

> Note: Telegram client session has permissions like the logged-in user. Use a dedicated "archive" account. Never use your personal account.

---

## 4) Data model

### `group_state`
- `chat_id` (PK, bigint)
- `title` (text)
- `chat_type` (`group | supergroup | channel`)
- `last_message_id` (bigint)
- `last_reconciled_at` (timestamp, nullable)
- `is_active` (boolean, default true)
- `created_at`, `updated_at`

### `media_item`
- `id` (uuid, PK)
- `chat_id` (bigint, FK → group_state)
- `message_id` (bigint)
- `grouped_id` (bigint, nullable — links album items)
- `media_index` (int, default 0 — position within a message with multiple media)
- `date` (timestamp)
- `sender_id` (bigint, nullable)
- `media_type` (`photo | video | document`)
- `mime_type` (text, nullable — e.g. `video/mp4`, `image/jpeg`)
- `tg_file_id` (text)
- `tg_file_unique_id` (text, nullable)
- `file_name` (text, nullable — original filename if available)
- `sha256` (text, nullable)
- `local_path` (text, nullable)
- `size_bytes` (bigint, nullable)
- `status` (`queued | downloading | downloaded | uploading | uploaded | failed | skipped`)
- `retry_count` (int, default 0)
- `last_retry_at` (timestamp, nullable)
- `drive_file_id` (text, nullable)
- `drive_web_url` (text, nullable)
- `error` (text, nullable)
- `failed_at` (timestamp, nullable)
- `priority` (int, default 0 — higher = processed first)
- `created_at`, `updated_at`

### `drive_folder_map`
- `chat_id` (PK, bigint)
- `drive_root_folder_id` (text)
- `drive_chat_folder_id` (text)
- `naming_template` (text, nullable)
- `created_at`, `updated_at`

### `drive_date_folder_cache`
- `id` (PK, serial)
- `chat_id` (bigint, FK)
- `date_path` (text — e.g. `2025/02/23`)
- `drive_folder_id` (text)
- `created_at`
- Unique(`chat_id`, `date_path`)

### `group_user_filter`
- `id` (PK, serial)
- `chat_id` (bigint, FK → group_state)
- `mode` (`whitelist | blacklist`)
- `user_id` (bigint)
- Unique(`chat_id`, `user_id`)

### `job_event_log` (append-only audit trail)
- `id` (PK, serial)
- `media_item_id` (uuid, FK)
- `event_type` (`queued | download_start | download_done | upload_start | upload_done | failed | retried | skipped`)
- `details` (jsonb, nullable)
- `created_at`

### `daily_stats` (materialized aggregates, one row per day)
- `date` (PK, date)
- `ingested_count` (int)
- `downloaded_count` (int)
- `uploaded_count` (int)
- `failed_count` (int)
- `skipped_count` (int)
- `bytes_downloaded` (bigint)
- `bytes_uploaded` (bigint)
- `avg_latency_ms` (int)
- `p95_latency_ms` (int)
- `flood_wait_count` (int)
- `drive_rate_limit_count` (int)
- `created_at`

**Uniqueness / dedupe (very important):**
- Primary dedupe key: unique(`chat_id`, `message_id`, `tg_file_unique_id`)
- Fallback if unique_id unavailable: unique(`chat_id`, `message_id`, `media_index`)
- Content-level dedupe (optional, future): match by `sha256` across messages

**Indexes (for query performance):**
- `media_item(status)` — for worker polling and dashboard queries
- `media_item(chat_id, date)` — for reconciliation range scans
- `media_item(chat_id, message_id)` — for dedupe lookups
- `job_event_log(media_item_id, created_at)` — for audit trail queries

---

## 5) Folder & file naming strategy (Drive)

Suggested folder tree:
`DriveRoot / TelegramArchive / <GroupTitle_or_ChatId> / YYYY / MM / DD / ...`

File naming (deterministic, debug-friendly):
`YYYYMMDD_HHMMSS__msg<messageId>__<type>__<index>.<ext>`

Example: `20250223_143022__msg12345__photo__0.jpg`

**Sanitization rules:**
- Group titles: replace `/\:*?"<>|` and whitespace runs with `_`, trim to 100 chars
- Append `__<chatId>` suffix to group folder name for uniqueness

Cache folder IDs to reduce Drive API calls:
- Cache `drive_chat_folder_id` in `drive_folder_map` table
- Cache `YYYY/MM/DD` folder IDs in `drive_date_folder_cache` table + in-memory LRU (TTL: 24h)

---

## 6) Queue design (BullMQ)

### Queues
- `media_download` — prioritized, with rate limiter
- `media_upload` — prioritized, with rate limiter

### Download job payload (example)
```json
{
  "mediaItemId": "uuid",
  "chatId": 123,
  "messageId": 456,
  "date": 1700000000,
  "senderId": 999,
  "priority": 0,
  "media": {
    "type": "photo",
    "fileId": "AgACAgIAAxkBAAI...",
    "uniqueId": "AQADAgAT...",
    "size": 12345,
    "fileName": "optional.jpg",
    "mimeType": "image/jpeg"
  }
}
```

### Upload job payload (example)
```json
{
  "mediaItemId": "uuid",
  "localPath": "/staging/chat_123/20250223_143022__msg456__photo__0.jpg",
  "chatId": 123,
  "messageId": 456,
  "mediaType": "photo",
  "sizeBytes": 12345
}
```

### Retry/backoff
- Download: retry 5 times, exponential backoff (initial 5s, max 5min)
- Upload: retry 8 times (Drive throttling), exponential backoff (initial 10s, max 30min)
- Dead-letter: mark `failed`, store `error` + `failed_at`, allow manual requeue via control plane

### Priority
- BullMQ supports job priority (lower number = higher priority)
- Photos default priority 0, videos priority 5 (photos first since they're faster)
- Manual requeues priority -1 (highest)

### Concurrency
- Photo downloads: 8–16 concurrent
- Video downloads: 2–4 (bound by network + disk I/O)
- Photo uploads: 8–12 concurrent
- Video uploads: 2–3 (bound by resumable upload overhead)

### Rate limiting (at queue level)
- Download queue: max 30 jobs/sec (Telegram flood control safety margin)
- Upload queue: max 10 jobs/sec (Drive API default quota: 12,000 queries/min per user)

---

## 7) Ingest logic (event-driven) + safety net

### Main (push updates)
- Listen to `NewMessage` events via gramjs `client.addEventHandler`
- For each message:
  - Ensure chat is in allowlist (`group_state.is_active = true`)
  - Extract `senderId` (handle anonymous admin: sender may be the group itself)
  - Apply `group_user_filter` rules
  - If media exists:
    - Extract all media items (a message can have grouped photos/videos via `groupedId`)
    - For each media item: upsert `media_item` + enqueue download
  - Update `group_state.last_message_id`

### Media album handling
- Telegram sends album items as individual `NewMessage` events sharing the same `groupedId`
- Each album item is a separate `media_item` row linked by `grouped_id`
- No special batching needed — they flow through the pipeline individually

### Edge cases to handle
- **Deleted messages**: not ingested (we only process NewMessage, not DeleteMessages)
- **Edited messages with new media**: listen for `EditedMessage` event; if media changed, create new `media_item`
- **Expired media**: download may fail with `FILE_REFERENCE_EXPIRED`; re-fetch message from API and retry
- **Media without file size**: set `size_bytes = null`, still enqueue; size determined after download
- **Service messages**: ignore (user joined, pinned message, etc.)

### Safety net (recommended)
A lightweight reconciliation job every 5–10 minutes:
- For each tracked group:
  - Fetch messages from `last_message_id` → now (using `messages.getHistory`)
  - Enqueue any media items not already in DB
  - Update `group_state.last_message_id` and `last_reconciled_at`
- This protects against downtime, network glitches, and gramjs event drops

---

## 8) Filtering by fixed sender user IDs

You can filter by `senderId` in groups/supergroups.

Common cases:
- **Group/Supergroup**: `senderId` is the user id.
- **Channel posts**: sender may be channel id or null; you'll need channel-specific handling.
- **Forwarded messages**: `senderId` is the forwarder; original sender may be in `fwdFrom`. Decide which you care about.
- **Anonymous admin**: messages appear as the group id itself. Option: add the group id to the whitelist if you want admin posts.
- **Bots**: `senderId` is the bot id. Usually you want to ignore bots unless they relay content.

Rule engine (simple):
- **whitelist mode**: process only listed userIds
- **blacklist mode**: ignore listed userIds
- **no filter**: process all senders (default if no `group_user_filter` rows for a chat)

---

## 9) Operational considerations

### Security
- Store Telegram session string encrypted at rest (macOS Keychain, Linux `secret-tool`, or AES-encrypted file).
- Store Google OAuth tokens / service account key encrypted at rest.
- Use a dedicated Telegram account to avoid affecting personal.
- Control plane (if exposed) must have authentication (API key or basic auth at minimum).
- Limit actions; avoid mass aggressive requests (flood control).

### Rate limiting & flood control

**Telegram (MTProto):**
- Telegram enforces flood wait; gramjs surfaces `FloodWaitError` with `seconds` field.
- On `FloodWaitError`: sleep for the indicated duration, then retry. Log a warning.
- Proactive throttling: limit download concurrency and reconciliation fetch rate (max ~30 requests/sec aggregate).
- For media download: gramjs `downloadMedia` handles chunking internally but is still subject to flood control.
- During initial backfill of history: use progressive delay (e.g., 200ms between `getHistory` calls).

**Google Drive API:**
- Default quota: 12,000 queries/min/user, 750 GB upload/day.
- On `403 rateLimitExceeded` or `429`: exponential backoff with jitter.
- Track daily upload volume; pause upload queue if approaching 750 GB limit.
- For resumable uploads (videos > 5MB): single upload session counts as 1 API call for initiation + 1 per chunk.

### Storage & disk management
- Staging folder size cap: configure `MAX_STAGING_SIZE_GB` (e.g., 50 GB).
- Cleanup job: runs every 15 min, deletes files with status `uploaded` older than `CLEANUP_AFTER_HOURS` (default: 2h).
- Emergency cleanup: if staging exceeds 90% of cap, pause download queue and aggressively clean uploaded files.
- For large videos, prefer resumable uploads to minimize time files sit in staging.

### Observability
- Structured logs per job: `chatId`, `messageId`, `mediaType`, `status`, latency, retries, error reason.
- Metrics to track:
  - Queue depth (download + upload) — alert if > 1000 for > 15 min
  - Job processing rate (jobs/min)
  - Error rate by type (Telegram flood, Drive quota, network, etc.)
  - Staging disk usage (GB)
  - End-to-end latency (message received → uploaded to Drive)
- Alerts:
  - Telegram session disconnected for > 5 min
  - Download or upload queue depth growing for > 30 min
  - Repeated failures for a specific chat (> 10 failures in 1h)
  - Staging disk > 80% of cap

---

## 10) API statistics & monitoring dashboard

A lightweight HTTP API (Express or Fastify) served by the control plane for real-time and historical pipeline statistics.

### 10.1) Real-time endpoints

#### `GET /api/stats/overview`
Top-level pipeline health at a glance.
```json
{
  "uptime_seconds": 86420,
  "telegram_connected": true,
  "telegram_connected_since": "2026-02-22T10:00:00Z",
  "queues": {
    "download": { "waiting": 12, "active": 4, "completed": 8340, "failed": 3, "delayed": 1 },
    "upload":   { "waiting": 8,  "active": 3, "completed": 8290, "failed": 5, "delayed": 2 }
  },
  "staging": {
    "used_gb": 2.4,
    "cap_gb": 50,
    "used_pct": 4.8,
    "backpressure_active": false
  },
  "rates": {
    "ingested_per_min": 14.2,
    "downloaded_per_min": 13.8,
    "uploaded_per_min": 12.5
  },
  "last_event_at": "2026-02-23T08:14:22Z"
}
```

#### `GET /api/stats/queues`
Detailed BullMQ queue metrics (wraps `queue.getJobCounts()`).
```json
{
  "download": {
    "waiting": 12,
    "active": 4,
    "completed": 8340,
    "failed": 3,
    "delayed": 1,
    "paused": false,
    "rate_limit": { "max_per_sec": 30, "current_per_sec": 14 }
  },
  "upload": {
    "waiting": 8,
    "active": 3,
    "completed": 8290,
    "failed": 5,
    "delayed": 2,
    "paused": false,
    "rate_limit": { "max_per_sec": 10, "current_per_sec": 7 }
  }
}
```

#### `GET /api/stats/queues/:queueName/failed?limit=20&offset=0`
List failed jobs with error details for inspection and requeue.
```json
{
  "total": 8,
  "items": [
    {
      "jobId": "dl-abc123",
      "mediaItemId": "uuid",
      "chatId": -1001234,
      "messageId": 5678,
      "mediaType": "video",
      "error": "FloodWaitError: 120 seconds",
      "attempts": 5,
      "failedAt": "2026-02-23T07:55:00Z"
    }
  ]
}
```

#### `POST /api/stats/queues/:queueName/requeue`
Requeue failed jobs. Body: `{ "jobIds": ["dl-abc123"] }` or `{ "all": true }`.

### 10.2) Per-group statistics

#### `GET /api/stats/groups`
Summary across all monitored groups.
```json
{
  "total_groups": 97,
  "active_groups": 95,
  "items": [
    {
      "chat_id": -1001234,
      "title": "Design Assets",
      "chat_type": "supergroup",
      "is_active": true,
      "last_message_id": 98765,
      "last_reconciled_at": "2026-02-23T08:10:00Z",
      "counts": {
        "total": 1240,
        "queued": 2,
        "downloading": 1,
        "downloaded": 3,
        "uploading": 1,
        "uploaded": 1220,
        "failed": 8,
        "skipped": 5
      },
      "today": {
        "ingested": 42,
        "uploaded": 38,
        "failed": 1,
        "bytes_uploaded": 524288000
      }
    }
  ]
}
```

#### `GET /api/stats/groups/:chatId`
Detailed stats for a single group, including recent media items.

#### `GET /api/stats/groups/:chatId/media?status=failed&limit=50&offset=0`
Query media items for a group, filterable by `status`, `mediaType`, `date_from`, `date_to`.

### 10.3) Historical / aggregate statistics

#### `GET /api/stats/daily?from=2026-02-01&to=2026-02-23`
Daily aggregates for trend analysis.
```json
{
  "days": [
    {
      "date": "2026-02-22",
      "ingested": 3420,
      "downloaded": 3420,
      "uploaded": 3415,
      "failed": 5,
      "bytes_downloaded": 8500000000,
      "bytes_uploaded": 8480000000,
      "avg_latency_sec": 12.4,
      "p95_latency_sec": 45.2,
      "errors": {
        "flood_wait": 3,
        "drive_quota": 0,
        "network": 2,
        "file_expired": 0
      }
    }
  ]
}
```

#### `GET /api/stats/hourly?date=2026-02-23`
Hourly breakdown for a single day — useful for identifying peak hours and bottlenecks.

### 10.4) Telegram API statistics

#### `GET /api/stats/telegram`
Telegram-specific API usage and health.
```json
{
  "session": {
    "connected": true,
    "connected_since": "2026-02-22T10:00:00Z",
    "disconnects_today": 1,
    "last_disconnect_at": "2026-02-23T03:12:00Z",
    "last_reconnect_at": "2026-02-23T03:12:08Z"
  },
  "flood_control": {
    "flood_waits_today": 4,
    "total_wait_seconds_today": 180,
    "last_flood_wait_at": "2026-02-23T06:30:00Z",
    "last_flood_wait_seconds": 30
  },
  "api_calls": {
    "messages_received_today": 12500,
    "media_messages_today": 3420,
    "get_history_calls_today": 288,
    "download_calls_today": 3420,
    "avg_download_speed_mbps": 18.5
  },
  "groups": {
    "monitored": 97,
    "active_today": 82,
    "silent_today": 15
  }
}
```

### 10.5) Google Drive API statistics

#### `GET /api/stats/drive`
Drive-specific API usage, quota tracking, and upload performance.
```json
{
  "strategy": "drive_api",
  "auth": {
    "authenticated": true,
    "token_expires_at": "2026-02-23T09:30:00Z",
    "token_refresh_count_today": 12
  },
  "quota": {
    "daily_upload_limit_gb": 750,
    "uploaded_today_gb": 8.2,
    "remaining_today_gb": 741.8,
    "used_pct": 1.1,
    "estimated_exhaustion": null
  },
  "api_calls": {
    "total_today": 4200,
    "files_create": 3415,
    "files_get": 120,
    "folders_create": 45,
    "folders_list": 620,
    "rate_limit_hits_today": 0,
    "avg_upload_speed_mbps": 22.3
  },
  "uploads": {
    "completed_today": 3415,
    "failed_today": 5,
    "resumable_sessions_active": 2,
    "avg_upload_duration_sec": 3.2,
    "p95_upload_duration_sec": 18.7,
    "bytes_uploaded_today": 8800000000
  },
  "folders": {
    "cached_folder_ids": 312,
    "folders_created_today": 45,
    "cache_hit_rate_pct": 92.5
  }
}
```

### 10.6) System health endpoint

#### `GET /api/health`
Used by load balancers, Docker healthcheck, or uptime monitoring.
```json
{
  "status": "healthy",
  "checks": {
    "telegram": { "status": "up", "latency_ms": 45 },
    "redis": { "status": "up", "latency_ms": 2 },
    "postgres": { "status": "up", "latency_ms": 5 },
    "drive": { "status": "up", "last_successful_upload": "2026-02-23T08:14:00Z" },
    "staging_disk": { "status": "ok", "used_pct": 4.8 }
  },
  "version": "1.2.0",
  "started_at": "2026-02-22T10:00:00Z"
}
```

Status values: `healthy` | `degraded` (backpressure active, high error rate) | `unhealthy` (session down, DB down, disk full).

### 10.7) Data model for statistics

#### `daily_stats` (materialized / pre-computed, one row per day)
- `date` (PK, date)
- `ingested_count` (int)
- `downloaded_count` (int)
- `uploaded_count` (int)
- `failed_count` (int)
- `skipped_count` (int)
- `bytes_downloaded` (bigint)
- `bytes_uploaded` (bigint)
- `avg_latency_ms` (int)
- `p95_latency_ms` (int)
- `flood_wait_count` (int)
- `drive_rate_limit_count` (int)
- `created_at`

#### `api_call_counter` (in-memory, persisted to Redis)
Tracks Telegram and Drive API call counts per rolling window (1 min, 1 hour, 1 day).

### 10.8) Configuration
| Variable | Default | Description |
|---|---|---|
| `STATS_API_PORT` | `3100` | Port for the statistics API |
| `STATS_API_AUTH_TOKEN` | (none) | Bearer token for API auth (required in production) |
| `STATS_RETENTION_DAYS` | `90` | How long to keep `daily_stats` rows |
| `STATS_REFRESH_INTERVAL_SEC` | `30` | How often to recompute real-time counters |

---

## 11) Graceful shutdown

All workers must handle `SIGTERM` and `SIGINT` cleanly:

1. **Ingestor**: disconnect gramjs client, flush pending enqueues, close DB connection.
2. **Download worker**: finish current download (or abort and mark `queued` for re-pickup), close BullMQ worker.
3. **Upload worker**: finish current upload (resumable uploads can be continued later), close BullMQ worker.
4. **BullMQ**: call `worker.close()` which waits for active jobs to complete (up to a configurable timeout, e.g., 30s).

Timeout: if graceful shutdown exceeds 60s, force-kill. PM2/Docker handles this with `kill_timeout` / `stop_grace_period`.

---

## 12) Cross-group deduplication (future consideration)

Same media forwarded to multiple groups:
- **Current approach (MVP)**: store per-group. Simple, no cross-group queries.
- **Future option**: use `sha256` or `tg_file_unique_id` to detect duplicates across groups.
  - Upload once to Drive, create shortcuts/links in other group folders.
  - Requires a `content_hash_index` table: `sha256 → drive_file_id`.
  - Trade-off: added complexity vs. storage savings.

---

## 13) Network resilience & reconnection

### Telegram client
- gramjs automatically reconnects on network drop, but the `NewMessage` handler must be re-registered.
- Implement a connection state monitor:
  - On disconnect: log warning, start reconnection timer.
  - On reconnect: verify event handlers are active, trigger immediate reconciliation for all groups.
  - If disconnected > 5 min: send alert.
  - If disconnected > 1 hour: may have missed messages; run full reconciliation.

### Redis connection
- BullMQ handles Redis reconnection internally.
- Configure Redis client with `maxRetriesPerRequest: null` and `enableReadyCheck: false` for resilience.

### Database connection
- Use connection pooling (Prisma default, or `pg.Pool` for raw Postgres).
- Retry transient DB errors (connection reset, deadlock) with backoff.

---

## 14) File size limits & constraints

| Source/Target | Limit |
|---|---|
| Telegram (regular account) | 2 GB per file (download) |
| Telegram (premium account) | 4 GB per file (download) |
| Google Drive (file upload) | 5 TB per file |
| Google Drive (daily upload) | 750 GB per user per day |
| Google Drive (API queries) | 12,000 per min per user |

- For videos approaching Telegram's limit: use streaming download to avoid OOM.
- Track daily Drive upload volume; pause queue if nearing 750 GB.

---

## 15) Backpressure & disk saturation protection

If downloads outpace uploads, the staging folder fills up. Mitigations:

1. **Disk usage check before download**: query staging folder size; if > `HIGH_WATERMARK` (e.g., 80% of cap), pause download queue.
2. **Resume downloads when safe**: when staging drops below `LOW_WATERMARK` (e.g., 50% of cap), resume download queue.
3. **BullMQ rate limiter**: configure max download rate to match realistic upload throughput.
4. **Priority inversion**: when backlogged, prioritize smaller files (photos) to clear staging faster.
5. **Health check**: expose `/health` endpoint that reports `degraded` when backpressure is active.

```
Download rate > Upload rate  →  staging grows  →  hit HIGH_WATERMARK  →  pause downloads
Upload clears backlog        →  staging shrinks →  hit LOW_WATERMARK   →  resume downloads
```

---

## 16) Capacity planning

### Estimates (for 100 groups, moderate activity)

| Metric | Estimate |
|---|---|
| Messages with media per day | ~2,000–10,000 |
| Average photo size | ~200 KB |
| Average video size | ~20 MB |
| Daily ingest volume (70% photos, 30% videos) | ~3–30 GB/day |
| Peak staging disk usage | ~5–15 GB |
| Monthly Drive storage | ~100–900 GB |
| Redis memory | < 200 MB (job metadata only) |
| Postgres storage | < 1 GB/month (metadata rows) |

### Infrastructure (single-machine MVP)

| Component | Minimum |
|---|---|
| CPU | 2 cores |
| RAM | 4 GB |
| Disk (staging) | 50 GB SSD |
| Network | 50 Mbps sustained |

### Scaling triggers
- If download queue depth is consistently > 500: add download worker concurrency or a second machine.
- If upload queue depth is consistently > 1000: investigate Drive API quota and consider Shared Drive (higher limits).
- If staging disk > 80% regularly: increase disk or reduce cleanup interval.

---

## 17) Testing strategy

### Unit tests
- Filter rule engine: whitelist/blacklist logic, edge cases (no filter, empty list).
- File naming: sanitization, deterministic naming, collision avoidance.
- Dedupe logic: same message, same media in different messages, cross-group.
- Config validation: missing required env vars, invalid values.

### Integration tests (with Testcontainers)
- Queue flow: enqueue download → worker picks up → enqueue upload → worker picks up.
- DB operations: upsert idempotency, status transitions, constraint violations.
- Redis: queue retry behavior, dead-letter.

### End-to-end tests (staging environment)
- Use a test Telegram group with known messages.
- Upload to a test Drive folder.
- Verify: correct files in correct folders, correct naming, no duplicates.

### Mock strategy
- **Telegram**: MSW or custom mock server that replays recorded MTProto responses.
- **Google Drive**: MSW intercept of `googleapis` HTTP calls; return fake file IDs.
- **Redis/Postgres**: Testcontainers spin up real instances per test suite.

### Manual / smoke tests
- Session login flow (requires real Telegram account).
- OAuth consent flow (requires real Google account).
- Reconnection test: kill network, verify recovery.

---

## 18) Deployment

### Option A: Docker Compose (recommended for prod)
```yaml
services:
  redis:
    image: redis:7-alpine
    volumes: [redis-data:/data]
  postgres:
    image: postgres:15-alpine
    volumes: [pg-data:/var/lib/postgresql/data]
  ingestor:
    build: ./apps/ingestor
    depends_on: [redis, postgres]
    restart: unless-stopped
  worker-downloader:
    build: ./apps/worker-downloader
    depends_on: [redis, postgres]
    restart: unless-stopped
    volumes: [staging:/staging]
  worker-uploader:
    build: ./apps/worker-uploader
    depends_on: [redis, postgres]
    restart: unless-stopped
    volumes: [staging:/staging]
```

### Option B: PM2 (single machine, simpler)
```json
{
  "apps": [
    { "name": "ingestor", "script": "dist/apps/ingestor/main.js", "instances": 1 },
    { "name": "downloader", "script": "dist/apps/worker-downloader/main.js", "instances": 1 },
    { "name": "uploader", "script": "dist/apps/worker-uploader/main.js", "instances": 1 }
  ]
}
```

### Deployment notes
- Ingestor must run as a **single instance** (one MTProto session = one connection).
- Download/upload workers can run multiple instances (BullMQ distributes jobs).
- Store Telegram session file and Google credentials outside the container (mounted volume or secret manager).

---

## 19) Configuration schema

All configuration via environment variables, validated at startup with `zod`.

### Required
| Variable | Description | Example |
|---|---|---|
| `TG_API_ID` | Telegram API ID | `12345678` |
| `TG_API_HASH` | Telegram API hash | `abcdef1234567890` |
| `TG_SESSION_STRING` | Telegram session string (base64) | `1BQANOTr...` |
| `TG_ALLOWED_CHAT_IDS` | Comma-separated chat IDs to monitor | `-1001234,-1005678` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `DATABASE_URL` | Postgres or SQLite connection string | `postgresql://user:pass@localhost/tgarch` |
| `STAGING_DIR` | Path to staging folder | `/data/staging` |
| `UPLOAD_STRATEGY` | Upload strategy | `drive_api`, `drive_desktop`, `playwright` |

### Required (per strategy)
| Variable | Strategy | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | drive_api | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | drive_api | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | drive_api | OAuth refresh token |
| `DRIVE_ROOT_FOLDER_ID` | drive_api | Root folder ID in Drive |
| `DRIVE_SYNC_FOLDER` | drive_desktop | Local sync folder path |
| `PLAYWRIGHT_PROFILE_DIR` | playwright | Browser profile path |

### Optional (with defaults)
| Variable | Default | Description |
|---|---|---|
| `DOWNLOAD_CONCURRENCY` | `8` | Max concurrent downloads |
| `UPLOAD_CONCURRENCY` | `6` | Max concurrent uploads |
| `MAX_STAGING_SIZE_GB` | `50` | Staging disk cap |
| `CLEANUP_AFTER_HOURS` | `2` | Delete uploaded files after N hours |
| `RECONCILIATION_INTERVAL_MIN` | `10` | Safety-net reconciliation interval |
| `LOG_LEVEL` | `info` | pino log level |
| `HIGH_WATERMARK_PCT` | `80` | Pause downloads above this % |
| `LOW_WATERMARK_PCT` | `50` | Resume downloads below this % |
| `DOWNLOAD_MAX_RETRIES` | `5` | Max download retries |
| `UPLOAD_MAX_RETRIES` | `8` | Max upload retries |

---

## 20) Concrete build plan (milestones)

### Milestone 1 — MVP (1–3 groups, ~1 week)
- Redis + DB up (Docker Compose)
- gramjs login + persistent session
- Detect new message with photo in 1–3 test groups
- Download → upload to a fixed Drive folder (DriveDesktopStrategy for speed)
- Record DB state + dedupe by `(chat_id, message_id, tg_file_unique_id)`
- Basic pino logging
- Config validation with zod

### Milestone 2 — Scale to 100 groups (~1 week)
- Allowlist groups + mapping chatId → Drive folder
- Folder-per-group + date subfolders (YYYY/MM/DD)
- Filter by senderIds (whitelist/blacklist per group)
- Add retries/backoff + dead-letter
- Video support + concurrency split (photo vs video)
- Priority queues (photos first)

### Milestone 3 — Production hardening (~1–2 weeks)
- Resumable upload for large files (Drive API strategy)
- Reconciliation job (safety net)
- Backpressure: disk watermark pause/resume
- Cleanup job (staging folder management)
- Graceful shutdown handling (SIGTERM)
- Network resilience: reconnection + re-reconciliation
- Error alerting (log-based or webhook to Telegram/Slack)
- Job event audit log

### Milestone 4 — Control plane & statistics API (~1–2 weeks)
- Statistics API server (Express/Fastify) with bearer token auth
- Real-time endpoints: overview, queue stats, Telegram stats, Drive stats
- Per-group statistics and media item queries
- Historical endpoints: daily/hourly aggregates with `daily_stats` materialization
- Health endpoint for Docker/load balancer integration
- Failed job inspector + manual requeue (single + bulk)
- Configuration hot-reload (filter rules, concurrency)
- Dashboard UI (optional): simple web page consuming the stats API

---

# Checklist TODO (for building)

## A. Repo & project setup
- [ ] Create monorepo structure (`apps/ingestor`, `apps/worker-downloader`, `apps/worker-uploader`, `packages/shared`)
- [ ] Add Docker Compose for Redis + Postgres
- [ ] Add config management (`dotenv` + `zod` validation schema)
- [ ] Add structured logger (pino + pino-pretty)
- [ ] Add `tsconfig.json` with strict mode, path aliases
- [ ] Add `.env.example` with all required/optional vars documented
- [ ] Add `Makefile` or `package.json` scripts for common dev tasks

## B. Database & migrations
- [ ] Define schema: `group_state`, `media_item`, `drive_folder_map`, `drive_date_folder_cache`, `group_user_filter`, `job_event_log`, `daily_stats`
- [ ] Add unique constraints for dedupe (`chat_id, message_id, tg_file_unique_id`)
- [ ] Add indexes for query performance (status, chat_id+date, chat_id+message_id)
- [ ] Implement DB client layer + migrations (Prisma or Knex)
- [ ] Seed script for dev/test data

## C. Telegram ingestor (gramjs)
- [ ] Implement login flow + persist session string securely
- [ ] Load allowlist groups configuration from env (`TG_ALLOWED_CHAT_IDS`)
- [ ] Subscribe to `NewMessage` events
- [ ] Subscribe to `EditedMessage` events (detect media changes)
- [ ] Parse message:
  - [ ] chatId, messageId, date, senderId, groupedId
  - [ ] detect media types (photo/video/document)
  - [ ] extract fileId/uniqueId/fileName/size/mimeType if available
- [ ] Apply filtering rules:
  - [ ] group allowlist
  - [ ] sender whitelist/blacklist per group
  - [ ] media type allowlist
- [ ] Upsert `media_item` (status `queued`) idempotently
- [ ] Enqueue `media_download` job with priority
- [ ] Handle `FloodWaitError` (sleep + retry)
- [ ] Implement reconnection handler (re-register event handlers, trigger reconciliation)
- [ ] Graceful shutdown: disconnect client, flush pending

## D. Queue layer (BullMQ)
- [ ] Create queues: `media_download`, `media_upload`
- [ ] Configure retry/backoff policies (exponential with jitter)
- [ ] Configure rate limiters (30 jobs/sec download, 10 jobs/sec upload)
- [ ] Add job priority support
- [ ] Add job tracing fields (jobId, correlationId, mediaItemId)
- [ ] Configure dead-letter behavior (move to failed after max retries)

## E. Downloader worker
- [ ] Consume `media_download` queue
- [ ] Check disk space before download (backpressure)
- [ ] Download media from Telegram:
  - [ ] stream to file in staging folder
  - [ ] determine extension from mime type or file name
  - [ ] handle `FILE_REFERENCE_EXPIRED` (re-fetch message, retry)
- [ ] Compute sha256 hash
- [ ] Update `media_item`: status → `downloaded`, save local_path, size_bytes, sha256
- [ ] Log to `job_event_log`
- [ ] Enqueue `media_upload` job
- [ ] Idempotent: if already downloaded, skip to upload enqueue
- [ ] Graceful shutdown: finish current download or mark `queued` for re-pickup

## F. Drive uploader worker
- [ ] Implement `UploadStrategy` interface
- [ ] Implement `DriveApiStrategy` (OAuth + Service Account support)
- [ ] Implement `DriveDesktopStrategy` (sync folder + done heuristic)
- [ ] Implement `PlaywrightStrategy` (fallback)
- [ ] `UploaderFactory`: select strategy from `UPLOAD_STRATEGY` env var
- [ ] Resolve Drive folder for chat:
  - [ ] create group folder if missing (sanitized name)
  - [ ] create date folders if missing (YYYY/MM/DD)
  - [ ] cache folder IDs in DB + in-memory LRU
- [ ] Upload file (resumable for files > 5MB)
- [ ] Save `drive_file_id` + `drive_web_url`, mark `uploaded`
- [ ] Delete staging file on success
- [ ] Log to `job_event_log`
- [ ] Idempotent: if already uploaded (check `drive_file_id`), skip
- [ ] Handle Drive API quota errors (backoff + pause queue)
- [ ] Graceful shutdown: finish current upload

## G. Reconciliation job
- [ ] Run on configurable interval (`RECONCILIATION_INTERVAL_MIN`)
- [ ] For each active group in `group_state`:
  - [ ] Fetch messages after `last_message_id` via `messages.getHistory`
  - [ ] Throttle fetches (200ms between API calls)
  - [ ] Enqueue any media not already in `media_item` table
- [ ] Update `group_state.last_message_id` and `last_reconciled_at`
- [ ] Skip groups where `last_reconciled_at` < interval ago (prevent overlap)

## H. Backpressure & cleanup
- [ ] Staging disk usage monitor (poll every 60s)
- [ ] Pause download queue at `HIGH_WATERMARK_PCT`
- [ ] Resume download queue at `LOW_WATERMARK_PCT`
- [ ] Cleanup job: delete staging files with status `uploaded` older than `CLEANUP_AFTER_HOURS`
- [ ] Emergency cleanup: if staging > 95%, delete all uploaded staging files immediately

## I. Ops & safety
- [ ] Graceful shutdown handler for all processes (SIGTERM, SIGINT)
- [ ] Health endpoints for each service (`/health`, `/ready`)
- [ ] Metrics: queue depth, processing rate, error rate, staging disk usage
- [ ] Alert on: session disconnect, queue backlog, repeated failures, disk pressure
- [ ] Dead-letter handling + manual requeue command

## J. Statistics API & monitoring
- [ ] Set up HTTP server (Express or Fastify) on `STATS_API_PORT`
- [ ] Add bearer token auth middleware (`STATS_API_AUTH_TOKEN`)
- [ ] `GET /api/stats/overview` — top-level pipeline health
- [ ] `GET /api/stats/queues` — BullMQ queue depths + rate info
- [ ] `GET /api/stats/queues/:queueName/failed` — list failed jobs (paginated)
- [ ] `POST /api/stats/queues/:queueName/requeue` — requeue failed jobs
- [ ] `GET /api/stats/groups` — per-group summary with counts
- [ ] `GET /api/stats/groups/:chatId` — single group detail
- [ ] `GET /api/stats/groups/:chatId/media` — query media items (filterable)
- [ ] `GET /api/stats/telegram` — session health, flood waits, API call counts
- [ ] `GET /api/stats/drive` — quota usage, upload stats, folder cache metrics
- [ ] `GET /api/stats/daily` — daily aggregate trends (date range)
- [ ] `GET /api/stats/hourly` — hourly breakdown for a single day
- [ ] `GET /api/health` — system health check for Docker/load balancers
- [ ] Add `daily_stats` table + materialization job (aggregate at midnight)
- [ ] Add in-memory `api_call_counter` (persisted to Redis) for rate tracking
- [ ] Configure `STATS_RETENTION_DAYS` for automatic cleanup of old stats

## K. Testing
- [ ] Unit tests: filter engine, file naming, dedupe logic, config validation
- [ ] Integration tests: queue flow (download → upload), DB idempotency
- [ ] Set up Testcontainers for Redis + Postgres in CI
- [ ] Mock strategy for Telegram and Drive API calls

## L. Configuration decisions to make
- [ ] DB: Postgres vs SQLite (MVP can start with SQLite, migrate later)
- [ ] Drive: My Drive vs Shared Drive
- [ ] Drive auth: OAuth (personal) vs Service Account (team)
- [ ] Folder rules: per day vs per month
- [ ] Filter rules: whitelist sender IDs, per group mapping
- [ ] Hosting: local machine, VPS, or cloud (e.g., Railway, Fly.io)

---

# Google upload strategies for Telegram media pipeline (switchable)

You can design your system so the **uploader is a pluggable strategy**. Then you can switch between:
1) **Google Drive API**
2) **Google Drive for Desktop + sync folder**
3) **Playwright auto-login + web upload**

This doc summarizes each option, pros/cons, prerequisites, and how to make them interchangeable.

---

## 0) Recommended design: "Uploader Strategy" interface

Treat upload as a module with a common interface:

- Input: `localFilePath`, `destination` (group/day folder), `metadata`
- Output: `remoteRef` (drive file id / web url / "synced marker"), `status`

**Example contract (TypeScript)**
```typescript
interface UploadStrategy {
  ensureDestination(dest: DestinationInfo): Promise<DestinationRef>;
  upload(localPath: string, destRef: DestinationRef, meta: MediaMeta): Promise<UploadResult>;
  verify?(result: UploadResult): Promise<VerifiedResult>;
  cleanup?(localPath: string): Promise<void>;
}

interface UploadResult {
  remoteRef: string;      // drive_file_id or sync marker
  webUrl?: string;        // shareable link
  status: 'uploaded' | 'pending_sync';
  bytesUploaded: number;
}
```

This way your pipeline remains the same:

```
Telegram Ingest → Queue → Download to staging → UploadStrategy → Mark uploaded → Cleanup
```

Only the **UploadStrategy** changes.

---

## 1) Option 1 — Google Drive API (best for server-grade reliability)

### What it is
Upload using **Google Drive API** (Drive v3), with OAuth or Service Account.

### Prerequisites
- Google Cloud project
- **Enable "Google Drive API"**
- Credentials:
  - OAuth client (Desktop / Web) for "My Drive" personal usage, OR
  - Service account for Shared Drive / headless servers (share the folder/drive with the service account email)

### Pros
- Most reliable / most automatable
- Clear success/failure + resumable uploads
- Easy to confirm "uploaded" (drive file id)
- Scales well with queue/worker model
- Works headless on servers

### Cons
- Requires permissions to enable API + create credentials
- Token management (OAuth refresh) if not using service account
- 750 GB/day upload limit per user

### Best use cases
- Production deployment
- Large videos (resumable upload)
- Need strong idempotency and audit trail

### Implementation notes
- Cache folder IDs (group folder, date folder) to reduce API calls
- Use deterministic naming and idempotency keys
- Use resumable upload for files > 5MB
- Track daily upload volume to avoid hitting 750 GB limit

---

## 2) Option 2 — Google Drive for Desktop + sync folder (best when API is blocked)

### What it is
Install **Google Drive for Desktop** and write files into a local **synced folder**. The Drive app uploads them to Drive.

### Critical setting
Use **Stream files** mode (NOT Mirror).
- **Stream files**: doesn't download your whole 2TB Drive to local storage.
- **Mirror files**: will try to mirror Drive locally → will blow up a 256GB SSD.

### Prerequisites
- macOS/Windows machine with GUI
- Google Drive for Desktop installed and logged in
- A chosen sync folder path (e.g. `~/Google Drive/TelegramArchive/...`)

### Pros
- No need to enable Drive API
- Very stable in practice (Google's own sync engine)
- Upload resumes automatically if network drops
- Simplifies auth (you just log in once in the Drive app)

### Cons
- Not ideal for headless servers
- Your app can't get a Drive fileId easily
- You need a method to decide "upload is done"
- During upload, the file exists locally in full → peak disk usage can spike

### Best use cases
- Personal laptop/workstation workflows
- Organizations that block Google Cloud API enablement
- When you want minimal code around Drive auth

### Recommended pattern: two-folder staging
1) Download into: `STAGING/`
2) After download completes, `move` into: `DRIVE_SYNC_FOLDER/`
3) Mark uploaded after "sync done" heuristic, then cleanup.

### "Sync done" heuristics (choose 1)
- H1: Delay + stability check (simple): wait N minutes and ensure file size/mtime stable
- H2: Check Drive Desktop status via UI/logs (more complex)
- H3: Use a ".done marker" file after stable + no temp files remain (practical)

---

## 3) Option 3 — Playwright auto-login and upload via drive.google.com (UI automation fallback)

### What it is
Use Playwright to automate the Drive web UI:
- login
- open folder
- upload files via file picker
- wait for "Upload complete"

### Prerequisites
- A stable browser environment
- Ability to keep sessions/cookies (persistent context)
- Plan for 2FA/captcha (often requires manual fallback)
- Reliable selectors / robust retry/backoff

### Pros
- No need to enable Drive API
- Can confirm "upload complete" by waiting for UI signals
- Works even if you only have "end-user UI access"

### Cons
- Most brittle (UI changes can break automation)
- 2FA/captcha/logouts can stop the system
- Uploading many large videos through browser can be slow / timeout
- Resource heavy (RAM/CPU), harder to scale

### Best use cases
- Temporary workaround
- When Drive Desktop cannot be installed and API cannot be enabled
- Low/medium volume uploads, or "manual-supervised automation"

### Hardening tips
- Use persistent browser profile per worker
- Implement exponential backoff and screenshot logging on failures
- Keep worker concurrency low for big videos
- Build a "manual rescue mode" (if login fails, notify you)

---

## 4) How to switch strategies flexibly (runtime config)

### Config example
- `UPLOAD_STRATEGY=drive_api | drive_desktop | playwright`
- `DRIVE_ROOT_FOLDER_ID=...` (for drive_api)
- `DRIVE_SYNC_FOLDER=...` (for drive_desktop)
- `PLAYWRIGHT_PROFILE_DIR=...` (for playwright)

### Suggested switch rules (examples)
- Default: `drive_api`
- If API credentials missing: fallback to `drive_desktop`
- If running on server without GUI: avoid drive_desktop
- If both API blocked and desktop unavailable: use playwright as last resort

### Implementation approach
- Make `UploaderFactory` pick the strategy at startup based on `UPLOAD_STRATEGY` env var.
- Validate that the required env vars for the chosen strategy are present (fail fast).
- Allow hot-switch by reloading config (or restarting only the uploader worker).
- Keep the rest of the pipeline unchanged.

---

## 5) Decision matrix (quick)

| Criteria | Drive API | Drive Desktop Sync | Playwright Web Upload |
|---|---|---|---|
| Needs API enablement | Yes | No | No |
| Headless server friendly | Yes | No | Partial |
| Reliability | High | Medium-High | Low |
| Large video handling | High | Medium-High | Low |
| Easy to confirm uploaded | High | Low | Medium |
| Complexity | Medium | Low-Medium | High |
| Daily upload limit | 750 GB | Unlimited (sync engine) | Unlimited (browser) |
| Best as | Primary | Primary when API blocked | Last-resort fallback |

---

## 6) Recommended default for your case

Given:
- ~100 groups
- many images/videos
- you may need flexibility over time

**Suggested order of preference**
1) **Google Drive API** (best long-term)
2) **Drive Desktop + Stream files** (best if API blocked)
3) **Playwright** (fallback / supervised automation)

---

## 7) Next step: what you should implement now

- [ ] Implement `UploadStrategy` TypeScript interface with `ensureDestination`, `upload`, `verify`, `cleanup`
- [ ] Implement `DriveDesktopStrategy` first (fastest to get working, no API setup needed)
- [ ] Implement `DriveApiStrategy` when you can enable API / get credentials
- [ ] Keep `PlaywrightStrategy` as a planned fallback (implement only if needed)
- [ ] Add `UPLOAD_STRATEGY` env switch + validation
- [ ] Add clear logs + job metadata so you can compare outcomes across strategies
