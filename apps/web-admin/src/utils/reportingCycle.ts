export const DEFAULT_REPORTING_CYCLE_CLOSE_DAY = 20;

function parseDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCycleRange(start: string, end: string, mode: 'compact' | 'full' = 'full'): string {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) {
    return mode === 'compact' ? `${start} -> ${end}` : `Cycle ${start} - ${end}`;
  }

  const startLabel = startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endLabel = endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (mode === 'compact') {
    return `${startLabel} -> ${endLabel}`;
  }

  return `Cycle ${startLabel} - ${endLabel}`;
}

export function formatCycleRule(closeDay?: number | null): string {
  const day = Number.isInteger(closeDay) ? Number(closeDay) : DEFAULT_REPORTING_CYCLE_CLOSE_DAY;
  return `Closes on day ${day}`;
}
