# Reconciliation

## Rule

- Acquire the token-checked Redis lease before stale recovery or history work; stop starting work if ownership is lost or the deadline expires.
- Preserve per-chat message order, bounded pages/workers, replay overlap and alias folding.
- Advance a chat cursor only after its applicable history page was successfully observed and processed.
- A failed Telegram history request must not advance the cursor.
- Preserve the monotonic checkpoint update; do not roll cursors backward to recover older media.

## Why

Reconciliation replays previously seen messages. Checkpointing an incomplete page can skip eligible media; ownership checks prevent competing runs from acting as one owner.

## Enforcement

Runtime: [ingestor lease/page/checkpoint logic](../../apps/ingestor/src/ingestor.service.ts), [Redis lease scripts](../../packages/shared/src/queue/queue.service.ts), [configuration constraints](../../packages/shared/src/config/env.ts).
Tests: [reconciliation](../../tests/reconciliation.spec.ts), [queue lease ownership](../../tests/queue-service.spec.ts).
The page-success invariants are migrated from [the reconciliation source](../../docs/reconciliation-scaling-implementation-plan.md).
Test coverage does not establish production-scale latency or absence of every possible overlap.
