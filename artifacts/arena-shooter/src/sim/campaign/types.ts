// ================================================================
// CAMPAIGN TYPES
// ================================================================
// Plain, JSON-serializable state, same discipline as the Arena's own
// sim/types.ts — the campaign is single-player (see GDD.md section
// 7), but there is no reason to give up the property that made the
// Arena's state easy to snapshot, log and test.
// ================================================================

import type { RoomId } from './constants';
export type { RoomId };

export type BossPhase = 'guard' | 'telegraph' | 'charge' | 'recover' | 'defeated';

export interface CampaignInput {
  /** Movement intent in entity-local space: +1 forward, -1 back. */
  forward: number;
  /** +1 right, -1 left (strafe). */
  strafe: number;
  /** Absolute yaw the player wants to face, in radians. */
  aimAngle: number;
  /** Edge-triggered: true on the tick the trigger is pulled. */
  fire: boolean;
  /** Scoped aiming, held. */
  ads: boolean;
}

export function emptyCampaignInput(): CampaignInput {
  return { forward: 0, strafe: 0, aimAngle: 0, fire: false, ads: false };
}

export interface CampaignPlayer {
  x: number;
  y: number;
  angle: number;
  pitch: number;
  weaponCooldown: number;
  /** ms of immunity right after a checkpoint respawn, so an
   *  already-in-flight drone shot or boss charge cannot kill the
   *  player a second time before they have even moved. */
  respawnInvulnerableMs: number;
  /** Tactical power-up, not permanent progression: absorbs exactly
   *  one hit (drone or boss contact) and is gone. See GDD.md,
   *  "Potenziamenti vs progressione permanente". */
  shieldActive: boolean;
}

export interface DoorTrapState {
  /** Sensor tripped, timer running. */
  armed: boolean;
  /** ms remaining before the door seals, once armed. */
  closeTimer: number;
  closed: boolean;
}

export interface DroneState {
  alive: boolean;
  /** ms of held line-of-sight still needed before it fires. Resets
   *  whenever line of sight is lost. */
  reactionTimer: number;
  fireCooldown: number;
}

export interface CoreState {
  id: string;
  x: number;
  y: number;
  collected: boolean;
}

export interface ShieldPickupState {
  collected: boolean;
}

export interface BossState {
  x: number;
  y: number;
  /** Facing — also the charge direction once one starts. */
  angle: number;
  phase: BossPhase;
  /** ms remaining in the current phase. */
  phaseTimer: number;
  /** 0..BOSS_HITS_TO_DEFEAT. A float so a graze (Danno di Striscio)
   *  can add half a point. */
  damageTaken: number;
  chargeDirX: number;
  chargeDirY: number;
}

export interface Checkpoint {
  room: RoomId;
  x: number;
  y: number;
  angle: number;
}

export type CampaignOutcome = 'playing' | 'victory';

export interface CampaignState {
  tick: number;
  checkpoint: Checkpoint;
  player: CampaignPlayer;
  door: DoorTrapState;
  drone: DroneState;
  cores: CoreState[];
  coresCollected: number;
  shield: ShieldPickupState;
  /** Esperienza totale accumulata nel run — non scende mai, nemmeno
   *  alla morte: solo la posizione e i nemici della stanza si
   *  resettano, il progresso no (vedi GDD.md, modalità Tutorial). */
  xp: number;
  level: number;
  /** Punti guadagnati salendo di livello, non ancora spesi
   *  sull'albero. `unlockedNodes` è la fonte di verità per quanto è
   *  già speso — vedi skills.ts `pointsSpent`. */
  skillPoints: number;
  unlockedNodes: string[];
  boss: BossState;
  outcome: CampaignOutcome;
}

export type CampaignEvent =
  | { type: 'roomEntered'; room: RoomId }
  | { type: 'doorSealed' }
  | { type: 'coreCollected'; id: string }
  | { type: 'shieldPickup' }
  | { type: 'shieldBreak' }
  | { type: 'xpGained'; amount: number }
  | { type: 'levelUp'; level: number }
  | { type: 'nodeUnlocked'; id: string }
  | { type: 'droneDown' }
  | { type: 'bossHit'; damage: number; phase: BossPhase }
  | { type: 'bossDefeated' }
  | { type: 'playerDied'; cause: 'drone' | 'boss' };
