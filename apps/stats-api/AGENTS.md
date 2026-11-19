# Stats API guide

## Scope

Applies to this app and its descendants. Start with the [root guide](../../AGENTS.md).
Use [app.module.ts](src/app.module.ts) to locate registered controllers and services.

## Read before changing

| Area | Read |
| --- | --- |
| Authentication, input parsing or username lookup | [API boundaries](../../.principles/code/api-boundaries.md), [API contracts](../../docs/reference/api.md) |
| Telegram calls | [Telegram access](../../.principles/code/telegram-access.md) |
| Dashboard, daily totals or reminders | [Reporting time](../../.principles/code/reporting-time.md) |
| Manual backfill | [Backfill specification](../../specs/manual-backfill.md), [API contracts](../../docs/reference/api.md) |
| Campaign dispatch, storage or startup/shutdown | [Architecture](../../docs/reference/architecture.md), [operations](../../docs/reference/operations.md), [status](../../docs/status.md) |

## Verification

Existing [controller](../../tests/messages-controller.spec.ts) and [resolver](../../tests/telegram-username-resolution.spec.ts) tests cover selected admin paths.
Do not describe these as coverage for all stats, reporting, scheduling or campaign behavior.
Follow [verification](../../.principles/quality/verification.md) and [docs-sync](../../.principles/practice/docs-sync.md).
