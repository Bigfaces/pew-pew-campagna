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
  BOSS_ENRAGED_CHARGES,
  BOSS_ENRAGE_AT,
  BOSS_GUARD_ENRAGED_MS,
  BOSS_GRAZE_ARC_HALF,
  BOSS_GUARD_MS,
  BOSS_HITS_TO_DEFEAT,
  BOSS_RADIUS,
  BOSS_REAR_ARC_HALF,
  BOSS_RECOVER_ENRAGED_MS,
  BOSS_RECOVER_MS,
  BOSS_START_X,
  BOSS_START_Y,
  BOSS_TELEGRAPH_ENRAGED_MS,
  BOSS_TELEGRAPH_MS,
  BOSS_TURN_RATE,
  BOSS_VOLLEY_RECOVER_MS,
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
  SHIELD_PICKUP_RADIUS,
  SHIELD_X,
  SHIELD_Y,
  START_X,
  START_Y,
  XP_BOSS_DEFEAT,
  XP_BOSS_HIT_GRAZE,
  XP_BOSS_HIT_SOLID,
  XP_CORE,
  XP_DRONE_DOWN,
  XP_ROOM_ENTER,
  levelForXp,
  roomForTx,
} from './constants';
import { CAMP_MAP_H, CAMP_MAP_W, campGetTile } from './map';
import { campMoveEntity, distanceAlongRayToCircle, type IsSolidFn } from './physics';
import { campCastRay, campHasLOS } from './raycast';
import { hasGrazeDamage, isValidNode, nodeCost, pointsSpent, weaponStatsFor } from './skills';
import {
  CAMPAIGN_PROFILE_VERSION,
  emptyCampaignInput,
  type CampaignEvent,
  type CampaignInput,
  type CampaignProfile,
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

  /** Tile value as seen by movement, LOS, hitscan and the renderer:
   *  the static map plus the door's tiles, once sealed. Public — the
   *  renderer needs it too, to draw the very door it can walk into. */
  getTile = (tx: number, ty: number): number => {
    if (this.state.door.closed) {
      for (const d of DOOR_TILES) {
        if (d.tx === tx && d.ty === ty) return 1;
      }
    }
    return campGetTile(tx, ty);
  };

  private isSolid: IsSolidFn = (tx, ty) => this.getTile(tx, ty) !== 0;

  /** `profile` seeds a returning player: the character they built,
   *  never where they were standing (see CampaignProfile). Absent —
   *  or discarded as an unknown version — means a fresh start. */
  constructor(profile?: CampaignProfile) {
    const xp = profile?.xp ?? 0;
    const level = levelForXp(xp);
    const collected = new Set(profile?.collectedCoreIds ?? []);

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
        shieldActive: false,
      },
      door: { armed: false, closeTimer: 0, closed: false },
      shield: { collected: false },
      drone: { alive: true, reactionTimer: DRONE_REACTION_MS, fireCooldown: 0 },
      cores: CORE_DEFS.map((d) => ({
        id: d.id,
        x: (d.tx + 0.5) * TILE,
        y: (d.ty + 0.5) * TILE,
        collected: collected.has(d.id),
      })),
      coresCollected: collected.size,
      roomsAwarded: [...(profile?.roomsAwarded ?? [])],
      xp,
      level,
      // One point per level gained, so this follows from the level the
      // XP buys — never stored, never able to drift from it.
      skillPoints: level - 1,
      unlockedNodes: [...(profile?.unlockedNodes ?? [])],
      boss: {
        x: BOSS_START_X,
        y: BOSS_START_Y,
        angle: Math.PI,
        phase: 'guard',
        phaseTimer: BOSS_GUARD_MS,
        damageTaken: 0,
        chargeDirX: 0,
        chargeDirY: 0,
        chargesLeft: 0,
      },
      outcome: 'playing',
    };
  }

  get finished(): boolean {
    return this.state.outcome === 'victory';
  }

  /** Seconda fase della Sentinella: derivata dal danno subito, non
   *  memorizzata, così non può restare accesa dopo un reset del boss
   *  che azzera il danno (vedi killPlayer). */
  get enraged(): boolean {
    return this.state.boss.damageTaken >= BOSS_ENRAGE_AT;
  }

  /** Skill points earned by leveling up but not yet spent on a node. */
  get availableSkillPoints(): number {
    return this.state.skillPoints - pointsSpent(this.state.unlockedNodes);
  }

  /** The part of this run worth carrying to the next one. */
  toProfile(): CampaignProfile {
    return {
      version: CAMPAIGN_PROFILE_VERSION,
      xp: this.state.xp,
      unlockedNodes: [...this.state.unlockedNodes],
      collectedCoreIds: this.state.cores.filter((c) => c.collected).map((c) => c.id),
      roomsAwarded: [...this.state.roomsAwarded],
    };
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
    this.updateShieldPickup();
    this.updateDrone();
    this.updateBoss();

    if (input.fire) this.fireWeapon(input);

    return this.events;
  }

  /** Spend one available skill point to unlock a Precisione node.
   *  Returns whether it succeeded — false if the id is unknown,
   *  already unlocked, or unaffordable. */
  tryUnlockNode(id: string): boolean {
    if (!isValidNode(id)) return false;
    if (this.state.unlockedNodes.includes(id)) return false;
    if (this.availableSkillPoints < nodeCost(id)) return false;
    this.state.unlockedNodes.push(id);
    this.events.push({ type: 'nodeUnlocked', id });
    return true;
  }

  // --------------------------------------------------------------------

  /** Add XP and raise the level (and skill points) for every threshold
   *  it now clears. A single big award — the boss-defeat bonus — can
   *  cross more than one threshold at once, so this loops rather than
   *  checking once. */
  private grantXp(amount: number): void {
    this.state.xp += amount;
    this.events.push({ type: 'xpGained', amount });

    const newLevel = levelForXp(this.state.xp);
    while (this.state.level < newLevel) {
      this.state.level++;
      this.state.skillPoints++;
      this.events.push({ type: 'levelUp', level: this.state.level });
    }
  }

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
      // Paid once per profile: otherwise leaving to the menu and
      // walking back in would be a stable XP loop.
      if (!this.state.roomsAwarded.includes(room)) {
        this.state.roomsAwarded.push(room);
        this.grantXp(XP_ROOM_ENTER);
      }
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
        this.grantXp(XP_CORE);
      }
    }
  }

  private updateShieldPickup(): void {
    const shield = this.state.shield;
    if (shield.collected) return;
    const p = this.state.player;
    if (Math.hypot(p.x - SHIELD_X, p.y - SHIELD_Y) <= SHIELD_PICKUP_RADIUS) {
      shield.collected = true;
      p.shieldActive = true;
      this.events.push({ type: 'shieldPickup' });
    }
  }

  /** A hit that would otherwise kill the player — spends the shield
   *  instead, if one is up. Tactical and disposable, unlike the
   *  skill tree: see GDD.md, "Potenziamenti vs progressione
   *  permanente". */
  private damagePlayer(cause: 'drone' | 'boss'): void {
    if (this.state.player.shieldActive) {
      this.state.player.shieldActive = false;
      this.events.push({ type: 'shieldBreak' });
      return;
    }
    this.killPlayer(cause);
  }

  private updateDrone(): void {
    const drone = this.state.drone;
    if (!drone.alive) return;

    const p = this.state.player;
    const los = campHasLOS(
      this.getTile,
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
      this.damagePlayer('drone');
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
          boss.phaseTimer = this.enraged ? BOSS_TELEGRAPH_ENRAGED_MS : BOSS_TELEGRAPH_MS;
          // La raffica si decide qui, una volta: se la Sentinella si
          // altera a meta' raffica, la raffica in corso resta quella
          // che il giocatore ha visto iniziare.
          boss.chargesLeft = this.enraged ? BOSS_ENRAGED_CHARGES : 1;
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
            this.damagePlayer('boss');
            break;
          }
        }
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          boss.chargesLeft = Math.max(0, boss.chargesLeft - 1);
          boss.phase = 'recover';
          // Dentro la raffica la pausa e' breve — le due cariche
          // devono leggersi come una sola sequenza. Quella dopo
          // l'ultima e' la piu' lunga dello scontro: e' il premio.
          boss.phaseTimer =
            boss.chargesLeft > 0
              ? BOSS_VOLLEY_RECOVER_MS
              : this.enraged
                ? BOSS_RECOVER_ENRAGED_MS
                : BOSS_RECOVER_MS;
        }
        break;
      }
      case 'recover': {
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          if (boss.chargesLeft > 0) {
            // Riparte senza tornare in guardia: la seconda carica
            // ri-mira, ma concede molto meno tempo per leggerla.
            boss.phase = 'telegraph';
            boss.phaseTimer = BOSS_TELEGRAPH_ENRAGED_MS;
          } else {
            boss.phase = 'guard';
            boss.phaseTimer = this.enraged ? BOSS_GUARD_ENRAGED_MS : BOSS_GUARD_MS;
          }
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
      this.getTile,
      p.x,
      p.y,
      input.aimAngle,
      Infinity,
      CAMP_MAP_W,
      CAMP_MAP_H,
    );
    // Which target the shot reaches is decided by distance and walls,
    // never by which room the shooter is standing in. Gating on the
    // room looked equivalent — the drone only lives in Magazzino, the
    // boss only in Molo — but a player standing *on* a doorway tile
    // belongs to the room behind them, so shots taken while peeking
    // through the Molo threshold silently did nothing.
    const boss = this.state.boss;
    const droneDist = this.state.drone.alive
      ? distanceAlongRayToCircle(
          p.x,
          p.y,
          input.aimAngle,
          DRONE_X,
          DRONE_Y,
          DRONE_RADIUS,
        )
      : null;
    const bossDist =
      boss.phase !== 'defeated'
        ? distanceAlongRayToCircle(p.x, p.y, input.aimAngle, boss.x, boss.y, BOSS_RADIUS)
        : null;

    const droneHit = droneDist !== null && droneDist <= wall.dist;
    const bossHit = bossDist !== null && bossDist <= wall.dist;
    // Nearest target wins, so you cannot shoot through one to reach
    // the other.
    const hitsDroneFirst = droneHit && (!bossHit || droneDist! <= bossDist!);

    if (hitsDroneFirst) {
      this.state.drone.alive = false;
      this.events.push({ type: 'droneDown' });
      this.grantXp(XP_DRONE_DOWN);
      return;
    }

    if (bossHit) {
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
        const wasEnraged = this.enraged;
        boss.damageTaken += dmg;
        this.events.push({ type: 'bossHit', damage: dmg, phase: boss.phase });
        if (!wasEnraged && this.enraged) this.events.push({ type: 'bossEnraged' });
        this.grantXp(dmg >= 1 ? XP_BOSS_HIT_SOLID : XP_BOSS_HIT_GRAZE);
        if (boss.damageTaken >= BOSS_HITS_TO_DEFEAT) {
          boss.phase = 'defeated';
          this.state.outcome = 'victory';
          this.events.push({ type: 'bossDefeated' });
          this.grantXp(XP_BOSS_DEFEAT);
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
      this.state.shield.collected = false;
    }
    if (cp.room === 'molo') {
      const boss = this.state.boss;
      boss.phase = 'guard';
      boss.phaseTimer = BOSS_GUARD_MS;
      boss.damageTaken = 0;
      boss.chargesLeft = 0;
      boss.x = BOSS_START_X;
      boss.y = BOSS_START_Y;
      boss.angle = Math.PI;
      // The shield sits in the room before this one, but a boss
      // attempt is exactly when a spent shield is worth backtracking
      // for — leave it collectable again rather than gone for good.
      this.state.shield.collected = false;
    }

    this.events.push({ type: 'playerDied', cause });
  }
}
