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
import type { CampaignDifficulty } from './types';

// ---- Player start / respawn ----
/** Brief lockout after a checkpoint respawn so a turret or a boss
 *  charge already in flight cannot kill the player a second time on
 *  the same tick it sent them back. Mirrors the Arena's own
 *  SPAWN_PROTECTION.
 *
 *  Resta come pavimento assoluto e come valore di riferimento; la
 *  grazia vera la sceglie RESPAWN_GRACE_MS qui sotto. */
export const RESPAWN_INVULN_MS = 800;

/** Quanto dura l'intoccabilità dopo un respawn, per difficoltà.
 *
 *  Il primo tester è rimasto bloccato qui, e non era una questione di
 *  bravura: era aritmetica. Con 800 ms fissi, al checkpoint del
 *  MAGAZZINO si rinasceva davanti a un drone che ha 500 ms di
 *  reazione e nessun cono visivo — quindi sparava nell'istante esatto
 *  in cui la grazia finiva. Vita misurata: 0,82 s, sempre la stessa,
 *  all'infinito.
 *
 *  La conseguenza è peggiore della morte in sé. L'otturatore ha un
 *  ciclo di BULLET_COOLDOWN (1400 ms), quindi in 820 ms si spara
 *  **una volta sola**; e siccome il respawn ricura i nemici della
 *  stanza (vedi resetEnemiesIn), quel singolo colpo veniva annullato
 *  prima del tentativo successivo. Un nemico da due punti vita
 *  diventava immortale: misurato col bot a mira perfetta, 49 morti in
 *  40 secondi e zero progressi. Non "difficile": impossibile. Ed era
 *  la modalità che si consiglia a chi prova il gioco per la prima
 *  volta.
 *
 *  Da qui la regola, che vale per tutte e tre le modalità: la grazia
 *  non deve durare quanto basta a *sopravvivere*, deve durare quanto
 *  basta ad **agire**. Sotto un ciclo d'otturatore il giocatore non
 *  può nemmeno completare il gesto che il gioco gli chiede, e
 *  qualsiasi altro bilanciamento diventa irrilevante. */
export const RESPAWN_GRACE_MS: Readonly<Record<CampaignDifficulty, number>> = {
  /** Due colpi e il tempo di guardarsi intorno: la modalità esiste
   *  per imparare, e s'impara solo se si fa in tempo a provare. */
  tutorial: BULLET_COOLDOWN + 600,
  /** Un colpo pieno più il margine per decidere dove andare. */
  medio: BULLET_COOLDOWN + 200,
  /** Il minimo che rispetta la regola. Qui morire riavvia l'atto, non
   *  la stanza, quindi il ciclo stretto non può formarsi comunque: la
   *  soglia serve solo a non rendere il primo istante una lotteria. */
  roguelike: BULLET_COOLDOWN,
};

/** Quanto la grazia può *aspettare* prima di cominciare a scorrere,
 *  quando si rinasce dentro una linea di tiro da cui non si può
 *  uscire.
 *
 *  Il giro scorso ho scritto, qui sopra, che la grazia deve durare
 *  quanto basta ad agire, e ho creduto che bastasse allungarla. Non
 *  basta: misurato sui nove livelli, su cinque la vita dopo una morte
 *  dura **esattamente** RESPAWN_GRACE_MS — 2,00 s in tutorial, al
 *  tick. Cioè si muore nell'istante in cui si torna toccabili, di
 *  nuovo, all'infinito, ed è lo stesso ciclo del primo tester con un
 *  numero diverso sopra.
 *
 *  Il motivo è che quei livelli non offrono scampo: ARCHIVIO e NIDO
 *  hanno la stanza di partenza spazzata da due e da quattro torrette,
 *  e cercando una casella libera in tutta la mappa non se ne trova
 *  nessuna. Arretrare non è possibile, quindi la regola va tenuta
 *  dall'altro capo: finché si è sotto tiro l'orologio non parte.
 *
 *  Il tetto esiste perché la grazia non diventi un riparo: un ciclo
 *  d'otturatore in più, non uno di più. Chi rinasce sotto tiro ha
 *  comunque il tempo di un gesto, e chi rinasce al sicuro non se ne
 *  accorge nemmeno. */
export const RESPAWN_HOLD_MS = BULLET_COOLDOWN;

// ---- Trabocchetti ----
// I numeri; *dove* stanno i trabocchetti è dato del livello
// (levels.ts), non di questo file. La distinzione conta: questi si
// ritarano una volta e valgono per tutto l'atto, le posizioni si
// disegnano livello per livello.

/** Porta stagna a tempo: quanto passa dal sensore alla chiusura. */
export const DOOR_CLOSE_DELAY_MS = 3500;

/** Turret (e il drone, che ne è un caso particolare): linea di vista
 *  da tenere prima di sparare. È il "tempo di reazione leggibile" del
 *  GDD — ciò che rende la minaccia superabile invece che subita. */
export const TURRET_REACTION_MS = 500;
export const TURRET_COOLDOWN_MS = 1800;
export const TURRET_RADIUS = ENTITY_RADIUS;

/** Pavimento che cede: quanto si resta sopra prima del crollo, e
 *  quanto ci mette a tornare calpestabile.
 *
 *  Non è un tempo di reazione: è la traversata più un margine.
 *  Attraversare il pozzo dei Condotti camminando dritti costa 900 ms
 *  esatti (misurato simulando, non stimato: PLAYER_SPEED copre
 *  ~132 px/s e il pavimento è largo quattro tile). La prima taratura
 *  metteva la soglia proprio a 900 e il pavimento cedeva *sempre*,
 *  anche a chi non si fermava — cioè non era una scelta, era un muro
 *  con l'aria di una scelta.
 *
 *  1200 ms lascia ~300 ms di margine: si passa camminando, si passa
 *  correggendo la mira al volo, non si passa fermandosi. Fermarsi in
 *  mezzo al pozzo è esattamente l'errore che la trappola deve punire,
 *  e l'unico. */
export const COLLAPSE_HOLD_MS = 1200;
export const COLLAPSE_RESET_MS = 2500;

/** Gas/EMP: quanto dura l'accecamento dopo essere usciti dalla nube.
 *  Una coda, non un interruttore — uscire dal gas e riavere subito
 *  tutto renderebbe la nube un fastidio da attraversare invece che una
 *  zona da cui si esce disorientati. */
export const GAS_LINGER_MS = 1600;

/** Passerelle sospese: quanto si può restare sul vuoto prima di
 *  cadere.
 *
 *  180 ms divide i tre modi di passare su un tile di vuoto:
 *    camminando          ~242 ms  → si cade
 *    con Passo Lungo     ~206 ms  → si cade lo stesso
 *    in scatto            ~97 ms  → si passa
 *  e su due tile:
 *    in scatto           ~194 ms  → si cade
 *    con Slancio         ~129 ms  → si passa
 *
 *  Cioè: le passerelle strette chiedono lo Scatto, quelle larghe anche
 *  lo Slancio, e camminare non basta mai — nemmeno col nodo della
 *  velocità, che altrimenti avrebbe reso lo Scatto facoltativo per
 *  sbaglio.
 *
 *  È l'unico punto del gioco in cui un nodo dell'albero cambia la
 *  *geometria* di un livello e non una statistica, e proprio per
 *  questo ogni voragine deve avere una strada alternativa a piedi: un
 *  nodo facoltativo non può essere l'unico modo di finire un livello.
 *  Lo verifica levels.test.ts. */
export const CHASM_GRACE_MS = 180;

/** Blackout: quanto resta buio dopo esserne usciti. Più corto della
 *  coda del gas — il buio si attraversa, il contaminante ti resta
 *  addosso. */
export const BLACKOUT_LINGER_MS = 700;

/** Quanto vicino bisogna essere all'uscita perché il livello finisca. */
export const EXIT_RADIUS = 26;

// ---- Raccoglibili ----
export const CORE_PICKUP_RADIUS = 20;
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
/** Vale per qualsiasi turret abbattuta, drone compreso: erano la
 *  stessa entità anche prima che lo dicesse il codice. */
export const XP_TURRET_DOWN = 30;
/** Un colpo andato sul punto debole paga *subito*, non solo quando il
 *  nemico cade. È il modo in cui la debolezza si insegna senza
 *  scriverla nella HUD: la prima volta che succede, il numero verde
 *  arriva prima che si sia capito perché. */
export const XP_ENEMY_WEAK_HIT = 8;
export const XP_BOSS_HIT_SOLID = 25;
export const XP_BOSS_HIT_GRAZE = 12;
export const XP_BOSS_DEFEAT = 150;

// ---- Nemici ----
// I valori che stanno qui e non in enemies.ts sono quelli che non
// appartengono a un archetipo ma al *gioco*: quanto dura una nube,
// quanto resta visibile chi si occulta.

/** ms in cui un nemico che si occulta resta comunque visibile dopo
 *  aver sparato. Più lungo della finestra di sfiato (VENT_WINDOW_MS,
 *  900): vedere un Araldo che non si può più punire dice dov'è
 *  andato, ed è un'informazione, non una beffa. */
/** Quota dell'occhio del giocatore, in px dal pavimento. Deve valere
 *  quanto EYE_HEIGHT del renderer (render/camera.ts), che è dove il
 *  mirino sta davvero: se i due divergono, il colpo alla testa parte
 *  da una quota diversa da quella disegnata e il giocatore mira a una
 *  cosa e ne colpisce un'altra. Ridichiararlo invece di importarlo
 *  tiene la simulazione libera dal modulo di rendering — e un test lo
 *  verifica, perché una costante copiata a mano senza un guardiano è
 *  una costante che prima o poi diverge. */
export const PLAYER_EYE_Z = TILE / 2;

export const ENEMY_REVEAL_MS = 1500;

/** Semi-apertura del cono usato per capire se il primo nemico avvistato
 *  è "davanti" al giocatore, ai fini della legenda del punto debole
 *  (GDD.md sezione 22). Generoso apposta: chi gioca con un campo
 *  visivo stretto ha comunque il nemico ben oltre il bordo dello
 *  schermo, e l'innesco deve scattare lo stesso — non è un test di
 *  mira, è "l'hai appena visto?". */
export const ENEMY_SIGHTING_CONE_HALF = (50 * Math.PI) / 180;

/** Distanza minima, in tile, fra lo spawn di un livello e il nemico
 *  più vicino. Un test la impone su tutte e nove le mappe. */
export const ENEMY_SPAWN_CLEARANCE_TILES = 3;

/** ms di intoccabilità all'ingresso in un livello.
 *
 *  Esisteva già per il respawn da checkpoint; serviva anche qui, e
 *  per lo stesso identico motivo. Con le sole turret non si notava —
 *  sono ferme e si vedono — ma un nemico che pattuglia può trovarsi
 *  girato verso la porta nel momento in cui il livello comincia, e
 *  farsi sparare prima di aver toccato un tasto non è una difficoltà,
 *  è un dado. L'IA tratta il giocatore intoccabile come invisibile,
 *  quindi la finestra non viene nemmeno consumata dai tempi di
 *  reazione: comincia a contare quando comincia il gioco. */
export const LEVEL_START_GRACE_MS = 1200;

/** La nube del Crogiolo: raggio in tile e durata dell'accecamento. */
export const CROGIOLO_CLOUD_TILES = 3.2;
export const CROGIOLO_CLOUD_MS = 2200;

// ---- Trasponditore ----
// L'arma secondaria, e non è una seconda canna: non fa un solo punto
// di danno. Pianta un identificativo rubato, e per una finestra breve
// quel punto del pavimento è più il giocatore del giocatore. Le
// macchine si voltano — cioè mostrano la schiena, che è dove il
// moltiplicatore del punto debole già vive.
//
// Il motivo per cui non fa danno è lo stesso per cui i nemici non
// hanno elementi (vedi enemies.ts): un'arma che uccide competerebbe
// col fucile e scavalcherebbe il sistema punto debole x3 /
// vulnerabilità x2. Questa lo *alimenta*.

/** Quanto lontano si pianta, se non trova un muro prima. */
export const BEACON_RANGE_TILES = 6;

/** Raggio del richiamo. Serve anche la linea di vista: un nemico non
 *  insegue un segnale che non può vedere. */
export const BEACON_LURE_TILES = 5;

/** Quanto dura il richiamo.
 *
 *  Non è un numero scelto a sentimento: è calibrato *contro il
 *  cooldown del fucile*, che è l'unico orologio che questo gioco
 *  abbia. Lanciare costa anche il tempo di un colpo (vedi
 *  CampaignWorld.throwBeacon), quindi la finestra si legge così:
 *
 *    lancio a 0 ms  ->  fucile pronto a 1400  ->  secondo colpo a 2800
 *
 *  A 2600 ms il secondo colpo cade *fuori* dalla finestra: un'esca
 *  vale esattamente un colpo. È questa aritmetica, e non una regola
 *  scritta a parte, a impedire che il Trasponditore sia un
 *  interruttore che spegne il Guardiano — costringe a far sì che
 *  quel colpo sia quello da x6.
 *
 *  Con Otturatore Rapido (1150 ms) i colpi dentro la finestra
 *  diventano due, ed è voluto: è il ramo Precisione che si ripaga
 *  su un'arma che non è il fucile. */
export const BEACON_LIFETIME_MS = 2600;

/** Cariche all'inizio di ogni livello, e tetto massimo. Poche di
 *  proposito: due lanci per livello sono due decisioni, sei sarebbero
 *  un secondo grilletto. */
export const BEACON_CHARGES_START = 2;
export const BEACON_CHARGES_MAX = 3;

/** Di quanto si tira indietro l'esca dal muro che ha colpito, perché
 *  non finisca dentro la geometria. */
export const BEACON_WALL_MARGIN = 6;

/** XP cumulativa richiesta per raggiungere il livello (indice + 1).
 *
 *  Quindici livelli, cioè quattordici punti — e da quando esiste il
 *  terzo anello i nodi sono diciassette. La differenza è voluta, ed è
 *  la ragione stessa per cui il terzo anello esiste: finché i punti
 *  bastavano per tutto, l'albero era una lista della spesa che si
 *  riempiva da sola entro l'Atto II. Tre nodi che non si possono
 *  avere sono ciò che trasforma una lista in una build, e una seconda
 *  partita in una partita diversa.
 *
 *  Il tetto resta comunque legato all'albero: alzarlo fino a coprire
 *  diciassette nodi rifarebbe il difetto che questa tabella era stata
 *  ritarata per togliere.
 *
 *  Le prime quattro soglie sono rimaste dov'erano: erano calibrate su
 *  cosa si raggiunge *prima* che il boss muoia (la prima versione
 *  metteva il terzo punto a 240 XP, cioè insieme al bonus di vittoria
 *  — un punto guadagnato a partita finita, su un nodo che non si
 *  poteva più usare), e quel vincolo non è cambiato.
 *
 *  La nona soglia è scesa da 455 a 430 per una ragione sola, e la
 *  ragione l'ha trovata `balance:campaign`: chi attraversa la campagna
 *  senza raccogliere né ripulire niente guadagnava un punto in ogni
 *  livello tranne il quinto, dove restava fermo. Un livello che non
 *  paga nessuno è un livello che non conta, e dal codice non si
 *  vedeva.
 *
 *  Quelle nuove invece accettano di proposito che un run solo non
 *  basti: dieci nodi comprabili tutti alla prima partita non sarebbero
 *  un albero, sarebbero una lista che si riempie da sola. Il primo run
 *  paga un ramo intero più un nodo — abbastanza per specializzarsi
 *  davvero — e l'albero completo arriva verso il terzo. Le cifre le
 *  verifica `balance:campaign`, che le ricalcola invece di fidarsi di
 *  questo commento. */
export const LEVEL_XP_THRESHOLDS: readonly number[] = [
  // Tarata sul percorso di chi esplora e ripulisce: un punto o due per
  // livello, dal primo all'ultimo, e il quattordicesimo che arriva col
  // colpo finale. Le cifre esatte le ricalcola `balance:campaign`
  // camminando i livelli veri — questa lista è il risultato, non la
  // premessa.
  //
  // Ritarata quando sono arrivati i nemici mobili, e non di poco: le
  // taglie hanno quasi raddoppiato l'esperienza disponibile, da ~2000
  // a ~3800 per chi esplora. Con la tabella precedente l'albero si
  // riempiva entro la fine dell'Atto II, e chi tirava dritto arrivava
  // comunque a quattordici nodi su quattordici — cioè esattamente le
  // due cose che le invarianti 1b e 2b esistono per impedire. L'ha
  // detto l'armonica, non una partita.
  //
  // I passi non sono regolari, di proposito: la tabella deve
  // incastrarsi fra *due* curve diverse, e una progressione liscia che
  // va bene a una va male all'altra.
  0, 60, 180, 420, 700, 950, 1200, 1450, 1600, 1900, 2400, 2550, 2900, 3400, 3750,
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
  | 'lettura-termica'
  // Secondo anello, aperto dall'Atto II.
  | 'mira-stabile'
  | 'slancio'
  | 'ancoraggio'
  | 'sensori-inerziali'
  // Terzo anello, aperto dall'Atto III. Fino a ieri l'albero smetteva
  // di crescere alla fine del secondo atto, cioe' proprio dove il
  // gioco diventa piu' duro.
  | 'scatto-angolare'
  | 'piastra-reattiva'
  | 'eco';

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
      {
        id: 'mira-stabile',
        cost: NODE_COST,
        name: 'Mira Stabile',
        desc: "L'ottica regge anche nel gas e a gravità invertita.",
        requires: 'aggancio-ottico',
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
      {
        id: 'slancio',
        cost: NODE_COST,
        name: 'Slancio',
        desc: 'Scatto più lungo: le passerelle più larghe diventano passabili.',
        requires: 'scatto',
      },
      {
        id: 'scatto-angolare',
        cost: NODE_COST,
        name: 'Scatto Angolare',
        desc: 'Lo scatto si può sterzare: si finisce dietro, non oltre.',
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
      {
        id: 'ancoraggio',
        cost: NODE_COST,
        name: 'Ancoraggio',
        desc: 'La gravità invertita non ti specchia più i comandi.',
        requires: 'riserva-di-bordo',
      },
      {
        id: 'piastra-reattiva',
        cost: NODE_COST,
        name: 'Piastra Reattiva',
        desc: 'Un colpo assorbito ti restituisce subito il colpo.',
        requires: 'piastra-aggiuntiva',
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
      {
        id: 'sensori-inerziali',
        cost: NODE_COST,
        name: 'Sensori Inerziali',
        desc: 'Lo scanner regge anche dentro il contaminante.',
        requires: 'lettura-termica',
      },
      {
        id: 'eco',
        cost: NODE_COST,
        name: 'Eco',
        desc: "L'esca svela anche chi si occulta.",
        requires: 'sensori-inerziali',
      },
    ],
  },
];

// ---- Il Banco di Riconfigurazione ----
// Fra un atto e l'altro il giocatore passa da un banco di fabbricazione.
// Non vende niente: su questa stazione non è rimasto hardware da
// comprare. Rilavora quello che si ha già.
//
// Perché esista, e perché paghi in punti abilità invece che in una
// moneta sua, lo dice la revisione registrata in GDD.md sezione 13.
// In breve: l'XP è già tutta impegnata (3830 disponibili contro una
// soglia di 3750 — ottanta di margine), quindi una valuta ricavata
// dall'avanzo non avrebbe niente da spendere; e il punto abilità è
// l'unica cosa in questo gioco che sia già scarsa. Farlo pagare al
// banco è ciò che trasforma l'albero da calendario di consegne a
// scelta: misurato, la sovrapposizione media fra due giocatori a fine
// campagna passa dall'84% al 65%, e le build legali da 157 a 65039.
//
// La regola che tiene in piedi tutto è una sola, ed è verificata da un
// test: **nessun innesto è guadagno puro**. Ognuno ha un `takes` non
// vuoto, perché è l'unica cosa che i diciassette nodi dell'albero non
// hanno — lì ogni scelta è un regalo, e una progressione fatta solo di
// regali non è una scelta.

export type ShopItemId =
  | 'otturatore-spinto'
  | 'eco-ampio'
  | 'zavorra-alleggerita'
  | 'doppio-innesco'
  | 'scatto-teso'
  | 'piastra-fusa';

export interface ShopItemDef {
  id: ShopItemId;
  /** L'atto al termine del quale il banco lo offre. Passato quel
   *  varco l'innesto non torna: è la ragione per cui la scelta pesa. */
  act: 1 | 2;
  name: string;
  /** Cosa dà. */
  gives: string;
  /** Cosa toglie. Non può essere vuoto — c'è un test che lo controlla,
   *  ed è l'invariante attorno a cui è costruito il banco intero. */
  takes: string;
  /** In punti abilità: gli stessi che comprano i nodi. */
  cost: number;
}

/** Quanto costa un innesto. Uno, come un nodo: è il confronto diretto
 *  fra le due spese a rendere la decisione leggibile. */
export const SHOP_ITEM_COST = 1;

// ---- Valori degli innesti ----
// Ognuno tocca due numeri: uno in meglio, uno in peggio. Sono deltas o
// assegnazioni applicate DOPO i nodi dell'albero (vedi skills.ts), in
// ordine di definizione, così due innesti che toccano lo stesso campo
// compongono in modo prevedibile invece che dipendere da cosa è stato
// comprato prima.

/** Otturatore Spinto: quanto accorcia la ricarica.
 *
 *  Centocinquanta e non duecento. Con Otturatore Rapido (1150) questo
 *  porta la ricarica a 1000 ms, e il soffitto dell'arco posteriore
 *  vuole che nessuna finestra contenga due ricariche: la più lunga
 *  misurata è 1733 ms (la Vedetta), quindi il limite vero è 866 ms.
 *  A −200 il margine sarebbe stato di 167 ms, troppo poco per una
 *  costante che qualcuno ritoccherà. A −150 sono 267. */
export const SHOP_OTTURATORE_SPINTO_DELTA_MS = -150;
/** ...e quanto rallenta l'apertura dell'ottica, che è il prezzo.
 *  Base 130, con Aggancio Ottico 70: questo li sovrascrive entrambi. */
export const SHOP_OTTURATORE_SPINTO_ADS_MS = 320;

/** Eco Ampio: il richiamo arriva più lontano... */
export const SHOP_ECO_AMPIO_LURE_TILES = 7;
/** ...ma l'esca dura meno. Il Trasponditore smette di essere un invito
 *  e diventa uno strappo: prende più nemici, per meno tempo. */
export const SHOP_ECO_AMPIO_LIFETIME_MS = 1800;

/** Zavorra Alleggerita: si cammina più in fretta... */
export const SHOP_ZAVORRA_SPEED_MULT = 1.15;
/** ...e lo scatto torna raro. Da 2600 a 3600 vuol dire uno scatto ogni
 *  tre secondi e mezzo: chi lo usava per schivare la carica deve
 *  imparare a camminare meglio. */
export const SHOP_ZAVORRA_DASH_COOLDOWN_MS = 3600;

/** Doppio Innesco: una carica d'esca in più di partenza... */
export const SHOP_DOPPIO_INNESCO_CHARGES = 3;
/** ...ma il lancio arriva meno lontano. Più esche, tutte da vicino. */
export const SHOP_DOPPIO_INNESCO_RANGE_TILES = 4;

/** Scatto Teso: lo scatto va più forte... */
export const SHOP_SCATTO_TESO_DASH_MULT = 1.35;
/** ...e il passo è più corto. Il contrario esatto della Zavorra:
 *  comprarli tutti e due riporta il passo quasi dov'era e lascia i due
 *  guadagni. È una sinergia trovabile, non nascosta — ma costa due
 *  punti su quattordici, e quei due punti sono due nodi. */
export const SHOP_SCATTO_TESO_SPEED_MULT = 0.88;

/** Piastra Fusa: una carica di scudo in più... */
export const SHOP_PIASTRA_FUSA_CHARGES_DELTA = 1;
/** ...e l'arma ricarica più lenta, perché la piastra pesa. Si somma a
 *  Otturatore Spinto invece di annullarlo: chi ha comprato tutti e due
 *  torna quasi al punto di partenza (-150 +150), che è il prezzo
 *  giusto per aver voluto le due cose insieme. */
export const SHOP_PIASTRA_FUSA_COOLDOWN_DELTA_MS = 150;

export const SHOP_ITEMS: readonly ShopItemDef[] = [
  {
    id: 'otturatore-spinto',
    act: 1,
    name: 'Otturatore Spinto',
    gives: 'Ricarica più corta di 150 ms, sempre.',
    takes: "L'ottica si apre in 320 ms: lenta, anche con Aggancio Ottico.",
    cost: SHOP_ITEM_COST,
  },
  {
    id: 'eco-ampio',
    act: 1,
    name: 'Eco Ampio',
    gives: "L'esca richiama da 7 tile invece di 5.",
    takes: 'Vive 1800 ms invece di 2600: un colpo solo, e stretto.',
    cost: SHOP_ITEM_COST,
  },
  {
    id: 'zavorra-alleggerita',
    act: 1,
    name: 'Zavorra Alleggerita',
    gives: 'Passo più veloce del 15%, sempre.',
    takes: 'Lo scatto si ricarica in 3600 ms invece di 2600.',
    cost: SHOP_ITEM_COST,
  },
  {
    id: 'doppio-innesco',
    act: 2,
    name: 'Doppio Innesco',
    gives: 'Tre cariche di Trasponditore a inizio livello invece di due.',
    takes: "L'esca vola 4 tile invece di 6: si lancia da vicino.",
    cost: SHOP_ITEM_COST,
  },
  {
    id: 'scatto-teso',
    act: 2,
    name: 'Scatto Teso',
    gives: 'Lo scatto è più rapido del 35%.',
    takes: 'Il passo è più lento del 12%, sempre.',
    cost: SHOP_ITEM_COST,
  },
  {
    id: 'piastra-fusa',
    act: 2,
    name: 'Piastra Fusa',
    gives: 'Una carica di scudo in più.',
    takes: 'La ricarica dell\'arma è più lunga di 150 ms.',
    cost: SHOP_ITEM_COST,
  },
];

/** Gli innesti offerti alla fine di un atto. Vuoto per l'Atto III:
 *  dopo ARBITER non c'è un intervallo in cui spendere, ed è un buco
 *  noto (vedi GDD sezione 13). */
export function shopItemsForAct(act: number): readonly ShopItemDef[] {
  return SHOP_ITEMS.filter((i) => i.act === act);
}

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
/** Le piastre con cui si comincia ogni livello, e che tornano piene
 *  entrando in una stanza nuova.
 *
 *  Era 1 — e il giocatore partiva a **zero**, quindi qualunque colpo
 *  uccideva finché non trovava una piastra per terra. È il difetto che
 *  regge tutti gli altri: il cuore di questo gioco è il punto debole,
 *  e imparare un punto debole richiede un esperimento fallito a cui si
 *  sopravvive. Sparo al torace, vedo che non muore, cambio mira. Il
 *  primo tester ha fatto esattamente quell'esperimento — quello
 *  giusto — ed è morto, e ha concluso «spari a dei nemici che non
 *  muoiono». Stava imparando bene: era il gioco a non dargliene il
 *  tempo.
 *
 *  Due, non tre: due bastano a rendere l'esperimento sopravvivibile e
 *  non bastano a rendere il punto debole facoltativo. */
export const SHIELD_CHARGES_BASE = 2;
export const SHIELD_CHARGES_UPGRADED = 3;

/** Quanto si resta intoccabili dopo che una piastra ha assorbito un
 *  colpo.
 *
 *  Senza questa finestra due piastre non valgono due errori: valgono
 *  due colpi, e i colpi non arrivano distanziati. Misurato stando
 *  fermi allo spawn: su ARCHIVIO due colpi arrivano a **17 ms** l'uno
 *  dall'altro — un tick, due torrette che sparano nello stesso
 *  istante — su MOLO a 100 ms, su PLANCIA a 200. Le piastre
 *  evaporavano insieme e il giocatore moriva come prima.
 *
 *  800 ms è sotto il ciclo di ricarica di qualunque nemico (il più
 *  rapido è 1250 ms) e sotto quello delle torrette (1800 ms): una
 *  salva simultanea costa una piastra sola, che è giusto perché è un
 *  errore solo, ma la salva successiva costa la sua. Non regala
 *  niente contro il fuoco sostenuto. */
export const SHIELD_BREAK_INVULN_MS = 800;

/** Riserva di Bordo, dopo questo giro, non è più «ricarica entrando in
 *  una stanza» — quella è diventata la regola base. Ora è l'asse che
 *  la regola base non copre: **il tempo**. Una piastra torna da sola
 *  dopo questi millisecondi senza incassare, quindi il nodo compra la
 *  possibilità di ritirarsi, respirare e rientrare interi, dentro la
 *  stessa stanza. */
export const SHIELD_REGEN_MS = 7000;

// Secondo anello (Atto II)
/** Slancio: moltiplica la *velocità* dello scatto, non la durata.
 *
 *  Sembrava uguale e non lo è. Sul vuoto non conta quanto dura lo
 *  scatto, conta quanti millisecondi si passano sospesi: allungare la
 *  durata fa arrivare più lontano ma non più in fretta, quindi una
 *  passerella larga resterebbe impossibile lo stesso. Alzando la
 *  velocità si guadagnano tutte e due le cose insieme — più distanza
 *  *e* meno tempo sul vuoto. */
export const NODE_SLANCIO_SPEED_MULT = 1.5;

// Terzo anello (Atto III)
// Tre nodi, tre rami. Non migliorano un numero che era già buono:
// ognuno risponde a una minaccia che l'Atto III porta in tavola —
// il Guardiano immune di fronte, il Martello che carica, l'Araldo
// che si occulta.

/** Scatto Angolare: quanto si può sterzare per tick durante lo
 *  scatto.
 *
 *  Il valore conta più di quanto sembri. Lo scatto dura 170 ms,
 *  cioè poco più di dieci tick: a 0.10 rad/tick si curva di circa un
 *  radiante in tutto, sessanta gradi. È abbastanza per girare attorno
 *  a un nemico e finirgli dietro — che è il solo motivo per cui
 *  questo nodo esiste — e non abbastanza per invertire la rotta, che
 *  renderebbe lo scatto una corsa sterzabile invece di uno strappo da
 *  puntare prima. */
export const NODE_DASH_STEER_RATE = 0.1;


// ---- Boss: Sentinella del Molo ----
// Dove sta lo dice il livello (levels.ts); qui c'è solo com'è fatta.
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

// ---- Boss: Custode del Reattore (fine Atto II) ----
// Non insegue: "manipola l'ambiente" (GDD sezione 5). Alterna
// blackout e inversione di gravità, e fra una manipolazione e
// l'altra resta scoperto per una finestra breve.
//
// Il contrasto con la Sentinella è il punto: lì la finestra si
// *crea* (farlo mancare, girargli dietro) ed è posizionale — solo il
// retro. Qui la finestra *arriva* ed è temporale — da qualsiasi
// angolo, ma solo adesso. Due boss che si battono allo stesso modo
// sarebbero un boss solo con due skin.
export const CUSTODE_MANIPULATION_MS = 4200;
/** La finestra vulnerabile. Corta, ma raggiungibile da ovunque: non
 *  c'è da guadagnare una posizione, c'è da essere pronti. */
export const CUSTODE_EXPOSED_MS = 1500;
/** Pausa fra la fine di una manipolazione e l'inizio della finestra:
 *  il preavviso. Senza, la finestra sarebbe una sorpresa invece di un
 *  appuntamento. */
export const CUSTODE_TELL_MS = 700;
export const CUSTODE_HITS_TO_DEFEAT = 4;
/** Da metà danni accorcia la finestra e allunga le manipolazioni. */
export const CUSTODE_ENRAGE_AT = CUSTODE_HITS_TO_DEFEAT / 2;
export const CUSTODE_EXPOSED_ENRAGED_MS = 1000;
export const CUSTODE_MANIPULATION_ENRAGED_MS = 5000;
export const CUSTODE_RADIUS = ENTITY_RADIUS * 2;

// ---- Boss finale: ARBITER (fine Atto III) ----
// "Corpo modulare: fase 1 a distanza (turret multiple da disattivare
// una a una), fase 2 ravvicinata (mobilità e schivata), fase 3 nucleo
// scoperto con tempo limitato. Ogni fase riusa una minaccia vista in
// atti precedenti, come test finale." (GDD sezione 5.)
//
// Le tre fasi non sono tre macchine nuove: sono le tre che il gioco ha
// già insegnato, rimesse in fila. La prima è il corridoio a fuoco
// incrociato (Atto I); la seconda è la Sentinella, con la stessa
// logica di carica e lo stesso cono posteriore (Atto I); la terza è il
// Custode, finestre e manipolazioni (Atto II). Il test finale è
// saperle riconoscere, non impararne una quarta.

/** Colpi sul retro per chiudere la fase di caccia. */
export const ARBITER_HUNT_HITS = 3;
/** Colpi nel nucleo per finirlo. */
export const ARBITER_CORE_HITS = 3;
export const ARBITER_HITS_TO_DEFEAT = ARBITER_HUNT_HITS + ARBITER_CORE_HITS;

/** Quanto resta scoperto il nucleo prima di richiudersi. Il tempo
 *  limitato della sezione 5: mancare la finestra non è una punizione,
 *  è tornare alla fase di caccia e doversela riguadagnare. */
export const ARBITER_CORE_WINDOW_MS = 5200;
/** Manipolazione fra una finestra e l'altra, nella terza fase. */
export const ARBITER_CORE_MANIPULATION_MS = 3200;
export const ARBITER_CORE_TELL_MS = 700;
export const ARBITER_RADIUS = ENTITY_RADIUS * 2;

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
