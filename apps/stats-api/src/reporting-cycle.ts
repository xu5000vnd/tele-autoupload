export const REPORTING_CYCLE_CLOSE_DAY = 20;

export function reportingCycleStartDay(closeDay = REPORTING_CYCLE_CLOSE_DAY): number {
  return closeDay + 1;
}
