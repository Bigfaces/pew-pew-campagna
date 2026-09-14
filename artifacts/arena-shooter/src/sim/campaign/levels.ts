// ================================================================
// ATTO I — i tre livelli
// ================================================================
// Le griglie sono scritte per esteso, come quella dell'Arena: una
// mappa che si legge guardandola vale più di una generata da regole
// che poi bisogna eseguire in testa. La numerazione delle colonne in
// cima a ciascuna serve a piazzare le entità contando con il dito.
//
// Un test strutturale (levels.test.ts) verifica che ogni entità stia
// su un tile calpestabile, che le stanze coprano la mappa senza
// buchi, e soprattutto che dallo spawn si raggiungano davvero uscita
// e boss: un muro di troppo in una riga è invisibile finché non ci si
// sbatte contro, e il giocatore non può provare le build.
// ================================================================

import {
  COLLAPSE_HOLD_MS,
  COLLAPSE_RESET_MS,
  DOOR_CLOSE_DELAY_MS,
  EXIT_RADIUS,
  GAS_LINGER_MS,
  TURRET_COOLDOWN_MS,
  TURRET_REACTION_MS,
} from './constants';
import type { LevelDef, TilePos } from './levelTypes';

/** Un rettangolo di tile, per gas e pavimenti che cedono. */
function rect(x0: number, x1: number, y0: number, y1: number): TilePos[] {
  const out: TilePos[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) out.push({ tx, ty });
  }
  return out;
}

// ================================================================
// 1 — ATTRACCO
// ================================================================
// La verticale slice dello Sprint 1, meno il boss: la Sentinella si è
// spostata alla fine dell'atto, dov'è sempre stata nel GDD. Al suo
// posto, nell'ultima stanza, c'è il sas che porta al livello due.
// Mappa e trabocchetto restano identici — è il livello su cui si è
// tarato tutto il resto, e cambiarlo per simmetria avrebbe buttato
// via quella taratura.

// prettier-ignore
const ATTRACCO_TILES: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  0
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], //  1
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], //  2
  [1,0,0,0,0,0,1,1,0,1,1,1,0,0,0,0,1,0,0,0,0,1], //  3  nicchia del core a (8,3)
  [1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], //  4
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  5  riga di passaggio
  [1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], //  6
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], //  7
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], //  8
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], //  9
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 10
];

export const LEVEL_ATTRACCO: LevelDef = {
  id: 'attracco',
  ordinal: 1,
  name: 'ATTRACCO',
  intro: 'Kessler-9. Registro un ingresso non autorizzato. Il registro è tutto ciò che mi resta.',
  width: 22,
  height: 11,
  tiles: ATTRACCO_TILES,
  spawn: { tx: 2, ty: 5 },
  rooms: [
    { id: 'attracco', name: 'ATTRACCO', fromTx: 0, toTx: 5 },
    { id: 'corridoio', name: 'CORRIDOIO', fromTx: 6, toTx: 11 },
    { id: 'magazzino', name: 'MAGAZZINO', fromTx: 12, toTx: 16 },
    { id: 'transito', name: 'SAS DI TRANSITO', fromTx: 17, toTx: 21 },
  ],
  doors: [
    {
      id: 'paratia-sei',
      sensorTx: 7,
      tiles: [
        { tx: 9, ty: 4 },
        { tx: 9, ty: 5 },
        { tx: 9, ty: 6 },
      ],
      delayMs: DOOR_CLOSE_DELAY_MS,
      room: 'corridoio',
    },
  ],
  turrets: [
    {
      id: 'drone-otto-quattro',
      kind: 'drone',
      tx: 13,
      ty: 3,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'magazzino',
    },
  ],
  collapsingFloors: [],
  gasZones: [],
  cores: [
    { id: 'attracco/nicchia', tx: 8, ty: 3 },
    { id: 'attracco/magazzino', tx: 14, ty: 7 },
  ],
  shields: [{ id: 'attracco/magazzino', tx: 15, ty: 7 }],
  boss: null,
  exit: { tx: 19, ty: 5, radius: EXIT_RADIUS },
  next: 'condotti',
};

// ================================================================
// 2 — CONDOTTI
// ================================================================
// Il livello dove si impara che il pavimento e l'aria sono nemici
// quanto le macchine.
//
// Il pozzo pone la prima scelta vera del gioco: la riga di passaggio
// è la strada breve, ma è pavimento che cede; la deviazione a nord è
// solida e porta a un core, ma passa davanti a una turret. Veloce e
// povero, oppure lento ed esposto. Nessuna delle due è la risposta
// giusta — è la scelta a essere il contenuto.
//
// La camera del gas fa la stessa cosa con l'informazione invece che
// col tempo: dentro la nube non hai né minimappa né ottica, e il core
// sta proprio lì in mezzo. Colpisce di proposito il ramo Percezione:
// una trappola che ignora quello che il giocatore si è costruito non
// è una trappola, è un ostacolo.
//
// Il muro alla colonna 16, con la feritoia sulla riga di passaggio,
// è arrivato dopo: senza, la turret in alto vedeva la soglia della
// stanza, e si veniva colpiti nell'istante in cui si entrava — un
// bot che sapeva solo camminare e sparare ci è morto 43 volte di
// fila. Adesso si entra al riparo, e ci si espone scegliendo di
// farlo.

// prettier-ignore
const CONDOTTI_TILES: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  0
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1], //  1  deviazione a nord: solida, esposta
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1], //  2
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1], //  3
  [1,0,0,0,0,0,0,1,0,1,1,1,1,0,1,0,1,0,0,0,1,0,0,1], //  4  (16,4) muro di copertura
  [1,0,0,0,0,0,0,1,0,1,1,1,1,0,1,0,1,0,0,0,1,0,0,1], //  5  (16,5) idem
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  6  nel pozzo cede; alla 16 è la feritoia
  [1,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,1,0,0,0,1,0,0,1], //  7  (16,7) muro di copertura
  [1,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,1,0,0,0,1,0,0,1], //  8  (16,8) idem
  [1,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,1,0,1,0,0,1], //  9  pilastro: copertura dalla turret
  [1,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,1,0,0,1], // 10
  [1,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,1,0,0,1], // 11
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 12
];

export const LEVEL_CONDOTTI: LevelDef = {
  id: 'condotti',
  ordinal: 2,
  name: 'CONDOTTI',
  intro: 'Condotti di servizio. Qui sotto la manutenzione l’ho sospesa io. Non ricordo perché.',
  width: 24,
  height: 13,
  tiles: CONDOTTI_TILES,
  spawn: { tx: 3, ty: 6 },
  rooms: [
    { id: 'paratie', name: 'PARATIE', fromTx: 0, toTx: 7 },
    { id: 'pozzo', name: 'POZZO', fromTx: 8, toTx: 14 },
    { id: 'camera', name: 'CAMERA DEL GAS', fromTx: 15, toTx: 20 },
    { id: 'sas', name: 'SAS DI TRANSITO', fromTx: 21, toTx: 23 },
  ],
  doors: [],
  turrets: [
    {
      // Guarda la deviazione a nord per tutta la sua lunghezza: è il
      // prezzo della strada solida.
      id: 'pozzo-nord',
      kind: 'turret',
      tx: 13,
      ty: 2,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'pozzo',
    },
    {
      id: 'camera-alta',
      kind: 'turret',
      tx: 19,
      ty: 2,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'camera',
    },
  ],
  collapsingFloors: [
    {
      id: 'pozzo',
      tiles: rect(9, 12, 6, 6),
      holdMs: COLLAPSE_HOLD_MS,
      landing: { tx: 8, ty: 6 },
      resetMs: COLLAPSE_RESET_MS,
      room: 'pozzo',
    },
  ],
  gasZones: [
    {
      id: 'camera',
      tiles: rect(17, 18, 4, 8),
      lingerMs: GAS_LINGER_MS,
      room: 'camera',
    },
  ],
  cores: [
    { id: 'condotti/nord', tx: 11, ty: 2 },
    { id: 'condotti/nube', tx: 17, ty: 6 },
  ],
  shields: [{ id: 'condotti/camera', tx: 16, ty: 10 }],
  boss: null,
  exit: { tx: 22, ty: 6, radius: EXIT_RADIUS },
  next: 'molo',
};

// ================================================================
// 3 — MOLO
// ================================================================
// La galleria è il "corridoio a fuoco incrociato" della sezione 4 del
// GDD, e non introduce niente: sono tre turret identiche a quelle dei
// Condotti, sfasate di un terzo di ciclo l'una dall'altra. Il livello
// è fatto dal ritmo, non da un'entità nuova — che è esattamente ciò
// che quella riga della tabella prometteva.
//
// La prima stesura era un tubo dritto di nove tile, e non funzionava:
// con la linea di tiro libera da un capo all'altro tutte e tre le
// turret vedevano il giocatore sempre, quindi sparava sempre qualcuna
// e non c'era niente da leggere. Simulando un attraversamento si
// contavano quattordici morti senza mai superare la prima metà.
//
// Due chicane spezzano la galleria in tre segmenti — alla colonna 10
// si passa solo dalla riga bassa, alla 13 solo dall'alta — e in ogni
// segmento vive una turret sola. Adesso se ne affronta una per volta,
// gli angoli fanno da riparo, e lo sfasamento conta davvero: è *quando*
// passare, non *se* sopravvivere.
//
// Poi il Molo, e la Sentinella.

// prettier-ignore
const MOLO_TILES: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  0
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1], //  1
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1], //  2
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1], //  3
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1], //  4
  [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1], //  5  chicane: (10,5) chiusa
  [1,0,0,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1], //  6  chicane: (10,6) e (13,6) chiuse
  [1,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,1], //  7  chicane: (13,7) chiusa
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1], //  8
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1], //  9
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1], // 10
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1], // 11
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 12
];

/** Un terzo di ciclo: tre turret sfasate così coprono la galleria a
 *  turno invece che tutte insieme. Sparare tutte sullo stesso battito
 *  sarebbe più facile, non più difficile — si aspetta la salva e si
 *  passa. */
const GALLERIA_CYCLE = TURRET_COOLDOWN_MS;

export const LEVEL_MOLO: LevelDef = {
  id: 'molo',
  ordinal: 3,
  name: 'MOLO',
  intro: 'Il molo di attracco. Da qui non parte più niente. Vediamo se tu fai eccezione.',
  width: 26,
  height: 13,
  tiles: MOLO_TILES,
  spawn: { tx: 3, ty: 6 },
  rooms: [
    { id: 'ingresso', name: 'INGRESSO', fromTx: 0, toTx: 6 },
    { id: 'galleria', name: 'GALLERIA', fromTx: 7, toTx: 16 },
    { id: 'molo', name: 'MOLO', fromTx: 17, toTx: 25 },
  ],
  doors: [],
  turrets: [
    {
      // Una per segmento: alla colonna 10 e alla 13 la linea di tiro
      // si spezza, quindi nessuna delle tre vede il territorio delle
      // altre.
      id: 'galleria-a',
      kind: 'turret',
      tx: 9,
      ty: 5,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: GALLERIA_CYCLE,
      phaseMs: 0,
      room: 'galleria',
    },
    {
      id: 'galleria-b',
      kind: 'turret',
      tx: 12,
      ty: 7,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: GALLERIA_CYCLE,
      phaseMs: GALLERIA_CYCLE / 3,
      room: 'galleria',
    },
    {
      id: 'galleria-c',
      kind: 'turret',
      tx: 15,
      ty: 5,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: GALLERIA_CYCLE,
      phaseMs: (GALLERIA_CYCLE * 2) / 3,
      room: 'galleria',
    },
  ],
  collapsingFloors: [],
  gasZones: [],
  cores: [{ id: 'molo/banchina', tx: 22, ty: 10 }],
  shields: [{ id: 'molo/deposito', tx: 18, ty: 2 }],
  boss: { id: 'sentinella', tx: 20, ty: 6, room: 'molo' },
  exit: null,
  next: null,
};

export const ACT_ONE: readonly LevelDef[] = [LEVEL_ATTRACCO, LEVEL_CONDOTTI, LEVEL_MOLO];

export const FIRST_LEVEL_ID = LEVEL_ATTRACCO.id;

/** La definizione di un livello dal suo id, o il primo livello se
 *  l'id non si riconosce — un profilo salvato può nominare un livello
 *  che non esiste più, e ricominciare dall'inizio è meglio che non
 *  poter più entrare in campagna. */
export function levelById(id: string): LevelDef {
  return ACT_ONE.find((l) => l.id === id) ?? LEVEL_ATTRACCO;
}
