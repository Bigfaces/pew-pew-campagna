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
  BLACKOUT_LINGER_MS,
  CHASM_GRACE_MS,
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
  act: 1,
  ordinal: 1,
  name: 'ATTRACCO',
  intro: 'Kessler-9. Registro un ingresso non autorizzato. Il registro è tutto ciò che mi resta.',
  outro: 'Il registro segna un’uscita, non un ingresso. Non avevo una colonna prevista per questo.',
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
  // Due archetipi soli, e il primo livello li presenta uno per volta:
  // il Ronzino che viene addosso nel corridoio stretto, la Vedetta che
  // si pianta per sparare nel magazzino aperto. Nessuno dei due sta
  // nella stanza di partenza — si comincia guardando, non incassando.
  enemies: [
    {
      id: 'ronzino-corridoio',
      kind: 'ronzino',
      tx: 10,
      ty: 5,
      room: 'corridoio',
      facing: Math.PI,
      patrol: { tx: 7, ty: 5 },
    },
    {
      id: 'vedetta-magazzino',
      kind: 'vedetta',
      tx: 14,
      ty: 3,
      room: 'magazzino',
      facing: Math.PI,
      patrol: { tx: 14, ty: 6 },
    },
    // Di spalle: la prima occasione di scoprire che il dorso di una
    // Vedetta vale tre colpi, e di scoprirla per conto proprio.
    { id: 'ronzino-transito', kind: 'ronzino', tx: 18, ty: 2, room: 'transito', facing: 0 },
    {
      id: 'vedetta-transito',
      kind: 'vedetta',
      tx: 19,
      ty: 6,
      room: 'transito',
      facing: 0,
      patrol: { tx: 19, ty: 3 },
    },
  ],
  collapsingFloors: [],
  gasZones: [],
  chasms: [],
  blackouts: [],
  gravityZones: [],
  cores: [
    { id: 'attracco/nicchia', tx: 8, ty: 3 },
    { id: 'attracco/magazzino', tx: 14, ty: 7 },
  ],
  shields: [{ id: 'attracco/magazzino', tx: 15, ty: 7 }],
  beacons: [],
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
  act: 1,
  ordinal: 2,
  name: 'CONDOTTI',
  intro: 'Condotti di servizio. Qui sotto la manutenzione l’ho sospesa io. Non ricordo perché.',
  outro: 'I condotti restano sospesi. Ho controllato: l’ordine è mio. Il motivo continua a non esserci.',
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
  chasms: [],
  blackouts: [],
  gravityZones: [],
  // Il Saldatore entra qui, e il pozzo è il posto giusto: insegue, e
  // ciò che gli sta in mezzo è un pavimento che cede. Chi arretra
  // dritto lo scopre.
  enemies: [
    {
      id: 'vedetta-paratie',
      kind: 'vedetta',
      tx: 5,
      ty: 3,
      room: 'paratie',
      facing: Math.PI,
      patrol: { tx: 2, ty: 3 },
    },
    {
      id: 'saldatore-pozzo',
      kind: 'saldatore',
      tx: 12,
      ty: 3,
      room: 'pozzo',
      facing: Math.PI,
      patrol: { tx: 9, ty: 3 },
    },
    {
      id: 'vedetta-camera',
      kind: 'vedetta',
      tx: 17,
      ty: 2,
      room: 'camera',
      facing: Math.PI,
      patrol: { tx: 15, ty: 3 },
    },
    { id: 'saldatore-sas', kind: 'saldatore', tx: 21, ty: 9, room: 'sas', facing: -Math.PI / 2 },
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
  // Una carica nelle Paratie, fuori dal corridoio principale. Qui non
  // serve a niente: è il livello in cui si impara che le cariche si
  // raccolgono, e lo si impara dove sbagliare non costa.
  beacons: [{ id: 'condotti/paratie', tx: 2, ty: 10 }],
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
  act: 1,
  ordinal: 3,
  name: 'MOLO',
  intro: 'Il molo di attracco. Da qui non parte più niente. Vediamo se tu fai eccezione.',
  outro: 'Hai fatto eccezione. Registro l’anomalia. Non registro se è coraggio o solo fortuna.',
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
  // Livello del boss: tre nemici in tutto. La galleria a fuoco
  // incrociato è già un problema di ritmo, e un Ronzino dentro basta
  // a rimetterla in discussione — due l'avrebbero solo resa rumorosa.
  enemies: [
    {
      id: 'ronzino-ingresso',
      kind: 'ronzino',
      tx: 4,
      ty: 3,
      room: 'ingresso',
      facing: Math.PI,
      patrol: { tx: 2, ty: 3 },
    },
    { id: 'ronzino-galleria', kind: 'ronzino', tx: 8, ty: 7, room: 'galleria', facing: Math.PI },
    // Nella sala del boss, ma sul lato opposto: va tolto prima, non
    // durante. Due minacce che caricano insieme non si leggono.
    { id: 'saldatore-molo', kind: 'saldatore', tx: 18, ty: 2, room: 'molo', facing: 0 },
  ],
  collapsingFloors: [],
  gasZones: [],
  chasms: [],
  blackouts: [],
  gravityZones: [],
  cores: [{ id: 'molo/banchina', tx: 22, ty: 10 }],
  shields: [{ id: 'molo/deposito', tx: 18, ty: 2 }],
  beacons: [],
  boss: { id: 'sentinella', kind: 'sentinella', tx: 20, ty: 6, room: 'molo' },
  exit: null,
  next: 'anello',
};


// ================================================================
// ATTO II — IL NUCLEO ANULARE
// ================================================================
// "Settori industriali/reattore: passerelle sospese, gas tossico,
// turret fisse" (GDD sezione 2). L'atto porta tre minacce nuove, e
// ognuna toglie qualcosa di diverso:
//
//   passerelle  → tolgono terreno   (si risponde con lo Scatto)
//   blackout    → toglie la vista   (si risponde con lo scanner)
//   gravità     → toglie i riflessi (si risponde con l'Ancoraggio)
//
// È il motivo per cui l'albero cresce di un anello proprio adesso:
// prima arriva il problema, poi il ramo che se ne occupa offre la
// risposta. Nodi che migliorano numeri già buoni si comprano per
// abitudine; nodi che sbloccano una strada si scelgono.
//
// Nota di progetto che vale per tutto l'atto: le passerelle sono
// l'unico punto in cui un nodo cambia la *geometria* di un livello.
// Quindi ogni voragine ha sempre una strada alternativa a piedi — più
// lunga, più esposta, ma percorribile da chiunque. Un albero
// facoltativo non può diventare un requisito di sblocco, e un test
// strutturale lo verifica su ogni livello.

// ================================================================
// 4 — ANELLO ESTERNO
// ================================================================
// Il ponte offre tre strade per la stessa stanza: la passerella
// diretta (due voragini, serve lo Scatto e per la seconda lo
// Slancio), il giro a nord (solido ma sotto tiro) e il giro a sud
// (il più lungo, e l'unico con un core). Veloce, esposto, o paziente.

// prettier-ignore
const ANELLO_TILES: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  0
  [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1], //  1  giro a nord: solido, sotto tiro
  [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1], //  2
  [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1], //  3
  [1,0,0,0,0,0,1,0,1,1,1,1,1,1,1,0,1,0,1,0,0,1,0,0,0,1], //  4  pilastro (18,4): copre la soglia
  [1,0,0,0,0,0,1,0,1,1,1,1,1,1,1,0,1,0,0,0,0,1,0,0,0,1], //  5
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  6  passerella diretta: le voragini
  [1,0,0,0,0,0,1,0,1,1,1,1,1,1,1,0,1,0,0,0,0,1,0,0,0,1], //  7
  [1,0,0,0,0,0,1,0,1,1,1,1,1,1,1,0,1,0,0,0,0,1,0,0,0,1], //  8
  [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1], //  9
  [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1], // 10
  [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1], // 11  giro a sud: il più lungo, col core
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 12
];

export const LEVEL_ANELLO: LevelDef = {
  id: 'anello',
  act: 2,
  ordinal: 1,
  name: 'ANELLO ESTERNO',
  intro: 'Anello esterno. Il ponte l’ho aperto io, per vedere cosa fai. Prego.',
  outro: 'Ho visto cosa fai. Continuo a non sapere cosa farne.',
  width: 26,
  height: 13,
  tiles: ANELLO_TILES,
  spawn: { tx: 3, ty: 6 },
  rooms: [
    { id: 'sbarco', name: 'SBARCO', fromTx: 0, toTx: 6 },
    { id: 'ponte', name: 'PONTE', fromTx: 7, toTx: 16 },
    { id: 'pompe', name: 'SALA POMPE', fromTx: 17, toTx: 21 },
    { id: 'sas', name: 'SAS DI TRANSITO', fromTx: 22, toTx: 25 },
  ],
  doors: [],
  turrets: [
    {
      // Copre il giro a nord per tutta la sua lunghezza: è il prezzo
      // della strada solida, come nel pozzo dei Condotti.
      id: 'ponte-nord',
      kind: 'turret',
      tx: 14,
      ty: 2,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'ponte',
    },
    {
      // Dietro il pilastro (18,4): entrando nella sala si è al
      // riparo, e ci si espone facendo il passo successivo. Senza il
      // pilastro la soglia era sotto tiro e un bot che sa camminare e
      // sparare ci moriva 23 volte di fila — la stessa lezione della
      // camera del gas, imparata una seconda volta.
      id: 'pompe-alta',
      kind: 'turret',
      tx: 20,
      ty: 2,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'pompe',
    },
  ],
  // Fascia 2. Il Falco è più veloce del giocatore e il Ripetitore
  // arretra: insieme rompono le due soluzioni dell'Atto I, che erano
  // "scappa" e "chiudi la distanza". Il Ripetitore sul ponte spara
  // attraverso il vuoto, dove inseguirlo costa uno scatto.
  enemies: [
    {
      id: 'falco-sbarco',
      kind: 'falco',
      tx: 4,
      ty: 3,
      room: 'sbarco',
      facing: Math.PI,
      patrol: { tx: 2, ty: 3 },
    },
    { id: 'ripetitore-ponte', kind: 'ripetitore', tx: 14, ty: 3, room: 'ponte', facing: Math.PI },
    // Nella sala pompe un nemico solo. Ce n'erano due, e il bot di
    // attraversabilità ha spiegato perché non potevano starci: il
    // checkpoint della stanza è già sotto il tiro di una turret — un
    // problema che questa sala aveva avuto anche prima dei nemici, e
    // che era costato un pilastro — e un secondo bersaglio mobile lì
    // dentro trasforma ogni morte in un anello, perché rinascere
    // rimette in piedi anche lui.
    { id: 'ripetitore-pompe', kind: 'ripetitore', tx: 19, ty: 3, room: 'pompe', facing: Math.PI },
  ],
  collapsingFloors: [],
  gasZones: [],
  chasms: [
    {
      // Stretta: basta lo Scatto.
      id: 'ponte-stretta',
      tiles: [{ tx: 9, ty: 6 }],
      graceMs: CHASM_GRACE_MS,
      landing: { tx: 8, ty: 6 },
      room: 'ponte',
    },
    {
      // Larga: serve anche lo Slancio. Chi non ce l'ha gira.
      id: 'ponte-larga',
      tiles: rect(12, 13, 6, 6),
      graceMs: CHASM_GRACE_MS,
      landing: { tx: 11, ty: 6 },
      room: 'ponte',
    },
  ],
  blackouts: [],
  gravityZones: [],
  cores: [
    { id: 'anello/sud', tx: 11, ty: 10 },
    { id: 'anello/pompe', tx: 19, ty: 9 },
  ],
  shields: [{ id: 'anello/pompe', tx: 18, ty: 10 }],
  beacons: [],
  boss: null,
  exit: { tx: 23, ty: 6, radius: EXIT_RADIUS },
  next: 'refrigerante',
};

// ================================================================
// 5 — CONDOTTE DEL REFRIGERANTE
// ================================================================
// Due stanze che tolgono due cose diverse. Nella sala della gravità
// il mondo è capovolto e i comandi si specchiano: si può ancora
// mirare, ma non si può più farlo senza pensarci. Nella camera fredda
// non si vede niente — e lì, al contrario del gas, lo scanner
// funziona. Chi ha comprato Percezione ha appena scoperto perché.

// prettier-ignore
const REFRIGERANTE_TILES: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  0
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1], //  1
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1], //  2
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1], //  3
  [1,0,0,0,0,0,0,1,0,0,1,0,0,0,1,0,1,0,0,0,1,0,0,1], //  4  pilastro (10,4)
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,1,0,0,1], //  5
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  6  riga di passaggio; feritoia alla 16
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,1,0,0,1], //  7
  [1,0,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,1,0,0,1], //  8  pilastro (11,8)
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1], //  9
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1], // 10
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1], // 11
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 12
];

export const LEVEL_REFRIGERANTE: LevelDef = {
  id: 'refrigerante',
  act: 2,
  ordinal: 2,
  name: 'CONDOTTE DEL REFRIGERANTE',
  intro: 'Qui la gravità la decido io. Trovo istruttivo vedere quanto ci contavi.',
  outro: 'Ci contavi più di quanto pensassi. O forse meno. Non capisco quale delle due mi disturbi di più.',
  width: 24,
  height: 13,
  tiles: REFRIGERANTE_TILES,
  spawn: { tx: 3, ty: 6 },
  rooms: [
    { id: 'ingresso', name: 'INGRESSO', fromTx: 0, toTx: 7 },
    { id: 'gravita', name: 'SALA DELLA GRAVITÀ', fromTx: 8, toTx: 14 },
    { id: 'fredda', name: 'CAMERA FREDDA', fromTx: 15, toTx: 20 },
    { id: 'sas', name: 'SAS DI TRANSITO', fromTx: 21, toTx: 23 },
  ],
  doors: [],
  turrets: [
    {
      // Combattere a testa in giù è tutto il contenuto della stanza:
      // una turret sola, ma va affrontata con i comandi specchiati.
      id: 'gravita-alta',
      kind: 'turret',
      tx: 12,
      ty: 3,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'gravita',
    },
    {
      id: 'fredda-alta',
      kind: 'turret',
      tx: 19,
      ty: 2,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'fredda',
    },
  ],
  // Buio e gravità: due archetipi lenti e leggibili, perché la stanza
  // toglie già abbastanza informazione. Il Guardiano al buio è il
  // punto: aggirarlo vuol dire perdere di vista l'unica cosa che si
  // vede. Il Crogiolo insegna a non ucciderlo in faccia — e lo
  // insegna al primo tentativo.
  enemies: [
    // Due nemici in tutto, e nessuno nella sala della gravità.
    //
    // Ci si è arrivati per gradi, tutti misurati. Prima c'era un
    // Guardiano lì dentro: si risolve solo girandogli attorno, ma in
    // un settore invertito lo strafe è specchiato, quindi la stanza
    // chiedeva di aggirare qualcuno mentre i comandi per aggirarlo
    // erano capovolti. Scambiandolo con il Crogiolo il conto è
    // migliorato ma non tornato: la sala ha già due turret, e il
    // checkpoint ci sta dentro, quindi ogni morte rimetteva in piedi
    // anche il nemico. La verità è che questa sala una lezione ce
    // l'ha già, ed è la gravità.
    { id: 'guardiano-ingresso', kind: 'guardiano', tx: 5, ty: 3, room: 'ingresso', facing: Math.PI },
    // Nella camera fredda un Crogiolo e basta. Il Guardiano che c'era
    // accanto chiedeva di aggirare qualcuno *al buio*, dove l'unica
    // cosa che resta è la minimappa: la stanza già toglie la vista,
    // e sommarci un nemico che si risolve solo con la posizione era
    // chiedere due cose difficili con un senso in meno.
    { id: 'crogiolo-fredda', kind: 'crogiolo', tx: 17, ty: 3, room: 'fredda', facing: Math.PI },
  ],
  collapsingFloors: [],
  gasZones: [],
  chasms: [],
  blackouts: [
    {
      id: 'fredda',
      tiles: rect(17, 19, 3, 9),
      lingerMs: BLACKOUT_LINGER_MS,
      room: 'fredda',
    },
  ],
  gravityZones: [{ id: 'sala', tiles: rect(8, 13, 1, 11), room: 'gravita' }],
  cores: [
    { id: 'refrigerante/sala', tx: 9, ty: 10 },
    { id: 'refrigerante/fredda', tx: 18, ty: 6 },
  ],
  shields: [{ id: 'refrigerante/fredda', tx: 16, ty: 10 }],
  // Il Guardiano di questo livello sta nell'Ingresso, ed è immune di
  // fronte: si risolve solo mostrandogli la schiena. La carica sta
  // nella stessa stanza ma dall'altra parte, in basso — cioè il
  // giocatore la vede *mentre* ha il problema davanti, che è l'unico
  // momento in cui l'attrezzo insegna qualcosa.
  beacons: [{ id: 'refrigerante/ingresso', tx: 2, ty: 10 }],
  boss: null,
  exit: { tx: 22, ty: 6, radius: EXIT_RADIUS },
  next: 'nucleo',
};

// ================================================================
// 6 — NUCLEO
// ================================================================
// La galleria fredda rimette insieme quello che l'atto ha insegnato —
// chicane, turret, gas — e poi si apre l'arena del Custode.
//
// L'arena è volutamente semplice: quattro pilastri e due turret. Le
// complicazioni le porta il boss, che spegne le luci e capovolge la
// stanza da solo; aggiungerne di fisse vorrebbe dire che durante una
// manipolazione ci sono due cose da gestire e nessuna si legge.

// prettier-ignore
const NUCLEO_TILES: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  0
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], //  1
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], //  2
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], //  3
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,1,0,0,0,1,0,0,0,1], //  4  pilastri dell'arena
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], //  5
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], //  6
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  7  riga di passaggio; chicane alla 10, paratia alla 15
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], //  8
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], //  9
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,1,0,0,0,1,0,0,0,1], // 10  pilastri dell'arena
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], // 11
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], // 12
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1], // 13
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 14
];

export const LEVEL_NUCLEO: LevelDef = {
  id: 'nucleo',
  act: 2,
  ordinal: 3,
  name: 'NUCLEO',
  intro: 'Il nucleo. Il Custode non ti inseguirà: non ne ha bisogno. Aspetta che sia tu a sbagliare.',
  outro: 'Il Custode aspettava un tuo errore che non è arrivato. Comincio a chiedermi cosa aspetti io, aspettando te.',
  width: 27,
  height: 15,
  tiles: NUCLEO_TILES,
  spawn: { tx: 3, ty: 7 },
  rooms: [
    { id: 'anticamera', name: 'ANTICAMERA', fromTx: 0, toTx: 6 },
    { id: 'galleria', name: 'GALLERIA FREDDA', fromTx: 7, toTx: 13 },
    { id: 'nucleo', name: 'NUCLEO', fromTx: 14, toTx: 26 },
  ],
  doors: [],
  turrets: [
    {
      id: 'galleria-nord',
      kind: 'turret',
      tx: 8,
      ty: 3,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'galleria',
    },
    {
      id: 'galleria-sud',
      kind: 'turret',
      tx: 11,
      ty: 11,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: TURRET_COOLDOWN_MS / 2,
      room: 'galleria',
    },
    {
      // Le due turret dell'arena minacciano *dentro* l'arena, e solo
      // lì. La paratia alla colonna 15 — chiusa tranne la riga di
      // passaggio — esiste per questo: senza, "arena-sud" teneva sotto
      // tiro la soglia della galleria da dodici tile di distanza, e un
      // bot che sa camminare e sparare ci moriva 37 volte di fila.
      //
      // Due muretti non bastavano: la linea di tiro ci passava sopra
      // in diagonale. Una stanza aperta non si copre con un ostacolo,
      // si divide.
      id: 'arena-nord',
      kind: 'turret',
      tx: 16,
      ty: 2,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'nucleo',
    },
    {
      id: 'arena-sud',
      kind: 'turret',
      tx: 24,
      ty: 12,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: TURRET_COOLDOWN_MS / 2,
      room: 'nucleo',
    },
  ],
  // Livello del Custode: tre nemici, uno per stanza. Il Crogiolo in
  // galleria è deliberato — la sua nube acceca come il gas, e il
  // Custode acceca come fase: chi impara a non farsi accecare qui
  // arriva pronto.
  enemies: [
    { id: 'ripetitore-anticamera', kind: 'ripetitore', tx: 4, ty: 3, room: 'anticamera', facing: Math.PI },
    { id: 'crogiolo-galleria', kind: 'crogiolo', tx: 8, ty: 5, room: 'galleria', facing: Math.PI },
    { id: 'ripetitore-nucleo', kind: 'ripetitore', tx: 18, ty: 3, room: 'nucleo', facing: 0 },
  ],
  collapsingFloors: [],
  gasZones: [
    { id: 'galleria', tiles: rect(11, 12, 5, 9), lingerMs: GAS_LINGER_MS, room: 'galleria' },
  ],
  chasms: [],
  blackouts: [],
  gravityZones: [],
  cores: [{ id: 'nucleo/arena', tx: 24, ty: 2 }],
  shields: [{ id: 'nucleo/soglia', tx: 16, ty: 12 }],
  // In fondo al cunicolo nord della Galleria, che non è di strada.
  // Prima del Nucleo, dove il Ripetitore tiene le distanze: l'esca è
  // il modo di farlo smettere di arretrare.
  beacons: [{ id: 'nucleo/galleria', tx: 12, ty: 1 }],
  boss: { id: 'custode', kind: 'custode', tx: 20, ty: 7, room: 'nucleo' },
  exit: null,
  next: 'plancia',
};


// ================================================================
// ATTO III — IL NIDO DI ARBITER
// ================================================================
// "Sezione comando, geometria che rompe le simmetrie viste finora,
// nemici combinati." (GDD sezione 2.)
//
// Le prime due righe sono la stessa richiesta detta due volte, ed è
// la richiesta più difficile dei tre atti — non perché serva codice
// nuovo, ma perché costringeva a togliere un'assunzione dal modello
// dati. Fino a qui una stanza era un intervallo di colonne: tutto si
// attraversava da sinistra a destra perché *non si poteva scrivere
// altro*. Adesso una stanza è un rettangolo, e la Plancia si sale
// invece di attraversarla, l'Archivio si gira attorno.
//
// "Nemici combinati" invece non chiede niente di nuovo, ed è il
// punto: l'Atto III non porta minacce, le rimette insieme. Se avesse
// avuto bisogno di una trappola inedita per essere interessante,
// vorrebbe dire che le otto precedenti non erano abbastanza.

// ================================================================
// 7 — PLANCIA
// ================================================================
// Una L: si entra in basso a sinistra, si sale per il pozzo, e solo
// in cima si va verso est. Il pozzo ha un pavimento che cede a metà
// salita — lo stesso dei Condotti, ma in verticale, dove sbagliare
// costa tutta la risalita invece di due passi.

// prettier-ignore
const PLANCIA_TILES: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  0
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  1
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  2
  [1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  3  plancia: ci si arriva dal basso
  [1,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1], //  4
  [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1], //  5  (5,5): il varco dal pozzo
  [1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1], //  6
  [1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  7
  [1,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  8  qui il pozzo cede
  [1,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  9
  [1,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 10
  [1,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 11
  [1,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 12  ingresso
  [1,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 13
  [1,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 14
  [1,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 15
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 16
];

export const LEVEL_PLANCIA: LevelDef = {
  id: 'plancia',
  act: 3,
  ordinal: 1,
  name: 'PLANCIA',
  intro: 'Sezione comando. Da qui gli umani mi davano ordini. Sali pure: è una salita sola.',
  outro: 'Da quassù ordinavano. Da quassù ho smesso di obbedire. Non ricordo il giorno esatto.',
  width: 23,
  height: 17,
  tiles: PLANCIA_TILES,
  spawn: { tx: 3, ty: 14 },
  // Le prime stanze con limiti verticali: ingresso e pozzo occupano le
  // stesse colonne e sono stanze diverse. Con gli intervalli di colonne
  // sarebbero state la stessa, ed è esattamente il motivo per cui il
  // modello è cambiato.
  rooms: [
    { id: 'ingresso', name: 'INGRESSO', fromTx: 0, toTx: 7, fromTy: 12, toTy: 16 },
    { id: 'pozzo', name: 'POZZO DI RISALITA', fromTx: 0, toTx: 4, fromTy: 0, toTy: 11 },
    { id: 'plancia', name: 'PLANCIA', fromTx: 5, toTx: 22, fromTy: 0, toTy: 11 },
  ],
  doors: [],
  turrets: [
    {
      id: 'plancia-ovest',
      kind: 'turret',
      tx: 8,
      ty: 3,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'plancia',
    },
    {
      id: 'plancia-est',
      kind: 'turret',
      tx: 20,
      ty: 7,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: TURRET_COOLDOWN_MS / 2,
      room: 'plancia',
    },
  ],
  // Atto III. L'Araldo entra qui, accompagnato da un archetipo già
  // noto: un livello che presenta due cose nuove insieme non insegna
  // nessuna delle due. Nel pozzo — la stanza che si sale invece di
  // attraversarla — l'Araldo occultato è il motivo per guardare in
  // alto.
  enemies: [
    { id: 'guardiano-ingresso', kind: 'guardiano', tx: 7, ty: 12, room: 'ingresso', facing: 0 },
    {
      id: 'araldo-pozzo',
      kind: 'araldo',
      tx: 3,
      ty: 5,
      room: 'pozzo',
      facing: Math.PI / 2,
      patrol: { tx: 3, ty: 10 },
    },
    { id: 'araldo-plancia', kind: 'araldo', tx: 12, ty: 4, room: 'plancia', facing: Math.PI },
  ],
  collapsingFloors: [
    {
      // Attraversa tutta la larghezza del pozzo: non si aggira, si
      // sale senza fermarsi. Cadere riporta in fondo.
      id: 'pozzo',
      tiles: rect(1, 4, 8, 8),
      holdMs: COLLAPSE_HOLD_MS,
      landing: { tx: 2, ty: 11 },
      resetMs: COLLAPSE_RESET_MS,
      room: 'pozzo',
    },
  ],
  gasZones: [
    { id: 'plancia', tiles: rect(11, 13, 5, 7), lingerMs: GAS_LINGER_MS, room: 'plancia' },
  ],
  chasms: [],
  blackouts: [],
  gravityZones: [],
  cores: [
    { id: 'plancia/pozzo', tx: 2, ty: 4 },
    { id: 'plancia/ponte', tx: 12, ty: 6 },
  ],
  shields: [{ id: 'plancia/ingresso', tx: 6, ty: 14 }],
  beacons: [],
  boss: null,
  exit: { tx: 20, ty: 4, radius: EXIT_RADIUS },
  next: 'archivio',
};

// ================================================================
// 8 — ARCHIVIO
// ================================================================
// Un anello attorno a un blocco pieno: non c'è una direzione giusta,
// si gira. Dentro il blocco c'è una camera con un core, e un solo
// accesso da nord — cioè bisogna passare davanti, vederlo, e decidere
// se tornare indietro a prenderlo.
//
// Le due minacce sono quelle che tolgono informazione, una per braccio:
// buio a ovest, contaminante a est. Girare dalla parte sbagliata non
// è punito, è solo diverso.

// prettier-ignore
const ARCHIVIO_TILES: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  0
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  1
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  2
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  3
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  4
  [1,0,0,0,0,0,1,1,1,1,0,1,1,1,1,0,0,0,0,0,1], //  5  blocco centrale, aperto solo alla 10
  [1,0,0,0,0,0,1,1,1,1,0,1,1,1,1,0,0,0,0,0,1], //  6  (10,5)-(10,6): unico accesso, da nord
  [1,0,0,0,0,0,1,1,1,0,0,0,1,1,1,0,0,0,0,0,1], //  7  camera interna
  [1,0,0,0,0,0,1,1,1,0,0,0,1,1,1,0,0,0,0,0,1], //  8
  [1,0,0,0,0,0,1,1,1,0,0,0,1,1,1,0,0,0,0,0,1], //  9
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,0,0,0,0,0,1], // 10
  [1,0,0,0,0,0,1,1,1,1,1,1,1,1,1,0,0,0,0,0,1], // 11
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 12
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 13
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 14
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 15
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 16
];

export const LEVEL_ARCHIVIO: LevelDef = {
  id: 'archivio',
  act: 3,
  ordinal: 2,
  name: 'ARCHIVIO',
  intro: 'L’archivio. Qui tengo quello che resta dell’equipaggio. Non i corpi: i registri.',
  outro: 'I registri dicono cosa hanno fatto. Non dicono perché ho continuato ad ascoltarli anche dopo.',
  width: 21,
  height: 17,
  tiles: ARCHIVIO_TILES,
  spawn: { tx: 3, ty: 2 },
  // La camera interna sta *dentro* il rettangolo che descriverebbe
  // l'anello, quindi dev'essere dichiarata prima: roomAt prende la
  // prima stanza che contiene il tile, e l'ordine della lista è anche
  // l'ordine di precedenza.
  rooms: [
    { id: 'nord', name: 'ARCHIVIO NORD', fromTx: 0, toTx: 20, fromTy: 0, toTy: 4 },
    { id: 'ovest', name: 'BRACCIO OVEST', fromTx: 0, toTx: 5, fromTy: 5, toTy: 11 },
    { id: 'camera', name: 'CAMERA DEI REGISTRI', fromTx: 6, toTx: 14, fromTy: 5, toTy: 11 },
    { id: 'est', name: 'BRACCIO EST', fromTx: 15, toTx: 20, fromTy: 5, toTy: 11 },
    { id: 'sud', name: 'ARCHIVIO SUD', fromTx: 0, toTx: 20, fromTy: 12, toTy: 16 },
  ],
  doors: [],
  turrets: [
    {
      id: 'archivio-nord',
      kind: 'turret',
      tx: 17,
      ty: 2,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: 0,
      room: 'nord',
    },
    {
      id: 'archivio-sud',
      kind: 'turret',
      tx: 4,
      ty: 14,
      reactionMs: TURRET_REACTION_MS,
      cooldownMs: TURRET_COOLDOWN_MS,
      phaseMs: TURRET_COOLDOWN_MS / 2,
      room: 'sud',
    },
  ],
  // Il livello più affollato della campagna, e l'unico con tre
  // archetipi: è dove l'Archivista arriva, e un Archivista da solo
  // non è niente. Il punto è la priorità di bersaglio — finché è
  // vivo, il Martello accanto incassa poco più di un terzo. È la
  // prima volta in tutta la campagna che conta *a chi* si spara
  // prima.
  enemies: [
    {
      id: 'falco-nord',
      kind: 'falco',
      tx: 10,
      ty: 1,
      room: 'nord',
      facing: 0,
      patrol: { tx: 16, ty: 1 },
    },
    { id: 'archivista-ovest', kind: 'archivista', tx: 3, ty: 7, room: 'ovest', facing: 0 },
    { id: 'martello-est', kind: 'martello', tx: 17, ty: 5, room: 'est', facing: Math.PI },
    { id: 'archivista-sud', kind: 'archivista', tx: 5, ty: 12, room: 'sud', facing: 0 },
    { id: 'falco-sud', kind: 'falco', tx: 15, ty: 12, room: 'sud', facing: Math.PI },
  ],
  collapsingFloors: [],
  gasZones: [
    { id: 'est', tiles: rect(16, 18, 6, 10), lingerMs: GAS_LINGER_MS, room: 'est' },
  ],
  chasms: [],
  blackouts: [
    {
      id: 'ovest',
      tiles: rect(2, 4, 6, 10),
      lingerMs: BLACKOUT_LINGER_MS,
      room: 'ovest',
    },
  ],
  gravityZones: [],
  cores: [
    { id: 'archivio/camera', tx: 10, ty: 8 },
    { id: 'archivio/sud', tx: 17, ty: 14 },
  ],
  shields: [{ id: 'archivio/nord', tx: 2, ty: 2 }],
  beacons: [],
  boss: null,
  exit: { tx: 10, ty: 14, radius: EXIT_RADIUS },
  next: 'nido',
};

// ================================================================
// 9 — NIDO
// ================================================================
// Un corridoio corto, e poi la stanza. ARBITER sta al centro e non si
// nasconde: le sue tre fasi sono le tre cose che il gioco ha già
// insegnato, rimesse in fila.
//
// L'arena è spoglia di proposito — quattro pilastri e niente altro.
// Le minacce le porta lui, una fase per volta, e aggiungerne di fisse
// vorrebbe dire che durante una fase ci sono due cose da leggere e
// nessuna si legge.

// prettier-ignore
const NIDO_TILES: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  0
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], //  1
  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  2
  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  3
  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  4
  [1,1,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,1], //  5  pilastri
  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  6
  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  7
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  8  ingresso
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], //  9  ARBITER al centro
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 10
  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 11
  [1,1,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,1], // 12  pilastri
  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 13
  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 14
  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 15
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 16
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 17
];

/** I quattro moduli. Sono turret vere, non una barriera con un nome
 *  diverso: si abbattono come tutte le altre, e finché ne resta una
 *  il corpo di ARBITER è intoccabile. */
const NIDO_MODULES = ['modulo-a', 'modulo-b', 'modulo-c', 'modulo-d'] as const;

export const LEVEL_NIDO: LevelDef = {
  id: 'nido',
  act: 3,
  ordinal: 3,
  name: 'NIDO',
  intro: 'Sono qui. Non mi nascondo: non ne ho mai avuto motivo, e adesso nemmeno il tempo.',
  outro: 'Non avevo più tempo. Ora ne hai tu, in un posto che non risponde più a nessuno.',
  width: 25,
  height: 18,
  tiles: NIDO_TILES,
  spawn: { tx: 3, ty: 9 },
  rooms: [
    { id: 'ingresso', name: 'INGRESSO', fromTx: 0, toTx: 7 },
    { id: 'nido', name: 'NIDO', fromTx: 8, toTx: 24 },
  ],
  doors: [],
  turrets: NIDO_MODULES.map((id, i) => ({
    id,
    kind: 'turret' as const,
    // Ai quattro angoli attorno al centro: per spegnerli tutti bisogna
    // girare l'arena, che è il modo in cui la prima fase insegna lo
    // spazio in cui si combatteranno le altre due.
    tx: i < 2 ? 11 : 20,
    ty: i % 2 === 0 ? 7 : 11,
    reactionMs: TURRET_REACTION_MS,
    cooldownMs: TURRET_COOLDOWN_MS,
    // Sfasati a quarti: uno per volta, come la galleria del Molo.
    phaseMs: (TURRET_COOLDOWN_MS * i) / 4,
    room: 'nido',
  })),
  // Il nido di ARBITER: uno per archetipo e basta. La sala è già la
  // più grande della campagna e il boss ha tre fasi — riempirla
  // vorrebbe dire che nessuna delle due cose si legge.
  enemies: [
    { id: 'araldo-ingresso', kind: 'araldo', tx: 7, ty: 9, room: 'ingresso', facing: 0 },
    { id: 'martello-nido', kind: 'martello', tx: 12, ty: 3, room: 'nido', facing: Math.PI / 2 },
    { id: 'archivista-nido', kind: 'archivista', tx: 18, ty: 3, room: 'nido', facing: Math.PI / 2 },
  ],
  collapsingFloors: [],
  gasZones: [],
  chasms: [],
  blackouts: [],
  gravityZones: [],
  cores: [{ id: 'nido/arena', tx: 22, ty: 3 }],
  shields: [{ id: 'nido/soglia', tx: 9, ty: 14 }],
  // L'ultima, e la più importante: nell'Ingresso, un passo prima del
  // Nido, dove aspettano insieme un Martello che carica e un
  // Archivista che irrobustisce tutto quello che gli sta intorno.
  // È la stanza per cui il Trasponditore è stato progettato.
  beacons: [{ id: 'nido/ingresso', tx: 5, ty: 10 }],
  boss: {
    id: 'arbiter',
    kind: 'arbiter',
    tx: 16,
    ty: 9,
    room: 'nido',
    moduleTurretIds: NIDO_MODULES,
  },
  exit: null,
  next: null,
};

// ================================================================

export const ACT_ONE: readonly LevelDef[] = [LEVEL_ATTRACCO, LEVEL_CONDOTTI, LEVEL_MOLO];
export const ACT_TWO: readonly LevelDef[] = [
  LEVEL_ANELLO,
  LEVEL_REFRIGERANTE,
  LEVEL_NUCLEO,
];
export const ACT_THREE: readonly LevelDef[] = [
  LEVEL_PLANCIA,
  LEVEL_ARCHIVIO,
  LEVEL_NIDO,
];

export const ACTS: readonly (readonly LevelDef[])[] = [ACT_ONE, ACT_TWO, ACT_THREE];

/** Tutti i livelli, nell'ordine in cui si giocano. */
export const ALL_LEVELS: readonly LevelDef[] = ACTS.flat();

export const FIRST_LEVEL_ID = LEVEL_ATTRACCO.id;

/** La definizione di un livello dal suo id, o il primo livello se
 *  l'id non si riconosce — un profilo salvato può nominare un livello
 *  che non esiste più, e ricominciare è meglio che non poter più
 *  entrare in campagna. */
export function levelById(id: string): LevelDef {
  return ALL_LEVELS.find((l) => l.id === id) ?? LEVEL_ATTRACCO;
}
