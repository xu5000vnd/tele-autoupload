# Environment reference

## Startup configuration

[env.ts](../../packages/shared/src/config/env.ts) loads dotenv and parses appConfig at import time.
The base schema applies wherever this configuration module is imported, not just to the process using a particular field.
Required core values must be supplied; strategy conditions and HTTP authentication add the requirements below.
[.env.example](../../.env.example) is a template, not proof that credentials or sessions work.

## Variable inventory

Names and literal defaults extracted from the schema without importing runtime configuration.
Quoted boolean defaults are parsed into booleans. "optional" means no schema default; it does not override conditional requirements.

| Variable | Schema default or presence |
| --- | --- |
| `NODE_ENV` | `'development'` |
| `LOG_LEVEL` | `'info'` |
| `LOG_DIR` | `'logs'` |
| `LOG_RETENTION_DAYS` | `14` |
| `TG_API_ID` | `required` |
| `TG_API_HASH` | `required` |
| `TG_SESSION_STRING` | `required` |
| `TG_NUMBER` | `required` |
| `TG_USE_WSS` | `'true'` |
| `REDIS_URL` | `required` |
| `DATABASE_URL` | `required` |
| `STAGING_DIR` | `required` |
| `UPLOAD_STRATEGY` | `required` |
| `UPLOAD_CONCURRENCY` | `6` |
| `UPLOAD_RATE_LIMIT_PER_SEC` | `10` |
| `UPLOAD_MAX_RETRIES` | `8` |
| `UPLOAD_INITIAL_BACKOFF_MS` | `10000` |
| `MAX_STAGING_SIZE_GB` | `50` |
| `HIGH_WATERMARK_PCT` | `80` |
| `CLEANUP_AFTER_HOURS` | `2` |
| `RECONCILIATION_INTERVAL_MIN` | `10` |
| `RECONCILIATION_FROM` | `optional` |
| `RECONCILIATION_LEASE_TTL_MS` | `540000` |
| `RECONCILIATION_LEASE_RENEWAL_MS` | `30000` |
| `RECONCILIATION_RUN_BUDGET_MS` | `480000` |
| `RECONCILIATION_STALE_BUDGET_MS` | `60000` |
| `RECONCILIATION_MAX_CHATS_PER_RUN` | `500` |
| `RECONCILIATION_MAX_PAGES_PER_CHAT` | `3` |
| `RECONCILIATION_HISTORY_PAGE_SIZE` | `100` |
| `RECONCILIATION_NORMAL_LOOKBACK_MESSAGES` | `50` |
| `RECONCILIATION_RECOVERY_LOOKBACK_MESSAGES` | `200` |
| `RECONCILIATION_CHAT_CONCURRENCY` | `3` |
| `RECONCILIATION_TELEGRAM_REQUESTS_PER_SEC` | `5` |
| `TELEGRAM_REQUEST_SLOT_TTL_MS` | `120000` |
| `DOWNLOAD_CONCURRENCY` | `3` |
| `DOWNLOAD_MAX_RETRIES` | `8` |
| `DOWNLOAD_INITIAL_BACKOFF_MS` | `10000` |
| `DOWNLOAD_HEARTBEAT_MS` | `60000` |
| `STATS_API_PORT` | `3100` |
| `STATS_API_AUTH_TOKEN` | `empty string` |
| `ADMIN_WEB_USERNAME` | `empty string` |
| `ADMIN_WEB_PASSWORD` | `empty string` |
| `STATS_RETENTION_DAYS` | `90` |
| `BOT_TOKEN` | `optional` |
| `BOT_REPORT_CHAT_ID` | `optional` |
| `UNREGISTERED_UPLOADER_USERNAME_WHITELIST` | `empty string` |
| `DRIVE_ROOT_FOLDER_ID` | `optional` |
| `GOOGLE_CLIENT_ID` | `optional` |
| `GOOGLE_CLIENT_SECRET` | `optional` |
| `GOOGLE_REFRESH_TOKEN` | `optional` |
| `DRIVE_SYNC_FOLDER` | `optional` |
| `UPLOAD_DATE_BUCKET_ENABLED` | `'true'` |
| `UPLOAD_DATE_BUCKET_DAYS` | `10` |
| `PLAYWRIGHT_PROFILE_DIR` | `optional` |

## Validation and conditional requirements

- TG_API_ID is a positive integer; TG_API_HASH, TG_SESSION_STRING and TG_NUMBER are nonempty strings.
- REDIS_URL is a URL; DATABASE_URL and STAGING_DIR are nonempty strings.
- UPLOAD_STRATEGY is drive_api, drive_desktop or playwright.
- Drive API requires root folder ID, client ID, client secret and refresh token.
- Desktop requires the sync folder; Playwright requires a profile directory even though its upload implementation is incomplete.
- Admin login and guarded HTTP requests require nonempty ADMIN_WEB_USERNAME, ADMIN_WEB_PASSWORD and STATS_API_AUTH_TOKEN. See [AuthService](../../apps/stats-api/src/auth.service.ts).
- Telegram transport and date-bucket booleans accept true/false, 1/0, yes/no and on/off, case-insensitively.
- History page size is a positive integer no greater than 100; reconciliation/download concurrency is 1 through 3.
- Lease renewal and run budget must each be below lease TTL; run budget must be below the configured interval; stale budget must be below run budget.
- Normal replay overlap cannot exceed recovery overlap. RECONCILIATION_FROM accepts an ISO datetime with timezone; blank values become absent.
- Request-slot TTL and download heartbeat are at least 1000 ms. Upload concurrency/rate and initial backoffs are positive.
- Retry-attempt settings are nonnegative integers. They are passed to BullMQ attempts; do not describe them as extra retries beyond an initial attempt.
- Date bucket days are 2 through 31. The example selects 5 while the schema default is 10.
- HIGH_WATERMARK_PCT is 1 through 99. Its current operational limitation is in [status](../status.md).

## Behavior notes

The whitelist parser accepts comma, semicolon or newline delimiters, removes leading @ characters and lowercases entries.
It suppresses unknown-uploader notifications. In the desktop uploader's missing-user mapping path, confirmed sender matches are skipped, including bot identities.
Resolution failure is cached for that uploader process lifetime; it does not grant authorization.
RECONCILIATION_FROM skips older messages inside fetched pages while preserving page checkpoint behavior.
RECONCILIATION_INTERVAL_MIN participates in due-window/stale calculations and budget validation; the actual Cron discrepancy is tracked in [status](../status.md).
STATS_RETENTION_DAYS is parsed but no daily_stats retention job is registered in the current implementation.
TG_ALLOWED_CHAT_IDS, LOW_WATERMARK_PCT and STATS_REFRESH_INTERVAL_SEC from source plans are not base-schema fields.
[Operations](operations.md) owns strategy completion and deployment procedures.

## Frontend development

[Vite configuration](../../apps/web-admin/vite.config.ts) reads VITE_API_PROXY_TARGET with default http://localhost:3100.
The development server listens on 0.0.0.0:3001 and proxies /api to that target.
This is a server-side development proxy setting, not a browser runtime API-base variable.

## Sources

Environment tables consolidated from README, [requirements](../../requirement.md), [process summary](../../PROCESS-SUMMARY.md) and [reconciliation plan](../reconciliation-scaling-implementation-plan.md); current defaults/constraints come from the linked configuration source.
