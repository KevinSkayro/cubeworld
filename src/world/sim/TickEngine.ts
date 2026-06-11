// A small fixed-rate tick engine — the shared heartbeat for anything dynamic.
//
// Water flow is its first consumer, but it's deliberately general: the same
// engine drives scheduled block updates (water now; crop growth, grass spread,
// leaf decay later) and a per-tick hook (the day/night clock, random ticks).
//
// `advance(dt)` converts real elapsed seconds into whole game ticks at a fixed
// rate (so behaviour is frame-rate independent), capped per call to avoid a
// "spiral of death" if the page stalls.

const MAX_TICKS_PER_ADVANCE = 5;

export class TickEngine {
  private readonly secondsPerTick: number;
  private accumulator = 0;
  private tick = 0;

  // Scheduled block updates: due-tick -> set of "x,y,z" keys, plus a flat set of
  // everything pending so re-scheduling the same cell coalesces.
  private readonly buckets = new Map<number, Set<string>>();
  private readonly pending = new Set<string>();

  /** Called for each due block update (decoded coords). */
  onBlockUpdate?: (x: number, y: number, z: number) => void;
  /** Called once per tick (e.g. world time, random ticks). */
  onTick?: (tick: number) => void;

  constructor(ticksPerSecond = 1) {
    this.secondsPerTick = 1 / ticksPerSecond;
  }

  get currentTick(): number {
    return this.tick;
  }

  /** Queue a block update `delayTicks` from now (deduped per cell). */
  scheduleBlockUpdate(x: number, y: number, z: number, delayTicks = 1): void {
    const key = `${x},${y},${z}`;
    if (this.pending.has(key)) return; // already queued — coalesce
    const due = this.tick + Math.max(1, delayTicks);
    let bucket = this.buckets.get(due);
    if (!bucket) {
      bucket = new Set();
      this.buckets.set(due, bucket);
    }
    bucket.add(key);
    this.pending.add(key);
  }

  /** Advance by real seconds, running whole ticks at the fixed rate. */
  advance(dtSeconds: number): void {
    if (dtSeconds > 0) this.accumulator += dtSeconds;
    // Small epsilon so floating-point sums (e.g. 0.1*3 !== 0.3) don't drop a
    // tick exactly on a boundary.
    const threshold = this.secondsPerTick - 1e-9;
    let ran = 0;
    while (this.accumulator >= threshold && ran < MAX_TICKS_PER_ADVANCE) {
      this.accumulator -= this.secondsPerTick;
      this.runTick();
      ran++;
    }
    // Drop any backlog beyond the cap so we never freeze catching up.
    if (this.accumulator > this.secondsPerTick) this.accumulator = 0;
  }

  private runTick(): void {
    this.tick++;
    const bucket = this.buckets.get(this.tick);
    if (bucket) {
      this.buckets.delete(this.tick);
      // Snapshot: updates scheduled during this tick land in a later bucket.
      for (const key of bucket) {
        this.pending.delete(key);
        if (this.onBlockUpdate) {
          const [x, y, z] = key.split(",").map(Number);
          this.onBlockUpdate(x, y, z);
        }
      }
    }
    this.onTick?.(this.tick);
  }
}
