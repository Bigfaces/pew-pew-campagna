// ================================================================
// NETWORK PROTOCOL
// ================================================================
// Two transports, deliberately different:
//
//   • Signaling (WebSocket to the API server) — reliable, ordered,
//     low volume. Used only to introduce peers to each other. Once
//     the WebRTC connection is up the server is out of the loop and
//     carries no game traffic at all.
//
//   • Game (WebRTC data channel, peer to peer) — unreliable and
//     unordered. Inputs and snapshots are sent 20-60 times a second
//     and a late packet is worthless: retransmitting it would only
//     add latency behind it. Anything that must not be lost (lobby
//     changes, match start) goes on a second, reliable channel.
//
// Topology is host-authoritative: one peer owns the simulation and
// everyone else predicts locally and reconciles. That keeps a single
// source of truth without needing a server to run the game.
// ================================================================

import type { Entity, PowerUp } from '../sim/types';

export const PROTOCOL_VERSION = 1;

/** Room codes are short enough to read aloud, and drawn from an
 *  alphabet without characters that are easily confused (no O/0, I/1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const MAX_PLAYERS = 8;

// ----------------------------------------------------------------
// Signaling
// ----------------------------------------------------------------

export interface LobbySlot {
  peerId: string;
  name: string;
  skin: number;
  isHost: boolean;
}

export type SignalToServer =
  | { t: 'host'; name: string; version: number }
  | { t: 'join'; room: string; name: string; version: number }
  /** SDP and ICE payloads are relayed verbatim; the server never
   *  inspects them. */
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'leave' };

export type SignalFromServer =
  | { t: 'hosted'; room: string; peerId: string }
  | { t: 'joined'; room: string; peerId: string; hostId: string }
  | { t: 'peer-joined'; peerId: string; name: string }
  | { t: 'peer-left'; peerId: string }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'error'; message: string };

// ----------------------------------------------------------------
// Game channel
// ----------------------------------------------------------------

/** Guest -> host, every tick. Mirrors InputState but with short keys:
 *  at 60 Hz per guest the field names are a real share of the bytes. */
export interface NetInput {
  t: 'i';
  /** Input sequence number, echoed back in snapshots so the guest
   *  knows which of its predictions the host has already applied. */
  q: number;
  f: number; // forward
  s: number; // strafe
  a: number; // aim angle
  x: boolean; // fire
}

/** A single entity inside a snapshot. Bot bookkeeping is omitted —
 *  guests never run AI, so shipping it would waste bandwidth. */
export interface NetEntity {
  i: number; // id
  x: number;
  y: number;
  a: number; // angle
  l: boolean; // alive
  k: number; // kills
  d: number; // deaths
  c: number; // weapon cooldown
  p: number; // powerup bitfield: 1 shield, 2 rapid, 4 speed
}

export interface NetSnapshot {
  t: 's';
  /** Simulation tick this snapshot describes. */
  k: number;
  /** Highest input sequence the host had applied for this guest. */
  q: number;
  e: NetEntity[];
  /** Active power-up mask, indexed like the world's powerup array. */
  p: number;
}

/** Events are cosmetic but must not be dropped, so they travel on the
 *  reliable channel rather than being packed into snapshots. */
export interface NetEvents {
  t: 'e';
  /** Serialized SimEvent list. */
  v: unknown[];
}

export interface NetWelcome {
  t: 'w';
  /** The entity id assigned to this guest. */
  id: number;
  seed: number;
  slots: { id: number; name: string; skin: number; bot: boolean }[];
}

export interface NetLobby {
  t: 'l';
  slots: LobbySlot[];
  starting: boolean;
}

export interface NetPing {
  t: 'p';
  /** Sender clock, echoed by the receiver to measure round trip. */
  c: number;
}

export interface NetPong {
  t: 'o';
  c: number;
}

export type NetMessage =
  | NetInput
  | NetSnapshot
  | NetEvents
  | NetWelcome
  | NetLobby
  | NetPing
  | NetPong;

// ----------------------------------------------------------------
// Packing helpers
// ----------------------------------------------------------------

export const PU_BIT_SHIELD = 1;
export const PU_BIT_RAPID = 2;
export const PU_BIT_SPEED = 4;

export function packEntity(e: Entity): NetEntity {
  let p = 0;
  if (e.shieldActive) p |= PU_BIT_SHIELD;
  if (e.rapidFireTimer > 0) p |= PU_BIT_RAPID;
  if (e.speedBoostTimer > 0) p |= PU_BIT_SPEED;
  return {
    i: e.id,
    // Positions are rounded to 1/8 of a pixel. The extra precision is
    // invisible at any render scale and costs bytes on every tick.
    x: Math.round(e.x * 8) / 8,
    y: Math.round(e.y * 8) / 8,
    a: Math.round(e.angle * 1000) / 1000,
    l: e.alive,
    k: e.kills,
    d: e.deaths,
    c: Math.round(e.weaponCooldown),
    p,
  };
}

/** Apply a networked entity onto a local one.
 *
 *  Power-up timers are reconstructed as "nonzero" rather than exact
 *  values: guests use them only to draw rings and pick a fire rate,
 *  and the host is the authority on when they actually expire. */
export function applyEntity(target: Entity, n: NetEntity): void {
  target.x = n.x;
  target.y = n.y;
  target.angle = n.a;
  target.alive = n.l;
  target.kills = n.k;
  target.deaths = n.d;
  target.weaponCooldown = n.c;
  target.shieldActive = (n.p & PU_BIT_SHIELD) !== 0;
  target.rapidFireTimer = n.p & PU_BIT_RAPID ? 1 : 0;
  target.speedBoostTimer = n.p & PU_BIT_SPEED ? 1 : 0;
}

export function packPowerups(powerups: readonly PowerUp[]): number {
  let mask = 0;
  powerups.forEach((pu, i) => {
    if (pu.active) mask |= 1 << i;
  });
  return mask;
}

export function applyPowerups(powerups: PowerUp[], mask: number): void {
  powerups.forEach((pu, i) => {
    pu.active = (mask & (1 << i)) !== 0;
  });
}

export function makeRoomCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}
