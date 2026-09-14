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
 *
 *  Undici livelli, cioè dieci punti: esattamente i nodi dell'albero.
 *  Un livello oltre l'ultimo nodo darebbe punti da spendere su niente
 *  — è lo stesso motivo per cui la tabella si fermava a quattro
 *  quando il ramo costruito era solo Precisione.
 *
 *  Le prime quattro soglie sono rimaste dov'erano: erano calibrate su
 *  cosa si raggiunge *prima* che il boss muoia (la prima versione
 *  metteva il terzo punto a 240 XP, cioè insieme al bonus di vittoria
 *  — un punto guadagnato a partita finita, su un nodo che non si
 *  poteva più usare), e quel vincolo non è cambiato.
 *
 *  Quelle nuove invece accettano di proposito che un run solo non
 *  basti: dieci nodi comprabili tutti alla prima partita non sarebbero
 *  un albero, sarebbero una lista che si riempie da sola. Il primo run
 *  paga un ramo intero più un nodo — abbastanza per specializzarsi
 *  davvero — e l'albero completo arriva verso il terzo. Le cifre le
 *  verifica `balance:campaign`, che le ricalcola invece di fidarsi di
 *  questo commento. */
export const LEVEL_XP_THRESHOLDS: readonly number[] = [
  0, 40, 75, 110, 150, 210, 280, 360, 450, 560, 690,
];

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

// ---- Skill tree ----
// Quattro rami. Precisione era l'unico costruito nello Sprint 1; gli
// altri tre esistevano solo come nomi nel menu, e quei nomi
// promettevano cose che la slice non ha: "passo silenzioso" in un
// gioco dove il drone ti trova con la linea di vista e non con
// l'udito, "rigenerazione" in un gioco dove un colpo uccide e non
// esiste una barra da riempire. Tenerli avrebbe voluto dire inventare
// meccaniche per far tornare i nomi. Sono stati riscritti su quello
// che la simulazione fa davvero — vedi GDD.md sezione 6.

/** Costo in punti abilità (uno per livello guadagnato), non più in
 *  core raccolti — vedi "Esperienza e livelli" sopra. */
export const NODE_COST = 1;

export const BASE_WEAPON_STATS = {
  cooldownMs: BULLET_COOLDOWN,
  adsTransitionMs: ADS_TRANSITION_MS,
  adsMoveMult: ADS_MOVE_MULT,
};

export type SkillBranchId = 'precisione' | 'mobilita' | 'sopravvivenza' | 'percezione';

export type SkillNodeId =
  | 'otturatore-rapido'
  | 'aggancio-ottico'
  | 'danno-di-striscio'
  | 'scatto'
  | 'passo-lungo'
  | 'scatto-evasivo'
  | 'piastra-aggiuntiva'
  | 'riserva-di-bordo'
  | 'scanner-di-settore'
  | 'lettura-termica';

export interface SkillNodeDef {
  id: SkillNodeId;
  cost: number;
  name: string;
  /** Una riga su cosa fa. Un albero i cui nodi sono soltanto nomi
   *  costringe a comprare al buio e a scoprire dopo se era la scelta
   *  giusta — con punti che non si possono rimborsare. */
  desc: string;
  /** Nodo da sbloccare prima di questo. È ciò che rende l'albero un
   *  albero invece di una lista della spesa: i due nodi che cambiano
   *  *come* si gioca stanno dietro quello che introduce la meccanica
   *  su cui si appoggiano. */
  requires?: SkillNodeId;
}

export interface SkillBranchDef {
  id: SkillBranchId;
  name: string;
  /** Cosa promette il ramo, in una riga: serve a scegliere *dove*
   *  investire prima ancora di leggere i singoli nodi. */
  tagline: string;
  nodes: readonly SkillNodeDef[];
}

export const SKILL_TREE: readonly SkillBranchDef[] = [
  {
    id: 'precisione',
    name: 'PRECISIONE',
    tagline: 'Colpire meglio, e più spesso.',
    nodes: [
      {
        id: 'otturatore-rapido',
        cost: NODE_COST,
        name: 'Otturatore Rapido',
        desc: 'Ricarica più veloce tra un colpo e il successivo.',
      },
      {
        id: 'aggancio-ottico',
        cost: NODE_COST,
        name: 'Aggancio Ottico',
        desc: "L'ottica si apre quasi subito e rallenta meno il passo.",
      },
      {
        id: 'danno-di-striscio',
        cost: NODE_COST,
        name: 'Danno di Striscio',
        desc: 'Mezzo danno anche fuori dal cono posteriore del boss.',
      },
    ],
  },
  {
    id: 'mobilita',
    name: 'MOBILITÀ',
    tagline: 'Arrivare dove il colpo non arriva.',
    nodes: [
      {
        id: 'scatto',
        cost: NODE_COST,
        name: 'Scatto',
        desc: 'Uno strappo breve nella direzione del movimento (MAIUSC).',
      },
      {
        id: 'passo-lungo',
        cost: NODE_COST,
        name: 'Passo Lungo',
        desc: 'Velocità base più alta, sempre.',
      },
      {
        id: 'scatto-evasivo',
        cost: NODE_COST,
        name: 'Scatto Evasivo',
        desc: 'Durante lo scatto sei intoccabile: la carica si attraversa.',
        requires: 'scatto',
      },
    ],
  },
  {
    id: 'sopravvivenza',
    name: 'SOPRAVVIVENZA',
    tagline: 'Un errore che non finisce il run.',
    nodes: [
      {
        id: 'piastra-aggiuntiva',
        cost: NODE_COST,
        name: 'Piastra Aggiuntiva',
        desc: 'Lo scudo assorbe due colpi invece di uno.',
      },
      {
        id: 'riserva-di-bordo',
        cost: NODE_COST,
        name: 'Riserva di Bordo',
        desc: 'Entrare in una stanza nuova ricarica lo scudo.',
      },
    ],
  },
  {
    id: 'percezione',
    name: 'PERCEZIONE',
    tagline: 'Sapere prima di vedere.',
    nodes: [
      {
        id: 'scanner-di-settore',
        cost: NODE_COST,
        name: 'Scanner di Settore',
        desc: 'Minimappa del settore con la tua posizione.',
      },
      {
        id: 'lettura-termica',
        cost: NODE_COST,
        name: 'Lettura Termica',
        desc: 'La minimappa segna anche droni, boss, core e scudo.',
        requires: 'scanner-di-settore',
      },
    ],
  },
];

export const ALL_SKILL_NODES: readonly SkillNodeDef[] = SKILL_TREE.flatMap((b) => b.nodes);

// ---- Valori dei nodi ----

// Precisione
export const NODE_OTTURATORE_COOLDOWN_MS = 1150;
export const NODE_AGGANCIO_TRANSITION_MS = 70;
export const NODE_AGGANCIO_MOVE_MULT = 0.55;

// Mobilità
/** px/tick durante lo scatto. Sopra BOSS_CHARGE_SPEED (3.4) di
 *  proposito: uno scatto più lento della carica non sarebbe una
 *  schivata, sarebbe una fuga persa in partenza. */
export const DASH_SPEED = 5.5;
export const DASH_DURATION_MS = 170;
export const DASH_COOLDOWN_MS = 2600;
/** Moltiplicatore di PLAYER_SPEED con Passo Lungo. Tenuto sotto la
 *  soglia che renderebbe il giocatore più veloce della carica del
 *  boss: la Sentinella deve restare una minaccia da schivare, non da
 *  superare camminando. */
export const NODE_PASSO_LUNGO_MULT = 1.18;

// Sopravvivenza
export const SHIELD_CHARGES_BASE = 1;
export const SHIELD_CHARGES_UPGRADED = 2;


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

// ---- Seconda fase: la Sentinella alterata ----
// Un solo pattern ripetuto per tutto lo scontro si impara in due cicli
// e poi diventa attesa. A meta' dei danni la Sentinella cambia ritmo:
// aspetta meno, si prepara piu' in fretta, e soprattutto carica DUE
// volte di fila — schivare una volta non basta piu', e chi ha imparato
// a contare un solo scatto viene preso dal secondo.
//
// Non e' solo "piu' difficile": la coppia di cariche si paga con una
// pausa finale piu' lunga, cioe' la finestra piu' generosa di tutto lo
// scontro. Chi regge la sequenza viene premiato, invece di dover solo
// sopportare piu' a lungo.
/** Danno oltre il quale la Sentinella si altera (meta' della soglia). */
export const BOSS_ENRAGE_AT = BOSS_HITS_TO_DEFEAT / 2;
export const BOSS_GUARD_ENRAGED_MS = 1400;
export const BOSS_TELEGRAPH_ENRAGED_MS = 600;
/** Quante cariche di fila in una raffica, da alterata. */
export const BOSS_ENRAGED_CHARGES = 2;
/** Pausa breve *dentro* la raffica: lega le due cariche invece di
 *  farle sembrare due cicli separati. */
export const BOSS_VOLLEY_RECOVER_MS = 380;
/** Pausa lunga dopo l'ultima carica della raffica: il premio. */
export const BOSS_RECOVER_ENRAGED_MS = 1300;

/** Half-angle of the true rear arc: standing here scores a full hit. */
export const BOSS_REAR_ARC_HALF = (60 * Math.PI) / 180;
/** Wider half-angle that scores a graze (0.5 damage) — but only with
 *  the Danno di Striscio node unlocked. */
export const BOSS_GRAZE_ARC_HALF = (100 * Math.PI) / 180;
