# API reference

## Access and transport

[AuthService](../../apps/stats-api/src/auth.service.ts) owns login configuration and bearer comparison.
Login accepts username/password and returns ok, token and username; invalid credentials produce 401 and incomplete auth configuration produces 503.
All other controllers in this inventory use BearerAuthGuard, including health.
[Fastify bootstrap](../../apps/stats-api/src/main.ts) configures a 100 MiB request body limit.
The frontend [API client](../../apps/web-admin/src/services/api.ts) sends JSON, adds the stored bearer token and parses safe response messages.
Endpoint strings below are HTTP routes, not filesystem paths.

## Route index

Inventory extracted from the linked controller decorators during this migration. There is no committed generator.

| Method | Route | Access | Source handler |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | login credentials | [auth.controller.login](../../apps/stats-api/src/auth.controller.ts) |
| POST | `/api/backfill/media` | bearer | [media-backfill.controller.media](../../apps/stats-api/src/media-backfill.controller.ts) |
| GET | `/api/messages/targets` | bearer | [messages.controller.targets](../../apps/stats-api/src/messages.controller.ts) |
| POST | `/api/messages/targets/resolve-username` | bearer | [messages.controller.resolveTargetUsername](../../apps/stats-api/src/messages.controller.ts) |
| POST | `/api/messages/targets/import` | bearer | [messages.controller.importTargets](../../apps/stats-api/src/messages.controller.ts) |
| POST | `/api/messages/targets` | bearer | [messages.controller.createTarget](../../apps/stats-api/src/messages.controller.ts) |
| PUT | `/api/messages/targets/:id` | bearer | [messages.controller.updateTarget](../../apps/stats-api/src/messages.controller.ts) |
| POST | `/api/messages` | bearer | [messages.controller.create](../../apps/stats-api/src/messages.controller.ts) |
| GET | `/api/messages/histories` | bearer | [messages.controller.histories](../../apps/stats-api/src/messages.controller.ts) |
| GET | `/api/messages/histories/:campaignId` | bearer | [messages.controller.historyDetail](../../apps/stats-api/src/messages.controller.ts) |
| GET | `/api/reminder-schedules` | bearer | [reminder-schedules.controller.list](../../apps/stats-api/src/reminder-schedules.controller.ts) |
| POST | `/api/reminder-schedules` | bearer | [reminder-schedules.controller.create](../../apps/stats-api/src/reminder-schedules.controller.ts) |
| PUT | `/api/reminder-schedules/:id` | bearer | [reminder-schedules.controller.update](../../apps/stats-api/src/reminder-schedules.controller.ts) |
| POST | `/api/reminder-schedules/:id/run-now` | bearer | [reminder-schedules.controller.runNow](../../apps/stats-api/src/reminder-schedules.controller.ts) |
| GET | `/api/stats/overview` | bearer | [stats.controller.overview](../../apps/stats-api/src/stats.controller.ts) |
| GET | `/api/dashboard/overview` | bearer | [stats.controller.dashboardOverview](../../apps/stats-api/src/stats.controller.ts) |
| GET | `/api/dashboard/monthly-heatmap` | bearer | [stats.controller.monthlyHeatmap](../../apps/stats-api/src/stats.controller.ts) |
| GET | `/api/dashboard/months/:monthKey/users` | bearer | [stats.controller.monthUsers](../../apps/stats-api/src/stats.controller.ts) |
| GET | `/api/dashboard/current-month/missing-image-users` | bearer | [stats.controller.currentMonthMissingImageUsers](../../apps/stats-api/src/stats.controller.ts) |
| GET | `/api/dashboard/users/:userId/upload-history` | bearer | [stats.controller.userUploadHistory](../../apps/stats-api/src/stats.controller.ts) |
| GET | `/api/stats/today` | bearer | [stats.controller.today](../../apps/stats-api/src/stats.controller.ts) |
| GET | `/api/stats/groups/:chatId/media` | bearer | [stats.controller.groupMedia](../../apps/stats-api/src/stats.controller.ts) |
| GET | `/api/health` | bearer | [stats.controller.health](../../apps/stats-api/src/stats.controller.ts) |

## Statistics and dashboards

| Route area | Inputs and response |
| --- | --- |
| stats/overview | Uptime, upload queue counts, staging usage; see [health caveats](../status.md) |
| stats/today | Optional date string; array of active-user identifiers, media counts and uploaded/failed counts |
| stats/groups/:chatId/media | status, mediaType, limit (50), offset (0); returns total and raw Prisma items |
| dashboard/overview | Composite health, daily, cycle, campaign and reminder data; [DashboardOverview](../../apps/web-admin/src/services/api.ts) owns the browser type |
| dashboard/monthly-heatmap | Optional year; cycle-based user/media aggregation |
| dashboard/months/:monthKey/users | sortBy, sortOrder, limit (50), offset (0); cycle user breakdown |
| dashboard/current-month/missing-image-users | Same sort/pagination inputs; current-cycle missing-image selection |
| dashboard/users/:userId/upload-history | Positive numeric UserTu record ID, limit (90); per-user history |
| health | Database query, upload queue query, staging usage and local Bot API/receiver freshness; guarded like other stats routes |

[StatsService](../../apps/stats-api/src/stats.service.ts) owns response construction and validation.
[Reporting time](../../.principles/code/reporting-time.md) owns date-boundary rules.
Group-media response serialization is [to confirm](../status.md#waiting-for-a-decision); do not promise every response has stringified IDs.
Daily aggregate, queue inspector/requeue and Telegram/Drive metric routes from source plans are not registered by the current controller.

## Targets and imports

[MessagesController](../../apps/stats-api/src/messages.controller.ts) parses transport fields; [MessagesService](../../apps/stats-api/src/messages.service.ts) owns persistence and lookup.

| Operation | Contract |
| --- | --- |
| List targets | query; status is active/inactive/all; active is the service default |
| Create target | tu_id, tu_name, telegram_user_id, telegram_chat_id required; path/telegram_username nullable; status optional |
| Update target | Positive UserTu record ID; partial target fields using the create field names |
| Target response | id, tu_id, tu_name, path, decimal-string telegram IDs, telegram_username, status |
| Import | Body contains nonempty targets array; each entry must contain tu_id, tu_name, path and the three telegram fields, even if a nullable field is empty |
| Import identifier handling | Missing/zero sender ID requires a username; numeric input must be safe, and parsed IDs must fit PostgreSQL bigint |
| Import resolution | Missing/zero sender IDs require enabled account lookup; invalid/unoccupied usernames contribute to manual_review; other lookup failures abort. Explicit-ID imports remain available without account access. |
| Import response | total, created, updated, resolved, manual_review; total refers to resolved inputs passed to persistence |

The import limit is 32767 inputs. Duplicate tu_id entries and conflicting user/chat pairs are rejected.
Persistence uses a serializable transaction; transaction conflicts map to a retryable HTTP conflict response.
Single-target parsing accepts integer strings/numbers but does not apply all import-specific range checks.

## Explicit username resolution

The route is POST /api/messages/targets/resolve-username. See [API boundaries](../../.principles/code/api-boundaries.md) for its invariants.

Request:

```json
{
  "telegram_username": "@ExampleUser"
}
```

Successful response:

```json
{
  "telegram_username": "exampleuser",
  "telegram_user_id": "123456789"
}
```

| Situation | HTTP status | Client-safe message |
| --- | ---: | --- |
| Missing, non-string, or empty username | 400 | `telegram_username is required` / `telegram_username must be a string` |
| Legacy account capability disabled | 503 | `Account messaging and username lookup are disabled; use explicit Telegram IDs or enable the legacy capability` |
| Telegram reports `USERNAME_INVALID` | 400 | `Telegram username is invalid` |
| Telegram reports `USERNAME_NOT_OCCUPIED` | 404 | `Telegram username was not found` |
| Username resolves to a group, channel or bot | 422 | `Telegram username does not belong to a user` |
| Gateway is disconnected, session is unauthorized, or Telegram is unavailable | 503 | `Telegram username lookup is currently unavailable` |
| Telegram reports FloodWait | 429 | `Telegram is rate limited; try again later` |

The endpoint itself has no application retry loop. The existing gate shares spacing/FloodWait state; the underlying Telegram client has its own library behavior.

## Campaigns and histories

Campaign creation accepts targetIds (UserTu record IDs), body, optional createdBy and media entries containing fileName, mimeType and base64.
It requires active targets and body or media. Targets are deduplicated by chat ID.
The response contains campaign_id, total_targets, media_count and queued status; delivery runs asynchronously in the API process.
Campaign creation and manual reminder dispatch return 503 before creating work when LEGACY_TELEGRAM_ENABLED=false; scheduled reminder dispatch is skipped. Target CRUD, explicit-ID import and stored campaign history remain available.
Body templates support tu_name, tu_id, telegram_username, telegram_user_id and telegram_chat_id substitutions.
History listing uses limit (20) and offset (0); detail uses campaignId.
[HistoryDetailResponse](../../apps/web-admin/src/services/api.ts) describes target/media fields; [MessagesService](../../apps/stats-api/src/messages.service.ts) owns dispatch and error behavior.
See [status](../status.md) before assuming restart-safe campaign recovery.

## Reminder schedules

Create/update fields: name, status, days_of_month, send_time, timezone, target_rule and message_template.
Creation requires name, nonempty days_of_month, send_time and message_template.
Days are distinct integers from 1 through 31; send_time uses HH:mm.
Defaults are active status, Asia/Ho_Chi_Minh timezone and no_media_current_period target rule.
The alternative rule is all_active_users. Unknown rules/statuses are rejected.
Listing includes recent_runs and next_run_label; run-now creates a manual run.
Scheduled runs deduplicate by schedule/date, while manual runs use a distinct run key.
[Reminder service](../../apps/stats-api/src/reminder-schedules.service.ts) owns execution/response fields; [schema](../../prisma/schema.prisma) owns the unique run constraint.

## Backfill

POST /api/backfill/media accepts chat_id, from_date, to_date and dry_run.
Preview is the default; only the boolean false requests run mode.
Date-only bounds expand to the beginning/end of a day at UTC+07:00; other accepted date strings are parsed as dates.
The end cannot precede the start; the group must have active selected users.
Response fields include dry_run, chat_id, date bounds, selected_users, scanned_messages, matched_messages, media_found, queued_media, retried_failed, skipped_existing, unknown_senders, processed_messages and max_seen_message_id.
The data source is now the captured bot inbox, not Telegram history. Additive fields are source (`bot_inbox`), capture_started_at (ISO timestamp or null), coverage (`captured`, `partial`, `unavailable`) and coverage_note. Coverage describes the recorded intake boundary, not a guarantee of complete Telegram delivery. The newest captured edit of each message is used. Run mode does not change history checkpoints.
[Backfill specification](../../specs/manual-backfill.md) owns eligibility, safety and the scan boundary.

## Sources

Route inventory comes from controller source; response summaries come from services and [browser contracts](../../apps/web-admin/src/services/api.ts).
Request/response examples and the safe-error table are migrated directly from [the username plan](../TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md), with bot rejection added from current code/tests.
