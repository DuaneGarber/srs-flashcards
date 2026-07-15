/** Anki's default rollover hour, in the device's local time — §4.3. */
export const ROLLOVER_HOUR = 4;

/**
 * Epoch ms of the start of the current "due day": the most recent
 * rollover-hour instant at or before `now`, in local time. A card
 * reviewed at 9pm with interval 1 is due at tomorrow's rollover, not
 * literally +24h, so this always resolves via local calendar fields
 * (not raw ms math) to stay correct across DST.
 */
export function startOfDay(now: Date, rolloverHour: number = ROLLOVER_HOUR): number {
  const d = new Date(now);
  if (d.getHours() < rolloverHour) {
    d.setDate(d.getDate() - 1);
  }
  d.setHours(rolloverHour, 0, 0, 0);
  return d.getTime();
}

/** App-layer interval -> due-timestamp conversion — kept out of the pure scheduler module (§4). */
export function intervalToDueDate(
  now: Date,
  intervalDays: number,
  rolloverHour: number = ROLLOVER_HOUR
): number {
  const dueDate = new Date(startOfDay(now, rolloverHour));
  dueDate.setDate(dueDate.getDate() + intervalDays);
  return dueDate.getTime();
}
