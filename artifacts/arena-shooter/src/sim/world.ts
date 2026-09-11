// ================================================================
// WORLD — the authoritative simulation
// ================================================================
// One `step()` call advances exactly one fixed tick. There is no dt
// parameter, and that is the entire point: the prototype scaled
// movement by nothing at all while scaling turning by frame dt, so a
// 144 Hz display moved you 2.4x faster than a 60 Hz one. A fixed tick
// makes the simulation frame-rate independent, reproducible from a
// seed, and safe to run on a remote host peer.
//
// The class holds no DOM references and imports nothing from the
// renderer, so it runs unchanged in a headless test.
// ================================================================

import {
  BACKWARD_MULT,
  BOT_TUNING,
  BULLET_COOLDOWN,
  MATCH_TIME_TICKS,
  PLAYER_SPEED,
  PU_PICKUP_RADIUS,
  PU_RAPID_DUR,
  PU_RESPAWN_MS,
  PU_SPEED_DUR,
  RAPIDFIRE_CD,
  RESPAWN_DELAY,
  SPAWN_PROTECTION,
  SPEED_MULT,
  STRAFE_MULT,
  TICK_MS,
  TILE,
  killTarget,
  type BotTuning,
  type Difficulty,
} from './constants';
import { POWERUP_DEFS, SPAWN_POINTS } from './map';
import { chooseSafeSpawn, hitscan, moveEntity, pushOutOfWalls } from './physics';
import { Rng } from './rng';
import { updateBot } from './bots';
import {
  emptyInput,
  type Entity,
  type InputState,
  type PowerUp,
  type SimEvent,
  type WorldState,
} from './types';

export interface SlotConfig {
  name: string;
  skin: number;
  controller: 'local' | 'bot' | 'remote';
}

/** Inputs supplied from outside the simulation, keyed by entity id.
 *  Bots are filled in internally; anything absent is treated as idle. */
export type InputMap = Record<number, InputState>;

function makeEntity(id: number, cfg: SlotConfig, x: number, y: number): Entity {
  return {
    id,
    name: cfg.name,
    skin: cfg.skin,
    controller: cfg.controller,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    kills: 0,
    deaths: 0,
    streak: 0,
    bestStreak: 0,
    shotsFired: 0,
    shotsHit: 0,
    weaponCooldown: 0,
    respawnTimer: 0,
    shieldActive: false,
    rapidFireTimer: 0,
    speedBoostTimer: 0,
    botState: 'patrol',
    botTargetId: null,
    botGoalX: null,
    botGoalY: null,
    botTimer: 0,
    botReactionTimer: 0,
    botLastSeenX: null,
    botLastSeenY: null,
  };
}

export class World {
  state: WorldState;
  /** Events produced by the most recent step(). Presentation layers
   *  drain this; the simulation never reads it back. */
  events: SimEvent[] = [];

  private rng: Rng;
  /** Resolved once in the constructor: difficulty cannot change mid
   *  match, so re-reading the table every tick would be pure noise. */
  private tuning: BotTuning;

  constructor(
    slots: readonly SlotConfig[],
    seed = 1,
    difficulty: Difficulty = 'normale',
  ) {
    this.rng = new Rng(seed);
    this.tuning = BOT_TUNING[difficulty];

    const spawns = this.rng.shuffle([...SPAWN_POINTS]);
    const entities = slots.map((cfg, i) => {
      const sp = spawns[i % spawns.length]!;
      const e = makeEntity(i, cfg, sp.x, sp.y);
      e.angle = this.rng.range(0, Math.PI * 2);
      pushOutOfWalls(e);
      return e;
    });

    const powerups: PowerUp[] = POWERUP_DEFS.map((d) => ({
      kind: d.kind,
      x: (d.tx + 0.5) * TILE,
      y: (d.ty + 0.5) * TILE,
      active: true,
      respawnTimer: 0,
      phase: this.rng.range(0, Math.PI * 2),
    }));

    this.state = {
      tick: 0,
      entities,
      powerups,
      winnerId: null,
      killTarget: killTarget(slots.length),
      rngState: this.rng.state,
      difficulty,
    };
  }

  /** Simulated milliseconds left in the match. Derived from the tick
   *  count rather than a wall clock, so it is identical on every peer
   *  and unaffected by a frame-rate stall. */
  get timeLeftMs(): number {
    return Math.max(0, (MATCH_TIME_TICKS - this.state.tick) * TICK_MS);
  }

  get entities(): Entity[] {
    return this.state.entities;
  }

  get finished(): boolean {
    return this.state.winnerId !== null;
  }

  byId(id: number): Entity | undefined {
    return this.state.entities.find((e) => e.id === id);
  }

  /** Advance one fixed tick. Returns the events generated. */
  step(externalInputs: InputMap = {}): SimEvent[] {
    this.events = [];
    if (this.finished) return this.events;

    this.state.tick++;

    // ---- Gather inputs -------------------------------------------------
    // Bots are resolved here so that from this point on every entity is
    // treated identically, whatever is driving it.
    const inputs: InputMap = {};
    for (const e of this.state.entities) {
      if (e.controller === 'bot') {
        inputs[e.id] = updateBot(
          e,
          this.state.entities,
          this.state.powerups,
          this.rng,
          TICK_MS,
          this.tuning,
        );
      } else {
        inputs[e.id] = externalInputs[e.id] ?? emptyInput();
      }
    }

    // ---- Phase 1: timers, respawns, movement ---------------------------
    // Movement is resolved for everyone before any shot is traced. The
    // prototype interleaved move-then-shoot per entity, so entity 0 fired
    // at entity 1's stale position while entity 1 fired at entity 0's
    // updated one — a positional advantage that came purely from array
    // order. Two phases remove it.
    for (const e of this.state.entities) {
      if (e.weaponCooldown > 0) {
        e.weaponCooldown = Math.max(0, e.weaponCooldown - TICK_MS);
      }

      if (!e.alive) {
        e.respawnTimer = Math.max(0, e.respawnTimer - TICK_MS);
        if (e.respawnTimer <= 0) this.respawn(e);
        continue;
      }

      if (e.rapidFireTimer > 0) {
        e.rapidFireTimer = Math.max(0, e.rapidFireTimer - TICK_MS);
      }
      if (e.speedBoostTimer > 0) {
        e.speedBoostTimer = Math.max(0, e.speedBoostTimer - TICK_MS);
      }

      this.applyMovement(e, inputs[e.id]!);
    }

    // ---- Phase 2: shooting ---------------------------------------------
    // Every shot is traced against the world as it stood at the start of
    // the phase, and only then are deaths applied. Resolving shot-by-shot
    // instead would mean the first entity in the array kills the second
    // before the second's trigger is ever read, so a mutual duel could
    // never trade — array order alone decided the winner.
    const pending: { shooter: Entity; victim: Entity | null }[] = [];
    for (const e of this.state.entities) {
      if (!e.alive) continue;
      if (!inputs[e.id]!.fire) continue;
      const shot = this.traceShot(e);
      if (shot) pending.push(shot);
    }
    for (const { shooter, victim } of pending) {
      this.resolveShot(shooter, victim);
    }

    // ---- Phase 3: pickups ----------------------------------------------
    for (const e of this.state.entities) {
      if (!e.alive) continue;
      for (const pu of this.state.powerups) {
        if (!pu.active) continue;
        if (Math.hypot(e.x - pu.x, e.y - pu.y) > PU_PICKUP_RADIUS) continue;
        this.grant(e, pu);
      }
    }

    for (const pu of this.state.powerups) {
      if (pu.active) continue;
      pu.respawnTimer = Math.max(0, pu.respawnTimer - TICK_MS);
      if (pu.respawnTimer <= 0) pu.active = true;
    }

    // ---- Phase 4: the clock ---------------------------------------------
    // Checked after everything else so a kill landing on the final tick
    // still counts toward who wins it.
    if (this.state.winnerId === null && this.state.tick >= MATCH_TIME_TICKS) {
      const leader = this.leader();
      this.state.winnerId = leader.id;
      this.events.push({ type: 'matchEnd', winnerId: leader.id });
    }

    this.state.rngState = this.rng.state;
    return this.events;
  }

  /** Who is ahead, by kills then fewest deaths then lowest id.
   *
   *  The tiebreak chain has to be total and order-independent: two
   *  peers that disagreed about who won a timed-out match would show
   *  different end screens for the same simulation. */
  private leader(): Entity {
    let best = this.state.entities[0]!;
    for (const e of this.state.entities) {
      if (e === best) continue;
      if (
        e.kills > best.kills ||
        (e.kills === best.kills && e.deaths < best.deaths) ||
        (e.kills === best.kills && e.deaths === best.deaths && e.id < best.id)
      ) {
        best = e;
      }
    }
    return best;
  }

  // --------------------------------------------------------------------

  private applyMovement(e: Entity, input: InputState): void {
    e.angle = input.aimAngle;

    let forward = input.forward;
    const strafe = input.strafe;
    if (forward === 0 && strafe === 0) return;

    // Backpedalling is slower, so peeking out of cover is a real
    // commitment rather than a free poke.
    if (forward < 0) forward *= BACKWARD_MULT;

    const fx = Math.cos(e.angle);
    const fy = Math.sin(e.angle);
    const rx = -Math.sin(e.angle);
    const ry = Math.cos(e.angle);

    let vx = fx * forward + rx * strafe * STRAFE_MULT;
    let vy = fy * forward + ry * strafe * STRAFE_MULT;

    // Normalize only when the combined intent exceeds full speed,
    // so analog-style partial input from bots stays proportional
    // while diagonal keyboard input doesn't outrun straight lines.
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }

    const base = e.controller === 'bot' ? this.tuning.speed : PLAYER_SPEED;
    const speed = base * (e.speedBoostTimer > 0 ? SPEED_MULT : 1);
    moveEntity(e, vx * speed, vy * speed);
  }

  /** Consume the shot and trace where it lands. Mutates only the
   *  shooter's own weapon state — no damage is dealt here. */
  private traceShot(
    shooter: Entity,
  ): { shooter: Entity; victim: Entity | null } | null {
    if (shooter.weaponCooldown > 0) return null;

    shooter.weaponCooldown =
      shooter.rapidFireTimer > 0 ? RAPIDFIRE_CD : BULLET_COOLDOWN;
    shooter.shotsFired++;

    // Shots travel along the horizontal only. Pitch is a rendering
    // effect (it shifts the horizon), so letting it steer bullets
    // would make what you hit disagree with what you see.
    const angle = shooter.angle;
    const result = hitscan(
      this.state.entities,
      shooter.id,
      shooter.x,
      shooter.y,
      angle,
    );

    this.events.push({
      type: 'shot',
      shooterId: shooter.id,
      x: shooter.x,
      y: shooter.y,
      angle,
      hitX: result.x,
      hitY: result.y,
      hitEntityId: result.victim?.id ?? null,
    });

    if (result.victim) shooter.shotsHit++;
    return { shooter, victim: result.victim };
  }

  private resolveShot(shooter: Entity, victim: Entity | null): void {
    if (!victim) return;
    // Someone else's bullet already landed on this target in the same
    // tick; the kill is theirs, not a second one for us.
    if (!victim.alive) return;

    if (victim.shieldActive) {
      victim.shieldActive = false;
      this.events.push({
        type: 'shieldBreak',
        entityId: victim.id,
        x: victim.x,
        y: victim.y,
      });
      return;
    }

    this.kill(shooter, victim);
  }

  private kill(killer: Entity, victim: Entity): void {
    victim.alive = false;
    victim.respawnTimer = RESPAWN_DELAY;
    victim.deaths++;
    victim.streak = 0;
    victim.shieldActive = false;
    victim.rapidFireTimer = 0;
    victim.speedBoostTimer = 0;

    killer.kills++;
    killer.streak++;
    if (killer.streak > killer.bestStreak) killer.bestStreak = killer.streak;

    this.events.push({
      type: 'kill',
      killerId: killer.id,
      victimId: victim.id,
      x: victim.x,
      y: victim.y,
    });

    // Guarded: two kills can now resolve in the same tick, and the
    // first to reach the target keeps the win.
    if (this.state.winnerId === null && killer.kills >= this.state.killTarget) {
      this.state.winnerId = killer.id;
      this.events.push({ type: 'matchEnd', winnerId: killer.id });
    }
  }

  private grant(e: Entity, pu: PowerUp): void {
    pu.active = false;
    pu.respawnTimer = PU_RESPAWN_MS;

    if (pu.kind === 'shield') e.shieldActive = true;
    else if (pu.kind === 'rapidfire') e.rapidFireTimer = PU_RAPID_DUR;
    else e.speedBoostTimer = PU_SPEED_DUR;

    this.events.push({
      type: 'pickup',
      entityId: e.id,
      kind: pu.kind,
      x: pu.x,
      y: pu.y,
    });
  }

  private respawn(e: Entity): void {
    const sp = chooseSafeSpawn(this.state.entities, e.id);
    e.x = sp.x;
    e.y = sp.y;
    e.alive = true;
    e.angle = this.rng.range(0, Math.PI * 2);
    e.pitch = 0;
    // Brief lockout so you cannot spawn already holding the trigger.
    e.weaponCooldown = SPAWN_PROTECTION;
    e.botState = 'patrol';
    e.botTargetId = null;
    e.botGoalX = null;
    e.botGoalY = null;
    e.botLastSeenX = null;
    e.botLastSeenY = null;
    pushOutOfWalls(e);

    this.events.push({ type: 'spawn', entityId: e.id, x: e.x, y: e.y });
  }
}
