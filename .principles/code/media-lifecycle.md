# Media lifecycle

## Rule

- Persist media before enqueueing download work. Keep upserts keyed by chat, message and media index; refresh Telegram file identity on that slot.
- Preserve both database uniqueness constraints and per-media queue deduplication.
- Claim stale/download work conditionally; keep ownership tokens on heartbeat, completion and failure writes.
- Preserve a durable staged file and downloaded state when downstream handoff fails.
- Preserve deleted-item guards in replay, stale recovery and queued downloads.
- Keep terminal Telegram download failures distinct from retryable local staging failures.

## Why

Replay, queue delivery, recovery sweeps and long downloads can overlap. Slot identity, conditional writes and durable handoff prevent duplicate effective work and stale owners overwriting newer state.

## Enforcement

Runtime: [MediaService](../../packages/shared/src/services/media.service.ts), [queue deduplication](../../packages/shared/src/queue/queue.service.ts) and [schema constraints](../../prisma/schema.prisma).
Tests: [media lifecycle cases](../../tests/media-service.spec.ts) and [queue cases](../../tests/queue-service.spec.ts).
Sources migrated: attachment and retry requirements in [the retained source](../../requirement.md); implemented recovery behavior is established by the code/tests.
These guards are scoped to their existing paths, not a claim that every uploader transition has ownership fencing.
