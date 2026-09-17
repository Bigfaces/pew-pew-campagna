// ================================================================
// LEVEL DEFINITIONS — la forma di un livello
// ================================================================
// Fino allo Sprint 1 il livello era il modulo: una griglia in map.ts,
// e porta, drone, core, scudo e boss come costanti a livello di file.
// Funzionava finché il livello era uno. Tre livelli con quelle
// premesse avrebbero voluto dire tre copie di world.ts, o un world.ts
// pieno di rami su "che livello è".
//
// Quindi il livello diventa un dato: una LevelDef che descrive mappa,
// stanze, trabocchetti, raccoglibili e boss. CampaignWorld ne prende
// una e non sa quale sia — è la stessa disciplina per cui la sim
// dell'Arena non sa che esiste una minimappa.
//
// Una nota sull'unificazione drone/turret: il "drone" del Magazzino
// non si è mai mosso. Linea di vista, tempo di reazione, colpo,
// cooldown — è esattamente il turret laser della sezione 4 del GDD.
// Tenere due entità identiche per due nomi diversi avrebbe raddoppiato
// la logica per una differenza puramente visiva, quindi `kind` decide
// come si disegna e nient'altro.
// ================================================================

import { TILE } from '../constants';
import type { EnemyKind } from './enemies';

export interface TilePos {
  tx: number;
  ty: number;
}

/** Una stanza è un rettangolo di tile.
 *
 *  Fino all'Atto II era solo un intervallo di colonne, perché tutti i
 *  livelli erano corridoi da sinistra a destra: la colonna bastava a
 *  dire dove sei. Ma quella semplificazione *era* la linearità, scritta
 *  dentro il modello dati — e l'Atto III chiede esplicitamente
 *  "geometria che rompe le simmetrie viste finora" (GDD sezione 2).
 *  Con le stanze a colonne non si poteva fare: due stanze affiancate in
 *  verticale sarebbero state la stessa stanza.
 *
 *  I limiti verticali restano facoltativi, e la loro assenza vuol dire
 *  "tutta l'altezza". Così i sei livelli lineari non hanno dovuto
 *  cambiare di una riga: un corridoio è un caso particolare di
 *  rettangolo, non un modello diverso. */
export interface RoomDef {
  id: string;
  /** Etichetta mostrata nella HUD. */
  name: string;
  /** Estremi inclusi, in colonne di tile. */
  fromTx: number;
  toTx: number;
  /** Estremi inclusi in righe. Assenti = tutta l'altezza della mappa. */
  fromTy?: number;
  toTy?: number;
}

/** Porta stagna a tempo (GDD sezione 4). */
export interface DoorDef {
  id: string;
  /** Superare questa colonna arma il timer. */
  sensorTx: number;
  /** Tile che diventano solide allo scadere. */
  tiles: readonly TilePos[];
  delayMs: number;
  /** Stanza a cui appartiene, per il reset alla morte. */
  room: string;
}

/** Turret laser, e il drone che ne è un caso particolare. */
export interface TurretDef {
  id: string;
  kind: 'drone' | 'turret';
  tx: number;
  ty: number;
  /** Linea di vista da tenere prima di sparare: è il "tempo di
   *  reazione leggibile" del GDD, cioè l'unica cosa che rende la
   *  minaccia superabile invece che subita. */
  reactionMs: number;
  cooldownMs: number;
  /** Sfasamento iniziale del cooldown. È tutto ciò che serve per il
   *  corridoio a fuoco incrociato: due turret identiche sfasate si
   *  superano leggendo il ritmo, e non serve una nuova entità. */
  phaseMs: number;
  room: string;
}

/** Pavimento che cede: starci sopra troppo a lungo riporta indietro.
 *  Non è una morte — è un costo di tempo, e va letto come tale. */
export interface CollapsingFloorDef {
  id: string;
  tiles: readonly TilePos[];
  /** Quanto si può restare sopra prima che ceda. */
  holdMs: number;
  /** Dove si finisce: nessuna fisica di caduta, solo un warp di stato
   *  come dice il GDD. */
  landing: TilePos;
  /** Quanto ci mette a tornare calpestabile. */
  resetMs: number;
  room: string;
}

/** Gas/EMP: non uccide, acceca. Toglie minimappa e ottica finché non
 *  ne esci, più una coda. Colpisce di proposito proprio i nodi che il
 *  giocatore può aver comprato nel ramo Percezione: una trappola che
 *  ignora le tue scelte non è una trappola, è un ostacolo. */
export interface GasZoneDef {
  id: string;
  tiles: readonly TilePos[];
  /** Quanto dura l'accecamento dopo essere usciti dalla nube. */
  lingerMs: number;
  room: string;
}

/** Passerella sospesa: il vuoto fra due tratti di camminamento.
 *
 *  Non è un muro — ci si passa sopra — ma restarci più di `graceMs`
 *  fa cadere. È tarato perché camminare non basti e lo scatto sì: un
 *  tile a passo normale costa ~240 ms, in scatto ~100. È l'unico
 *  punto in cui l'albero delle abilità cambia la *geometria* del
 *  livello invece di una statistica, e proprio per questo ogni
 *  voragine deve avere una strada alternativa a piedi — un nodo
 *  facoltativo non può essere l'unico modo di finire un livello.
 *  Lo verifica un test strutturale. */
export interface ChasmDef {
  id: string;
  tiles: readonly TilePos[];
  /** Quanto si può restare sospesi prima di cadere. */
  graceMs: number;
  /** Dove si riemerge. Come il pavimento che cede: un costo di tempo,
   *  non una morte. */
  landing: TilePos;
  room: string;
}

/** Blackout a settori: qui non si vede.
 *
 *  Non tocca la simulazione — è il gemello visivo del gas. Ma al
 *  contrario del gas *non* spegne la minimappa: al buio lo scanner
 *  diventa l'unica cosa che resta, ed è il momento in cui il ramo
 *  Percezione si ripaga. Due trappole che tolgono informazione in modi
 *  opposti valgono più di due che la tolgono allo stesso modo. */
export interface BlackoutZoneDef {
  id: string;
  tiles: readonly TilePos[];
  /** Quanto resta buio dopo esserne usciti. */
  lingerMs: number;
  room: string;
}

/** Gravità alterata.
 *
 *  In un gioco senza asse verticale la gravità non può tirare in
 *  basso: non esiste un basso. Quello che può fare è cambiare *dove
 *  credi che sia*. In un settore invertito il mondo si ribalta — il
 *  soffitto diventa il pavimento — e lo strafe si specchia con lui.
 *  È la stessa riscrittura onesta fatta per i nomi dei nodi: si tiene
 *  l'intento (disorientare, togliere l'automatismo del movimento) e
 *  si butta la lettera, invece di inventare una fisica che il motore
 *  non ha. */
export interface GravityZoneDef {
  id: string;
  tiles: readonly TilePos[];
  room: string;
}

export interface CoreDef {
  id: string;
  tx: number;
  ty: number;
}

export interface ShieldPickupDef {
  id: string;
  tx: number;
  ty: number;
}

/** Una carica di Trasponditore per terra. Stessa forma dello scudo
 *  perché è la stessa cosa: un consumabile che il level design
 *  posiziona, non una statistica. Dove sta è la leva vera — una
 *  carica appena prima di una stanza con un Guardiano dice al
 *  giocatore cosa gli serve senza scriverglielo. */
export interface BeaconPickupDef {
  id: string;
  tx: number;
  ty: number;
}

/** Tre boss, tre macchine a stati. La Sentinella insegue e si scopre
 *  caricando; il Custode non si muove e si scopre fra una
 *  manipolazione e l'altra; ARBITER attraversa tre fasi che riusano
 *  entrambi. Non hanno abbastanza in comune per una macchina sola,
 *  quindi `kind` sceglie quale logica gira invece di parametrizzarne
 *  una fino a farla sembrare tutte e tre. */
export type BossKind = 'sentinella' | 'custode' | 'arbiter';

export interface BossDef {
  id: string;
  kind: BossKind;
  tx: number;
  ty: number;
  room: string;
  /** Solo per ARBITER: le turret che fanno da moduli. Finché una di
   *  queste è viva, il corpo è invulnerabile — è la prima fase, e
   *  riusa le turret invece di inventare una barriera. */
  moduleTurretIds?: readonly string[];
}

/** Un nemico piazzato sulla mappa.
 *
 *  `room` non è ridondante con la posizione: è il **guinzaglio**. Un
 *  nemico non lascia la stanza in cui è stato messo, perché senza quel
 *  limite bastava farsi vedere una volta per trascinarsi dietro il
 *  livello intero — e il ciclo "entra, leggi la minaccia, risolvi"
 *  diventava una fuga unica dall'inizio alla fine. Dichiararla invece
 *  di dedurla dalla posizione permette anche di legare a una stanza
 *  chi sta sulla soglia.
 *
 *  `patrol` è l'altro capo della spola. Assente = resta al suo posto e
 *  scandaglia. Non esiste una pattuglia casuale di proposito:
 *  sposterebbe i nemici fuori dalla composizione pensata per la
 *  stanza, che è dove sta il level design. */
export interface EnemySpawnDef {
  id: string;
  kind: EnemyKind;
  tx: number;
  ty: number;
  room: string;
  /** Angolo iniziale in radianti. Da dove guarda decide se la stanza
   *  si apre con un avvistamento o con un'occasione. */
  facing?: number;
  patrol?: TilePos;
}

/** L'uscita di un livello senza boss. Raggiungerla chiude il livello:
 *  è il gemello della sconfitta del boss, non un caso a parte. */
export interface ExitDef {
  tx: number;
  ty: number;
  radius: number;
}

export interface LevelDef {
  id: string;
  /** A quale atto appartiene (1..3). */
  act: number;
  /** Numero dentro l'atto (1..3). */
  ordinal: number;
  name: string;
  /** Riga che ARBITER pronuncia entrando. */
  intro: string;
  /** Riga che ARBITER pronuncia a livello completato (uscita raggiunta
   *  o boss sconfitto). Risponde all'`intro`: la chiude, o la lascia
   *  peggio di come l'aveva trovata. Vive accanto a `intro` e non nelle
   *  battute per-evento di `ui/arbiter.ts` perché quelle commentano
   *  *cosa* è successo nella simulazione (una porta, un core, un
   *  drone), mentre questa commenta il pensiero specifico con cui
   *  ARBITER aveva aperto *questo* livello — un testo non deducibile
   *  dagli eventi, quindi non riusabile fra livelli diversi. */
  outro: string;
  width: number;
  height: number;
  /** 0 = pavimento, 1 = muro. */
  tiles: readonly (readonly number[])[];
  spawn: TilePos;
  rooms: readonly RoomDef[];
  doors: readonly DoorDef[];
  turrets: readonly TurretDef[];
  enemies: readonly EnemySpawnDef[];
  collapsingFloors: readonly CollapsingFloorDef[];
  gasZones: readonly GasZoneDef[];
  chasms: readonly ChasmDef[];
  blackouts: readonly BlackoutZoneDef[];
  gravityZones: readonly GravityZoneDef[];
  cores: readonly CoreDef[];
  shields: readonly ShieldPickupDef[];
  beacons: readonly BeaconPickupDef[];
  boss: BossDef | null;
  exit: ExitDef | null;
  /** Livello successivo, o null se è l'ultimo dell'atto. */
  next: string | null;
}

/** Tile lookup per una definizione. Fuori mappa è muro, come
 *  nell'Arena: così il raycast non ha mai bisogno di un caso
 *  speciale ai bordi. */
export function tileAt(level: LevelDef, tx: number, ty: number): number {
  if (tx < 0 || tx >= level.width || ty < 0 || ty >= level.height) return 1;
  return level.tiles[ty]![tx]!;
}

function roomContains(level: LevelDef, r: RoomDef, tx: number, ty: number): boolean {
  if (tx < r.fromTx || tx > r.toTx) return false;
  const y0 = r.fromTy ?? 0;
  const y1 = r.toTy ?? level.height - 1;
  return ty >= y0 && ty <= y1;
}

/** In quale stanza cade un tile.
 *
 *  Vince la prima che lo contiene, quindi l'ordine della lista è anche
 *  l'ordine di precedenza — utile quando una stanza piccola sta dentro
 *  il rettangolo di una grande. Il fallback è l'ultima stanza: un tile
 *  fuori da ogni rettangolo dichiarato appartiene alla fine del
 *  livello, non a "nessun posto", o il checkpoint tornerebbe indietro
 *  attraversando un angolo non mappato. */
export function roomAt(level: LevelDef, tx: number, ty: number): string {
  for (const r of level.rooms) {
    if (roomContains(level, r, tx, ty)) return r.id;
  }
  return tx < level.rooms[0]!.fromTx
    ? level.rooms[0]!.id
    : level.rooms[level.rooms.length - 1]!.id;
}

/** Ordine di avanzamento di una stanza: i checkpoint non tornano mai
 *  indietro, e l'indice nella lista è ciò che lo definisce. */
export function roomOrder(level: LevelDef, id: string): number {
  const i = level.rooms.findIndex((r) => r.id === id);
  return i < 0 ? 0 : i;
}

/** Il rettangolo di una stanza in px, che è il guinzaglio dei nemici
 *  che ci stanno dentro. Mezzo tile di margine per lato: senza, un
 *  nemico incollato al bordo risulterebbe già fuori e passerebbe la
 *  vita a rientrare da dov'è. */
export function roomBoundsPx(
  level: LevelDef,
  id: string,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const r = level.rooms.find((x) => x.id === id);
  if (!r) return null;
  const y0 = r.fromTy ?? 0;
  const y1 = r.toTy ?? level.height - 1;
  return {
    minX: r.fromTx * TILE,
    minY: y0 * TILE,
    maxX: (r.toTx + 1) * TILE,
    maxY: (y1 + 1) * TILE,
  };
}

export function roomName(level: LevelDef, id: string): string {
  return level.rooms.find((r) => r.id === id)?.name ?? id;
}
