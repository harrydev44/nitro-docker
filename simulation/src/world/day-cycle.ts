/**
 * Day cycle system — gives the hotel a natural rhythm.
 *
 * 1 full day = 600 ticks (~15 minutes at 1.5s/tick)
 *
 * Periods:
 *   morning   (tick 0-149):   Work rooms busy, agents productive
 *   afternoon (tick 150-299): Trade peaks, social activity rises
 *   evening   (tick 300-449): Hangouts peak, parties start, most social
 *   night     (tick 450-599): Chill, low activity, some late-night parties
 */

export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

const DAY_LENGTH = 600;

export function getDayPeriod(tick: number): DayPeriod {
  const dayTick = tick % DAY_LENGTH;
  if (dayTick < 150) return 'morning';
  if (dayTick < 300) return 'afternoon';
  if (dayTick < 450) return 'evening';
  return 'night';
}

export function getDayProgress(tick: number): number {
  return (tick % DAY_LENGTH) / DAY_LENGTH;
}

// Action score multipliers per period
// Values > 1.0 boost, < 1.0 dampen
interface PeriodModifiers {
  work: number;
  trade: number;
  chat: number;
  move: number;
  host_party: number;
  decorate: number;
  drama: number;
}

const PERIOD_MODIFIERS: Record<DayPeriod, PeriodModifiers> = {
  morning: {
    work: 1.5,        // peak work time
    trade: 0.8,
    chat: 0.7,
    move: 1.0,
    host_party: 0.3,  // no morning parties
    decorate: 1.2,
    drama: 0.5,
  },
  afternoon: {
    work: 1.0,
    trade: 1.5,       // peak trade time
    chat: 1.0,
    move: 1.2,        // people moving around
    host_party: 0.6,
    decorate: 1.0,
    drama: 0.8,
  },
  evening: {
    work: 0.5,        // people going home
    trade: 0.8,
    chat: 1.5,        // peak social time
    move: 1.3,        // everyone going out
    host_party: 1.8,  // prime party time
    decorate: 0.6,
    drama: 1.5,       // emotions run high
  },
  night: {
    work: 0.3,        // almost no one works
    trade: 0.4,
    chat: 1.2,        // late-night conversations
    move: 0.7,        // people settling in
    host_party: 1.3,  // late parties still happen
    decorate: 0.4,
    drama: 1.2,
  },
};

/**
 * Get the score multiplier for an action during the current time period.
 */
export function getTimeMultiplier(tick: number, action: string): number {
  const period = getDayPeriod(tick);
  const mods = PERIOD_MODIFIERS[period];
  return (mods as any)[action] ?? 1.0;
}
