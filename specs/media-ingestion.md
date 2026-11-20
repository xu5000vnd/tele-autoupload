# Media ingestion

## Supported flow

The system receives Telegram bot updates through a local Bot API server, saves them before acknowledgment, persists eligible attachment metadata, copies media to staging and dispatches upload work.
It handles new/edited group messages and channel posts. Albums arrive as individual messages linked by an opaque string album ID. Photo sizes represent one attachment, with the largest variant selected.
The [bot parser](../packages/shared/src/telegram/bot-telegram.service.ts) recognizes photos, videos, documents, animations, audio, voice, video notes and stickers, mapping each message to one attachment. Media references carry the owning bot and a durable receipt revision.
Ordinary conversation text is acknowledged without retaining its body; supported media, summary commands and relevant membership outcomes are retained.
Only new media visible to the bot is captured. The operator must add the bot to each source chat with permission to receive ordinary media; database registration alone does not grant Telegram access.

## Uploader eligibility

The ingestor matches active registered uploaders within supported chat aliases, trying sender ID before username.
An authorized incoming message can backfill the sender ID, username and canonical chat ID on the matched user record.
Intake admits only configured database chats; explicitly inactive group aliases block admission. Unmatched/inactive senders are retained in the inbox without uploading and can be replayed after registration; notification behavior is separate.
Anonymous/chat-authored posts cannot be attributed to a human uploader through a signature or forwarded origin and remain ineligible without an identifiable registered sender.
The whitelist setting does not grant upload authorization; see [environment](../docs/reference/environment.md).

## Processing outcomes

A media record tracks discovery, download, upload and failure states.
The [media lifecycle principle](../.principles/code/media-lifecycle.md) owns technical identity, ownership, durability and terminal-state rules.
[Operations](../docs/reference/operations.md) owns strategy-specific destinations and the meaning of upload completion.
An uploaded message slot is not automatically uploaded again solely because an edited update changes its Telegram file identity.
Before upload is claimed, a replacement attachment invalidates old staging and refreshes its download. If an upload already owns the artifact, the edit waits for that operation to settle; the uploaded-slot rule then applies.
Hashing records content metadata; no cross-group content-hash lookup controls the current upsert path.

## Recovery and visibility

Inbox retries and the leased stale-media sweep recover captured work. The bot never scans arbitrary Telegram history; undelivered updates older than Telegram's retention window cannot be reconstructed.
[Reconciliation rules](../.principles/code/reconciliation.md) own recovery safety; [environment](../docs/reference/environment.md) owns limits/defaults.
The [manual replay specification](manual-backfill.md) describes preview/run over captured messages, including later uploader registration.
Dashboards and bot summaries expose counts through the [API](../docs/reference/api.md) and [operations](../docs/reference/operations.md).

## Current limitations

[Status](../docs/status.md) owns unimplemented disk protection, strategy verification, history boundaries and uncertain requirements.
The recorded design goals are not evidence of guaranteed throughput, remote synchronization, streaming downloads or complete history recovery.

## Sources

Consolidated from scope, architecture, album and dedupe sections of [requirements](../requirement.md), the [process summary](../PROCESS-SUMMARY.md) and README service descriptions.
Verified against [ingestor matching](../apps/ingestor/src/ingestor.service.ts), [media processing](../packages/shared/src/services/media.service.ts), [bot parsing](../packages/shared/src/telegram/bot-telegram.service.ts) and [media tests](../tests/media-service.spec.ts).
