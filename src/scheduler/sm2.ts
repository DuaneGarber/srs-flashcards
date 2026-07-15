export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface SchedulerState {
  easeFactor: number; // EF
  interval: number; // days
  repetitions: number; // n
}

export interface Scheduler {
  // pure: given current state + rating, return next state (interval in days)
  review(state: SchedulerState, rating: Rating): SchedulerState;
}

const HARD_MULTIPLIER = 1.2;
const EASY_BONUS = 1.3;
const EASY_GRADUATE = 4; // days
const MIN_EASE_FACTOR = 1.3;

// SM-2 quality scores, mapped from the 4 review buttons — §4.1.
const QUALITY: Record<Rating, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
};

export const sm2Scheduler: Scheduler = {
  review(state, rating) {
    const q = QUALITY[rating];
    const { easeFactor, interval, repetitions } = state;

    let nextInterval: number;
    let nextRepetitions: number;

    if (q < 3) {
      // lapse (Again)
      nextRepetitions = 0;
      nextInterval = 1;
    } else {
      if (repetitions === 0) {
        nextInterval = q === 5 ? EASY_GRADUATE : 1;
      } else if (repetitions === 1) {
        nextInterval = 6;
      } else if (q === 3) {
        // Hard
        nextInterval = Math.round(interval * HARD_MULTIPLIER);
      } else if (q === 4) {
        // Good
        nextInterval = Math.round(interval * easeFactor);
      } else {
        // Easy
        nextInterval = Math.round(interval * easeFactor * EASY_BONUS);
      }
      nextRepetitions = repetitions + 1;
    }

    // EF always updates (using the pre-update easeFactor above), then clamps.
    const nextEaseFactor = Math.max(
      MIN_EASE_FACTOR,
      easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    );

    return {
      easeFactor: nextEaseFactor,
      interval: nextInterval,
      repetitions: nextRepetitions,
    };
  },
};
