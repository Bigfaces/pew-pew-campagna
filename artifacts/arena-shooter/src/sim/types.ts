// ================================================================
// SIMULATION TYPES
// ================================================================
// Everything here must be plain, JSON-serializable data. That is not
// a stylistic preference: the host peer serializes WorldState into
// snapshots and ships it over a WebRTC data channel, so a single
// object reference or Map in here would break multiplayer.
//
// This is why bots track `botTargetId` rather than an Entity pointer
// — the prototype's `botTarget: Entity` was a circular reference that
// could never have been serialized.
// ================================================================

// Type-only import: this module still contributes nothing to the bundle.
import type { Difficulty } from './constants';

/** Per-entity input for one tick.
 *
 *  This is the *only* channel through which anything influences an
 *  entity. Local keyboard/mouse, bot AI, and remote network messages
 *  all write the exact same shape, which is what makes a bot slot and
 *  a human slot interchangeable at runtime. */
export interface InputState {
  /** Movement intent in entity-local space: +1 forward, -1 back. */
  forward: number;
  /** +1 right, -1 left (strafe). */
  strafe: number;
  /** Absolute yaw the entity wants to face, in radians. */
  aimAngle: number;
  /** Edge-triggered: true on the tick the trigger is pulled. */
  fire: boolean;
  /** Monotonic counter used by netcode to acknowledge and replay
   *  inputs during client-side prediction. */
  seq: number;
}

export function emptyInput(): InputState {
  return { forward: 0, strafe: 0, aimAngle: 0, fire: false, seq: 0 };
}

export type BotState = 'patrol' | 'aim' | 'seek' | 'collect';

/** A participant in the match — human or bot, local or remote.
 *  There is deliberately no separate "RemotePlayer" type. */
export interface Entity {
  id: number;
  name: string;
  /** Palette index; the renderer resolves it to actual colours so
   *  that snapshots stay compact. */
  skin: number;
  /** How this entity is driven. The simulation itself only branches
   *  on `bot` (to run AI); `local` vs `remote` matters to the netcode
   *  layer, never to the physics. */
  controller: 'local' | 'bot' | 'remote';

  x: number;
  y: number;
  /** Yaw in radians, 0 = +X. Doubles as the first-person look angle. */
  angle: number;
  /** Normalized vertical look, -1..1. Purely cosmetic: it shifts the
   *  horizon rather than rotating the camera, so it cannot affect
   *  what a shot hits. Shots always travel along the horizontal. */
  pitch: number;

  alive: boolean;
  kills: number;
  deaths: number;
  /** Consecutive kills without dying — drives the streak callouts. */
  streak: number;
  bestStreak: number;
  shotsFired: number;
  shotsHit: number;

  weaponCooldown: number; // ms until the next shot is allowed
  respawnTimer: number; // ms until respawn, when dead

  shieldActive: boolean;
  rapidFireTimer: number;
  speedBoostTimer: number;

  // ---- Bot-only fields (inert for human-controlled entities) ----
  botState: BotState;
  botTargetId: number | null;
  botGoalX: number | null;
  botGoalY: number | null;
  botTimer: number;
  botReactionTimer: number;
  botLastSeenX: number | null;
  botLastSeenY: number | null;
}

export type PowerUpKind = 'shield' | 'rapidfire' | 'speed';

export interface PowerUp {
  kind: PowerUpKind;
  x: number;
  y: number;
  active: boolean;
  respawnTimer: number;
  /** Fixed per-instance phase offset so pickups don't bob in unison. */
  phase: number;
}

/** The complete authoritative state of a match.
 *
 *  Snapshots sent to guest peers are exactly this object (minus the
 *  bot bookkeeping, which guests never need). */
export interface WorldState {
  tick: number;
  entities: Entity[];
  powerups: PowerUp[];
  /** Entity id of the winner once the match is decided. */
  winnerId: number | null;
  /** Kills needed to win. Derived from the roster size at creation and
   *  recorded here rather than recomputed, so a guest reading a
   *  snapshot shows the same target the host is playing to. */
  killTarget: number;
  /** Which bot tuning this match was created with. Recorded on the
   *  state so a snapshot is self-describing, though only the host ever
   *  runs the AI it configures. */
  difficulty: Difficulty;
  /** Seeded PRNG state — carried in the snapshot so a guest that
   *  takes over as host can continue the same random sequence. */
  rngState: number;
}

// ================================================================
// EVENTS
// ================================================================
// The simulation never draws and never plays audio. It emits events,
// and the presentation layers subscribe.
//
// This split is what let the particle system be fixed: the prototype
// simulated particle physics inside the game loop and then drew none
// of it. Now particles are spawned by the renderer from these events
// and never touch the simulation at all.

export interface ShotEvent {
  type: 'shot';
  shooterId: number;
  x: number;
  y: number;
  angle: number;
  /** Where the bullet stopped — a wall, or the victim. */
  hitX: number;
  hitY: number;
  hitEntityId: number | null;
}

export interface KillEvent {
  type: 'kill';
  killerId: number;
  victimId: number;
  x: number;
  y: number;
}

export interface ShieldBreakEvent {
  type: 'shieldBreak';
  entityId: number;
  x: number;
  y: number;
}

export interface PickupEvent {
  type: 'pickup';
  entityId: number;
  kind: PowerUpKind;
  x: number;
  y: number;
}

export interface SpawnEvent {
  type: 'spawn';
  entityId: number;
  x: number;
  y: number;
}

export interface MatchEndEvent {
  type: 'matchEnd';
  winnerId: number;
}

export type SimEvent =
  | ShotEvent
  | KillEvent
  | ShieldBreakEvent
  | PickupEvent
  | SpawnEvent
  | MatchEndEvent;
