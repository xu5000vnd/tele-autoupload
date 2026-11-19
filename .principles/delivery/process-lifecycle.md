# Process lifecycle

## Rule

- Preserve existing worker shutdown: close the BullMQ worker before disconnecting its Telegram client.
- Keep headless workers on Nest application contexts and HTTP serving in the stats API entry point.
- Preserve explicit signal handlers where they exist; do not describe every service as having the same shutdown behavior.
- Keep operational instructions grounded in the configured scripts and process definitions.

## Why

Disconnecting a download client before active work closes can interrupt processing. The configured process model also determines which services are supervised and which are separate.

## Enforcement

Runtime: [downloader lifecycle](../../apps/worker-downloader/src/downloader.service.ts), [uploader lifecycle](../../apps/worker-uploader/src/uploader.service.ts), [ingestor entry](../../apps/ingestor/src/main.ts), [stats entry](../../apps/stats-api/src/main.ts), [PM2](../../ecosystem.config.cjs).
Test: [downloader lifecycle](../../tests/downloader-service.spec.ts) checks close/disconnect calls; their ordering follows source and is review only.
The stats bootstrap does not install the same explicit shutdown handlers as the workers.
Deployment procedures and process settings live in [operations](../../docs/reference/operations.md).
