// The world clock: a continuous time-of-day driven by real elapsed seconds.
//
// Time scale: 1 real minute = 1 in-game hour, so a full day is 24 real minutes
// (DAY_LENGTH_SECONDS). The clock wraps every day and exposes the current hour
// as a float in [0, 24). It starts in the morning so the player spawns into
// daylight.
//
// Deliberately tiny and side-effect-free: `advance(dt)` is the only mutation and
// `hours` is the only output. The sky/lighting (render/Sky.ts) and the F3 HUD
// read `hours`; nothing here touches Three.js or the DOM.

export const DAY_LENGTH_SECONDS = 24 * 60; // 24 real minutes per in-game day
const HOURS_PER_SECOND = 24 / DAY_LENGTH_SECONDS;

const START_HOUR = 8; // a clear morning

export class TimeOfDay {
  /** Current in-game hour in [0, 24). */
  hours = START_HOUR;

  /** Advance the clock by real elapsed seconds, wrapping at 24h. */
  advance(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    this.hours = (this.hours + dtSeconds * HOURS_PER_SECOND) % 24;
  }

  /** Fraction through the day in [0, 1) (0 = midnight, 0.5 = noon). */
  get dayFraction(): number {
    return this.hours / 24;
  }

  /** "HH:MM" label for the HUD. */
  get label(): string {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }
}
