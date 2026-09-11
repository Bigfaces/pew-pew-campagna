// ================================================================
// NETCODE TESTS
// ================================================================
// Prediction, reconciliation and interpolation are the parts of
// multiplayer that fail subtly — a stale packet applied in the wrong
// order looks like lag, not like a bug. Keeping them as pure data
// structures means they can be driven with a synthetic packet stream
// instead of two real browsers.
// ================================================================

import { describe, expect, it } from 'vitest';

import { PLAYER_SPEED, TILE } from '../sim/constants';
import { emptyInput, type InputState } from '../sim/types';
import { World, type InputMap, type SlotConfig } from '../sim/world';
import {
  applyEntity,
  applyPowerups,
  makeRoomCode,
  packEntity,
  packPowerups,
  PU_BIT_RAPID,
  PU_BIT_SHIELD,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type NetSnapshot,
} from './protocol';
import {
  LatencyTracker,
  PredictionBuffer,
  SnapshotBuffer,
} from './reconcile';

function input(seq: number, over: Partial<InputState> = {}): InputState {
  return { ...emptyInput(), seq, ...over };
}

function snapshot(
  tick: number,
  entities: { i: number; x: number; y: number; a?: number }[],
  ack = 0,
): NetSnapshot {
  return {
    t: 's',
    k: tick,
    q: ack,
    p: 0xff,
    e: entities.map((e) => ({
      i: e.i,
      x: e.x,
      y: e.y,
      a: e.a ?? 0,
      l: true,
      k: 0,
      d: 0,
      c: 0,
      p: 0,
    })),
  };
}

// ----------------------------------------------------------------
describe('PredictionBuffer', () => {
  it('retains inputs the host has not acknowledged', () => {
    const buf = new PredictionBuffer();
    for (let i = 1; i <= 5; i++) buf.record(input(i));

    const pending = buf.acknowledge(3);
    expect(pending.map((p) => p.seq)).toEqual([4, 5]);
    expect(buf.size).toBe(2);
  });

  it('clears completely when everything is acknowledged', () => {
    const buf = new PredictionBuffer();
    for (let i = 1; i <= 4; i++) buf.record(input(i));
    expect(buf.acknowledge(4).length).toBe(0);
  });

  it('ignores an acknowledgement older than what it already dropped', () => {
    // Datagrams arrive out of order, so a stale ack must not
    // resurrect inputs that were already applied.
    const buf = new PredictionBuffer();
    for (let i = 1; i <= 5; i++) buf.record(input(i));
    buf.acknowledge(4);
    const pending = buf.acknowledge(2);
    expect(pending.map((p) => p.seq)).toEqual([5]);
  });

  it('bounds memory when acknowledgements stop arriving', () => {
    const buf = new PredictionBuffer();
    for (let i = 1; i <= 500; i++) buf.record(input(i));
    expect(buf.size).toBeLessThanOrEqual(120);
  });
});

// ----------------------------------------------------------------
describe('prediction against the authoritative simulation', () => {
  const SLOTS: SlotConfig[] = [
    { name: 'HOST', skin: 0, controller: 'local' },
    { name: 'GUEST', skin: 1, controller: 'remote' },
  ];

  it('reaches the same position the host does after replay', () => {
    // The guest runs ahead on its own inputs; the host applies the
    // same inputs later. Replaying the unacknowledged tail on top of
    // the host's correction must converge on the host's answer.
    const host = new World(SLOTS, 4242);
    const guest = new World(SLOTS, 4242);

    const guestId = 1;
    const inputs: InputState[] = [];
    for (let i = 1; i <= 10; i++) {
      inputs.push(input(i, { forward: 1, aimAngle: 0 }));
    }

    // Guest predicts all ten ticks immediately.
    const buf = new PredictionBuffer();
    for (const inp of inputs) {
      buf.record(inp);
      guest.step({ [guestId]: inp });
    }

    // Host has only processed the first six.
    for (let i = 0; i < 6; i++) {
      host.step({ [guestId]: inputs[i]! });
    }

    // Correction arrives: snap to authoritative, replay the rest.
    const authoritative = host.byId(guestId)!;
    const local = guest.byId(guestId)!;
    applyEntity(local, packEntity(authoritative));

    const replay = buf.acknowledge(6);
    expect(replay.map((r) => r.seq)).toEqual([7, 8, 9, 10]);
    for (const inp of replay) {
      guest.step({ [guestId]: inp });
    }

    // Host eventually catches up to the same inputs.
    for (let i = 6; i < 10; i++) {
      host.step({ [guestId]: inputs[i]! });
    }

    // Positions are quantized to 1/8 px on the wire, so allow that.
    expect(guest.byId(guestId)!.x).toBeCloseTo(host.byId(guestId)!.x, 1);
    expect(guest.byId(guestId)!.y).toBeCloseTo(host.byId(guestId)!.y, 1);
  });

  it('corrects a guest that mispredicted into a wall', () => {
    const host = new World(SLOTS, 11);
    const guest = new World(SLOTS, 11);
    const id = 1;

    // Drag the guest's local copy somewhere the host never agreed to.
    const local = guest.byId(id)!;
    local.x += TILE * 5;
    local.y += TILE * 3;

    applyEntity(local, packEntity(host.byId(id)!));

    expect(local.x).toBeCloseTo(host.byId(id)!.x, 1);
    expect(local.y).toBeCloseTo(host.byId(id)!.y, 1);
  });

  it('keeps a predicted move within one tick of the authoritative one', () => {
    const host = new World(SLOTS, 99);
    const inp: InputMap = { 1: input(1, { forward: 1, aimAngle: 0 }) };
    const before = host.byId(1)!.x;
    host.step(inp);
    const moved = host.byId(1)!.x - before;
    // Guests predict with the identical constant, so any drift here
    // would compound every single tick.
    expect(Math.abs(moved)).toBeLessThanOrEqual(PLAYER_SPEED + 1e-6);
  });
});

// ----------------------------------------------------------------
describe('SnapshotBuffer', () => {
  it('interpolates halfway between two snapshots', () => {
    const buf = new SnapshotBuffer();
    buf.push(snapshot(1, [{ i: 0, x: 0, y: 0 }]), 1000);
    buf.push(snapshot(2, [{ i: 0, x: 100, y: 50 }]), 1100);

    // Render 100 ms behind: target 1050, exactly between the two.
    const out = buf.sample(1150, 100)!;
    expect(out[0]!.x).toBeCloseTo(50, 4);
    expect(out[0]!.y).toBeCloseTo(25, 4);
  });

  it('discards a snapshot that arrives out of order', () => {
    // Unreliable transport reorders packets; applying an older tick
    // after a newer one would visibly rewind every remote player.
    const buf = new SnapshotBuffer();
    buf.push(snapshot(5, [{ i: 0, x: 100, y: 0 }]), 1000);
    buf.push(snapshot(3, [{ i: 0, x: 0, y: 0 }]), 1010);

    expect(buf.length).toBe(1);
    expect(buf.latest!.k).toBe(5);
  });

  it('holds the last pose when the stream stalls instead of extrapolating', () => {
    const buf = new SnapshotBuffer();
    buf.push(snapshot(1, [{ i: 0, x: 0, y: 0 }]), 1000);
    buf.push(snapshot(2, [{ i: 0, x: 100, y: 0 }]), 1100);

    // Far beyond the newest snapshot: a guess would send the entity
    // sliding through walls.
    const out = buf.sample(5000, 100)!;
    expect(out[0]!.x).toBe(100);
  });

  it('returns null before any snapshot has arrived', () => {
    expect(new SnapshotBuffer().sample(1000)).toBeNull();
  });

  it('takes the shortest path across the angle wrap', () => {
    const buf = new SnapshotBuffer();
    buf.push(snapshot(1, [{ i: 0, x: 0, y: 0, a: 3.0 }]), 1000);
    buf.push(snapshot(2, [{ i: 0, x: 0, y: 0, a: -3.0 }]), 1100);

    const out = buf.sample(1150, 100)!;
    // Going the short way crosses PI, not through zero.
    expect(Math.abs(out[0]!.angle)).toBeGreaterThan(3.0);
  });

  it('shows a newly joined entity at its known position', () => {
    const buf = new SnapshotBuffer();
    buf.push(snapshot(1, [{ i: 0, x: 0, y: 0 }]), 1000);
    buf.push(
      snapshot(2, [
        { i: 0, x: 10, y: 0 },
        { i: 7, x: 500, y: 500 },
      ]),
      1100,
    );

    const out = buf.sample(1150, 100)!;
    const joiner = out.find((e) => e.id === 7)!;
    expect(joiner.x).toBe(500);
    expect(joiner.y).toBe(500);
  });

  it('bounds its capacity', () => {
    const buf = new SnapshotBuffer(8);
    for (let i = 1; i <= 40; i++) {
      buf.push(snapshot(i, [{ i: 0, x: i, y: 0 }]), 1000 + i * 50);
    }
    expect(buf.length).toBe(8);
  });
});

// ----------------------------------------------------------------
describe('wire format', () => {
  it('round-trips an entity through pack and apply', () => {
    const w = new World(
      [
        { name: 'A', skin: 0, controller: 'local' },
        { name: 'B', skin: 1, controller: 'remote' },
      ],
      7,
    );
    const src = w.byId(0)!;
    src.x = 123.456;
    src.y = 654.321;
    src.angle = 1.2345;
    src.kills = 4;
    src.deaths = 2;
    src.shieldActive = true;
    src.rapidFireTimer = 3000;

    const dst = w.byId(1)!;
    applyEntity(dst, packEntity(src));

    // Positions are quantized to 1/8 px on the wire, so the error is
    // bounded by half a step rather than by a decimal place.
    expect(Math.abs(dst.x - src.x)).toBeLessThanOrEqual(1 / 8);
    expect(Math.abs(dst.y - src.y)).toBeLessThanOrEqual(1 / 8);
    // Angles are quantized to 1/1000 rad.
    expect(Math.abs(dst.angle - src.angle)).toBeLessThanOrEqual(1 / 1000);
    expect(dst.kills).toBe(4);
    expect(dst.deaths).toBe(2);
    expect(dst.shieldActive).toBe(true);
    expect(dst.rapidFireTimer).toBeGreaterThan(0);
  });

  it('packs power-up flags into a bitfield', () => {
    const w = new World([{ name: 'A', skin: 0, controller: 'local' }], 1);
    const e = w.byId(0)!;
    e.shieldActive = true;
    e.rapidFireTimer = 100;
    e.speedBoostTimer = 0;

    const packed = packEntity(e);
    expect(packed.p & PU_BIT_SHIELD).toBeTruthy();
    expect(packed.p & PU_BIT_RAPID).toBeTruthy();
    expect(packed.p & 4).toBeFalsy();
  });

  it('round-trips power-up availability', () => {
    const w = new World([{ name: 'A', skin: 0, controller: 'local' }], 1);
    w.state.powerups[0]!.active = false;
    w.state.powerups[3]!.active = false;

    const mask = packPowerups(w.state.powerups);
    for (const pu of w.state.powerups) pu.active = true;
    applyPowerups(w.state.powerups, mask);

    expect(w.state.powerups[0]!.active).toBe(false);
    expect(w.state.powerups[1]!.active).toBe(true);
    expect(w.state.powerups[3]!.active).toBe(false);
  });

  it('keeps a snapshot small enough for one datagram', () => {
    // Data channels fragment above roughly 1200 bytes; staying under
    // it keeps a snapshot to a single packet, so partial loss cannot
    // corrupt a frame.
    const slots: SlotConfig[] = Array.from({ length: 8 }, (_, i) => ({
      name: `PLAYER${i}`,
      skin: i,
      controller: i === 0 ? ('local' as const) : ('bot' as const),
    }));
    const w = new World(slots, 5);
    for (let i = 0; i < 120; i++) w.step();

    const snap: NetSnapshot = {
      t: 's',
      k: w.state.tick,
      q: 999,
      p: packPowerups(w.state.powerups),
      e: w.entities.map(packEntity),
    };

    const bytes = new TextEncoder().encode(JSON.stringify(snap)).length;
    expect(bytes).toBeLessThan(1200);
  });
});

// ----------------------------------------------------------------
describe('room codes', () => {
  it('uses only unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code.length).toBe(ROOM_CODE_LENGTH);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
    // Characters people misread when reading a code aloud.
    for (const ch of ['O', '0', 'I', '1']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    }
  });
});

describe('LatencyTracker', () => {
  it('reports the median so one spike cannot move the ping', () => {
    const lt = new LatencyTracker();
    for (const v of [40, 42, 38, 41, 4000]) lt.add(v);
    expect(lt.median).toBeLessThan(60);
  });

  it('reports zero before any sample', () => {
    expect(new LatencyTracker().median).toBe(0);
  });
});
