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

// ---- Player start / respawn ----
/** Brief lockout after a checkpoint respawn so a turret or a boss
 *  charge already in flight cannot kill the player a second time on
 *  the same tick it sent them back. Mirrors the Arena's own
 *  SPAWN_PROTECTION. */
export const RESPAWN_INVULN_MS = 800;

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

/** XP cumulativa richiesta per raggiungere il livello (indice + 1).
 *
 *  Quindici livelli, cioè quattordici punti: esattamente i nodi
 *  dell'albero.
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
  | 'sensori-inerziali';

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
