# Manual Media Backfill Requirements

## Problem

Operations can create Telegram groups manually before users are imported into `user_tu`.
If users upload media before their DB records exist, the ingestor treats those messages as
unknown uploaders and skips them. Once the group cursor advances, adding users later does
not automatically revisit those older messages.

## Business Goal

After bulk importing users, an admin must be able to scan existing Telegram group history
for a date range and recover media uploaded by those users without creating duplicates.

## Functional Requirements

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
  - unknown senders
- Backfill must be idempotent.

## Duplicate Rules

Before queueing a media item, the system checks existing `media_item` rows using the same
identity used by normal ingestion:

- `chat_id`
- `message_id`
- `tg_file_unique_id` when available
- fallback unique value `idx:<media_index>`

Existing media is counted as `skipped_existing` and is not queued again.

## Safety Rules

- Backfill must not move `group_state.last_message_id` backward.
- Dry run must not create `media_item` rows or upload jobs.
- Unknown uploaders must be visible to admins instead of silently ignored.
- Running the same backfill multiple times must not duplicate uploads.

## MVP Scope

The MVP scans up to the Telegram history batch cap exposed by the gateway and filters the
returned messages by date range. If a group has more historical messages than the cap,
admins should run smaller ranges or repeat after extending pagination support.

## Acceptance Criteria

- Given a user uploaded media before being added to DB, when the admin adds/imports the user
  and runs backfill for that group/date range, then missing matching media is queued.
- Given media was already processed, when backfill runs again, then it is counted as existing
  and not queued again.
- Given messages were sent by users not in the selected active users, then the result lists
  unknown sender summaries.
