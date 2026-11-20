# Media lifecycle

## Rule

- Persist media before enqueueing download work. Keep upserts keyed by chat, message and media index; refresh Telegram file identity on that slot.
- Preserve both database uniqueness constraints and per-media queue deduplication.
- Claim stale/download work conditionally; keep ownership tokens on heartbeat, completion and failure writes.
- Preserve a durable staged file and downloaded state when downstream handoff fails.
- Preserve deleted-item guards in replay, stale recovery and queued downloads.
- Keep terminal deleted-item handling distinct from retryable Bot API, network and local staging failures.
- Persist bot provenance, opaque album IDs and receipt revisions; reject an older receipt when a newer reference is stored. Fence bot download claim/completion with that revision and invalidate an active lease on a newer reference.
- Use separate attempt directories with deterministic basenames so a stale attempt cannot overwrite newer bytes. Keep Bot API/network/local-copy failures retryable and preserve terminal deleted-item guards.

## Why

Replay, queue delivery, recovery sweeps and long downloads can overlap. Slot identity, conditional writes and durable handoff prevent duplicate effective work and stale owners overwriting newer state.

## Enforcement

Runtime: [MediaService](../../packages/shared/src/services/media.service.ts), [queue deduplication](../../packages/shared/src/queue/queue.service.ts) and [schema constraints](../../prisma/schema.prisma).
Tests: [media lifecycle cases](../../tests/media-service.spec.ts) and [queue cases](../../tests/queue-service.spec.ts).
Sources migrated: attachment and retry requirements in [the retained source](../../requirement.md); implemented recovery behavior is established by the code/tests.
These guards are scoped to their existing paths, not a claim that every uploader transition has ownership fencing.
