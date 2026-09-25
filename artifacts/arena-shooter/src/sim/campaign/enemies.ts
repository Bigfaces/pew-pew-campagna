// ================================================================
// NEMICI — il listino degli archetipi
// ================================================================
// Fino a qui la campagna aveva trabocchetti e boss, e niente in
// mezzo. Le turret non si muovono (vedi la nota su drone/turret in
// levelTypes.ts): sei livelli su nove non contenevano nulla che si
// spostasse e sparasse, mentre il GDD descrive il ciclo di stanza
// come "entra → leggi la minaccia → risolvi". La parte "minaccia che
// si muove" mancava.
//
// Questo file è solo il *listino*: dati, nessun comportamento. La
// macchina a stati sta in enemyAi.ts e chi la applica è
// CampaignWorld. È la stessa divisione che regge i livelli — un
// livello è un dato, un archetipo pure — e serve allo stesso scopo:
// aggiungere un nemico deve voler dire scrivere una riga, non toccare
// la simulazione.
//
// ---- Sui "punti deboli" e sugli "elementi" ----
//
// La richiesta era: ogni nemico ha un punto debole, o un elemento
// debole che gli fa più danni. Il gioco però ha **un'arma sola** e
// nessun elemento: fuoco, ghiaccio e scariche non esistono e non
// hanno una sorgente. Inventarli avrebbe voluto dire inventare anche
// tre munizioni per usarli.
//
// Stesso criterio già usato per la gravità (GDD sezione 4): si tiene
// l'intento, si butta la lettera. L'intento è "esiste un modo giusto
// di colpire questo nemico, e paga molto più del modo qualunque".
// Qui diventa due assi indipendenti:
//
//   • il PUNTO DEBOLE dice *dove* — dietro, il nucleo, la testa. È
//     geometria, la cosa che un raycaster sa fare meglio.
//   • la VULNERABILITÀ dice *quando* — ed è sempre qualcosa che il
//     giocatore già fa (aprire l'ottica, chiudere la distanza,
//     aspettare che l'altro abbia appena sparato). Un "elemento" che
//     il giocatore non può produrre sarebbe una statistica, non una
//     scelta.
//
// I due assi moltiplicano, quindi il colpo perfetto vale sei volte
// quello qualunque. Con BULLET_COOLDOWN a 1400 ms — l'otturatore
// manuale è il vincolo che tara tutto il resto — è la differenza fra
// uno scontro di due colpi e uno di dieci secondi.
// ================================================================

import { ENTITY_RADIUS, TILE } from '../constants';

export type EnemyKind =
  // Fascia 1 — Atto I
  | 'ronzino'
  | 'vedetta'
  | 'saldatore'
  // Fascia 2 — Atto II
  | 'ripetitore'
  | 'guardiano'
  | 'falco'
  | 'crogiolo'
  // Fascia 3 — Atto III
  | 'araldo'
  | 'martello'
  | 'archivista';

/** Dove si colpisce.
 *
 *  `rear` è l'arco posteriore, lo stesso criterio della Sentinella:
 *  aggirare, non insistere. `core` è una feritoia sul torace, esposta
 *  sempre ma piccola — chiede mira, non posizione. `head` è la banda
 *  alta della sagoma, e per colpirla serve alzare il tiro: è l'unica
 *  cosa in tutto il gioco che dia un significato all'inclinazione
 *  della visuale, che fino a ieri era solo una panoramica. */
export type WeakSpot = 'rear' | 'core' | 'head';

/** Quando il colpo vale il doppio. Nessuna è un elemento inventato:
 *  ognuna è una condizione che il giocatore produce o riconosce. */
export type Vulnerability =
  /** Nessuna finestra: conta solo il punto debole. Riservata a chi ha
   *  già una regola forte altrove (il Guardiano è immune di fronte:
   *  aggiungergli una finestra vorrebbe dire due lezioni in uno). */
  | 'nessuna'
  /** Solo con l'ottica aperta. Il ramo Precisione si ripaga qui. */
  | 'mirato'
  /** Sotto i tre tile. Paga chi tiene la posizione invece di
   *  arretrare — cioè chiede coraggio, non abilità. */
  | 'ravvicinato'
  /** Oltre i sei tile. L'opposto, e non è simmetria per simmetria:
   *  serve a chi è pericoloso da vicino per un motivo suo. */
  | 'distante'
  /** Mentre ha le bocchette aperte, subito dopo aver sparato. È il
   *  ritmo del fuoco incrociato riletto su un bersaglio mobile. */
  | 'sfiatato'
  /** Mentre è fermo. Chi si pianta per sparare è più preciso e più
   *  fragile nello stesso istante, che è il baratto che si vuole
   *  leggibile. */
  | 'immobile'
  /** Mentre avanza o carica, cioè quando è più minaccioso. */
  | 'scoperto';

/** Come fa male. `contact` deve toccarti, `ranged` è un hitscan con
 *  preavviso come quello delle turret, `none` è chi non attacca
 *  affatto e va comunque tolto di mezzo. */
export type EnemyAttack = 'ranged' | 'contact' | 'none';

export interface EnemyArchetype {
  kind: EnemyKind;
  name: string;
  /** 1, 2 o 3. Serve a un test: un livello non può ospitare una
   *  fascia più alta di quella del suo atto. */
  tier: 1 | 2 | 3;
  /** In colpi corpo. Il colpo base vale 1. */
  hp: number;
  radius: number;
  /** px/tick. PLAYER_SPEED è 2.2: sopra quella soglia il nemico non
   *  si semina più camminando, e va trattato diversamente. */
  speed: number;
  /** Altezza della sagoma in tile. Decide anche dove sta la testa. */
  height: number;
  attack: EnemyAttack;
  /** ms di linea di vista tenuta prima di sparare. Lo stesso
   *  contratto delle turret: il preavviso è leggibile e si può
   *  rompere la linea. */
  reactionMs: number;
  cooldownMs: number;
  /** Portata utile in tile. Oltre, non spara nemmeno. */
  rangeTiles: number;
  /** Distanza sotto la quale arretra, in tile. 0 = non arretra mai. */
  keepAwayTiles: number;
  weakSpot: WeakSpot;
  vulnerability: Vulnerability;
  xp: number;
  /** Solo il Guardiano: immune del tutto nell'arco frontale. Non è
   *  "più resistente davanti", è *immune*, perché una riduzione si
   *  supera sparando di più e un'immunità no. */
  frontImmune?: boolean;
  /** Solo il Crogiolo: morendo apre una nube che acceca. */
  gasOnDeath?: boolean;
  /** Solo l'Araldo: invisibile finché non spara. */
  cloaks?: boolean;
  /** Solo l'Archivista: irrobustisce gli alleati entro questo raggio
   *  in tile. */
  hardensAlliesTiles?: number;
  /** Solo il Martello: carica in linea retta a questa velocità. */
  chargeSpeed?: number;
  /** Quanto sta sollevato da terra, in tile. Chi vola ha il nucleo e
   *  la testa più in alto, e con i colpi mirati in verticale questo
   *  smette di essere una scelta di disegno: cambia dove si spara. */
  floatZ?: number;
}

/** Il moltiplicatore del punto debole. Tre e non due: con l'otturatore
 *  a 1400 ms, due colpi giusti contro tre qualunque non è una
 *  differenza che si *senta*. */
export const WEAK_SPOT_MULT = 3;

/** Quello della vulnerabilità. Si moltiplicano fra loro: il colpo
 *  perfetto vale sei. */
export const VULNERABILITY_MULT = 2;

// Una nota sulle vite, perché non sono scelte a occhio. Il banco di
// prova (tools/) misura il duello archetipo per archetipo, e la prima
// tornata ha mostrato che Ripetitore, Crogiolo e Araldo cadevano al
// primo colpo *sul solo punto debole*: la loro vulnerabilità — lo
// sfiato, la distanza — non aveva modo di contare, perché lo scontro
// finiva prima. Alzarli di uno li mette esattamente sopra il punto
// debole da solo e sotto punto debole più finestra: cioè rende la
// finestra la differenza fra un colpo e due, che è dove doveva stare.

/** Riduzione subita da chi sta vicino a un Archivista. Non azzera:
 *  ignorarlo è permesso, costa. */
export const HARDENED_MULT = 0.4;

/** Arco posteriore, in radianti da ciascun lato della schiena. Lo
 *  stesso della Sentinella: una regola imparata una volta deve valere
 *  ovunque, o non è una regola, è un'eccezione per bersaglio. */
export const ENEMY_REAR_ARC_HALF = Math.PI / 3;

/** Arco frontale immune del Guardiano. Più stretto dell'arco
 *  posteriore di proposito: la piastra è una piastra, non una cupola,
 *  e deve bastare spostarsi di poco per trovarne il bordo. */
export const ENEMY_FRONT_PLATE_HALF = Math.PI / 3.6;

/** Quanto resta "sfiatato" dopo aver sparato. */
export const VENT_WINDOW_MS = 900;

// Una nota sui tempi di reazione, perché sono il numero più delicato
// del file. Il giocatore muore in un colpo — vale per le turret, per i
// boss e ora per i nemici, e l'uniformità è deliberata. Quindi il
// preavviso *è* la lealtà dello scontro: è la finestra in cui si
// decide se sparare o togliersi dalla linea. La prima taratura andava
// da 480 a 900 ms, e il banco di prova ha detto che sotto i 650 non
// c'è nessuna decisione — c'è solo un dado. Sono stati alzati tutti.

/** Sotto/sopra queste distanze scattano `ravvicinato` e `distante`. */
export const CLOSE_RANGE_TILES = 3;
export const LONG_RANGE_TILES = 6;

/** La banda alta della sagoma che conta come testa, in frazione
 *  dell'altezza. Larga un quarto: più stretta sarebbe un tiro di
 *  precisione verticale che il mouse, con l'orizzonte che scorre
 *  invece di ruotare, non può promettere onestamente. */
export const HEAD_BAND_LOW = 0.74;

/** Il nucleo, come frazione dell'altezza, e il suo raggio sullo stesso
 *  asse.
 *
 *  La prima taratura lo metteva a metà sagoma (0.52), e il banco di
 *  prova ha mostrato subito perché era sbagliata: a quell'altezza, su
 *  un nemico alto quanto un uomo, il nucleo coincide con la quota
 *  dell'occhio. Cioè il mirino *a riposo* ci cadeva dentro, e il colpo
 *  al punto debole toccava a chiunque sparasse dritto senza saperlo —
 *  un bonus, non una scelta. Abbassarlo al ventre lo rende una mira,
 *  che è tutto il punto.
 *
 *  Il rapporto non dipende dalla distanza: `aimSlope` è una pendenza,
 *  e il bersaglio rimpicciolisce con la stessa legge. Sullo schermo
 *  resta "punta un po' più in basso" da vicino e da lontano. */
export const CORE_BAND_CENTRE = 0.35;
export const CORE_BAND_HALF = 0.08;

const R = ENTITY_RADIUS;

export const ENEMY_ARCHETYPES: Readonly<Record<EnemyKind, EnemyArchetype>> = {
  // ---- Fascia 1 ------------------------------------------------
  // Insegnano una cosa ciascuno, e nessuno dei tre punisce l'errore
  // più di una volta.
  ronzino: {
    kind: 'ronzino',
    // Vola: il suo nucleo sta più in alto di quanto il mirino a
    // riposo suggerisca.
    floatZ: 0.38,
    name: 'RONZINO',
    tier: 1,
    hp: 2,
    radius: R * 0.8,
    speed: 1.9,
    height: 0.75,
    attack: 'ranged',
    reactionMs: 850,
    cooldownMs: 1700,
    rangeTiles: 5,
    keepAwayTiles: 0,
    weakSpot: 'core',
    // Ti viene addosso, e premia chi non arretra: la reazione
    // istintiva — indietreggiare — è quella che allunga lo scontro.
    vulnerability: 'ravvicinato',
    xp: 25,
  },
  vedetta: {
    kind: 'vedetta',
    name: 'VEDETTA',
    tier: 1,
    hp: 2,
    radius: R,
    speed: 1.3,
    height: 1.05,
    attack: 'ranged',
    reactionMs: 950,
    cooldownMs: 2000,
    rangeTiles: 8,
    keepAwayTiles: 0,
    weakSpot: 'rear',
    // Si pianta per sparare: è più precisa e più fragile nello stesso
    // momento. Il primo nemico che insegna a guardare cosa sta
    // facendo invece di quanto gli manca.
    vulnerability: 'immobile',
    xp: 30,
  },
  saldatore: {
    kind: 'saldatore',
    name: 'SALDATORE',
    tier: 1,
    hp: 3,
    radius: R * 1.15,
    speed: 1.5,
    height: 1.15,
    attack: 'contact',
    reactionMs: 700,
    cooldownMs: 1200,
    rangeTiles: 0.8,
    keepAwayTiles: 0,
    weakSpot: 'head',
    vulnerability: 'scoperto',
    xp: 40,
  },

  // ---- Fascia 2 ------------------------------------------------
  // Qui ogni archetipo rompe una soluzione che funzionava nell'Atto I.
  ripetitore: {
    kind: 'ripetitore',
    name: 'RIPETITORE',
    tier: 2,
    hp: 4,
    radius: R,
    speed: 1.6,
    height: 1.05,
    attack: 'ranged',
    reactionMs: 700,
    cooldownMs: 1250,
    rangeTiles: 10,
    // Arretra: chiudere la distanza, che risolveva il Ronzino, qui
    // non funziona.
    keepAwayTiles: 4,
    weakSpot: 'core',
    vulnerability: 'sfiatato',
    xp: 45,
  },
  guardiano: {
    kind: 'guardiano',
    name: 'GUARDIANO',
    tier: 2,
    hp: 4,
    radius: R * 1.25,
    speed: 1.1,
    height: 1.25,
    attack: 'ranged',
    reactionMs: 900,
    cooldownMs: 2300,
    rangeTiles: 7,
    keepAwayTiles: 0,
    weakSpot: 'rear',
    vulnerability: 'nessuna',
    frontImmune: true,
    xp: 55,
  },
  falco: {
    kind: 'falco',
    floatZ: 0.3,
    name: 'FALCO',
    tier: 2,
    hp: 2,
    // Più veloce del giocatore (2.2): non si semina camminando, e
    // nemmeno scattando lo si distanzia a lungo. Va risolto sparando.
    radius: R * 0.85,
    speed: 2.6,
    height: 0.95,
    attack: 'ranged',
    reactionMs: 650,
    cooldownMs: 1500,
    rangeTiles: 7,
    keepAwayTiles: 0,
    weakSpot: 'head',
    vulnerability: 'mirato',
    xp: 50,
  },
  crogiolo: {
    kind: 'crogiolo',
    name: 'CROGIOLO',
    tier: 2,
    hp: 4,
    radius: R * 1.1,
    speed: 1.2,
    height: 1.1,
    attack: 'ranged',
    reactionMs: 800,
    cooldownMs: 2100,
    rangeTiles: 6,
    keepAwayTiles: 0,
    weakSpot: 'core',
    // La vulnerabilità e la minaccia dicono la stessa cosa: sta
    // lontano. Morendo apre una nube, quindi ucciderlo in faccia è
    // esattamente il modo di restarci dentro.
    vulnerability: 'distante',
    gasOnDeath: true,
    xp: 50,
  },

  // ---- Fascia 3 ------------------------------------------------
  araldo: {
    kind: 'araldo',
    name: 'ARALDO',
    tier: 3,
    hp: 4,
    radius: R,
    speed: 1.8,
    height: 1.05,
    attack: 'ranged',
    reactionMs: 700,
    cooldownMs: 1800,
    rangeTiles: 9,
    keepAwayTiles: 2,
    weakSpot: 'core',
    // Invisibile finché non spara, e vulnerabile proprio mentre
    // sfiata: la finestra per colpirlo è la stessa in cui si vede.
    // Due regole che coincidono invece di sommarsi.
    vulnerability: 'sfiatato',
    cloaks: true,
    xp: 70,
  },
  martello: {
    kind: 'martello',
    name: 'MARTELLO',
    tier: 3,
    hp: 5,
    radius: R * 1.6,
    speed: 1.4,
    height: 1.45,
    attack: 'contact',
    reactionMs: 900,
    cooldownMs: 2400,
    rangeTiles: 1.1,
    keepAwayTiles: 0,
    weakSpot: 'rear',
    vulnerability: 'scoperto',
    // Sotto DASH_SPEED (5.5) e sotto la carica della Sentinella: si
    // schiva, ma non si supera camminando.
    chargeSpeed: 3.2,
    xp: 90,
  },
  archivista: {
    kind: 'archivista',
    name: 'ARCHIVISTA',
    tier: 3,
    hp: 3,
    radius: R,
    speed: 1.0,
    height: 1.1,
    // Non spara mai. È l'unico nemico che non è una minaccia diretta
    // e va comunque ucciso per primo — la prima volta in tutta la
    // campagna in cui la priorità di bersaglio conta.
    attack: 'none',
    reactionMs: 0,
    cooldownMs: 0,
    rangeTiles: 0,
    keepAwayTiles: 7,
    weakSpot: 'head',
    vulnerability: 'immobile',
    hardensAlliesTiles: 5,
    xp: 80,
  },
};

export const ALL_ENEMY_KINDS: readonly EnemyKind[] = Object.keys(ENEMY_ARCHETYPES) as EnemyKind[];

export function archetypeOf(kind: EnemyKind): EnemyArchetype {
  return ENEMY_ARCHETYPES[kind];
}

/** Il nome della debolezza, per la HUD. Esiste solo col nodo Lettura
 *  Termica: senza, la si impara sparando, che è il modo giusto la
 *  prima volta e una tassa dalla quinta in poi. */
export const WEAK_SPOT_LABEL: Readonly<Record<WeakSpot, string>> = {
  rear: 'DORSO',
  core: 'NUCLEO',
  head: 'TESTA',
};

export const VULNERABILITY_LABEL: Readonly<Record<Vulnerability, string>> = {
  nessuna: '—',
  mirato: 'OTTICA',
  ravvicinato: 'CORTO RAGGIO',
  distante: 'LUNGO RAGGIO',
  sfiatato: 'SFIATO',
  immobile: 'DA FERMO',
  scoperto: 'IN AVVICINAMENTO',
};

/** Raggio di contatto: quanto vicino deve arrivare chi colpisce
 *  toccando. In px, non in tile, perché è una collisione. */
export function contactRange(a: EnemyArchetype): number {
  return a.rangeTiles * TILE;
}
