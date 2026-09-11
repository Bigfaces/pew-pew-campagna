// ================================================================
// SIMULATION TESTS
// ================================================================
// Each test here pins down one behaviour the prototype got wrong.
// They run headless because the simulation has no DOM dependency —
// that separation is what makes this file possible at all.
// ================================================================

import { describe, expect, it } from 'vitest';

import {
  BOT_HALF_FOV,
  BOT_TUNING,
  BULLET_COOLDOWN,
  DIFFICULTIES,
  ENTITY_RADIUS,
  MATCH_TIME_TICKS,
  PLAYER_SPEED,
  SENS_MAX,
  SENS_MIN,
  TICK_MS,
  TILE,
  WIN_KILLS,
  clampSensitivity,
  killTarget,
  type Difficulty,
} from './constants';
import { isSolid } from './map';
import { circleHitsTile, hitscan } from './physics';
import { angleDelta, castRay, hasLOS } from './raycast';
import { Rng } from './rng';
import { emptyInput, type InputState } from './types';
import { World, type InputMap, type SlotConfig } from './world';

const SLOTS: SlotConfig[] = [
  { name: 'P1', skin: 0, controller: 'local' },
  { name: 'P2', skin: 1, controller: 'local' },
];

function input(over: Partial<InputState> = {}): InputState {
  return { ...emptyInput(), ...over };
}

/** Place an entity at an explicit spot facing an explicit way. */
function place(
  w: World,
  id: number,
  x: number,
  y: number,
  angle = 0,
): void {
  const e = w.byId(id)!;
  e.x = x;
  e.y = y;
  e.angle = angle;
  e.alive = true;
  e.weaponCooldown = 0;
}

/** A floor tile with at least `pad` clear tiles either side along the
 *  X axis, so tests can place two entities in a mutual line of sight.
 *  Derived from the map rather than hard-coded, so editing the arena
 *  cannot silently invalidate the tests. */
function openSpot(pad = 3): { x: number; y: number } {
  for (let ty = 2; ty < 26; ty++) {
    for (let tx = 2 + pad; tx < 36 - pad; tx++) {
      let clear = true;
      // The whole horizontal run must be open, and one tile above and
      // below too, so a slightly offset shot still has a clear lane.
      for (let d = -pad; d <= pad && clear; d++) {
        if (isSolid(tx + d, ty) || isSolid(tx + d, ty - 1) || isSolid(tx + d, ty + 1)) {
          clear = false;
        }
      }
      if (!clear) continue;
      const x = (tx + 0.5) * TILE;
      const y = (ty + 0.5) * TILE;
      if (!circleHitsTile(x, y, TILE)) return { x, y };
    }
  }
  throw new Error('no open spot in map');
}

// ----------------------------------------------------------------
describe('fixed timestep', () => {
  it('moves the same distance per tick regardless of how ticks are grouped', () => {
    // The prototype scaled movement by nothing, so a 144 Hz display
    // advanced the player 2.4x further per second than a 60 Hz one.
    const spot = openSpot();

    const run = (ticks: number) => {
      const w = new World(SLOTS, 42);
      place(w, 0, spot.x, spot.y, 0);
      const inputs: InputMap = { 0: input({ forward: 1, aimAngle: 0 }) };
      for (let i = 0; i < ticks; i++) w.step(inputs);
      return w.byId(0)!.x - spot.x;
    };

    // 60 ticks is one simulated second whether the host managed 60
    // frames or 6 — the loop decides how many ticks to run, never
    // how far each one moves.
    expect(run(10)).toBeCloseTo(PLAYER_SPEED * 10, 5);
    expect(run(60)).toBeCloseTo(PLAYER_SPEED * 60, 5);
  });

  it('does not let diagonal movement outrun straight movement', () => {
    const spot = openSpot();
    const w = new World(SLOTS, 1);
    place(w, 0, spot.x, spot.y, 0);

    for (let i = 0; i < 5; i++) {
      w.step({ 0: input({ forward: 1, strafe: 1, aimAngle: 0 }) });
    }
    const e = w.byId(0)!;
    const travelled = Math.hypot(e.x - spot.x, e.y - spot.y);
    expect(travelled).toBeLessThanOrEqual(PLAYER_SPEED * 5 + 1e-6);
  });
});

// ----------------------------------------------------------------
describe('determinism', () => {
  it('produces identical state from the same seed and inputs', () => {
    // Required for netcode: a guest predicting locally must reach the
    // same state the host does, and Math.random() in the simulation
    // made that impossible.
    const build = () => {
      const w = new World(
        [
          { name: 'P', skin: 0, controller: 'local' },
          { name: 'B1', skin: 1, controller: 'bot' },
          { name: 'B2', skin: 2, controller: 'bot' },
        ],
        12345,
      );
      for (let i = 0; i < 400; i++) {
        w.step({ 0: input({ forward: 1, aimAngle: i * 0.01 }) });
      }
      return w.state;
    };

    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('diverges when the seed differs', () => {
    const build = (seed: number) => {
      const w = new World(
        [
          { name: 'B1', skin: 0, controller: 'bot' },
          { name: 'B2', skin: 1, controller: 'bot' },
        ],
        seed,
      );
      for (let i = 0; i < 300; i++) w.step();
      return JSON.stringify(w.state);
    };
    expect(build(1)).not.toBe(build(2));
  });

  it('serializes to JSON without loss', () => {
    // Snapshots go over a data channel; an object reference anywhere
    // in the state would silently break multiplayer.
    const w = new World(SLOTS, 7);
    for (let i = 0; i < 50; i++) w.step();
    const round = JSON.parse(JSON.stringify(w.state));
    expect(round).toEqual(w.state);
  });
});

// ----------------------------------------------------------------
describe('bot vision', () => {
  it('cannot see a target behind it', () => {
    // The prototype checked line-of-sight only, so bots had 360°
    // awareness and shot players in the back without ever turning.
    const w = new World(
      [
        { name: 'BOT', skin: 0, controller: 'bot' },
        { name: 'P', skin: 1, controller: 'local' },
      ],
      3,
    );
    const spot = openSpot();
    // Bot faces +X; the player stands directly behind it at -X.
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x - TILE * 2, spot.y, 0);

    w.step({ 1: input({ aimAngle: 0 }) });

    const bot = w.byId(0)!;
    // Unobstructed line, but outside the view cone.
    expect(hasLOS(bot.x, bot.y, w.byId(1)!.x, w.byId(1)!.y)).toBe(true);
    expect(bot.botState).not.toBe('aim');
    expect(bot.botTargetId).toBeNull();
  });

  it('sees a target directly in front of it', () => {
    const w = new World(
      [
        { name: 'BOT', skin: 0, controller: 'bot' },
        { name: 'P', skin: 1, controller: 'local' },
      ],
      3,
    );
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, 0);

    w.step({ 1: input({ aimAngle: 0 }) });

    const bot = w.byId(0)!;
    expect(bot.botState).toBe('aim');
    expect(bot.botTargetId).toBe(1);
  });

  it('keeps the view cone strictly narrower than a full circle', () => {
    expect(BOT_HALF_FOV).toBeGreaterThan(0);
    expect(BOT_HALF_FOV).toBeLessThan(Math.PI);
  });

  it('turns toward a target gradually rather than snapping', () => {
    const w = new World(
      [
        { name: 'BOT', skin: 0, controller: 'bot' },
        { name: 'P', skin: 1, controller: 'local' },
      ],
      5,
    );
    const spot = openSpot();
    // Target near the edge of the cone, so a snap would be obvious.
    place(w, 0, spot.x, spot.y, 0);
    const bearing = BOT_HALF_FOV * 0.8;
    place(
      w,
      1,
      spot.x + Math.cos(bearing) * TILE * 2,
      spot.y + Math.sin(bearing) * TILE * 2,
    );

    const before = w.byId(0)!.angle;
    w.step({ 1: input({ aimAngle: 0 }) });
    const after = w.byId(0)!.angle;

    const turned = Math.abs(angleDelta(before, after));
    expect(turned).toBeGreaterThan(0);
    // Nowhere near the full offset in a single tick.
    expect(turned).toBeLessThan(bearing);
  });
});

// ----------------------------------------------------------------
describe('shooting', () => {
  it('kills a target in the open with one shot', () => {
    const w = new World(SLOTS, 9);
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);

    const events = w.step({ 0: input({ fire: true, aimAngle: 0 }) });

    expect(w.byId(1)!.alive).toBe(false);
    expect(w.byId(0)!.kills).toBe(1);
    expect(events.some((e) => e.type === 'kill')).toBe(true);
  });

  it('cannot shoot through a solid tile', () => {
    // Find a wall and put shooter and target on opposite sides of it.
    let wallTx = -1;
    let wallTy = -1;
    for (let ty = 2; ty < 25 && wallTx < 0; ty++) {
      for (let tx = 2; tx < 35; tx++) {
        if (isSolid(tx, ty) && !isSolid(tx - 1, ty) && !isSolid(tx + 1, ty)) {
          wallTx = tx;
          wallTy = ty;
          break;
        }
      }
    }
    expect(wallTx).toBeGreaterThan(0);

    const y = (wallTy + 0.5) * TILE;
    const w = new World(SLOTS, 11);
    place(w, 0, (wallTx - 1 + 0.5) * TILE, y, 0);
    place(w, 1, (wallTx + 1 + 0.5) * TILE, y, Math.PI);

    w.step({ 0: input({ fire: true, aimAngle: 0 }) });

    expect(w.byId(1)!.alive).toBe(true);
    expect(w.byId(0)!.kills).toBe(0);
  });

  it('lets a shielded target survive exactly one hit', () => {
    const w = new World(SLOTS, 13);
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);
    w.byId(1)!.shieldActive = true;

    const events = w.step({ 0: input({ fire: true, aimAngle: 0 }) });
    expect(w.byId(1)!.alive).toBe(true);
    expect(w.byId(1)!.shieldActive).toBe(false);
    expect(events.some((e) => e.type === 'shieldBreak')).toBe(true);

    // Second shot, once the bolt has cycled, connects.
    w.byId(0)!.weaponCooldown = 0;
    w.step({ 0: input({ fire: true, aimAngle: 0 }) });
    expect(w.byId(1)!.alive).toBe(false);
  });

  it('enforces the bolt-action cooldown', () => {
    const w = new World(SLOTS, 17);
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);

    w.step({ 0: input({ fire: true, aimAngle: 0 }) });
    expect(w.byId(0)!.shotsFired).toBe(1);

    // Holding the trigger through the cooldown yields no extra shots.
    for (let i = 0; i < 10; i++) {
      w.step({ 0: input({ fire: true, aimAngle: 0 }) });
    }
    expect(w.byId(0)!.shotsFired).toBe(1);

    // ...until the cooldown has fully drained.
    const ticks = Math.ceil(BULLET_COOLDOWN / TICK_MS) + 1;
    for (let i = 0; i < ticks; i++) w.step({});
    w.step({ 0: input({ fire: true, aimAngle: 0 }) });
    expect(w.byId(0)!.shotsFired).toBe(2);
  });

  it('resolves a mutual duel as a trade, not an array-order win', () => {
    // Both fire on the same tick with a clear line to each other.
    // Resolving shot-by-shot would kill the second entity before its
    // trigger was ever read, handing the duel to whoever sat earlier
    // in the array.
    const w = new World(SLOTS, 19);
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);

    w.step({
      0: input({ fire: true, aimAngle: 0 }),
      1: input({ fire: true, aimAngle: Math.PI }),
    });

    expect(w.byId(0)!.alive).toBe(false);
    expect(w.byId(1)!.alive).toBe(false);
    expect(w.byId(0)!.kills).toBe(1);
    expect(w.byId(1)!.kills).toBe(1);
  });

  it('credits a kill only once when two shooters hit the same target', () => {
    const w = new World(
      [
        { name: 'A', skin: 0, controller: 'local' },
        { name: 'B', skin: 1, controller: 'local' },
        { name: 'C', skin: 2, controller: 'local' },
      ],
      23,
    );
    const spot = openSpot();
    // A and B face C from opposite sides, so neither one's line passes
    // through the other — C is the nearest body on both rays.
    place(w, 2, spot.x, spot.y, 0);
    place(w, 0, spot.x - TILE * 2, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);

    w.step({
      0: input({ fire: true, aimAngle: 0 }),
      1: input({ fire: true, aimAngle: Math.PI }),
    });

    const total = w.byId(0)!.kills + w.byId(1)!.kills;
    expect(w.byId(2)!.alive).toBe(false);
    expect(total).toBe(1);
    expect(w.byId(2)!.deaths).toBe(1);
  });
});

// ----------------------------------------------------------------
describe('collision', () => {
  it('never leaves an entity inside a solid tile', () => {
    const w = new World(
      [
        { name: 'B1', skin: 0, controller: 'bot' },
        { name: 'B2', skin: 1, controller: 'bot' },
        { name: 'B3', skin: 2, controller: 'bot' },
        { name: 'B4', skin: 3, controller: 'bot' },
      ],
      31,
    );

    for (let i = 0; i < 1500; i++) {
      w.step();
      for (const e of w.entities) {
        if (!e.alive) continue;
        expect(circleHitsTile(e.x, e.y, 1)).toBe(false);
      }
    }
  });

  it('slides along a wall instead of stopping dead', () => {
    // Walk diagonally into the outer wall: the blocked axis stops but
    // the free one keeps moving.
    const w = new World(SLOTS, 37);
    const y = 1.5 * TILE;
    place(w, 0, 10 * TILE, y, 0);
    const startX = w.byId(0)!.x;

    // Face +X, push forward and strafe into the north wall.
    for (let i = 0; i < 20; i++) {
      w.step({ 0: input({ forward: 1, strafe: -1, aimAngle: 0 }) });
    }

    expect(w.byId(0)!.x).toBeGreaterThan(startX);
    expect(circleHitsTile(w.byId(0)!.x, w.byId(0)!.y, 1)).toBe(false);
  });
});

// ----------------------------------------------------------------
describe('match flow', () => {
  it('ends at the kill target and freezes the world', () => {
    const w = new World(SLOTS, 41);
    const winner = w.byId(0)!;
    winner.kills = WIN_KILLS - 1;

    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);

    const events = w.step({ 0: input({ fire: true, aimAngle: 0 }) });
    expect(events.some((e) => e.type === 'matchEnd')).toBe(true);
    expect(w.state.winnerId).toBe(0);

    // Further steps are inert once the match is decided.
    const tickBefore = w.state.tick;
    w.step({ 0: input({ forward: 1, aimAngle: 0 }) });
    expect(w.state.tick).toBe(tickBefore);
  });

  it('ends the match when the clock runs out and awards it to the leader', () => {
    const w = new World(SLOTS, 71);
    w.byId(1)!.kills = 2;

    // Wind the clock to one tick short rather than simulating five
    // minutes: the condition under test is the tick threshold itself.
    w.state.tick = MATCH_TIME_TICKS - 1;
    expect(w.timeLeftMs).toBeGreaterThan(0);

    const events = w.step({});

    expect(events.some((e) => e.type === 'matchEnd')).toBe(true);
    expect(w.state.winnerId).toBe(1);
    expect(w.timeLeftMs).toBe(0);
  });

  it('breaks a tied timeout by deaths, then by id', () => {
    // Both peers must reach the same winner from the same state, so the
    // tiebreak chain has to be total rather than "whoever is first".
    const byDeaths = new World(SLOTS, 73);
    byDeaths.byId(0)!.kills = 4;
    byDeaths.byId(1)!.kills = 4;
    byDeaths.byId(0)!.deaths = 3;
    byDeaths.byId(1)!.deaths = 1;
    byDeaths.state.tick = MATCH_TIME_TICKS - 1;
    byDeaths.step({});
    expect(byDeaths.state.winnerId).toBe(1);

    const byId = new World(SLOTS, 73);
    byId.byId(0)!.kills = 4;
    byId.byId(1)!.kills = 4;
    byId.state.tick = MATCH_TIME_TICKS - 1;
    byId.step({});
    expect(byId.state.winnerId).toBe(0);
  });

  it('lets a kill on the final tick still decide the match', () => {
    // The clock is checked after shooting, so the last bullet counts.
    const w = new World(SLOTS, 79);
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);
    w.state.tick = MATCH_TIME_TICKS - 1;

    w.step({ 0: input({ fire: true, aimAngle: 0 }) });

    expect(w.byId(0)!.kills).toBe(1);
    expect(w.state.winnerId).toBe(0);
  });

  it('respawns a dead entity away from the killer', () => {
    const w = new World(SLOTS, 43);
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);

    w.step({ 0: input({ fire: true, aimAngle: 0 }) });
    expect(w.byId(1)!.alive).toBe(false);

    // Run past the respawn delay.
    for (let i = 0; i < 200; i++) w.step({});

    const victim = w.byId(1)!;
    expect(victim.alive).toBe(true);
    expect(victim.deaths).toBe(1);
    // Not dropped back on top of the shooter.
    expect(Math.hypot(victim.x - spot.x, victim.y - spot.y)).toBeGreaterThan(
      TILE * 4,
    );
  });

  it('tracks streaks and resets them on death', () => {
    const w = new World(SLOTS, 47);
    const spot = openSpot();

    for (let k = 0; k < 3; k++) {
      place(w, 0, spot.x, spot.y, 0);
      place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);
      w.byId(0)!.weaponCooldown = 0;
      w.step({ 0: input({ fire: true, aimAngle: 0 }) });
    }
    expect(w.byId(0)!.streak).toBe(3);
    expect(w.byId(0)!.bestStreak).toBe(3);

    // Now the other way round.
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);
    w.byId(1)!.weaponCooldown = 0;
    w.step({ 1: input({ fire: true, aimAngle: Math.PI }) });

    expect(w.byId(0)!.alive).toBe(false);
    expect(w.byId(0)!.streak).toBe(0);
    expect(w.byId(0)!.bestStreak).toBe(3);
  });
});

// ----------------------------------------------------------------
describe('difficulty', () => {
  /** Ticks a bot takes to get its first shot off against a stationary
   *  target directly in front of it. */
  function ticksToFire(difficulty: Difficulty): number {
    const w = new World(
      [
        { name: 'BOT', skin: 0, controller: 'bot' },
        { name: 'P', skin: 1, controller: 'local' },
      ],
      5,
      difficulty,
    );
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, 0);

    for (let i = 0; i < 300; i++) {
      const events = w.step({ 1: input({ aimAngle: 0 }) });
      if (events.some((e) => e.type === 'shot')) return i;
    }
    return Infinity;
  }

  it('changes how fast a bot opens fire', () => {
    const hard = ticksToFire('difficile');
    const normal = ticksToFire('normale');
    const easy = ticksToFire('facile');

    expect(hard).toBeLessThan(normal);
    expect(normal).toBeLessThan(easy);
    // All three must actually shoot, or the comparison above is
    // comparing two Infinities.
    expect(easy).toBeLessThan(300);
  });

  it('never lets a bot outrun the player at any level', () => {
    // A bot faster than the player reads as cheating, not difficulty.
    for (const d of DIFFICULTIES) {
      expect(BOT_TUNING[d].speed).toBeLessThan(PLAYER_SPEED);
      expect(BOT_TUNING[d].halfFov).toBeLessThan(Math.PI);
      expect(BOT_TUNING[d].reactionMs).toBeGreaterThan(0);
    }
  });

  it('makes patience part of the difficulty, not a hidden constant', () => {
    // The firing tolerance used to be a fixed 0.12 rad inside the AI.
    // At the ranges the arena produces it was several times the aim
    // error, so it — not the difficulty setting — decided accuracy.
    // Harder bots wait until they are lined up; sloppy ones shoot
    // mid-swing. So the tolerance rises as the difficulty falls.
    let previous = 0;
    for (const d of ['difficile', 'normale', 'facile'] as Difficulty[]) {
      expect(BOT_TUNING[d].fireTolerance).toBeGreaterThan(previous);
      previous = BOT_TUNING[d].fireTolerance;
    }
  });

  it('defaults to the baseline tuning', () => {
    // 'normale' must reproduce the constants the game shipped with, so
    // the default difficulty is not a silent balance change.
    const w = new World(SLOTS, 2);
    expect(w.state.difficulty).toBe('normale');
    expect(BOT_TUNING.normale.halfFov).toBe(BOT_HALF_FOV);
  });

  it('records difficulty in serializable state', () => {
    const w = new World(SLOTS, 3, 'difficile');
    const round = JSON.parse(JSON.stringify(w.state));
    expect(round.difficulty).toBe('difficile');
  });
});

// ----------------------------------------------------------------
describe('bot fire discipline', () => {
  /** Four bots left to their own devices for a while, with every shot
   *  they take recorded. */
  function botFirefight(ticks: number): {
    shots: { dist: number; movedThatTick: number }[];
  } {
    const w = new World(
      [
        { name: 'B1', skin: 0, controller: 'bot' },
        { name: 'B2', skin: 1, controller: 'bot' },
        { name: 'B3', skin: 2, controller: 'bot' },
        { name: 'B4', skin: 3, controller: 'bot' },
      ],
      101,
    );

    const shots: { dist: number; movedThatTick: number }[] = [];
    for (let i = 0; i < ticks; i++) {
      const before = new Map(w.entities.map((e) => [e.id, { x: e.x, y: e.y }]));
      for (const ev of w.step()) {
        if (ev.type !== 'shot') continue;
        const from = before.get(ev.shooterId)!;
        const now = w.byId(ev.shooterId)!;
        shots.push({
          dist: Math.hypot(ev.hitX - ev.x, ev.hitY - ev.y),
          movedThatTick: Math.hypot(now.x - from.x, now.y - from.y),
        });
      }
    }
    return { shots };
  }

  it('does not empty its magazine into the cover it is standing behind', () => {
    // Line of sight is measured centre-to-centre, but the bullet leaves
    // along the angle the bot is actually facing. A bot hugging a crate
    // has a clear centre line past the corner while its firing line
    // clips it — which is where nearly every shot used to go.
    const { shots } = botFirefight(9000);
    expect(shots.length).toBeGreaterThan(20);

    const intoOwnCover = shots.filter((s) => s.dist < TILE).length;
    expect(intoOwnCover / shots.length).toBeLessThan(0.05);
  });

  it('plants its feet on the tick it fires', () => {
    // The firing line is checked from where the bot stands when it
    // decides; movement is applied before any shot is traced. If it
    // moved in between, it would fire from a position it never checked.
    const { shots } = botFirefight(9000);
    for (const s of shots) expect(s.movedThatTick).toBe(0);
  });

  it('keeps its reaction running while a target flickers out of view', () => {
    // Behind cover a target leaves line of sight constantly. Restarting
    // the reaction delay on every flicker meant the countdown never
    // finished and the bot never fired.
    const w = new World(
      [
        { name: 'BOT', skin: 0, controller: 'bot' },
        { name: 'P', skin: 1, controller: 'local' },
      ],
      5,
    );
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, 0);

    // The initial delay carries a random component, so the baseline to
    // compare against is the timer itself once it has started, not the
    // tuning constant.
    w.step({ 1: input({ aimAngle: 0 }) });
    const bot = w.byId(0)!;
    const initial = bot.botReactionTimer;

    for (let i = 0; i < 8; i++) w.step({ 1: input({ aimAngle: 0 }) });
    const partway = bot.botReactionTimer;
    expect(partway).toBeLessThan(initial);
    expect(bot.botState).toBe('aim');

    // Duck out of the view cone for a tick, then step back into it.
    place(w, 1, spot.x - TILE * 2, spot.y, 0);
    w.step({ 1: input({ aimAngle: 0 }) });
    expect(bot.botState).toBe('seek');

    place(w, 1, spot.x + TILE * 2, spot.y, 0);
    w.step({ 1: input({ aimAngle: 0 }) });

    expect(bot.botState).toBe('aim');
    // Picked up where it left off rather than starting over.
    expect(bot.botReactionTimer).toBeLessThanOrEqual(partway);
  });
});

// ----------------------------------------------------------------
describe('kill target', () => {
  it('scales with the roster so match length does not', () => {
    // Total kills in a free-for-all rise faster than the player count,
    // so a fixed target made a 1v1 run out the clock every time while a
    // full lobby was over in under a minute.
    expect(killTarget(2)).toBeLessThan(killTarget(4));
    expect(killTarget(4)).toBeLessThan(killTarget(8));
    expect(killTarget(4)).toBe(WIN_KILLS);
  });

  it('never asks for a target so low the match is a formality', () => {
    expect(killTarget(1)).toBeGreaterThanOrEqual(3);
  });

  it('records the target on the state so every peer plays to the same one', () => {
    const w = new World(SLOTS, 3);
    expect(w.state.killTarget).toBe(killTarget(SLOTS.length));
    const round = JSON.parse(JSON.stringify(w.state));
    expect(round.killTarget).toBe(w.state.killTarget);
  });

  it('ends the match at the roster-scaled target', () => {
    const w = new World(SLOTS, 41);
    const spot = openSpot();
    w.byId(0)!.kills = w.state.killTarget - 1;
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);

    w.step({ 0: input({ fire: true, aimAngle: 0 }) });
    expect(w.state.winnerId).toBe(0);
  });
});

// ----------------------------------------------------------------
describe('hitbox', () => {
  it('is exactly the body, with no padding', () => {
    // Aim here is one-dimensional — pitch is a camera effect and
    // bullets travel on the horizontal — so the one axis that is left
    // has to be worth something. It used to be padded to 1.4x area.
    const w = new World(SLOTS, 61);
    const spot = openSpot();
    const range = TILE * 4;

    const shootWithOffset = (offset: number): boolean => {
      const world = new World(SLOTS, 61);
      place(world, 0, spot.x, spot.y, 0);
      place(world, 1, spot.x + range, spot.y + offset, Math.PI);
      world.step({ 0: input({ fire: true, aimAngle: 0 }) });
      return !world.byId(1)!.alive;
    };

    expect(w).toBeDefined();
    // Dead centre connects; a body-width off does not.
    expect(shootWithOffset(0)).toBe(true);
    expect(shootWithOffset(ENTITY_RADIUS * 0.8)).toBe(true);
    expect(shootWithOffset(ENTITY_RADIUS * 1.2)).toBe(false);
  });
});

// ----------------------------------------------------------------
describe('look sensitivity', () => {
  // The setting is read back from local storage, which is text on the
  // user's disk and therefore arbitrary. The clamp is the only thing
  // between that text and a view that will not turn.
  it('falls back to the default on anything that is not a number', () => {
    expect(clampSensitivity(Number('abc'))).toBe(1); // NaN
    expect(clampSensitivity(Number(undefined))).toBe(1);
    expect(clampSensitivity(Infinity)).toBe(1);
    expect(clampSensitivity(-Infinity)).toBe(1);
  });

  it('holds anything out of range at the ends', () => {
    expect(clampSensitivity(-4)).toBe(SENS_MIN);
    expect(clampSensitivity(1000)).toBe(SENS_MAX);
  });

  it('treats zero as too slow rather than as unset', () => {
    // `Number(null)` is 0, so reading a key that was never written and
    // parsing before checking would land here — and 0.25x is the
    // slowest the game goes, which is a rotten thing to hand someone
    // opening it for the first time. loadConfig tests for null first;
    // this pins down why it has to.
    expect(clampSensitivity(0)).toBe(SENS_MIN);
    expect(clampSensitivity(0)).not.toBe(1);
  });

  it('leaves usable values exactly as given', () => {
    expect(clampSensitivity(1)).toBe(1);
    expect(clampSensitivity(SENS_MIN)).toBe(SENS_MIN);
    expect(clampSensitivity(SENS_MAX)).toBe(SENS_MAX);
    expect(clampSensitivity(1.35)).toBe(1.35);
  });

  it('round-trips through the string form storage keeps it in', () => {
    for (const v of [SENS_MIN, 0.7, 1, 1.85, SENS_MAX]) {
      expect(clampSensitivity(Number(String(v)))).toBe(v);
    }
  });

  it('brackets 1, so the default is a setting and not an end stop', () => {
    expect(SENS_MIN).toBeLessThan(1);
    expect(SENS_MAX).toBeGreaterThan(1);
  });
});

// ----------------------------------------------------------------
describe('power-ups', () => {
  it('grants, expires and respawns', () => {
    const w = new World(SLOTS, 53);
    const pu = w.state.powerups[0]!;
    place(w, 0, pu.x, pu.y, 0);

    const events = w.step({ 0: input({ aimAngle: 0 }) });
    expect(events.some((e) => e.type === 'pickup')).toBe(true);
    expect(pu.active).toBe(false);

    // Whatever it was, the entity now carries exactly that effect.
    const e = w.byId(0)!;
    const carrying =
      e.shieldActive || e.rapidFireTimer > 0 || e.speedBoostTimer > 0;
    expect(carrying).toBe(true);
  });

  it('clears carried power-ups on death', () => {
    const w = new World(SLOTS, 59);
    const spot = openSpot();
    place(w, 0, spot.x, spot.y, 0);
    place(w, 1, spot.x + TILE * 2, spot.y, Math.PI);
    const victim = w.byId(1)!;
    victim.rapidFireTimer = 5000;
    victim.speedBoostTimer = 5000;

    w.step({ 0: input({ fire: true, aimAngle: 0 }) });

    expect(victim.alive).toBe(false);
    expect(victim.rapidFireTimer).toBe(0);
    expect(victim.speedBoostTimer).toBe(0);
  });
});

// ----------------------------------------------------------------
describe('raycast', () => {
  it('reports a texture coordinate inside the unit range', () => {
    const spot = openSpot();
    for (let i = 0; i < 64; i++) {
      const hit = castRay(spot.x, spot.y, (i / 64) * Math.PI * 2, Infinity);
      expect(hit.hit).toBe(true);
      expect(hit.wallX).toBeGreaterThanOrEqual(0);
      expect(hit.wallX).toBeLessThanOrEqual(1);
    }
  });

  it('agrees with hitscan about where a bullet stops', () => {
    // Renderer and weapon share one raycast, so what you see and what
    // you hit cannot drift apart.
    const spot = openSpot();
    const angle = 0.3;
    const ray = castRay(spot.x, spot.y, angle, Infinity);
    const shot = hitscan([], -1, spot.x, spot.y, angle);
    expect(shot.x).toBeCloseTo(ray.x, 6);
    expect(shot.y).toBeCloseTo(ray.y, 6);
  });

  it('measures angles across the +/-PI wrap correctly', () => {
    expect(angleDelta(3.0, -3.0)).toBeCloseTo(Math.PI * 2 - 6.0, 6);
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.abs(angleDelta(0.1, 0.1))).toBeCloseTo(0, 6);
  });
});

// ----------------------------------------------------------------
describe('rng', () => {
  it('reproduces a stream from the same seed', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays within range', () => {
    const r = new Rng(1);
    for (let i = 0; i < 500; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(r.int(5)).toBeLessThan(5);
    }
  });
});
