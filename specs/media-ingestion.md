# Media ingestion

## Supported flow

The system receives Telegram user-session updates, persists eligible attachment metadata, downloads to staging and dispatches upload work.
It listens for new and edited messages. Albums arrive as individual messages linked by grouped_id.
The parser recognizes photo media and document media; document attributes determine video versus document classification.
This is not a separate allowlist excluding every sticker, animation or voice-message subtype.

## Uploader eligibility

The ingestor matches active registered uploaders within supported chat aliases, trying sender ID before username.
An authorized incoming message can backfill the sender ID, username and canonical chat ID on the matched user record.
Unmatched/inactive senders are skipped by that ingestion path; notification behavior is separate.
The whitelist setting does not grant upload authorization; see [environment](../docs/reference/environment.md).

## Processing outcomes

A media record tracks discovery, download, upload and failure states.
The [media lifecycle principle](../.principles/code/media-lifecycle.md) owns technical identity, ownership, durability and terminal-state rules.
[Operations](../docs/reference/operations.md) owns strategy-specific destinations and the meaning of upload completion.
An uploaded message slot is not automatically uploaded again solely because an edited update changes its Telegram file identity.
Hashing records content metadata; no cross-group content-hash lookup controls the current upsert path.

## Recovery and visibility

Reconciliation revisits history with overlap and discovers missed eligible media.
[Reconciliation rules](../.principles/code/reconciliation.md) own checkpoint safety; [environment](../docs/reference/environment.md) owns limits/defaults.
The [manual backfill specification](manual-backfill.md) describes the separate admin recovery path.
Dashboards and the optional summary bot expose counts through the [API](../docs/reference/api.md) and [operations](../docs/reference/operations.md).

## Current limitations

[Status](../docs/status.md) owns unimplemented disk protection, strategy verification, history boundaries and uncertain requirements.
The recorded design goals are not evidence of guaranteed throughput, remote synchronization, streaming downloads or complete history recovery.

## Sources

Consolidated from scope, architecture, album and dedupe sections of [requirements](../requirement.md), the [process summary](../PROCESS-SUMMARY.md) and README service descriptions.
Verified against [ingestor matching](../apps/ingestor/src/ingestor.service.ts), [media processing](../packages/shared/src/services/media.service.ts), [gateway parsing](../packages/shared/src/telegram/telegram-gateway.ts) and [media tests](../tests/media-service.spec.ts).
