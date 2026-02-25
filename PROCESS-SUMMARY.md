# Process Summary — Telegram Media Auto-Upload Pipeline

A concise overview of every process in the system, how they interact, and what each one does.

---

## System at a glance

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TELEGRAM (100 groups)                               │
│                   push updates via MTProto session                          │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  PROCESS 1: telegram-ingestor (single instance)                          │
│  - Receives real-time NewMessage / EditedMessage events                   │
│  - Filters by group allowlist, sender whitelist/blacklist, media type     │
│  - Upserts media_item rows (dedupe) and enqueues download jobs           │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ enqueue
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  QUEUE: media_download (BullMQ + Redis)                                  │
│  - Priority queue (photos first), rate-limited (30 jobs/sec)             │
│  - Retry 5x with exponential backoff, dead-letter on exhaust             │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ consume
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  PROCESS 2: media-downloader-worker (scalable, N instances)              │
│  - Streams media from Telegram to local staging folder                   │
│  - Computes sha256 hash, updates DB status to "downloaded"               │
│  - Checks disk watermark before downloading (backpressure)               │
│  - Enqueues upload job on success                                        │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ enqueue
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  QUEUE: media_upload (BullMQ + Redis)                                    │
│  - Priority queue, rate-limited (10 jobs/sec)                            │
│  - Retry 8x with exponential backoff, dead-letter on exhaust             │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ consume
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  PROCESS 3: drive-uploader-worker (scalable, N instances)                │
│  - Uploads file via pluggable strategy (API / Desktop Sync / Playwright) │
│  - Creates group + date folder structure on Drive                        │
│  - Marks DB status "uploaded", records drive_file_id                     │
│  - Deletes local staging file after confirmed upload                     │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE DRIVE                                      │
│            /TelegramArchive/<Group>/YYYY/MM/DD/file.ext                   │
└──────────────────────────────────────────────────────────────────────────┘


  Background processes:

┌──────────────────────────────────────────────────────────────────────────┐
│  PROCESS 4: reconciliation-job (cron, every 5-10 min)                    │
│  - Fetches message history for each group since last checkpoint          │
│  - Enqueues any missed media (safety net for downtime/network drops)     │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  PROCESS 5: cleanup-job (cron, every 15 min)                             │
│  - Deletes staging files already uploaded (older than CLEANUP_AFTER_HOURS)│
│  - Emergency mode: aggressively cleans if disk exceeds 95%               │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  PROCESS 6: stats-api-server (single instance, HTTP)                     │
│  - Serves /api/stats/* endpoints (overview, queues, groups, TG, Drive)   │
│  - Serves /api/health for Docker/load balancer health checks             │
│  - Materializes daily_stats aggregates at midnight                        │
│  - Provides failed job inspection and requeue operations                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Process details

### Process 1: Telegram Ingestor

| Property | Value |
|---|---|
| **Instances** | 1 (single — one MTProto session per account) |
| **Trigger** | Real-time push from Telegram (NewMessage, EditedMessage events) |
| **Input** | Telegram MTProto event stream |
| **Output** | `media_item` rows in DB + jobs in `media_download` queue |
| **Key dependencies** | gramjs, Redis, Postgres |
| **Failure mode** | If disconnected, queues drain but no new work enters. Reconciliation job covers the gap. |

**What it does step by step:**
1. Connects to Telegram via gramjs with a persistent session string.
2. Registers event handlers for `NewMessage` and `EditedMessage`.
3. For each incoming message:
   - Checks if the chat is in the group allowlist.
   - Extracts `senderId` and applies whitelist/blacklist filter rules.
   - If media is present (photo/video/document), extracts metadata: `fileId`, `uniqueId`, `fileName`, `size`, `mimeType`, `groupedId`.
   - Upserts a `media_item` row with status `queued` (idempotent by unique constraint).
   - Enqueues a `media_download` job to BullMQ.
   - Updates `group_state.last_message_id`.
4. On `FloodWaitError`: sleeps for the indicated duration, then resumes.
5. On disconnect: logs warning, waits for gramjs auto-reconnect, then triggers reconciliation.
6. On SIGTERM: disconnects cleanly, flushes pending DB writes.

---

### Process 2: Media Downloader Worker

| Property | Value |
|---|---|
| **Instances** | 1–N (scalable, BullMQ distributes jobs) |
| **Trigger** | Consumes jobs from `media_download` queue |
| **Input** | Download job payload (chatId, messageId, fileId, etc.) |
| **Output** | File on local staging disk + job in `media_upload` queue |
| **Key dependencies** | gramjs (for media download), Redis, Postgres, local disk |
| **Failure mode** | Retries up to 5x. On permanent failure, marks `failed` and moves to dead-letter. |

**What it does step by step:**
1. Picks up a `media_download` job from the queue.
2. Checks staging disk usage — if above `HIGH_WATERMARK_PCT`, pauses and waits.
3. Loads the `media_item` from DB. If already `downloaded` or `uploaded`, skips (idempotent).
4. Updates status to `downloading`.
5. Calls `client.downloadMedia()` to stream the file to the staging folder.
6. Determines file extension from MIME type or original filename.
7. Computes SHA-256 hash of the downloaded file.
8. Updates `media_item`: status `downloaded`, sets `local_path`, `size_bytes`, `sha256`.
9. Logs a `download_done` event to `job_event_log`.
10. Enqueues a `media_upload` job.
11. On `FILE_REFERENCE_EXPIRED`: re-fetches the message from Telegram, retries.
12. On SIGTERM: finishes current download or resets status to `queued` for re-pickup.

---

### Process 3: Drive Uploader Worker

| Property | Value |
|---|---|
| **Instances** | 1–N (scalable, BullMQ distributes jobs) |
| **Trigger** | Consumes jobs from `media_upload` queue |
| **Input** | Upload job payload (mediaItemId, localPath, chatId, etc.) |
| **Output** | File on Google Drive + updated `media_item` with `drive_file_id` |
| **Key dependencies** | Google Drive (API/Desktop/Playwright), Redis, Postgres, local disk |
| **Failure mode** | Retries up to 8x. On Drive quota errors, pauses queue with backoff. |

**What it does step by step:**
1. Picks up a `media_upload` job from the queue.
2. Loads the `media_item` from DB. If already `uploaded`, skips (idempotent).
3. Updates status to `uploading`.
4. Resolves the Drive destination folder:
   - Looks up `drive_folder_map` for the chat's root folder.
   - Creates group folder if missing (sanitized name + chatId suffix).
   - Creates date subfolders (YYYY/MM/DD) if missing.
   - Uses LRU cache + `drive_date_folder_cache` table to minimize API calls.
5. Uploads the file using the configured `UploadStrategy`:
   - **Drive API**: resumable upload for files > 5MB, simple upload otherwise.
   - **Drive Desktop**: moves file into sync folder, waits for sync heuristic.
   - **Playwright**: automates browser upload (fallback).
6. On success: updates `media_item` with `drive_file_id`, `drive_web_url`, status `uploaded`.
7. Deletes the local staging file.
8. Logs an `upload_done` event to `job_event_log`.
9. On Drive rate limit (403/429): exponential backoff with jitter.
10. On SIGTERM: finishes current upload (resumable sessions persist across restarts).

---

### Process 4: Reconciliation Job

| Property | Value |
|---|---|
| **Instances** | 1 (runs inside ingestor or as a standalone cron) |
| **Trigger** | Timer-based, every `RECONCILIATION_INTERVAL_MIN` (default 10 min) |
| **Input** | `group_state` table (last_message_id per group) |
| **Output** | Newly discovered `media_item` rows + download jobs |
| **Key dependencies** | gramjs (getHistory), Redis, Postgres |
| **Failure mode** | If it fails, it retries next interval. No data loss. |

**What it does step by step:**
1. Iterates over all active groups in `group_state`.
2. Skips groups already reconciled within the interval (prevents overlap).
3. For each group, calls Telegram `messages.getHistory` from `last_message_id` to latest.
4. Throttles API calls (200ms between requests) to avoid flood control.
5. For each message with media: checks if already in `media_item` table.
6. If missing: upserts `media_item` and enqueues `media_download` job.
7. Updates `group_state.last_message_id` and `last_reconciled_at`.

---

### Process 5: Cleanup Job

| Property | Value |
|---|---|
| **Instances** | 1 (cron or setInterval inside uploader) |
| **Trigger** | Timer-based, every 15 minutes |
| **Input** | Staging folder + `media_item` table |
| **Output** | Freed disk space |
| **Key dependencies** | Local filesystem, Postgres |
| **Failure mode** | If it fails, staging grows until next successful run. Backpressure protects the system. |

**What it does step by step:**
1. Queries `media_item` where status = `uploaded` and `updated_at` < now - `CLEANUP_AFTER_HOURS`.
2. For each matching row: deletes the file at `local_path` if it exists.
3. Sets `local_path = null` in DB.
4. If staging usage > 95% of `MAX_STAGING_SIZE_GB`: emergency mode — deletes all uploaded staging files regardless of age.
5. Logs cleanup results (files deleted, space reclaimed).

---

### Process 6: Statistics API Server

| Property | Value |
|---|---|
| **Instances** | 1 |
| **Trigger** | HTTP requests |
| **Input** | REST API calls |
| **Output** | JSON responses with pipeline metrics |
| **Key dependencies** | Redis (queue metrics, rate counters), Postgres (historical data) |
| **Failure mode** | If down, monitoring is blind but the pipeline continues running. |

**What it does step by step:**
1. Starts an HTTP server on `STATS_API_PORT` (default 3100).
2. Authenticates requests via bearer token (`STATS_API_AUTH_TOKEN`).
3. Serves real-time endpoints by querying BullMQ queue state and in-memory counters.
4. Serves per-group stats by aggregating `media_item` counts from Postgres.
5. Serves Telegram stats: session health, flood wait counters, API call rates.
6. Serves Drive stats: quota usage, upload throughput, folder cache hit rates.
7. Serves historical stats from the `daily_stats` table (date-range queries).
8. Runs a midnight job to materialize `daily_stats` from `media_item` + `job_event_log`.
9. Cleans up `daily_stats` rows older than `STATS_RETENTION_DAYS`.
10. Exposes `/api/health` for Docker healthcheck / load balancer probes.

---

## Data flow summary

```
Message arrives in Telegram group
        │
        ▼
[1] Ingestor receives event
        │
        ├─ Filter: group allowed? sender allowed? has media?
        │   └─ NO → discard
        │
        └─ YES
            ├─ Upsert media_item (status: queued)
            └─ Enqueue → media_download queue
                              │
                              ▼
                    [2] Downloader picks up job
                              │
                              ├─ Disk OK? → Download file → Compute hash
                              │   └─ Update DB (status: downloaded)
                              │   └─ Enqueue → media_upload queue
                              │                       │
                              │                       ▼
                              │             [3] Uploader picks up job
                              │                       │
                              │                       ├─ Resolve Drive folder
                              │                       ├─ Upload file
                              │                       ├─ Update DB (status: uploaded)
                              │                       └─ Delete staging file
                              │
                              └─ Disk full? → PAUSE queue (backpressure)
                                               └─ Resume when disk clears

        Background:
        [4] Reconciliation: fills gaps every 10 min
        [5] Cleanup: frees staging disk every 15 min
        [6] Stats API: exposes metrics over HTTP
```

---

## Status lifecycle of a media item

```
                                    ┌──────────┐
                                    │  queued   │ ◄── Ingestor creates
                                    └────┬─────┘
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │ downloading   │ ◄── Downloader picks up
                                  └──────┬───────┘
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                      ┌──────────────┐       ┌──────────┐
                      │  downloaded  │       │  failed   │ ◄── after max retries
                      └──────┬───────┘       └──────────┘
                             │                     ▲
                             ▼                     │
                      ┌──────────────┐             │
                      │  uploading   │ ◄── Uploader picks up
                      └──────┬───────┘             │
                             │                     │
                  ┌──────────┴──────────┐          │
                  ▼                     ▼          │
          ┌──────────────┐       ┌──────────┐     │
          │   uploaded   │       │  failed   │ ────┘
          └──────────────┘       └──────────┘

          Special:
          ┌──────────┐
          │  skipped  │ ◄── duplicate detected or filter changed
          └──────────┘
```

---

## Concurrency & scaling rules

| Process | Instances | Concurrency per instance | Notes |
|---|---|---|---|
| Ingestor | **1** | N/A (event-driven) | Must be single instance (one MTProto session) |
| Downloader | 1–N | Photos: 8–16, Videos: 2–4 | Scale by adding instances; BullMQ distributes |
| Uploader | 1–N | Photos: 8–12, Videos: 2–3 | Scale by adding instances; BullMQ distributes |
| Reconciliation | **1** | 1 group at a time | Runs inside ingestor or standalone |
| Cleanup | **1** | Sequential | Lightweight, no need to scale |
| Stats API | **1** | Handles concurrent HTTP | Stateless reads; scale if needed behind LB |

---

## Port & endpoint map

| Service | Port | Key endpoints |
|---|---|---|
| Stats API | `3100` | `GET /api/health`, `GET /api/stats/*` |
| Redis | `6379` | BullMQ queue storage |
| Postgres | `5432` | All persistent state |

---

## Environment variable quick reference

| Variable | Required | Used by |
|---|---|---|
| `TG_API_ID`, `TG_API_HASH`, `TG_SESSION_STRING` | Yes | Ingestor, Downloader, Reconciliation |
| `TG_ALLOWED_CHAT_IDS` | Yes | Ingestor |
| `REDIS_URL` | Yes | All (queues) |
| `DATABASE_URL` | Yes | All (state) |
| `STAGING_DIR` | Yes | Downloader, Uploader, Cleanup |
| `UPLOAD_STRATEGY` | Yes | Uploader |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Per strategy | Uploader (drive_api) |
| `DRIVE_ROOT_FOLDER_ID` | Per strategy | Uploader (drive_api) |
| `DRIVE_SYNC_FOLDER` | Per strategy | Uploader (drive_desktop) |
| `STATS_API_PORT`, `STATS_API_AUTH_TOKEN` | Optional | Stats API |
| `DOWNLOAD_CONCURRENCY`, `UPLOAD_CONCURRENCY` | Optional | Downloader, Uploader |
| `MAX_STAGING_SIZE_GB`, `HIGH_WATERMARK_PCT`, `LOW_WATERMARK_PCT` | Optional | Downloader, Cleanup |
| `CLEANUP_AFTER_HOURS` | Optional | Cleanup |
| `RECONCILIATION_INTERVAL_MIN` | Optional | Reconciliation |
