// ================================================================
// CAMPAIGN CONSTANTS — Sprint 1 vertical slice
// ================================================================
// The weapon-related numbers start from the Arena's own tuning
// (imported, not retyped) so the Precisione nodes read as real deltas
// against a weapon the player already knows, per GDD.md section 10.
// ================================================================

import {
  ADS_MOVE_MULT,
  ADS_TRANSITION_MS,
  BULLET_COOLDOWN,
  ENTITY_RADIUS,
  TILE,
} from '../constants';

export type RoomId = 'attracco' | 'corridoio' | 'magazzino' | 'molo';

/** Forward order of the rooms — used to make checkpoints only ever
 *  advance, never move backward when the player retreats. */
export const ROOM_ORDER: Record<RoomId, number> = {
  attracco: 0,
  corridoio: 1,
  magazzino: 2,
  molo: 3,
};

/** Which room a player tile-column belongs to. Column ranges mirror
 *  the layout in map.ts. */
export function roomForTx(tx: number): RoomId {
  if (tx <= 5) return 'attracco';
  if (tx <= 11) return 'corridoio';
  if (tx <= 16) return 'magazzino';
  return 'molo';
}

// ---- Player start / respawn ----
export const START_TX = 2;
export const START_TY = 5;
export const START_X = (START_TX + 0.5) * TILE;
export const START_Y = (START_TY + 0.5) * TILE;

/** Brief lockout after a checkpoint respawn so the drone or a boss
 *  charge already in flight cannot kill the player a second time on
 *  the same tick it sent them back. Mirrors the Arena's own
 *  SPAWN_PROTECTION. */
export const RESPAWN_INVULN_MS = 800;

// ---- Timed door trap (corridoio) ----
/** First corridor tile-column: crossing it arms the timer. */
export const DOOR_SENSOR_TX = 7;
/** Tiles that turn solid once the timer runs out. */
export const DOOR_TILES: readonly { tx: number; ty: number }[] = [
  { tx: 9, ty: 4 },
  { tx: 9, ty: 5 },
  { tx: 9, ty: 6 },
];
export const DOOR_CLOSE_DELAY_MS = 3500;

// ---- Drone (Magazzino) ----
export const DRONE_TX = 13;
export const DRONE_TY = 3;
export const DRONE_X = (DRONE_TX + 0.5) * TILE;
export const DRONE_Y = (DRONE_TY + 0.5) * TILE;
export const DRONE_RADIUS = ENTITY_RADIUS;
/** Delay between acquiring line of sight and firing — the "linea di
 *  mira visibile prima di sparare" the GDD calls for. */
export const DRONE_REACTION_MS = 500;
export const DRONE_FIRE_COOLDOWN_MS = 1800;

// ---- Cores ----
export const CORE_PICKUP_RADIUS = 20;
export interface CoreDef {
  id: string;
  tx: number;
  ty: number;
}
export const CORE_DEFS: readonly CoreDef[] = [
  { id: 'corridoio-nicchia', tx: 8, ty: 3 },
  { id: 'magazzino', tx: 14, ty: 7 },
];

// ---- Potenziamento tattico: scudo (Magazzino, prima del Molo) ----
// Distinto di proposito dai core: non dà esperienza, non è una scelta
// permanente — assorbe un solo colpo e si consuma. Vedi GDD.md,
// sezione "Potenziamenti vs progressione permanente".
export const SHIELD_TX = 15;
export const SHIELD_TY = 7;
export const SHIELD_X = (SHIELD_TX + 0.5) * TILE;
export const SHIELD_Y = (SHIELD_TY + 0.5) * TILE;
export const SHIELD_PICKUP_RADIUS = CORE_PICKUP_RADIUS;

// ---- Esperienza e livelli ----
// I core restano collezionabili nel livello, ma non sono più la
// valuta spesa direttamente sull'albero: alimentano l'esperienza,
// insieme a ogni altra cosa che il giocatore fa — esplorare, colpire
// il drone, colpire il boss, abbatterlo. Salire di livello è ciò che
// paga i nodi, cosi' un run puramente esplorativo e uno aggressivo
// progrediscono entrambi, invece di premiare solo la raccolta.
export const XP_ROOM_ENTER = 15;
export const XP_CORE = 20;
export const XP_DRONE_DOWN = 30;
export const XP_BOSS_HIT_SOLID = 25;
export const XP_BOSS_HIT_GRAZE = 12;
export const XP_BOSS_DEFEAT = 150;

/** XP cumulativa richiesta per raggiungere il livello (indice + 1).
 *  Calibrata sulla verticale slice: completarla del tutto (4 stanze,
 *  core, drone, boss abbattuto con qualche striscio) rende circa
 *  350-380 XP — abbastanza per arrivare a livello 4-5 e spendere ogni
 *  punto sul ramo Precisione, senza che restino punti in eccesso. */
export const LEVEL_XP_THRESHOLDS: readonly number[] = [0, 50, 130, 240, 380, 550];

export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_XP_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_XP_THRESHOLDS[i]!) level = i + 1;
    else break;
  }
  return level;
}

/** XP cumulativa per il prossimo livello, o null al livello massimo
 *  della tabella — la UI la mostra come "prossimo livello", non come
 *  un tetto duro: null significa solo "nessuna soglia oltre questa". */
export function xpForNextLevel(level: number): number | null {
  return LEVEL_XP_THRESHOLDS[level] ?? null;
}

// ---- Skill tree: ramo Precisione ----
/** Costo in punti abilità (uno per livello guadagnato), non più in
 *  core raccolti — vedi "Esperienza e livelli" sopra. */
export const NODE_COST = 1;

export const BASE_WEAPON_STATS = {
  cooldownMs: BULLET_COOLDOWN,
  adsTransitionMs: ADS_TRANSITION_MS,
  adsMoveMult: ADS_MOVE_MULT,
};

export type PrecisionNodeId =
  | 'otturatore-rapido'
  | 'aggancio-ottico'
  | 'danno-di-striscio';

export interface PrecisionNodeDef {
  id: PrecisionNodeId;
  cost: number;
  name: string;
}

export const PRECISION_NODES: readonly PrecisionNodeDef[] = [
  { id: 'otturatore-rapido', cost: NODE_COST, name: 'Otturatore Rapido' },
  { id: 'aggancio-ottico', cost: NODE_COST, name: 'Aggancio Ottico' },
  { id: 'danno-di-striscio', cost: NODE_COST, name: 'Danno di Striscio' },
];

export const NODE_OTTURATORE_COOLDOWN_MS = 1150;
export const NODE_AGGANCIO_TRANSITION_MS = 70;
export const NODE_AGGANCIO_MOVE_MULT = 0.55;

// ---- Boss: Sentinella del Molo ----
export const BOSS_TX = 18;
export const BOSS_TY = 5;
export const BOSS_START_X = (BOSS_TX + 0.5) * TILE;
export const BOSS_START_Y = (BOSS_TY + 0.5) * TILE;
export const BOSS_RADIUS = ENTITY_RADIUS * 2;

export const BOSS_GUARD_MS = 2600;
export const BOSS_TELEGRAPH_MS = 900;
export const BOSS_CHARGE_MS = 700;
export const BOSS_RECOVER_MS = 900;
/** px/tick — faster than PLAYER_SPEED (2.2), so the charge is a real
 *  threat, not a formality. */
export const BOSS_CHARGE_SPEED = 3.4;
export const BOSS_TURN_RATE = 0.05;

/** Hits on the exposed core needed to win the fight. Boss health is a
 *  small integer count of exposed hits, not a generic HP bar — see
 *  GDD.md section 6. */
export const BOSS_HITS_TO_DEFEAT = 3;

/** Half-angle of the true rear arc: standing here scores a full hit. */
export const BOSS_REAR_ARC_HALF = (60 * Math.PI) / 180;
/** Wider half-angle that scores a graze (0.5 damage) — but only with
 *  the Danno di Striscio node unlocked. */
export const BOSS_GRAZE_ARC_HALF = (100 * Math.PI) / 180;
