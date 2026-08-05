# Ingestor Reconciliation Scaling: Implementation Plan

## Context and implemented behavior

This plan addresses reconciliation slowdown at approximately 500 active, distinct Telegram chats. The number of distinct active chat IDs—not the number of users who share one chat—drives the reconciliation fan-out.

The implemented reconciliation path:

- Runs every 10 minutes.
- Acquires a token-checked Redis lease before stale recovery or Telegram history work; overlapping ticks log a skip.
- Stops starting new work at the configured run deadline (eight minutes by default inside the ten-minute schedule).
- Rotates due chats fairly, folds Telegram channel aliases to one physical chat, and caps a run at 500 chats.
- Rewinds a healthy chat by 50 message IDs and an overdue chat by 200 message IDs.
- Fetches history in pages of at most 100 messages, preserving per-chat order and checkpointing only successful pages.
- Preloads active authorization rows and caches Telegram entities for the reconciliation run.
- Persists media and enqueues idempotent download work; it does not download, stage, or hash inline.
- Uses a dedicated downloader worker to download, stage, hash, and enqueue upload work.
- Shares Redis-backed Telegram request permits, rate spacing, and FloodWait pause state across ingestor and downloader processes.

PostgreSQL is the system of record. Replay safety depends on idempotent `media_item` persistence and deduplicated effective upload work.

## Goals

- Prevent concurrent reconciliation runs from competing for the same work.
- Bound reconciliation runtime so it remains inside the 10-minute schedule window.
- Reduce routine replay, Telegram calls, and authorization lookups without missing eligible media.
- Improve throughput safely while respecting Telegram rate limits.
- Decouple reconciliation latency from media size and download speed.
- Preserve cursor safety, retryability, and idempotency.

## Non-goals

- Change the Telegram authorization rules.
- Change the destination or upload strategy.
- Rewrite existing media or upload persistence semantics.
- Introduce unbounded parallel Telegram processing.

## Success metrics

Measure before rollout and after every phase:

- Reconciliation run duration: p50, p95, and p99.
- Concurrent-run count.
- Per-chat reconciliation lag.
- Chats scanned, skipped, and deferred per run.
- History requests, raw messages scanned, and supported-media messages found.
- Stale recoveries, retries, download failures, and upload-enqueue failures.
- Telegram request latency, errors, and FloodWait/rate-limit events.

Target outcomes:

- No overlapping reconciliation runs.
- Routine runs complete within eight minutes.
- p95 chat reconciliation lag remains below 15 minutes.
- No missed eligible media and no duplicate effective uploads.

## Invariants

- Advance a chat cursor only after its applicable history page was successfully observed and processed.
- Preserve replay overlap sufficient to handle delayed or edited Telegram events.
- Reprocessing the same attachment must produce one idempotent media record and one effective upload.
- Failed work must remain recoverable and retryable.
- A failed Telegram history request must not advance the cursor.
- PostgreSQL remains authoritative; Redis/BullMQ transports work only.

## Expected implementation areas

| Area | Responsibility |
| --- | --- |
| `apps/ingestor/src/ingestor.service.ts` | Lease lifecycle, run budget, chat selection, paging, checkpoints, and orchestration metrics. |
| `packages/shared/src/config/env.ts` | Validate reconciliation configuration. |
| `packages/shared/src/queue/queue.service.ts` | Redis lease operations, shared Telegram request permits, and download queue. |
| `packages/shared/src/telegram/telegram-gateway.ts` | Paged history reads and run-scoped entity caching. |
| `packages/shared/src/services/media.service.ts` | Idempotent discovery, download handoff, worker-facing download lifecycle, and stale recovery. |
| `packages/shared/src/services/shared.module.ts` | Register newly introduced shared services. |
| `tests/reconciliation.spec.ts`, `tests/media-service.spec.ts` | Unit and integration-style coverage for scheduling, replay, and idempotency. |
| `apps/worker-downloader/*` | Telegram download, staging, hashing, upload enqueueing, and worker lifecycle. |

## Phase 0: establish a baseline

1. Add structured measurements for the success metrics above.
2. Capture production-like baseline data at the current 500-chat scale.
3. Identify the slowest chats and distinguish history-fetch, authorization, database, download, hash, and stale-recovery time.
4. Record the actual cardinality of active `user_tu` records to distinct chat IDs.

**Exit criteria:** baseline p50/p95/p99 run duration, lag, and per-chat cost are available for comparison.

## Phase 1: prevent overlap and bound work

1. Add a Redis-backed distributed reconciliation lease with:
   - An ownership token.
   - A lease TTL.
   - Renewal while the run remains active.
   - Token-checked release.

2. Acquire the lease before reconciliation. If unavailable, skip that trigger and record the reason. If lease ownership is lost, stop starting new work.

3. Add an eight-minute total reconciliation deadline for the 10-minute schedule.

4. Give stale-item recovery its own bounded portion of the run budget so it cannot starve Telegram-history replay.

5. Stop before starting another chat or history page when insufficient time remains. Leave unprocessed chats for a later run.

6. Emit run-level and per-chat timing, count, error, deadline, and skip telemetry.

7. Add validated configuration for lease TTL/renewal, run budget, stale-recovery budget, and maximum work per run. Defaults must retain safe current behavior until tuned from production data.

**Exit criteria:** reconciliation cannot overlap across instances, stops before the configured deadline, and does not regress cursors.

## Phase 2: reduce routine replay cost

1. Preload active authorization data once per run into lookup maps keyed by the identifiers used for chat, sender ID, and normalized username matching.

2. Select a fair, bounded set of candidate chats:
   - Recently active chats.
   - Chats with failures or overdue reconciliation.
   - Quiet chats selected on a rotating audit schedule.

3. Replace monolithic history reads with bounded pages. Checkpoint a page only after it was successfully fetched and processed; do not skip messages at page boundaries.

4. Make replay adaptive:
   - Use a small normal overlap for healthy, regularly reconciled chats.
   - Retain a larger recovery rewind for failure, missed runs, or detected gaps.

5. Cache repeated Telegram chat and sender entity resolution within a reconciliation run where applicable.

6. Persist fair rotation or candidate priority so quiet or late-ordered chats cannot be starved by the run budget.

**Exit criteria:** routine runs scan materially fewer historical messages, avoid per-message authorization queries, and preserve replay correctness.

## Phase 3: introduce bounded concurrency

1. Keep messages within one chat ordered and single-threaded.

2. Process a small number of chats concurrently, initially `3`.

3. Apply a shared Telegram-aware rate limit across reconciliation work.

4. Handle FloodWait and similar rate-limit responses with centralized backoff.

5. Schedule chats fairly so deferred or slow chats do not remain at the end of every run.

6. Increase concurrency only after observed request latency, FloodWait rate, run duration, and reconciliation lag remain within targets.

### Open decision: concurrency model

Choose before implementation:

- **Recommended:** one shared GramJS client with conservative global concurrency and centralized rate limiting.
- **Alternative:** multiple Telegram sessions/clients, which may increase throughput but adds account, session, and operational risk.

**Exit criteria:** a 500-chat production-like run meets the runtime target without Telegram rate-limit failures or cursor violations.

## Phase 4: separate the download queue

1. Add a BullMQ download queue alongside the existing upload queue.

2. Change reconciliation to discover, authorize, and idempotently persist media records, then enqueue download work. Persist the media item before queueing it.

3. Add a downloader worker responsible for:
   - Telegram media download.
   - Staging-file write.
   - Hash calculation.
   - Enqueuing upload work after successful staging.

4. Apply bounded Telegram-aware concurrency and retry/backoff to download workers.

5. Retain stale recovery behavior for both missing staged files and pending download/upload states.

**Exit criteria:** reconciliation duration is no longer determined by media file size, download speed, staging I/O, or hashing time.

## Implemented configuration and operating limits

The default rollout is intentionally conservative:

| Setting | Default | Purpose |
| --- | ---: | --- |
| `RECONCILIATION_LEASE_TTL_MS` / `RECONCILIATION_LEASE_RENEWAL_MS` | 540000 / 30000 | Distributed run ownership with token-checked renewal and release. |
| `RECONCILIATION_RUN_BUDGET_MS` / `RECONCILIATION_STALE_BUDGET_MS` | 480000 / 60000 | Keep a run within its schedule window and prevent stale recovery from starving history reads. |
| `RECONCILIATION_MAX_CHATS_PER_RUN` / `RECONCILIATION_MAX_PAGES_PER_CHAT` | 500 / 3 | Bound total fan-out and per-chat work. |
| `RECONCILIATION_HISTORY_PAGE_SIZE` | 100 | One GramJS history chunk per page/request-gated operation. |
| `RECONCILIATION_NORMAL_LOOKBACK_MESSAGES` / `RECONCILIATION_RECOVERY_LOOKBACK_MESSAGES` | 50 / 200 | Small routine overlap with a safer overdue recovery window. |
| `RECONCILIATION_CHAT_CONCURRENCY` / `DOWNLOAD_CONCURRENCY` | 3 / 3 | Local worker limits; do not raise above 3 without measured evidence. |
| `DOWNLOAD_HEARTBEAT_MS` | 60000 | Keep a legitimate long-running download out of stale recovery. |
| `RECONCILIATION_TELEGRAM_REQUESTS_PER_SEC` | 5 | Redis-shared global request spacing across ingestor and downloader. |
| `TELEGRAM_REQUEST_SLOT_TTL_MS` | 120000 | Renewable global request-concurrency permit expiry. |

Run-level telemetry is emitted as structured logs: selected/completed/deferred chats, history pages, raw/media messages, page failures, duration, deadline status, and lease loss. Per-item logs identify download lifecycle and stale recovery actions. A safe rollout starts both concurrency values at `1` for an unmeasured deployment, confirms no FloodWait/cursor failures and acceptable lag, then returns to the default maximum of `3` gradually.

## Testing and verification

Add automated tests for:

- Lease contention, lease expiry, renewal, and token-checked release.
- Deadline exit without cursor advancement for unprocessed work.
- Successful and failed paged history retrieval.
- Cursor safety after a Telegram timeout or FloodWait mid-page.
- Duplicate Telegram updates and replay-window idempotency.
- Authorization lookup behavior for supported aliases and identifiers.
- Stale-item recovery with and without a staged file.
- Crash boundaries before and after database persistence, cursor checkpointing, and queue enqueueing.
- Two reconciliation instances operating simultaneously.
- Bounded chat concurrency and rate-limit backoff.
- Large-media bursts while reconciliation continues.

Validate at production-like scale using 500 active chats and measure the defined success metrics. Run the load scenarios with quiet, active, and media-heavy chat distributions.

## Rollout and rollback

1. Ship each phase behind configuration flags.
2. Start with a small chat cohort and concurrency `1`.
3. Expand only after that phase's exit criteria and metrics pass.
4. Raise concurrency gradually from `3` only when rate limits and lag remain healthy.
5. Roll back by disabling the new scheduling or queue path, or restoring concurrency to `1`.
6. Do not roll back by reverting already persisted cursors or media state.

## Milestone sequence

1. Baseline measurements.
2. Lease, deadline, stale-work budget, and telemetry.
3. Paged/adaptive replay, candidate selection, and authorization/entity caching.
4. Bounded concurrency with Telegram-aware rate limiting.
5. Dedicated download worker and queue.

The implementation now covers milestones 2 through 5. Production rollout should still begin with conservative concurrency and advance only when the operational metrics demonstrate cursor safety, no-overlap behavior, and acceptable Telegram rate-limit/error levels under normal traffic.
