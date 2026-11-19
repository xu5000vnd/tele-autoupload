# Admin API boundaries

## Rule

- Preserve BearerAuthGuard on existing protected controllers, including health.
- Preserve decimal-string Telegram IDs in target/resolver HTTP payloads; do not round user IDs through Number.
- Normalize target usernames by trimming, removing leading @ characters and lowercasing.
- Explicit username resolution changes only the form username/user ID: no target write and no inferred chat ID.
- Keep resolver RPC-to-HTTP error mapping in the API service, with safe client messages.
- Preserve controller parsing and service-level validation rather than passing unchecked input into persistence.

## Why

Telegram user IDs can exceed JavaScript integer precision. Lookup is distinct from saving authorization data; leaking RPC details or opening protected routes changes the admin boundary.

## Enforcement

Runtime: [auth guard](../../apps/stats-api/src/auth.guard.ts), [auth service](../../apps/stats-api/src/auth.service.ts), [messages controller](../../apps/stats-api/src/messages.controller.ts), [messages service](../../apps/stats-api/src/messages.service.ts).
Tests: [controller parsing](../../tests/messages-controller.spec.ts), [resolver contracts](../../tests/telegram-username-resolution.spec.ts).
Guard preservation and validation outside these tested paths: review only.
Migrated from [the username source](../../docs/TELEGRAM-USERNAME-USER-ID-RESOLUTION-IMPLEMENTATION.md); see [API reference](../../docs/reference/api.md) for payloads and current exceptions.
