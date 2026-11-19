# Documentation synchronization

## Rule

Use this table when changing an owning source. Update the canonical document and link to it elsewhere; keep reference material out of agent rules.

| When you change X | Update document Y |
| --- | --- |
| Package scripts or build/test scope | [Scripts](../../docs/reference/scripts.md), affected [verification guidance](../quality/verification.md) |
| Environment schema or Vite settings | [Environment](../../docs/reference/environment.md), affected [operations](../../docs/reference/operations.md) |
| Controller routes, payloads or errors | [API](../../docs/reference/api.md) |
| Media identity, ownership or recovery | [Media lifecycle](../code/media-lifecycle.md), affected [specification](../../specs/media-ingestion.md) |
| Reconciliation paging, timing or checkpoints | [Reconciliation](../code/reconciliation.md), [environment](../../docs/reference/environment.md) |
| Reporting cycle or time calculations | [Reporting time](../code/reporting-time.md), affected [API contract](../../docs/reference/api.md) |
| Upload completion or destination behavior | [Operations](../../docs/reference/operations.md), affected [status entry](../../docs/status.md) |
| Process registration or shutdown | [Architecture](../../docs/reference/architecture.md), [process lifecycle](../delivery/process-lifecycle.md) |
| Product requirements or known limitations | [Specs index](../../specs/INDEX.md), [status](../../docs/status.md) |
| Task routing or documentation paths | [Root routing](../../AGENTS.md), identical table in [principles index](../README.md) |
| Source-document migration coverage | [Migration map](../../docs/migration-map.md) |

Run the documentation check from the script reference. No committed documentation generator exists in this documentation-only change; keep the inventory tables synchronized with source.

## Why

One owner per fact reduces contradictory setup instructions and rules. The routing table is an intentional mirrored navigation view with context-specific reference definitions.

## Enforcement

User-approved documentation policy; review only for semantic synchronization.
The [documentation test](../../tests/documentation.spec.ts) enforces local link resolution, routing-table equality and agent line limits.
It does not prove semantic accuracy or automatically regenerate reference tables.
