# Reconciliation

## Rule

- Acquire the token-checked Redis lease before stale-media recovery; stop starting work if ownership is lost or the deadline expires.
- Poll and dispatch captured updates under separate bot-scoped leases. Save accepted updates and the receipt offset transactionally before requesting the next offset; abort polling on lost ownership.
- Preserve receipt order and chat aliases. Use the internal receipt sequence for edit fencing; Telegram update IDs can reset after an idle interval.
- Keep failed dispatch retryable and unmatched senders retained without blocking following receipts. Preview must not modify media, jobs or processing outcomes.
- Replay only captured messages, selecting the newest edit per message. Do not roll history cursors backward or use them as bot receipt offsets.
- Never replace missing capture with a user-account history scan.

## Why

The bot has no arbitrary old-history scan. Durable intake, ownership checks, ordered replay and stale-media recovery protect work that was actually captured; they cannot reconstruct expired undelivered updates.

## Enforcement

Runtime: [ingestor stale recovery](../../apps/ingestor/src/ingestor.service.ts), [bot inbox and receipt handoff](../../packages/shared/src/telegram/bot-telegram.service.ts), [captured replay](../../apps/stats-api/src/media-backfill.service.ts), [Redis lease scripts](../../packages/shared/src/queue/queue.service.ts), [configuration constraints](../../packages/shared/src/config/env.ts).
Tests: [reconciliation](../../tests/reconciliation.spec.ts), [queue lease ownership](../../tests/queue-service.spec.ts).
The retained [reconciliation source](../../docs/reconciliation-scaling-implementation-plan.md) describes the former history transport. Test coverage does not establish production-scale latency or absence of every possible overlap.
