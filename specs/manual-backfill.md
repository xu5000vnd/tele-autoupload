# Manual media backfill

## Purpose

After bulk importing users, an admin must be able to scan existing Telegram group history
for a date range and recover media uploaded by those users without creating duplicates.

This specification describes the current implementation boundary, not an assurance of complete historical recovery.

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
- Backfill must be idempotent.

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

The cursor behavior describes this service's sequential path; concurrent cursor-update behavior is not proven by a dedicated backfill test.

## Current scan boundary

The service fetches history after message ID zero before filtering by date.
The gateway wrapper asks for a larger batch but the page implementation caps it at 100 raw messages and returns one page.
Narrower date ranges do not reach later pages. See [status](../docs/status.md) for the unresolved pagination requirement.

## Acceptance criteria

- Given a user uploaded media before being added to DB, when the admin adds/imports the user
  and runs backfill for that group/date range, then missing matching media is queued.
- Given media was already processed, when backfill runs again, then it is counted as existing
  and not queued again.
- Given messages were sent by users not in the selected active users, then the result lists
  unknown sender summaries.

These criteria apply to messages returned within the current scan boundary.
They are migrated requirements checked by source inspection, not a claim of automated backfill coverage.

## Sources

Migrated from [backfill requirements](../docs/MANUAL-BACKFILL-REQUIREMENTS.md), corrected against [backfill service](../apps/stats-api/src/media-backfill.service.ts), [controller](../apps/stats-api/src/media-backfill.controller.ts) and [history gateway](../packages/shared/src/telegram/telegram-gateway.ts).
