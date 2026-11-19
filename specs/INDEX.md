# Current specifications

Read the [specification guide](AGENTS.md) before editing.

| Specification | Owns | Implementation evidence |
| --- | --- | --- |
| [Media ingestion](media-ingestion.md) | Supported inputs, uploader eligibility and replay outcomes | [Ingestor](../apps/ingestor/src/ingestor.service.ts), [media service](../packages/shared/src/services/media.service.ts) |
| [Manual backfill](manual-backfill.md) | Preview/run behavior and current scan boundary | [Backfill service](../apps/stats-api/src/media-backfill.service.ts), [gateway](../packages/shared/src/telegram/telegram-gateway.ts) |

[Status](../docs/status.md) owns unresolved requirements and current problems.
[API](../docs/reference/api.md) owns transport contracts; [operations](../docs/reference/operations.md) owns operator procedures.
[Migration map](../docs/migration-map.md) identifies retained source documents and deletion candidates.
