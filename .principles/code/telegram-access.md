# Telegram access

## Rule

- Use BotTelegramService for media intake/downloads and bot notifications. One leased ingestor polls each bot; persist batches and receipt offsets before acknowledgment. Stats and workers must not poll.
- Bot downloads use stored file IDs owned by the configured bot and local cache files validated inside the configured cache root. Never translate legacy IDs or fall back to a human session.
- Reuse TelegramGateway only for explicitly enabled account capabilities and preserve its established connection lifecycle.
- Preserve runTelegramRequest and shared FloodWait deferral on remaining gated account operations, including permit release.
- Username lookup requires an existing connection; it must not initiate interactive login or persist a target.
- Keep the public-user resolver distinct from internal user-or-bot identity lookup.
- Do not generalize the shared-gate guarantee to outbound campaign sends; their implementation is different.

## Why

Independent polling or acknowledgment before persistence can lose media. Account access is disabled by default; enabling campaigns/lookups does not enable account media capture. A Telegram bot is represented as a user peer but is not accepted by the public-user resolver.

## Enforcement

Runtime: [bot service](../../packages/shared/src/telegram/bot-telegram.service.ts), [account gateway](../../packages/shared/src/telegram/telegram-gateway.ts), [distributed request coordination](../../packages/shared/src/queue/queue.service.ts).
Tests: [request gate](../../tests/telegram-request-gate.spec.ts), [username resolution](../../tests/telegram-username-resolution.spec.ts), [downloader lifecycle](../../tests/downloader-service.spec.ts).
Connection and lookup requirements are migrated from [the username source](../../docs/TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md).
