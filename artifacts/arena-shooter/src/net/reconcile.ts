// ================================================================
// CLIENT-SIDE PREDICTION & ENTITY INTERPOLATION
// ================================================================
// A guest cannot wait for the host to confirm its movement — at 60 ms
// round trip that is four ticks of input lag on every keypress. So it
// applies its own input immediately (prediction) and corrects when
// the authoritative state arrives (reconciliation).
//
// Other players are handled the opposite way. Their positions are
// only known at snapshot rate and always in the past, so they are
// rendered on a deliberate delay and interpolated between the two
// snapshots straddling that point. Extrapolating instead would make
// them rubber-band every time someone changed direction.
//
// Both classes here are pure data structures with no WebRTC, DOM or
// timer dependency, which is what makes the netcode testable without
// two browsers.
// ================================================================

import type { InputState } from '../sim/types';
import type { NetEntity, NetSnapshot } from './protocol';

/** How far behind the newest snapshot remote entities are rendered.
 *  Must exceed the snapshot interval, or the buffer runs dry between
 *  packets and motion stutters. */
export const INTERP_DELAY_MS = 100;

/** Inputs kept awaiting acknowledgement. At 60 Hz this is two
 *  seconds — far beyond any round trip worth predicting through. */
const MAX_PENDING = 120;

/** Holds inputs the host has not yet confirmed, so they can be
 *  re-applied on top of a correction. */
export class PredictionBuffer {
  private pending: InputState[] = [];

  get size(): number {
    return this.pending.length;
  }

  record(input: InputState): void {
    this.pending.push(input);
    // Bound the buffer: if acknowledgements stop arriving the
    // connection is already broken, and growing without limit would
    // turn that into a memory leak.
    if (this.pending.length > MAX_PENDING) {
      this.pending.splice(0, this.pending.length - MAX_PENDING);
    }
  }

  /** Drop everything the host has applied and return what remains,
   *  in order, for replay against the corrected state. */
  acknowledge(seq: number): readonly InputState[] {
    let cut = 0;
    while (cut < this.pending.length && this.pending[cut]!.seq <= seq) cut++;
    if (cut > 0) this.pending.splice(0, cut);
    return this.pending;
  }

  clear(): void {
    this.pending.length = 0;
  }
}

interface TimedSnapshot {
  snap: NetSnapshot;
  /** Local clock time at which this snapshot arrived. */
  at: number;
}

export interface InterpolatedEntity {
  id: number;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  kills: number;
  deaths: number;
  weaponCooldown: number;
  powerBits: number;
}

/** Shortest-path angle interpolation. Lerping raw radians makes a
 *  player spin the long way round whenever they cross +/-PI. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Ring of recent snapshots, sampled on a delay to smooth remote
 *  players between packets. */
export class SnapshotBuffer {
  private buf: TimedSnapshot[] = [];
  private capacity: number;

  constructor(capacity = 24) {
    this.capacity = capacity;
  }

  get length(): number {
    return this.buf.length;
  }

  get latest(): NetSnapshot | null {
    return this.buf.length ? this.buf[this.buf.length - 1]!.snap : null;
  }

  push(snap: NetSnapshot, at: number): void {
    // Datagrams are unordered, so a stale snapshot can arrive after a
    // newer one. Dropping it is correct — reordering would rewind
    // every remote player for a frame.
    const last = this.buf[this.buf.length - 1];
    if (last && snap.k <= last.snap.k) return;

    this.buf.push({ snap, at });
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  clear(): void {
    this.buf.length = 0;
  }

  /** Positions at `now - delay`, interpolated between the bracketing
   *  snapshots. Returns null until two snapshots have arrived. */
  sample(now: number, delay = INTERP_DELAY_MS): InterpolatedEntity[] | null {
    if (this.buf.length === 0) return null;
    if (this.buf.length === 1) return toEntities(this.buf[0]!.snap);

    const target = now - delay;

    // Newest snapshot is already older than the target: the stream
    // has stalled, so hold the last known pose rather than
    // extrapolating into a guess.
    const newest = this.buf[this.buf.length - 1]!;
    if (target >= newest.at) return toEntities(newest.snap);

    const oldest = this.buf[0]!;
    if (target <= oldest.at) return toEntities(oldest.snap);

    for (let i = this.buf.length - 1; i > 0; i--) {
      const b = this.buf[i]!;
      const a = this.buf[i - 1]!;
      if (target >= a.at && target <= b.at) {
        const span = b.at - a.at;
        const t = span <= 0 ? 1 : (target - a.at) / span;
        return blend(a.snap, b.snap, t);
      }
    }
    return toEntities(newest.snap);
  }
}

function fromNet(e: NetEntity): InterpolatedEntity {
  return {
    id: e.i,
    x: e.x,
    y: e.y,
    angle: e.a,
    alive: e.l,
    kills: e.k,
    deaths: e.d,
    weaponCooldown: e.c,
    powerBits: e.p,
  };
}

function toEntities(s: NetSnapshot): InterpolatedEntity[] {
  return s.e.map(fromNet);
}

function blend(
  a: NetSnapshot,
  b: NetSnapshot,
  t: number,
): InterpolatedEntity[] {
  const byId = new Map<number, NetEntity>();
  for (const e of a.e) byId.set(e.i, e);

  return b.e.map((eb) => {
    const ea = byId.get(eb.i);
    // An entity absent from the older snapshot just joined; there is
    // nothing to blend from, so show it at its known position.
    if (!ea) return fromNet(eb);
    return {
      id: eb.i,
      x: ea.x + (eb.x - ea.x) * t,
      y: ea.y + (eb.y - ea.y) * t,
      angle: lerpAngle(ea.a, eb.a, t),
      // Discrete state snaps to the newer snapshot: interpolating
      // "alive" or a kill count is meaningless.
      alive: eb.l,
      kills: eb.k,
      deaths: eb.d,
      weaponCooldown: eb.c,
      powerBits: eb.p,
    };
  });
}

/** Rolling round-trip estimate, used to show a ping and to size the
 *  interpolation delay on bad connections. */
export class LatencyTracker {
  private samples: number[] = [];
  private capacity = 16;

  add(rttMs: number): void {
    this.samples.push(rttMs);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  /** Median rather than mean: a single 400 ms spike should not move
   *  the reported ping. */
  get median(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  clear(): void {
    this.samples.length = 0;
  }
}
