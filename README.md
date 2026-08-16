# Tele-AutoUpload

A Telegram media ingestion pipeline that automatically downloads photos and videos sent to a Telegram group and uploads them to Google Drive.

## How It Works

```
Telegram Group
     │
     │  (photos / videos)
     ▼
┌─────────────┐  persist + enqueue  ┌─────────────────┐
│  Ingestor   │ ───────────────────►│ Download queue  │
│  (GramJS)   │                     └────────┬────────┘
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

### Services

| Service | Description |
|---|---|
| `ingestor` | Listens for Telegram messages, persists media metadata, enqueues downloads, and reconciles missed history |
| `worker-downloader` | BullMQ worker that downloads, stages, hashes, and enqueues media for upload |
| `worker-uploader` | BullMQ worker that uploads files to Google Drive |
| `stats-api` | REST API for monitoring + Telegram bot for daily summaries |

---

## Prerequisites

- Node.js >= 22 ([nvm](https://github.com/nvm-sh/nvm) recommended — `.nvmrc` is included)
- PostgreSQL
- Redis
- A Telegram account (for the user session)
- A Telegram Bot (for the stats bot — optional)
- Google Drive Desktop app (for `drive_desktop` strategy)

---

## Setup

### 1. Node.js version

```bash
nvm use   # uses v22 from .nvmrc
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Then fill in `.env` — see the [Environment Variables](#environment-variables) section below.

### 4. Run database migrations

```bash
npm run prisma:migrate
```

### 5. Generate Telegram session string

You need a `TG_SESSION_STRING` to authenticate the GramJS user client:

```bash
npm run tg:session
```

Follow the prompts (enter your phone number and the OTP code sent by Telegram). Copy the printed session string into `TG_SESSION_STRING` in your `.env`.

> The session is long-lived (no expiry unless you log out from another device).

### 6. Register allowed users

Only users listed in the `user_tu` table can trigger uploads. Insert a row for each person:

```sql
-- Using numeric user ID (most reliable)
INSERT INTO user_tu (tu_id, tu_name, path, telegram_user_id, telegram_chat_id, telegram_username, status)
VALUES ('user1', 'John Doe', 'TU Media General/[123456789] John Doe', 123456789, -1001234567890, 'john_doe', 'active');

-- Using username only (numeric ID will be auto-filled on first message)
INSERT INTO user_tu (tu_id, tu_name, path, telegram_user_id, telegram_chat_id, telegram_username, status)
VALUES ('user2', 'Jane', 'TU Media General/[0] Jane', 0, -1001234567890, 'jane_doe', 'active');
```

**How to find IDs:**
- `telegram_user_id` — forward a message from the user to `@userinfobot`, or check the `sender_id` in the ingestor logs after they send a message
- `telegram_chat_id` — the negative number in the group URL: `web.telegram.org/a/#-1001234567890` → `-1001234567890`

### 7. Start all services

```bash
npm run dev
```

This starts all four services concurrently with colored labels:

```
[ingestor]  blue
[downloader] magenta
[uploader]  yellow
[stats]     cyan
```

Start backend + web admin together:

```bash
npm run dev:all
```

Or start individually:

```bash
npm run start:ingestor
npm run start:downloader
npm run start:uploader
npm run start:stats
npm run start:web
```

Install frontend dependencies once:

```bash
npm --prefix apps/web-admin install
```

### Run backend services with PM2

PM2 supervises the four long-running backend services: `ingestor`, `downloader`, `uploader`,
and `stats`. Redis and PostgreSQL remain managed by Docker Compose. The Vite
web admin is a separate static frontend build and is not started by PM2.

From the project root, after configuring `.env` and making Redis/PostgreSQL
available:

```bash
nvm use
npm ci
npm install --global pm2
npm run pm2:start
```

Check and operate the services with:

```bash
npm run pm2:status
npm run pm2:logs
pm2 logs ingestor
npm run pm2:reload
```

Run `npm run pm2:reload` after changing `.env` or
`ecosystem.config.cjs`. To restore the services after a machine reboot, run
the platform-specific command printed by `pm2 startup`, then persist the
current process list:

```bash
pm2 save
```

Keep the `.env` file readable only by the deployment user. Do not add
credentials to `ecosystem.config.cjs` or commit them to the repository.

To start the PM2 backend services and the local Vite web admin together in one
terminal, run:

```bash
npm run start:all
```

The Vite server stops when you press `Ctrl-C`; the PM2 services continue until
you stop them with PM2. Re-running this command restarts the PM2 backend
services before starting the web admin.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TG_API_ID` | ✅ | Telegram API ID from [my.telegram.org](https://my.telegram.org) |
| `TG_API_HASH` | ✅ | Telegram API Hash from [my.telegram.org](https://my.telegram.org) |
| `TG_SESSION_STRING` | ✅ | GramJS session string (generate with `npm run tg:session`) |
| `TG_NUMBER` | ✅ | Your Telegram phone number (e.g. `+66812345678`) |
| `DATABASE_URL` | ✅ | PostgreSQL connection URL |
| `REDIS_URL` | ✅ | Redis connection URL |
| `STAGING_DIR` | ✅ | Local directory for downloaded files before upload |
| `UPLOAD_STRATEGY` | ✅ | `drive_desktop`, `drive_api`, or `playwright` |
| `DRIVE_SYNC_FOLDER` | ✅ (desktop) | Local path of your Google Drive synced folder |
| `UPLOAD_DATE_BUCKET_ENABLED` | optional | Enable bucketed date folders for desktop upload (`true`/`false`, default: `true`) |
| `UPLOAD_DATE_BUCKET_DAYS` | optional | Date bucket size for desktop folder grouping (default: `10`) |
| `BOT_TOKEN` | optional | Telegram bot token from `@BotFather` |
| `BOT_REPORT_CHAT_ID` | optional | Chat ID to receive automatic daily summary at 09:00 UTC |
| `UNREGISTERED_UPLOADER_USERNAME_WHITELIST` | optional | Comma/semicolon/newline-separated usernames to skip "Unregistered uploader" notifications (supports values with or without `@`). Queued media from a configured username is skipped after Telegram confirms its sender ID. |
| `STATS_API_PORT` | optional | Stats API port (default: `3100`) |
| `STATS_API_AUTH_TOKEN` | optional | Bearer token for the stats API |
| `UPLOAD_CONCURRENCY` | optional | Parallel upload jobs (default: `6`) |
| `DOWNLOAD_CONCURRENCY` | optional | Parallel downloader jobs; keep at or below `3` initially (default: `3`) |
| `DOWNLOAD_MAX_RETRIES` | optional | BullMQ attempts for a download job (default: `8`) |
| `DOWNLOAD_INITIAL_BACKOFF_MS` | optional | Initial exponential download retry delay (default: `10000`) |
| `DOWNLOAD_HEARTBEAT_MS` | optional | Refresh interval for an active download’s recovery timestamp (default: `60000`) |
| `MAX_STAGING_SIZE_GB` | optional | Max staging disk usage in GB (default: `50`) |
| `HIGH_WATERMARK_PCT` | optional | Pause uploads above this disk usage % (default: `80`) |
| `CLEANUP_AFTER_HOURS` | optional | Delete local files after N hours post-upload (default: `2`) |
| `RECONCILIATION_INTERVAL_MIN` | optional | How often to backfill missed messages (default: `10`) |
| `RECONCILIATION_LEASE_TTL_MS` | optional | Redis ownership lease for a reconciliation run (default: `540000`) |
| `RECONCILIATION_LEASE_RENEWAL_MS` | optional | Lease renewal cadence; must be below the lease TTL (default: `30000`) |
| `RECONCILIATION_RUN_BUDGET_MS` | optional | Maximum reconciliation runtime; must be below the interval and lease TTL (default: `480000`) |
| `RECONCILIATION_STALE_BUDGET_MS` | optional | Portion of a run reserved for stale-media recovery (default: `60000`) |
| `RECONCILIATION_MAX_CHATS_PER_RUN` | optional | Fairly rotated cap on chats per run (default: `500`) |
| `RECONCILIATION_MAX_PAGES_PER_CHAT` | optional | History pages per chat before deferral (default: `3`) |
| `RECONCILIATION_HISTORY_PAGE_SIZE` | optional | Telegram history page size, capped at `100` (default: `100`) |
| `RECONCILIATION_NORMAL_LOOKBACK_MESSAGES` | optional | Routine replay overlap (default: `50`) |
| `RECONCILIATION_RECOVERY_LOOKBACK_MESSAGES` | optional | Replay overlap for overdue chats (default: `200`) |
| `RECONCILIATION_CHAT_CONCURRENCY` | optional | Initial per-ingestor chat concurrency, capped at `3` (default: `3`) |
| `RECONCILIATION_TELEGRAM_REQUESTS_PER_SEC` | optional | Shared Redis-backed Telegram request rate across ingestor and downloader (default: `5`) |
| `TELEGRAM_REQUEST_SLOT_TTL_MS` | optional | Expiry for a renewable shared Telegram request permit (default: `120000`) |

### Reconciliation and downloader operations

Each reconciliation tick obtains a token-checked Redis lease before it performs stale recovery or history reads. It uses an eight-minute default budget inside the ten-minute schedule, pages history at 100 messages, and checkpoints a cursor only after the page was processed. Due chats are rotated fairly when there are more than the per-run cap; Telegram channel aliases are collapsed so one physical chat is not reconciled twice.

The downloader and ingestor share Redis-backed Telegram request permits, a global request rate, and a FloodWait pause. Keep `RECONCILIATION_CHAT_CONCURRENCY` and `DOWNLOAD_CONCURRENCY` at `1` for an initial production rollout if telemetry is not yet established, then increase no higher than `3` after run duration, reconciliation lag, and FloodWait/error logs remain healthy.

Useful structured log events are `reconciliation run started`, `reconciliation run completed`, `reconcile: history page failed; cursor was not advanced`, `media download starting`, `media download completed`, and `recovering stale media item`.

### Upload strategy options

| Strategy | Required vars | Notes |
|---|---|---|
| `drive_desktop` | `DRIVE_SYNC_FOLDER` | Uses Google Drive Desktop app to sync. Simplest setup. |
| `drive_api` | `DRIVE_ROOT_FOLDER_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Uses Google Drive REST API directly |
| `playwright` | `PLAYWRIGHT_PROFILE_DIR` | Browser automation fallback |

### Getting Telegram API credentials

1. Go to [https://my.telegram.org](https://my.telegram.org)
2. Log in with your phone number
3. Click **API development tools**
4. Create an app → copy `App api_id` and `App api_hash`

---

## Telegram Bot (Optional)

The stats bot responds to commands in any chat it's added to.

### Setup

1. Open `@BotFather` in Telegram → send `/newbot`
2. Copy the token → set `BOT_TOKEN` in `.env`
3. Add the bot to your group
4. Set `BOT_REPORT_CHAT_ID` to your group's chat ID for automatic daily reports

### Commands

| Command | Description |
|---|---|
| `/today` | Summary for today |
| `/today 2026-02-25` | Summary for a specific date |
| `/start` | Show help |

### Example response

```
📊 Summary — 2026-02-25

👤 John Doe (@john_doe)
   🖼 100 images  🎬 10 videos  📦 Total: 110
   ✅ Uploaded: 90  ❌ Failed: 10
```

---

## Stats API

All endpoints require `Authorization: Bearer <STATS_API_AUTH_TOKEN>` header.

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/stats/overview` | Queue + disk usage summary |
| `GET /api/stats/today?date=YYYY-MM-DD` | Per-user media counts for a day |
| `GET /api/stats/daily?from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily aggregated stats |
| `GET /api/stats/groups/:chatId/media` | Media items for a group |
| `GET /api/stats/queues/upload/failed` | Failed upload jobs |
| `POST /api/stats/queues/upload/requeue` | Retry failed jobs |

---

## Project Structure

```
tele-autoupload/
├── apps/
│   ├── ingestor/          # Telegram listener + reconciliation scheduler
│   ├── worker-downloader/ # Telegram download, staging, hashing worker
│   ├── worker-uploader/   # Google Drive upload worker
│   └── stats-api/         # REST API + Telegram bot
├── packages/
│   └── shared/            # Shared services, types, utilities
│       ├── config/        # Environment config (Zod)
│       ├── db/            # Prisma service
│       ├── drive/         # Upload strategies
│       ├── queue/         # BullMQ queue service
│       ├── services/      # MediaService, JobEventLogService
│       ├── telegram/      # GramJS gateway
│       └── utils/         # File naming, hashing, disk utils
├── prisma/
│   └── schema.prisma      # Database schema
├── scripts/
│   └── generate-session.ts  # TG session generator
└── .env.example
```

---

## Database Schema (key tables)

| Table | Description |
|---|---|
| `user_tu` | Allowed Telegram users per chat |
| `media_item` | Every media file ingested (tracks status through pipeline) |
| `group_state` | Active Telegram groups and reconciliation state |
| `job_event_log` | Per-file event history (queued → downloaded → uploaded) |
| `daily_stats` | Aggregated daily counters |
