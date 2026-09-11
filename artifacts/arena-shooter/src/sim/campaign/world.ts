// ================================================================
// CAMPAIGN WORLD — the authoritative Sprint 1 vertical-slice sim
// ================================================================
// Single-player, tick-based like the Arena's World (sim/world.ts),
// but with campaign rules instead of FFA ones: a checkpoint per room
// instead of a respawn timer, a timed door instead of power-ups, one
// boss with a hit-phase fight instead of a kill target. See GDD.md
// sections 9-10 for the design this implements.
//
// Deliberately its own class rather than a mode flag on World: the
// two share no rules (win condition, respawn behaviour, what "input"
// even drives), so forcing them into one class would mean branching
// on mode everywhere instead of the Arena staying exactly as it is.
// ================================================================

import {
  BACKWARD_MULT,
  ENTITY_RADIUS,
  PLAYER_SPEED,
  STRAFE_MULT,
  TICK_MS,
  TILE,
} from '../constants';
import {
  BOSS_CHARGE_MS,
  BOSS_CHARGE_SPEED,
  BOSS_DEFEAT_BONUS_CORES,
  BOSS_GRAZE_ARC_HALF,
  BOSS_GUARD_MS,
  BOSS_HITS_TO_DEFEAT,
  BOSS_RADIUS,
  BOSS_REAR_ARC_HALF,
  BOSS_RECOVER_MS,
  BOSS_START_X,
  BOSS_START_Y,
  BOSS_TELEGRAPH_MS,
  BOSS_TURN_RATE,
  CORE_DEFS,
  CORE_PICKUP_RADIUS,
  DOOR_CLOSE_DELAY_MS,
  DOOR_SENSOR_TX,
  DOOR_TILES,
  DRONE_FIRE_COOLDOWN_MS,
  DRONE_RADIUS,
  DRONE_REACTION_MS,
  DRONE_X,
  DRONE_Y,
  RESPAWN_INVULN_MS,
  ROOM_ORDER,
  START_X,
  START_Y,
  roomForTx,
} from './constants';
import { CAMP_MAP_H, CAMP_MAP_W, campIsSolidBase } from './map';
import { campMoveEntity, distanceAlongRayToCircle, type IsSolidFn } from './physics';
import { campCastRay, campHasLOS } from './raycast';
import { coresSpent, hasGrazeDamage, isValidNode, nodeCost, weaponStatsFor } from './skills';
import {
  emptyCampaignInput,
  type CampaignEvent,
  type CampaignInput,
  type CampaignState,
} from './types';

/** Signed shortest angular difference, in (-PI, PI]. Same helper as
 *  the Arena's raycast.ts angleDelta. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** How much damage a hit on the boss's hurtbox actually does, given
 *  where the shooter is standing relative to the boss's facing.
 *  Positional, not aim-angle-based: "vulnerabile solo al core sul
 *  retro" (GDD.md section 6) is about where you stand, not how
 *  precisely you shoot. */
function resolveBossHit(
  bossX: number,
  bossY: number,
  bossAngle: number,
  bossPhase: string,
  shooterX: number,
  shooterY: number,
  canGraze: boolean,
): number {
  if (bossPhase !== 'charge' && bossPhase !== 'recover') return 0;
  const toShooter = Math.atan2(shooterY - bossY, shooterX - bossX);
  const rearDir = bossAngle + Math.PI;
  const diff = Math.abs(angleDelta(rearDir, toShooter));
  if (diff <= BOSS_REAR_ARC_HALF) return 1;
  if (canGraze && diff <= BOSS_GRAZE_ARC_HALF) return 0.5;
  return 0;
}

export class CampaignWorld {
  state: CampaignState;
  /** Events produced by the most recent step(). Drained by the
   *  presentation layer; the sim never reads it back. */
  events: CampaignEvent[] = [];

  /** Solidity as seen by movement, LOS and hitscan: the static map
   *  plus the door's tiles, once sealed. */
  private isSolid: IsSolidFn = (tx, ty) => {
    if (campIsSolidBase(tx, ty)) return true;
    if (this.state.door.closed) {
      for (const d of DOOR_TILES) if (d.tx === tx && d.ty === ty) return true;
    }
    return false;
  };

  constructor() {
    this.state = {
      tick: 0,
      checkpoint: { room: 'attracco', x: START_X, y: START_Y, angle: 0 },
      player: {
        x: START_X,
        y: START_Y,
        angle: 0,
        pitch: 0,
        weaponCooldown: 0,
        respawnInvulnerableMs: 0,
      },
      door: { armed: false, closeTimer: 0, closed: false },
      drone: { alive: true, reactionTimer: DRONE_REACTION_MS, fireCooldown: 0 },
      cores: CORE_DEFS.map((d) => ({
        id: d.id,
        x: (d.tx + 0.5) * TILE,
        y: (d.ty + 0.5) * TILE,
        collected: false,
      })),
      coresCollected: 0,
      unlockedNodes: [],
      boss: {
        x: BOSS_START_X,
        y: BOSS_START_Y,
        angle: Math.PI,
        phase: 'guard',
        phaseTimer: BOSS_GUARD_MS,
        damageTaken: 0,
        chargeDirX: 0,
        chargeDirY: 0,
      },
      outcome: 'playing',
    };
  }

  get finished(): boolean {
    return this.state.outcome === 'victory';
  }

  /** Cores collected but not yet spent on a node. */
  get availableCores(): number {
    return this.state.coresCollected - coresSpent(this.state.unlockedNodes);
  }

  /** Advance one fixed tick. Returns the events generated. */
  step(input: CampaignInput = emptyCampaignInput()): CampaignEvent[] {
    this.events = [];
    this.state.tick++;

    const p = this.state.player;
    if (p.weaponCooldown > 0) {
      p.weaponCooldown = Math.max(0, p.weaponCooldown - TICK_MS);
    }
    if (p.respawnInvulnerableMs > 0) {
      p.respawnInvulnerableMs = Math.max(0, p.respawnInvulnerableMs - TICK_MS);
    }

    this.applyMovement(input);
    this.updateCheckpoint();
    this.updateDoor();
    this.updateCores();
    this.updateDrone();
    this.updateBoss();

    if (input.fire) this.fireWeapon(input);

    return this.events;
  }

  /** Spend one available core to unlock a Precisione node. Returns
   *  whether it succeeded — false if the id is unknown, already
   *  unlocked, or unaffordable. */
  tryUnlockNode(id: string): boolean {
    if (!isValidNode(id)) return false;
    if (this.state.unlockedNodes.includes(id)) return false;
    if (this.availableCores < nodeCost(id)) return false;
    this.state.unlockedNodes.push(id);
    this.events.push({ type: 'nodeUnlocked', id });
    return true;
  }

  // --------------------------------------------------------------------

  private applyMovement(input: CampaignInput): void {
    const p = this.state.player;
    p.angle = input.aimAngle;

    let forward = input.forward;
    const strafe = input.strafe;
    if (forward === 0 && strafe === 0) return;

    if (forward < 0) forward *= BACKWARD_MULT;

    const fx = Math.cos(p.angle);
    const fy = Math.sin(p.angle);
    const rx = -Math.sin(p.angle);
    const ry = Math.cos(p.angle);

    let vx = fx * forward + rx * strafe * STRAFE_MULT;
    let vy = fy * forward + ry * strafe * STRAFE_MULT;

    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }

    const stats = weaponStatsFor(this.state.unlockedNodes);
    const speed = PLAYER_SPEED * (input.ads ? stats.adsMoveMult : 1);
    campMoveEntity(this.isSolid, p, vx * speed, vy * speed);
  }

  /** Checkpoints only ever advance: stepping back into an earlier
   *  room (e.g. retreating from the boss) must not lose progress. */
  private updateCheckpoint(): void {
    const p = this.state.player;
    const room = roomForTx(Math.floor(p.x / TILE));
    if (ROOM_ORDER[room] > ROOM_ORDER[this.state.checkpoint.room]) {
      this.state.checkpoint = { room, x: p.x, y: p.y, angle: p.angle };
      this.events.push({ type: 'roomEntered', room });
    }
  }

  private updateDoor(): void {
    const d = this.state.door;
    if (d.closed) return;

    if (!d.armed) {
      const tx = Math.floor(this.state.player.x / TILE);
      if (tx >= DOOR_SENSOR_TX) {
        d.armed = true;
        d.closeTimer = DOOR_CLOSE_DELAY_MS;
      }
      return;
    }

    d.closeTimer -= TICK_MS;
    if (d.closeTimer <= 0) {
      d.closed = true;
      d.armed = false;
      this.events.push({ type: 'doorSealed' });
    }
  }

  private updateCores(): void {
    const p = this.state.player;
    for (const c of this.state.cores) {
      if (c.collected) continue;
      if (Math.hypot(p.x - c.x, p.y - c.y) <= CORE_PICKUP_RADIUS) {
        c.collected = true;
        this.state.coresCollected++;
        this.events.push({ type: 'coreCollected', id: c.id });
      }
    }
  }

  private updateDrone(): void {
    const drone = this.state.drone;
    if (!drone.alive) return;

    const p = this.state.player;
    const los = campHasLOS(
      this.isSolid,
      DRONE_X,
      DRONE_Y,
      p.x,
      p.y,
      CAMP_MAP_W,
      CAMP_MAP_H,
    );

    if (!los) {
      drone.reactionTimer = DRONE_REACTION_MS;
    } else if (drone.reactionTimer > 0) {
      drone.reactionTimer = Math.max(0, drone.reactionTimer - TICK_MS);
    }
    if (drone.fireCooldown > 0) {
      drone.fireCooldown = Math.max(0, drone.fireCooldown - TICK_MS);
    }

    if (
      los &&
      drone.reactionTimer <= 0 &&
      drone.fireCooldown <= 0 &&
      p.respawnInvulnerableMs <= 0
    ) {
      drone.fireCooldown = DRONE_FIRE_COOLDOWN_MS;
      this.killPlayer('drone');
    }
  }

  private updateBoss(): void {
    const boss = this.state.boss;
    if (boss.phase === 'defeated') return;
    // The fight does not start until the player has actually reached
    // the Molo — a stray tick before that must not burn the timer.
    if (this.state.checkpoint.room !== 'molo') return;

    const p = this.state.player;

    switch (boss.phase) {
      case 'guard': {
        this.turnBossToward(p.x, p.y);
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          boss.phase = 'telegraph';
          boss.phaseTimer = BOSS_TELEGRAPH_MS;
        }
        break;
      }
      case 'telegraph': {
        this.turnBossToward(p.x, p.y);
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          const dx = p.x - boss.x;
          const dy = p.y - boss.y;
          const len = Math.hypot(dx, dy) || 1;
          boss.chargeDirX = dx / len;
          boss.chargeDirY = dy / len;
          boss.angle = Math.atan2(dy, dx);
          boss.phase = 'charge';
          boss.phaseTimer = BOSS_CHARGE_MS;
        }
        break;
      }
      case 'charge': {
        campMoveEntity(
          this.isSolid,
          boss,
          boss.chargeDirX * BOSS_CHARGE_SPEED,
          boss.chargeDirY * BOSS_CHARGE_SPEED,
          BOSS_RADIUS - 1,
        );
        if (p.respawnInvulnerableMs <= 0) {
          const dist = Math.hypot(p.x - boss.x, p.y - boss.y);
          if (dist <= BOSS_RADIUS + ENTITY_RADIUS) {
            this.killPlayer('boss');
            break;
          }
        }
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          boss.phase = 'recover';
          boss.phaseTimer = BOSS_RECOVER_MS;
        }
        break;
      }
      case 'recover': {
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          boss.phase = 'guard';
          boss.phaseTimer = BOSS_GUARD_MS;
        }
        break;
      }
    }
  }

  private turnBossToward(x: number, y: number): void {
    const boss = this.state.boss;
    const target = Math.atan2(y - boss.y, x - boss.x);
    const diff = angleDelta(boss.angle, target);
    if (Math.abs(diff) <= BOSS_TURN_RATE) {
      boss.angle = target;
    } else {
      boss.angle += Math.sign(diff) * BOSS_TURN_RATE;
    }
  }

  private fireWeapon(input: CampaignInput): void {
    const p = this.state.player;
    if (p.weaponCooldown > 0) return;

    const stats = weaponStatsFor(this.state.unlockedNodes);
    p.weaponCooldown = stats.cooldownMs;

    const wall = campCastRay(
      this.isSolid,
      p.x,
      p.y,
      input.aimAngle,
      Infinity,
      CAMP_MAP_W,
      CAMP_MAP_H,
    );
    const room = roomForTx(Math.floor(p.x / TILE));

    if (room === 'magazzino' && this.state.drone.alive) {
      const dist = distanceAlongRayToCircle(
        p.x,
        p.y,
        input.aimAngle,
        DRONE_X,
        DRONE_Y,
        DRONE_RADIUS,
      );
      if (dist !== null && dist <= wall.dist) {
        this.state.drone.alive = false;
        this.events.push({ type: 'droneDown' });
        return;
      }
    }

    if (room === 'molo' && this.state.boss.phase !== 'defeated') {
      const boss = this.state.boss;
      const dist = distanceAlongRayToCircle(
        p.x,
        p.y,
        input.aimAngle,
        boss.x,
        boss.y,
        BOSS_RADIUS,
      );
      if (dist !== null && dist <= wall.dist) {
        const dmg = resolveBossHit(
          boss.x,
          boss.y,
          boss.angle,
          boss.phase,
          p.x,
          p.y,
          hasGrazeDamage(this.state.unlockedNodes),
        );
        if (dmg > 0) {
          boss.damageTaken += dmg;
          this.events.push({ type: 'bossHit', damage: dmg, phase: boss.phase });
          if (boss.damageTaken >= BOSS_HITS_TO_DEFEAT) {
            boss.phase = 'defeated';
            this.state.coresCollected += BOSS_DEFEAT_BONUS_CORES;
            this.state.outcome = 'victory';
            this.events.push({ type: 'bossDefeated' });
          }
        }
      }
    }
  }

  private killPlayer(cause: 'drone' | 'boss'): void {
    const p = this.state.player;
    const cp = this.state.checkpoint;

    p.x = cp.x;
    p.y = cp.y;
    p.angle = cp.angle;
    p.weaponCooldown = 0;
    p.respawnInvulnerableMs = RESPAWN_INVULN_MS;

    // "Nemici della stanza resettati" (GDD.md section 9, modalità
    // Tutorial): only the hazards belonging to the room the checkpoint
    // sits in need resetting — earlier rooms are already resolved.
    if (cp.room === 'attracco' || cp.room === 'corridoio') {
      this.state.door.armed = false;
      this.state.door.closed = false;
      this.state.door.closeTimer = 0;
    }
    if (cp.room === 'magazzino') {
      this.state.drone.alive = true;
      this.state.drone.reactionTimer = DRONE_REACTION_MS;
      this.state.drone.fireCooldown = 0;
    }
    if (cp.room === 'molo') {
      const boss = this.state.boss;
      boss.phase = 'guard';
      boss.phaseTimer = BOSS_GUARD_MS;
      boss.damageTaken = 0;
      boss.x = BOSS_START_X;
      boss.y = BOSS_START_Y;
      boss.angle = Math.PI;
    }

    this.events.push({ type: 'playerDied', cause });
  }
}
