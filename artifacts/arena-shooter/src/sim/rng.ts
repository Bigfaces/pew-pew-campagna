// ================================================================
// SEEDED PRNG (mulberry32)
// ================================================================
// The prototype called Math.random() directly inside the simulation
// — for bot aim spread, patrol targets and spawn shuffling. That
// makes a match impossible to reproduce, impossible to unit-test
// against a known outcome, and impossible to hand off between peers.
//
// Every random draw in the simulation now goes through this, with the
// state living in WorldState so it travels inside a snapshot.
// ================================================================

/** Advances `state` and returns the next value in [0, 1).
 *  Returned as a tuple because the caller owns the state — keeping
 *  this function itself pure. */
export function nextRandom(state: number): [value: number, nextState: number] {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, t | 0];
}

/** Mutable cursor over the PRNG stream.
 *
 *  Simulation code takes one of these, draws from it, and the World
 *  writes the final state back into WorldState at the end of the
 *  tick. This keeps call sites readable without leaking a global. */
export class Rng {
  constructor(public state: number) {}

  /** Next float in [0, 1). */
  next(): number {
    const [v, s] = nextRandom(this.state);
    this.state = s;
    return v;
  }

  /** Next float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Next integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Symmetric spread in [-half, +half). */
  spread(half: number): number {
    return (this.next() - 0.5) * 2 * half;
  }

  /** In-place Fisher-Yates. Deterministic given the same state. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }
}
