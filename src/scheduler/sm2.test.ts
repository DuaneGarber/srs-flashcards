import { sm2Scheduler, type SchedulerState } from './sm2';

function graduatedState(easeFactor: number, interval = 10): SchedulerState {
  return { easeFactor, interval, repetitions: 2 };
}

describe('sm2Scheduler — monotonicity invariant (§4.1, required)', () => {
  it('interval(hard) < interval(good) < interval(easy) for any valid EF on a graduated card', () => {
    for (let ef = 1.3; ef <= 3.5; ef += 0.05) {
      const state = graduatedState(ef);
      const hard = sm2Scheduler.review(state, 'hard').interval;
      const good = sm2Scheduler.review(state, 'good').interval;
      const easy = sm2Scheduler.review(state, 'easy').interval;
      expect(hard).toBeLessThan(good);
      expect(good).toBeLessThan(easy);
    }
  });
});

describe('sm2Scheduler — worked example from §4.1 (mature card: interval 10, EF 2.5)', () => {
  const state = graduatedState(2.5, 10);

  it('Hard -> 12', () => {
    expect(sm2Scheduler.review(state, 'hard').interval).toBe(12);
  });

  it('Good -> 25', () => {
    expect(sm2Scheduler.review(state, 'good').interval).toBe(25);
  });

  it('Easy -> 33', () => {
    expect(sm2Scheduler.review(state, 'easy').interval).toBe(33);
  });
});

describe('sm2Scheduler — new card (repetitions 0)', () => {
  const newCard: SchedulerState = { easeFactor: 2.5, interval: 0, repetitions: 0 };

  it('Easy graduates straight to 4 days', () => {
    const next = sm2Scheduler.review(newCard, 'easy');
    expect(next.interval).toBe(4);
    expect(next.repetitions).toBe(1);
  });

  it('Good graduates to 1 day', () => {
    expect(sm2Scheduler.review(newCard, 'good').interval).toBe(1);
  });

  it('Hard graduates to 1 day (same as Good — no multiplier applies to new cards)', () => {
    expect(sm2Scheduler.review(newCard, 'hard').interval).toBe(1);
  });

  it('Again keeps interval at 1 and repetitions at 0', () => {
    const next = sm2Scheduler.review(newCard, 'again');
    expect(next.interval).toBe(1);
    expect(next.repetitions).toBe(0);
  });
});

describe('sm2Scheduler — second review (repetitions 1)', () => {
  // Pseudocode checks repetitions === 1 before considering q, so every
  // recalled rating collapses to interval 6 here — Hard/Good/Easy don't
  // diverge until the review after this one.
  const secondReview: SchedulerState = { easeFactor: 2.5, interval: 1, repetitions: 1 };

  it.each(['hard', 'good', 'easy'] as const)('%s -> interval 6', (rating) => {
    expect(sm2Scheduler.review(secondReview, rating).interval).toBe(6);
  });
});

describe('sm2Scheduler — lapse (Again)', () => {
  it('resets repetitions to 0 and interval to 1 from any prior state', () => {
    const matureState = graduatedState(2.8, 90);
    const next = sm2Scheduler.review(matureState, 'again');
    expect(next.repetitions).toBe(0);
    expect(next.interval).toBe(1);
  });
});

describe('sm2Scheduler — ease factor', () => {
  it('never drops below the 1.3 floor, even under repeated lapses', () => {
    let state: SchedulerState = { easeFactor: 2.5, interval: 10, repetitions: 3 };
    for (let i = 0; i < 20; i++) {
      state = sm2Scheduler.review(state, 'again');
    }
    expect(state.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('Good (q=4) leaves EF unchanged — the SM-2 default-correct response', () => {
    const state = graduatedState(2.5);
    expect(sm2Scheduler.review(state, 'good').easeFactor).toBeCloseTo(2.5, 10);
  });

  it('Easy (q=5) increases EF by exactly 0.1', () => {
    const state = graduatedState(2.5);
    expect(sm2Scheduler.review(state, 'easy').easeFactor).toBeCloseTo(2.6, 10);
  });

  it('Hard (q=3) decreases EF by 0.14', () => {
    const state = graduatedState(2.5);
    expect(sm2Scheduler.review(state, 'hard').easeFactor).toBeCloseTo(2.36, 10);
  });

  it('Again (q=0) decreases EF by 0.8', () => {
    const state = graduatedState(2.5);
    expect(sm2Scheduler.review(state, 'again').easeFactor).toBeCloseTo(1.7, 10);
  });
});
