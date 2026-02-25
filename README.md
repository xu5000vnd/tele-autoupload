# Tele-AutoUpload

A Telegram media ingestion pipeline that automatically downloads photos and videos sent to a Telegram group and uploads them to Google Drive.

## How It Works

```
Telegram Group
     │
     │  (photos / videos)
     ▼
┌─────────────┐     download inline     ┌─────────────────┐
│  Ingestor   │ ──────────────────────► │  Google Drive   │
│  (GramJS)   │                         │  (via uploader) │
└─────────────┘                         └─────────────────┘
     │
     │  enqueue upload job
     ▼
┌─────────────────┐     REST API / Bot   ┌───────────────┐
│    Uploader     │                      │   Stats API   │
│   (BullMQ)      │                      │  + Telegram   │
└─────────────────┘                      │     Bot       │
                                         └───────────────┘
```

### Services

| Service | Description |
|---|---|
| `ingestor` | Listens for new Telegram messages via GramJS, downloads media inline, enqueues upload jobs |
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
INSERT INTO user_tu (tu_id, tu_name, telegram_user_id, telegram_chat_id, telegram_username, status)
VALUES ('user1', 'John Doe', 123456789, -1001234567890, 'john_doe', 'active');

-- Using username only (numeric ID will be auto-filled on first message)
INSERT INTO user_tu (tu_id, tu_name, telegram_user_id, telegram_chat_id, telegram_username, status)
VALUES ('user2', 'Jane', 0, -1001234567890, 'jane_doe', 'active');
```

**How to find IDs:**
- `telegram_user_id` — forward a message from the user to `@userinfobot`, or check the `sender_id` in the ingestor logs after they send a message
- `telegram_chat_id` — the negative number in the group URL: `web.telegram.org/a/#-1001234567890` → `-1001234567890`

### 7. Start all services

```bash
npm run dev
```

This starts all three services concurrently with colored labels:

```
[ingestor]  blue
[uploader]  yellow
[stats]     cyan
```

Or start individually:

```bash
npm run start:ingestor
npm run start:uploader
npm run start:stats
```

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
| `BOT_TOKEN` | optional | Telegram bot token from `@BotFather` |
| `BOT_REPORT_CHAT_ID` | optional | Chat ID to receive automatic daily summary at 09:00 UTC |
| `STATS_API_PORT` | optional | Stats API port (default: `3100`) |
| `STATS_API_AUTH_TOKEN` | optional | Bearer token for the stats API |
| `UPLOAD_CONCURRENCY` | optional | Parallel upload jobs (default: `6`) |
| `MAX_STAGING_SIZE_GB` | optional | Max staging disk usage in GB (default: `50`) |
| `HIGH_WATERMARK_PCT` | optional | Pause uploads above this disk usage % (default: `80`) |
| `CLEANUP_AFTER_HOURS` | optional | Delete local files after N hours post-upload (default: `2`) |
| `RECONCILIATION_INTERVAL_MIN` | optional | How often to backfill missed messages (default: `10`) |

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
│   ├── ingestor/          # Telegram listener + inline downloader
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
