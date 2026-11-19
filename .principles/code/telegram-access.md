# Telegram access

## Rule

- Reuse TelegramGateway and its established connection lifecycle.
- Preserve runTelegramRequest for history, download and username operations already routed through it, including permit release and shared FloodWait deferral.
- Username lookup requires an existing connection; it must not initiate interactive login or persist a target.
- Keep the public-user resolver distinct from internal user-or-bot identity lookup.
- Do not generalize the shared-gate guarantee to outbound campaign sends; their implementation is different.

## Why

Independent request spacing or reconnect/login logic can bypass coordination. A Telegram bot is represented as a user peer but is not accepted by the public-user resolver.

## Enforcement

Runtime: [gateway](../../packages/shared/src/telegram/telegram-gateway.ts), [distributed request coordination](../../packages/shared/src/queue/queue.service.ts).
Tests: [request gate](../../tests/telegram-request-gate.spec.ts), [username resolution](../../tests/telegram-username-resolution.spec.ts), [downloader lifecycle](../../tests/downloader-service.spec.ts).
Connection and lookup requirements are migrated from [the username source](../../docs/TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md).
