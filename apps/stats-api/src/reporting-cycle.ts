export const REPORTING_CYCLE_START_DAY = 20;

export function reportingCyclePreviousMonthEndDay(startDay = REPORTING_CYCLE_START_DAY): number {
  return startDay - 1;
}
