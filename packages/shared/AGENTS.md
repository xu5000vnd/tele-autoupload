# Shared module guide

## Scope

Applies to this module and its descendants. Start with the [root guide](../../AGENTS.md).
The [architecture reference](../../docs/reference/architecture.md) owns the shared-provider and queue map.

## Read before changing

| Area | Read |
| --- | --- |
| Media persistence, download or recovery | [Media lifecycle](../../.principles/code/media-lifecycle.md) |
| History/request coordination | [Reconciliation](../../.principles/code/reconciliation.md), [Telegram access](../../.principles/code/telegram-access.md) |
| Environment or injection/import registration | [TypeScript boundaries](../../.principles/workspace/typescript-boundaries.md), [environment reference](../../docs/reference/environment.md) |
| Drive destination or upload behavior | [Operations](../../docs/reference/operations.md), [current problems](../../docs/status.md) |
| Naming or date helpers | [Reporting time](../../.principles/code/reporting-time.md) |

## Verification

Use the relevant existing media, queue, request-gate, resolver and filename cases in [tests](../../tests).
Read [verification guidance](../../.principles/quality/verification.md) before reporting completion.
Update owning documents using [docs-sync](../../.principles/practice/docs-sync.md).
