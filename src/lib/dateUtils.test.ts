import { ROLLOVER_HOUR, startOfDay, intervalToDueDate } from './dateUtils';

describe('startOfDay', () => {
  it('resolves to the previous calendar day when local time is before the rollover hour', () => {
    const beforeRollover = new Date('2026-07-15T02:00:00');
    const result = new Date(startOfDay(beforeRollover));
    expect(result.getDate()).toBe(14);
    expect(result.getHours()).toBe(ROLLOVER_HOUR);
  });

  it('resolves to the same calendar day when local time is at or after the rollover hour', () => {
    const afterRollover = new Date('2026-07-15T21:00:00');
    const result = new Date(startOfDay(afterRollover));
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(ROLLOVER_HOUR);
  });

  it('is exactly at the rollover boundary itself', () => {
    const atRollover = new Date('2026-07-15T04:00:00');
    const result = new Date(startOfDay(atRollover));
    expect(result.getDate()).toBe(15);
  });

  it('zeroes out minutes/seconds/ms', () => {
    const now = new Date('2026-07-15T21:47:33.123');
    const result = new Date(startOfDay(now));
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it('respects a custom rollover hour', () => {
    const now = new Date('2026-07-15T05:00:00');
    const result = new Date(startOfDay(now, 6));
    // 5am is before a 6am rollover -> previous day
    expect(result.getDate()).toBe(14);
    expect(result.getHours()).toBe(6);
  });
});

describe('intervalToDueDate', () => {
  it('adds interval days to the start of the current due-day', () => {
    const now = new Date('2026-07-15T21:00:00'); // today's due-day
    const due = new Date(intervalToDueDate(now, 1));
    expect(due.getDate()).toBe(16);
    expect(due.getHours()).toBe(ROLLOVER_HOUR);
  });

  it('interval 0 lands exactly on startOfDay(now)', () => {
    const now = new Date('2026-07-15T21:00:00');
    expect(intervalToDueDate(now, 0)).toBe(startOfDay(now));
  });

  it('a card reviewed at 9pm with interval 1 is due at tomorrow morning\'s rollover, not +24h', () => {
    // Regression for the exact scenario called out in §4.3.
    const reviewedAt = new Date('2026-07-15T21:00:00');
    const due = intervalToDueDate(reviewedAt, 1);
    const twentyFourHoursLater = reviewedAt.getTime() + 24 * 60 * 60 * 1000;
    expect(due).toBeLessThan(twentyFourHoursLater);
  });

  it('stays correct across a spring-forward DST transition (calendar-day arithmetic, not raw ms)', () => {
    // 2026-03-08 is DST start in the US — clocks skip 2am -> 3am, so that
    // calendar day is only 23 real hours. A naive +24h*n would land an
    // hour off the 4am rollover; setDate-based arithmetic should not.
    const beforeDst = new Date('2026-03-07T21:00:00');
    const due = new Date(intervalToDueDate(beforeDst, 2));
    expect(due.getHours()).toBe(ROLLOVER_HOUR);
    expect(due.getDate()).toBe(9);
  });
});
