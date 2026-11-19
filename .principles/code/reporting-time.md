# Reporting time

## Rule

- Preserve the current boundaries of each reporting calculation unless a behavior change is requested.
- Dashboard/reminder reporting cycles use the shared backend start-day constant and Vietnam-time calculations.
- Daily summary statistics use UTC days; desktop date-folder helpers use host-local calendar accessors, while deterministic filenames use UTC.
- Keep the frontend reporting fallback aligned with the backend constant when intentionally changing that value.
- Do not assume a Cron comment configures its timezone.

## Why

Month labels, reporting cycles, daily totals and destination dates do not share one clock boundary. Silently unifying them changes reported membership or folder placement.

## Enforcement

Review only: [backend cycle constant](../../apps/stats-api/src/reporting-cycle.ts), [stats calculations](../../apps/stats-api/src/stats.service.ts), [reminder calculations](../../apps/stats-api/src/reminder-schedules.service.ts), [frontend fallback](../../apps/web-admin/src/utils/reportingCycle.ts), [date helpers](../../packages/shared/src/utils/file-naming.ts), [bot Cron](../../apps/stats-api/src/bot.service.ts).
[Filename tests](../../tests/file-naming.spec.ts) cover selected naming cases, not all timezone/reporting boundaries.
The intended long-term timezone policy is [to confirm](../../docs/status.md#waiting-for-a-decision).
