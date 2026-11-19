# Principles

## How to use this folder

Start with the [root agent guide](../AGENTS.md), then read the rule area for the change.
[Guardrails](guardrails.md) summarize expensive mistakes; linked principles own the explanations.
Each principle has three sections: Rule, Why, Enforcement.
Existing tests, compiler configuration and runtime checks are evidence; "review only" means no automated gate is claimed.
User-confirmed working policies are identified explicitly.
Inferences and unresolved product choices belong in [status](../docs/status.md), marked "to confirm".
Reference tables and operational procedures belong in [reference](../docs/reference), not in rules.

## Doing X → read Y

<!-- routing:start -->
| Doing X | Read Y |
| --- | --- |
| Planning or editing any change | [Change scope][scope], [guardrails][guardrails] |
| Changing TypeScript or runtime settings | [TypeScript boundaries][typescript] |
| Changing media discovery, download or recovery | [Shared module guide][shared], [media lifecycle][media] |
| Changing history replay or checkpoints | [Reconciliation][reconciliation] |
| Changing Telegram access or username lookup | [Telegram access][telegram], [API boundaries][api-rules] |
| Changing admin HTTP behavior | [Stats API guide][stats], [API reference][api] |
| Changing reporting or reminders | [Reporting time][reporting], [Stats API guide][stats] |
| Changing Vue pages or browser API calls | [Web admin guide][web] |
| Changing startup, shutdown or process configuration | [Process lifecycle][lifecycle], [operations][operations] |
| Changing product requirements | [Specification guide][spec-guide], [specification index][spec-index], [status][status] |
| Verifying or documenting a change | [Verification][verification], [documentation sync][docs-sync] |
<!-- routing:end -->

## Maintenance

The root guide owns the routing entries. Keep this table byte-identical; reference definitions below resolve from this folder.
The [documentation test](../tests/documentation.spec.ts) checks routing, local links and agent budgets.
Use the [sync table](practice/docs-sync.md) when implementation changes.

[scope]: ../.principles/workspace/change-scope.md
[guardrails]: ../.principles/guardrails.md
[typescript]: ../.principles/workspace/typescript-boundaries.md
[shared]: ../packages/shared/AGENTS.md
[media]: ../.principles/code/media-lifecycle.md
[reconciliation]: ../.principles/code/reconciliation.md
[telegram]: ../.principles/code/telegram-access.md
[api-rules]: ../.principles/code/api-boundaries.md
[stats]: ../apps/stats-api/AGENTS.md
[api]: ../docs/reference/api.md
[reporting]: ../.principles/code/reporting-time.md
[web]: ../apps/web-admin/AGENTS.md
[lifecycle]: ../.principles/delivery/process-lifecycle.md
[operations]: ../docs/reference/operations.md
[spec-guide]: ../specs/AGENTS.md
[spec-index]: ../specs/INDEX.md
[status]: ../docs/status.md
[verification]: ../.principles/quality/verification.md
[docs-sync]: ../.principles/practice/docs-sync.md
