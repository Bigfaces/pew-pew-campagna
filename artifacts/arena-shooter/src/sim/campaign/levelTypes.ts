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

export interface TilePos {
  tx: number;
  ty: number;
}

/** Una stanza è un intervallo di colonne. I livelli sono lineari
 *  (GDD sezione 3), quindi la colonna basta a dire dove sei: niente
 *  poligoni, niente test di appartenenza a volumi arbitrari. */
export interface RoomDef {
  id: string;
  /** Etichetta mostrata nella HUD. */
  name: string;
  /** Estremi inclusi, in colonne di tile. */
  fromTx: number;
  toTx: number;
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

export interface BossDef {
  id: string;
  tx: number;
  ty: number;
  room: string;
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
  /** Numero mostrato al giocatore (1..3 nell'Atto I). */
  ordinal: number;
  name: string;
  /** Riga che ARBITER pronuncia entrando. */
  intro: string;
  width: number;
  height: number;
  /** 0 = pavimento, 1 = muro. */
  tiles: readonly (readonly number[])[];
  spawn: TilePos;
  rooms: readonly RoomDef[];
  doors: readonly DoorDef[];
  turrets: readonly TurretDef[];
  collapsingFloors: readonly CollapsingFloorDef[];
  gasZones: readonly GasZoneDef[];
  cores: readonly CoreDef[];
  shields: readonly ShieldPickupDef[];
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

/** In quale stanza cade una colonna. L'ultima stanza fa da default:
 *  una colonna oltre l'ultimo intervallo dichiarato appartiene alla
 *  fine del livello, non a "nessun posto". */
export function roomAtTx(level: LevelDef, tx: number): string {
  for (const r of level.rooms) {
    if (tx >= r.fromTx && tx <= r.toTx) return r.id;
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

export function roomName(level: LevelDef, id: string): string {
  return level.rooms.find((r) => r.id === id)?.name ?? id;
}
