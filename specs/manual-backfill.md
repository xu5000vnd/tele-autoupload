# Manual replay of captured media

## Purpose

After bulk importing users, an admin can replay media already captured by the bot for a date range without creating duplicate uploads. The existing backfill route and navigation are retained; they do not fetch Telegram history.

## Inputs and results

- Admin can run a backfill for one Telegram group/chat.
- Admin can specify a date range.
- Admin runs backfill for all active users in that group.
- Admin can preview before queueing uploads.
- Backfill reports:
  - scanned messages
  - matched messages
  - media found
  - media already existing
  - media queued
  - failed media retried
  - unknown senders
- Backfill is idempotent and selects the newest captured edit per message before processing.
- The result identifies the bot inbox source, recorded capture start and whether the requested range precedes that boundary.

The [API reference](../docs/reference/api.md) owns request fields, date parsing and response names.

## Duplicate and retry behavior

The backfill scan checks each attachment by chat, message and media index.
Existing failed items contribute to retried_failed; other existing statuses contribute to skipped_existing.
Missing and failed counts are prospective in preview; the counters alone do not prove a successful queue handoff.
Run mode delegates matching messages to the shared media lifecycle; preview does not.
See [media lifecycle](../.principles/code/media-lifecycle.md) for technical identity and recovery rules.

## Safety

- Backfill must not move `group_state.last_message_id` backward.
- Dry run must not create `media_item` rows or upload jobs.
- Dry run must not clear failed media status.
- Unknown uploaders must be visible to admins instead of silently ignored.
- Running the same backfill multiple times must not duplicate uploads.

Replay calls the media lifecycle without managing the retired history cursor. Receipt revisions prevent older replay from replacing newer stored references.

## Capture boundary

The service reads the current bot's captured inbox for the chat aliases/date range. Messages before capture, before bot membership, or missed beyond Telegram's delivery window are unavailable. A capture timestamp is not a completeness guarantee for outages or permission gaps. Empty results must not be presented as proof that old Telegram history was scanned.

## Acceptance criteria

- Given the bot captured a user's media before that user was added to DB, when the admin adds/imports the user
  and runs backfill for that group/date range, then missing matching media is queued.
- Given media was already processed, when backfill runs again, then it is counted as existing
  and not queued again.
- Given messages were sent by users not in the selected active users, then the result lists
  unknown sender summaries.

These criteria apply to captured messages. The isolated integration check exercises read-only preview, registration replay and repeated-run deduplication; it does not establish live Telegram history recovery.

## Sources

Adapted from [backfill requirements](../docs/MANUAL-BACKFILL-REQUIREMENTS.md) to the confirmed new-media-only bot scope; implementation lives in [backfill service](../apps/stats-api/src/media-backfill.service.ts), [controller](../apps/stats-api/src/media-backfill.controller.ts) and [bot capture](../packages/shared/src/telegram/bot-telegram.service.ts).
