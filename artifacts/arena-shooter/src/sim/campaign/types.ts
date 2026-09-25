// ================================================================
// CAMPAIGN TYPES
// ================================================================
// Plain, JSON-serializable state, same discipline as the Arena's own
// sim/types.ts — the campaign is single-player (see GDD.md section
// 7), but there is no reason to give up the property that made the
// Arena's state easy to snapshot, log and test.
//
// Dallo Sprint 1 a qui la differenza è che quasi tutto è diventato
// una lista: un livello ha N porte, N turret, N pavimenti che cedono.
// Con un livello solo bastava un campo per ciascuno; con tre, un
// campo per trabocchetto avrebbe voluto dire un tipo di stato nuovo
// per ogni copia dello stesso trabocchetto.
// ================================================================

import type { EnemyKind, Vulnerability, WeakSpot } from './enemies';

export type RoomId = string;

/** Le fasi della Sentinella e quelle del Custode in un tipo solo. Non
 *  si mescolano mai — ogni boss gira la sua macchina — ma tenerle
 *  separate vorrebbe dire due tipi di BossState quasi identici, e la
 *  HUD dovrebbe sapere quale sta guardando per leggerne la fase. */
export type BossPhase =
  | 'guard'
  | 'telegraph'
  | 'charge'
  | 'recover'
  // Custode: manipola l'ambiente, poi si scopre.
  | 'blackout'
  | 'invert'
  | 'tell'
  | 'exposed'
  // ARBITER: i suoi tre atti. `modules` è la prima fase (i moduli
  // ancora in piedi); poi riusa le fasi della Sentinella per la
  // caccia, e `core*` per il finale a tempo.
  | 'modules'
  | 'coreOpening'
  | 'coreOpen'
  | 'coreSealed'
  | 'defeated';

export interface CampaignInput {
  /** Movement intent in entity-local space: +1 forward, -1 back. */
  forward: number;
  /** +1 right, -1 left (strafe). */
  strafe: number;
  /** Absolute yaw the player wants to face, in radians. */
  aimAngle: number;
  /** Edge-triggered: true on the tick the trigger is pulled. */
  fire: boolean;
  /** Scoped aiming, held. */
  ads: boolean;
  /** Edge-triggered: true on the tick the dash key is pressed. Ha
   *  effetto solo col nodo Scatto sbloccato e fuori cooldown — la
   *  simulazione decide, il controller si limita a riferire che il
   *  tasto è stato premuto. */
  dash: boolean;
  /** Edge-triggered: true nel tick in cui si lancia il Trasponditore.
   *  Come `dash`, il controller riferisce la pressione e la
   *  simulazione decide se c'erano cariche. */
  beacon: boolean;
  /** Pendenza verticale della mira: di quanti px sale il mirino per
   *  ogni px di distanza. Serve ai colpi alla testa, l'unica cosa in
   *  tutto il gioco che dia un senso all'inclinazione della visuale.
   *
   *  È una *pendenza* e non l'inclinazione grezza della camera di
   *  proposito. L'orizzonte, in un raycaster a colonne, si sposta
   *  invece di ruotare, e quanto mondo copra quello spostamento
   *  dipende dalla proiezione — cioè dal viewport e dallo zoom
   *  dell'ottica. Convertire nel controller, che il viewport ce l'ha,
   *  tiene la simulazione senza DOM e fa sì che il mirino indichi lo
   *  stesso punto a qualunque risoluzione. */
  aimSlope: number;
}

export function emptyCampaignInput(): CampaignInput {
  return {
    forward: 0,
    strafe: 0,
    aimAngle: 0,
    fire: false,
    ads: false,
    dash: false,
    beacon: false,
    aimSlope: 0,
  };
}

export interface CampaignPlayer {
  x: number;
  y: number;
  angle: number;
  pitch: number;
  weaponCooldown: number;
  /** ms of immunity right after a checkpoint respawn, so an
   *  already-in-flight turret shot or boss charge cannot kill the
   *  player a second time before they have even moved. */
  respawnInvulnerableMs: number;
  /** Quanto ancora la grazia può restare ferma perché si è rinati
   *  dentro una linea di tiro. Vedi RESPAWN_HOLD_MS: senza, su cinque
   *  livelli su nove si moriva al tick esatto in cui scadeva. */
  respawnHoldMs: number;
  /** Intoccabili perché una piastra ha appena assorbito un colpo.
   *  Tenuto separato da respawnInvulnerableMs apposta: quello ha la
   *  regola del fermo-immagine sotto tiro (RESPAWN_HOLD_MS), e
   *  applicarla anche qui renderebbe immortale chi resta nel fuoco. */
  hitInvulnerableMs: number;
  /** Da quanto non si incassa un colpo. Serve solo a Riserva di Bordo
   *  (SHIELD_REGEN_MS); senza il nodo resta un numero che sale. */
  sinceHitMs: number;
  /** Tactical power-up, not permanent progression: each charge
   *  absorbs one hit (turret or boss contact) and is gone. Un
   *  contatore e non un booleano perché il nodo Piastra Aggiuntiva ne
   *  concede due. See GDD.md, "Potenziamenti vs progressione
   *  permanente". */
  shieldCharges: number;
  /** ms remaining of an active dash. */
  dashTimer: number;
  dashCooldown: number;
  /** Direzione dello scatto in corso, congelata all'avvio. */
  dashDirX: number;
  dashDirY: number;
  /** px/tick dello scatto in corso, congelata anch'essa: il nodo
   *  Slancio la alza, e leggerla dai nodi a ogni tick vorrebbe dire
   *  che sbloccarlo *durante* uno scatto lo accelererebbe a metà. */
  dashSpeed: number;
  /** ms di accecamento residuo dal gas: niente minimappa, niente
   *  ottica. Non fa danno — toglie informazione. */
  empMs: number;
  /** ms di buio residuo. Come empMs ma toglie la *vista*, non i
   *  sensori: al buio la minimappa resta, ed è il punto. */
  darkMs: number;
  /** Il mondo è capovolto: la vista si ribalta e lo strafe si
   *  specchia (a meno del nodo Ancoraggio). */
  gravityFlipped: boolean;
  /** Lanci di Trasponditore rimasti. Come lo scudo è un consumabile e
   *  non progressione: si riparte da BEACON_CHARGES_START a ogni
   *  livello, e quello che si raccoglie dentro al livello resta
   *  dentro al livello. */
  beaconCharges: number;
}

export interface DoorState {
  id: string;
  /** Sensor tripped, timer running. */
  armed: boolean;
  /** ms remaining before the door seals, once armed. */
  closeTimer: number;
  closed: boolean;
}

/** Turret laser, e il drone che ne è un caso particolare: stessa
 *  macchina a stati, `kind` cambia solo come si disegna. */
export interface TurretState {
  id: string;
  alive: boolean;
  /** ms of held line-of-sight still needed before it fires. Resets
   *  whenever line of sight is lost. */
  reactionTimer: number;
  fireCooldown: number;
}

/** Le passerelle non hanno stato proprio: il vuoto è sempre vuoto.
 *  Quello che varia è da quanto il giocatore ci sta sopra, e quello sta
 *  sul giocatore perché è uno solo. */
export interface ChasmState {
  id: string;
  hoverMs: number;
}

export interface CollapsingFloorState {
  id: string;
  /** ms già passati con il giocatore sopra. Si azzera appena esce:
   *  il pavimento va attraversato, non cronometrato a rate. */
  standingMs: number;
  collapsed: boolean;
  /** ms prima che torni calpestabile. */
  resetTimer: number;
}

export interface CoreState {
  id: string;
  x: number;
  y: number;
  collected: boolean;
}

export interface ShieldPickupState {
  id: string;
  x: number;
  y: number;
  collected: boolean;
}

export interface BeaconPickupState {
  id: string;
  x: number;
  y: number;
  collected: boolean;
}

/** L'esca piantata, se ce n'è una viva. Una sola: due esche
 *  contemporanee vorrebbero dire che il giocatore decide *dove*
 *  guarderanno due gruppi diversi, e la finestra smetterebbe di
 *  essere una decisione per diventare una regia. */
export interface BeaconState {
  active: boolean;
  x: number;
  y: number;
  /** ms di vita residui. */
  ms: number;
}

/** Un nemico mobile. Tutto quello che serve a rigiocare il tick da
 *  un salvataggio sta qui: l'archetipo (`kind`) dice le costanti, lo
 *  stato dice dove sta nella sua macchina.
 *
 *  `postX/postY` sono il posto di guardia, `patrolX/patrolY` l'altro
 *  capo della spola. Tenerli sullo *stato* e non solo sulla
 *  definizione serve al respawn: morire riporta i nemici della stanza
 *  al loro posto, e il posto deve essere noto senza risalire al
 *  livello. */
export interface EnemyState {
  id: string;
  kind: EnemyKind;
  alive: boolean;
  x: number;
  y: number;
  angle: number;
  /** In colpi corpo residui. Float perché i moltiplicatori del punto
   *  debole e della vulnerabilità non sono interi fra loro. */
  hp: number;
  ai: 'patrol' | 'search' | 'engage';
  /** ms di linea di vista ancora da tenere prima del colpo. */
  reactionTimer: number;
  attackCooldown: number;
  /** ms residui di sfiato: la finestra dopo il colpo in cui incassa
   *  il doppio, e in cui l'Araldo si vede. */
  ventMs: number;
  /** ms residui in cui resta visibile comunque, per chi si occulta.
   *  Separato da `ventMs` perché il velo torna più tardi della
   *  finestra di danno: vedere un nemico che non si può più punire è
   *  un'informazione, non una beffa. */
  revealMs: number;
  /** ms residui di carica in corso, e la direzione congelata quando è
   *  partita. Congelata perché una carica che corregge la rotta non
   *  è schivabile, ed è tutto ciò che la rende leale. */
  chargeMs: number;
  chargeDirX: number;
  chargeDirY: number;
  postX: number | null;
  postY: number | null;
  patrolX: number | null;
  patrolY: number | null;
  goalX: number | null;
  goalY: number | null;
  patrolTimer: number;
  lastSeenX: number | null;
  lastSeenY: number | null;
  /** Osservazioni sull'intenzione dell'ultimo tick. Stanno sullo
   *  stato perché due lettori diversi ne hanno bisogno — la
   *  risoluzione del colpo e il disegno — e ricalcolarle in due
   *  posti vorrebbe dire che possono divergere. */
  still: boolean;
  closing: boolean;
  /** Sta inseguendo l'esca invece del giocatore. Osservazione come le
   *  due sopra: la leggono il disegno (per dirlo) e il mondo (per non
   *  far arrivare addosso al giocatore un colpo diretto altrove). */
  lured: boolean;
  /** Irrobustito da un Archivista vivo nel raggio. */
  hardened: boolean;
}

export interface BossState {
  x: number;
  y: number;
  /** Facing — also the charge direction once one starts. */
  angle: number;
  phase: BossPhase;
  /** ms remaining in the current phase. */
  phaseTimer: number;
  /** 0..BOSS_HITS_TO_DEFEAT. A float so a graze (Danno di Striscio)
   *  can add half a point. */
  damageTaken: number;
  chargeDirX: number;
  chargeDirY: number;
  /** Cariche ancora da fare nella raffica in corso. Per il Custode fa
   *  da contatore del ciclo, per alternare le due manipolazioni. */
  chargesLeft: number;
  /** Solo ARBITER: quale dei tre atti sta giocando. Separato da
   *  `phase` perché la fase di caccia *è* quella della Sentinella —
   *  stessi nomi, stessa logica — e serviva un posto per dire "siamo
   *  ancora nella caccia" senza toccarli. */
  stage: 1 | 2 | 3;
  /** Solo ARBITER: danni incassati nella fase in corso. `damageTaken`
   *  resta il totale, che è quello che la HUD mostra. */
  stageDamage: number;
}

export interface Checkpoint {
  room: RoomId;
  x: number;
  y: number;
  angle: number;
}

/** Le tre fasi di difficoltà del GDD (sezione 9), costruite una alla
 *  volta invece che tutte insieme — Tutorial è la sola che esisteva
 *  finora. Le tre non cambiano una sola regola di *come* si gioca:
 *  cambiano solo cosa succede alla morte, che è tutto ciò che
 *  CampaignWorld.killPlayer legge da questo valore. Tenerlo come un
 *  campo di stato invece di tre classi (o tre World) evita di
 *  triplicare fisica, IA e boss per una differenza che sta tutta in
 *  un metodo. */
export type CampaignDifficulty = 'tutorial' | 'medio' | 'roguelike';

export const CAMPAIGN_DIFFICULTIES: readonly CampaignDifficulty[] = [
  'tutorial',
  'medio',
  'roguelike',
];

/** 'levelComplete' è il gemello di 'victory': un livello senza boss
 *  finisce raggiungendo l'uscita, uno con il boss finisce abbattendolo.
 *  Tenerli distinti serve al chiamante, che nel primo caso deve
 *  costruire il livello successivo e nel secondo mostrare la fine.
 *
 *  'actRestart' è il terzo modo di finire una simulazione, ed è
 *  Roguelike: la morte non chiude il livello, chiude l'atto. CampaignWorld
 *  simula un livello alla volta (vedi il commento in cima a world.ts),
 *  quindi non può ricostruire da sola il primo livello dell'atto — può
 *  solo dirlo. Il controller (game/campaignGame.ts) legge questo
 *  outcome, o l'evento gemello, e fa la ricostruzione. */
export type CampaignOutcome = 'playing' | 'levelComplete' | 'victory' | 'actRestart';

/** What survives leaving the campaign and coming back.
 *
 *  Deliberately the *character*, not the *run*: position, boss damage
 *  and door timers are not here, so returning replays the current
 *  level from its start with the progression intact.
 *
 *  `level` and `skillPoints` are absent on purpose: both follow from
 *  `xp` (see levelForXp), and a stored copy is just a second version
 *  of the truth waiting to disagree with the first. */
export interface CampaignProfile {
  /** Bumped when this shape changes. An unknown version is discarded
   *  rather than migrated — it is a short act, not a save file worth
   *  rescuing. */
  version: number;
  xp: number;
  unlockedNodes: string[];
  /** Il livello in cui il giocatore si trovava. Rientrare lo rigioca
   *  dall'inizio: si conserva il personaggio e il punto dell'atto, non
   *  la posizione dentro la stanza. */
  levelId: string;
  /** Livelli già completati, per non ripagarne i bonus. */
  completedLevels: string[];
  /** Cores already taken, so returning cannot farm the same XP twice.
   *  Gli id dei core sono già prefissati col livello (levels.ts). */
  collectedCoreIds: string[];
  /** Stanze il cui bonus d'ingresso è già stato pagato, come
   *  `livello/stanza` — due livelli possono avere una stanza con lo
   *  stesso nome, e senza il prefisso la seconda non pagherebbe. */
  roomsAwarded: string[];
  /** Nemici e torrette già pagati, come `livello/id` — stesso schema di
   *  roomsAwarded e stessa ragione (un id può ripetersi fra livelli
   *  diversi). GDD.md sezione 9: "morire non deve poter rifarmare
   *  esperienza". In Tutorial e Medio un respawn rimette in vita i
   *  nemici e le torrette della stanza (vedi killPlayer/resetEnemiesIn);
   *  in Roguelike è il riavvio d'atto a ricostruirli da zero. Senza
   *  questa lista, in entrambi i casi la stessa uccisione tornerebbe a
   *  pagare ogni volta che il bersaglio torna in piedi — non filtrata
   *  contro un elenco di id noti, per lo stesso motivo di
   *  collectedCoreIds qui sopra: un profilo di una versione precedente
   *  non deve perdere il resto per una chiave che non riconosciamo più. */
  killsAwarded: string[];
  /** Scelta fatta prima di iniziare il run, non modificabile a
   *  partita in corso: cambiare regole di morte a metà atto non ha un
   *  significato pulito, quindi il profilo la fissa insieme al resto
   *  del personaggio. */
  difficulty: CampaignDifficulty;
  /** Innesti comprati al Banco (constants.ts, SHOP_ITEMS).
   *
   *  Lista separata da `unlockedNodes` e non in coda a quella, per una
   *  ragione precisa: al caricamento `unlockedNodes` NON viene filtrata
   *  contro gli id noti, ed è giusto così — `pointsSpent` fa costare
   *  zero un id sconosciuto perché un profilo salvato da una versione
   *  precedente può contenere un nodo che non esiste più, e farlo
   *  costare infinito bloccherebbe l'albero di quel giocatore per
   *  sempre. La stessa permissività, applicata a un acquisto,
   *  regalerebbe l'acquisto. Questa lista è quindi filtrata
   *  (stats/campaignProfile.ts), ed è l'unica differenza di trattamento
   *  fra le due — voluta, non dimenticata. */
  purchases: string[];
}

/** 4: il profilo impara gli innesti comprati al Banco.
 *
 *  3: il profilo impara la difficoltà scelta (Tutorial/Medio/
 *  Roguelike, vedi GDD.md sezione 9). Come sempre i profili di
 *  versione precedente vengono scartati, non migrati — è la politica
 *  dichiarata fin dall'inizio, e l'atto dura pochi minuti: rigiocarlo
 *  costa meno che scrivere e mantenere un convertitore. */
export const CAMPAIGN_PROFILE_VERSION = 4;

export interface CampaignState {
  tick: number;
  /** Il livello che questo mondo sta simulando. */
  levelId: string;
  checkpoint: Checkpoint;
  player: CampaignPlayer;
  doors: DoorState[];
  turrets: TurretState[];
  enemies: EnemyState[];
  collapsingFloors: CollapsingFloorState[];
  chasms: ChasmState[];
  cores: CoreState[];
  shields: ShieldPickupState[];
  beaconPickups: BeaconPickupState[];
  beacon: BeaconState;
  coresCollected: number;
  /** Chiavi `livello/stanza` già pagate — una volta per profilo, non
   *  una per visita. */
  roomsAwarded: string[];
  /** Chiavi `livello/id` di nemici e torrette già pagati — vedi
   *  CampaignProfile.killsAwarded, di cui questo è lo specchio a
   *  runtime. Guarda solo l'XP (killEnemy, hitEnemy, fireWeapon): non
   *  decide se un nemico è vivo o morto in questo mondo, quello resta
   *  `enemies[].alive`/`turrets[].alive`, che un respawn di
   *  Tutorial/Medio può rimettere a `true` senza toccare questa
   *  lista. */
  killsAwarded: string[];
  completedLevels: string[];
  /** Esperienza totale accumulata — non scende mai, nemmeno alla
   *  morte: solo la posizione e i nemici della stanza si resettano,
   *  il progresso no (vedi GDD.md, modalità Tutorial). */
  xp: number;
  level: number;
  /** Punti guadagnati salendo di livello, non ancora spesi
   *  sull'albero né al Banco. `unlockedNodes` e `purchases` sono
   *  insieme la fonte di verità per quanto è già speso — vedi
   *  skills.ts `pointsSpent`. */
  skillPoints: number;
  unlockedNodes: string[];
  /** Innesti comprati al Banco. Spendono gli stessi punti dei nodi:
   *  è quel confronto diretto a rendere la scelta una scelta. */
  purchases: string[];
  /** null nei livelli senza boss. */
  boss: BossState | null;
  outcome: CampaignOutcome;
  /** Fissata alla costruzione del mondo (dal profilo, o dalla scelta
   *  del menu se non c'è ancora un profilo) e mai più cambiata da
   *  dentro un run: vedi CampaignProfile.difficulty. */
  difficulty: CampaignDifficulty;
  /** La stanza più profonda in cui il giocatore sia mai arrivato.
   *
   *  Diversa da `checkpoint.room`, e la differenza è il punto: il
   *  checkpoint pretende un posto sicuro e può restare indietro (vedi
   *  CampaignWorld.updateCheckpoint), mentre "ci sono arrivato" resta
   *  vero anche dentro una stanza battuta da una torretta. Ci pendono
   *  la battuta narrativa, l'XP di stanza e il risveglio del boss. */
  reachedRoom: string;
  /** Le stanze già viste in QUESTO mondo, per sapere se la prossima
   *  soglia è una prima volta. Diversa da `reachedRoom`, ed è la
   *  differenza che risolve i livelli ad anello (ARCHIVIO: nord=0,
   *  ovest=1, camera=2, est=3, sud=4): chi gira nord -> est -> sud e poi
   *  rientra da ovest ci arriva con un ordine (1) più basso del massimo
   *  già toccato (4), ma non ci è mai stato — e la battuta, l'XP di
   *  stanza (updateCheckpoint) e la ricarica delle piastre
   *  (refillShieldOnRoomEnter, GDD.md sezione 18) devono scattare lo
   *  stesso. `reachedRoom` resta "il massimo mai raggiunto in ordine",
   *  perché è quello che serve al risveglio del boss (updateBoss): un
   *  boss non deve "riaddormentarsi" perché il giocatore è tornato
   *  indietro a esplorare.
   *
   *  Non serializzata nel profilo (vedi CampaignProfile.toProfile),
   *  stessa ragione di enemySightedFired qui sotto: inizializzata con
   *  la sola stanza di spawn a ogni costruzione, così un livello nuovo
   *  — o un respawn che ricostruisce il mondo — ricomincia a contare le
   *  prime volte da capo. È esattamente il comportamento che
   *  `reachedRoom` aveva già sui livelli lineari (non si azzera alla
   *  morte, quindi ogni stanza ricarica al più una volta per mondo):
   *  qui si limita a estenderlo a chi non procede in ordine. */
  visitedRooms: string[];
  /** True dopo il primo `enemySighted` di questo mondo. Non
   *  serializzato nel profilo (vedi CampaignProfile.toProfile): un
   *  livello nuovo, o un respawn che ricostruisce il mondo, deve poter
   *  rilevare di nuovo il primo avvistamento *di quel mondo* — è la
   *  persistenza fra sessioni ("già mostrata almeno una volta nella
   *  run") a vivere altrove, in campaignProfile.ts via localStorage. */
  enemySightedFired: boolean;
}

export type CampaignEvent =
  | { type: 'roomEntered'; room: RoomId }
  | { type: 'doorSealed'; id: string }
  | { type: 'coreCollected'; id: string }
  | { type: 'shieldPickup'; charges: number }
  | { type: 'shieldRefilled'; charges: number }
  | { type: 'shieldBreak'; chargesLeft: number }
  | { type: 'xpGained'; amount: number }
  | { type: 'levelUp'; level: number }
  | { type: 'nodeUnlocked'; id: string }
  | { type: 'dashStarted' }
  | { type: 'beaconThrown'; x: number; y: number }
  | { type: 'beaconExpired' }
  | { type: 'beaconPickup'; charges: number }
  /** Il primo nemico mobile mai avvistato in linea di vista, davanti
   *  al giocatore. Emesso una volta sola per mondo (vedi
   *  `CampaignState.enemySightedFired`) — è l'innesco della legenda
   *  del punto debole (GDD.md sezione 22), non un evento tattico:
   *  torrette e droni (state.turrets) non lo generano, sono un'altra
   *  cosa e non insegnano nulla sul punto debole. */
  | { type: 'enemySighted'; id: string; kind: EnemyKind }
  /** Un nemico ha appena cambiato bersaglio. Sul fronte di salita
   *  soltanto: un evento per tick di richiamo sarebbe rumore, e
   *  quello che serve — al suono e alla HUD — è l'istante in cui
   *  l'altro si volta. */
  | { type: 'enemyLured'; id: string; kind: EnemyKind }
  /** Piastra Reattiva: lo scudo ha assorbito e ha restituito il
   *  colpo. Separato da 'shieldBreak', che c'è comunque: sono due
   *  cose diverse da dire, e la seconda esiste solo col nodo. */
  | { type: 'shieldReactive' }
  | { type: 'turretDown'; id: string; kind: 'drone' | 'turret' }
  | {
      type: 'enemyHit';
      id: string;
      kind: EnemyKind;
      damage: number;
      /** Quali dei due assi hanno morso. La HUD li usa per dire
       *  *perché* quel colpo è valso di più: un numero grande senza
       *  motivo non insegna niente. */
      weakSpot: WeakSpot | null;
      vulnerability: Vulnerability | null;
      hardened: boolean;
    }
  | { type: 'enemyDown'; id: string; kind: EnemyKind }
  | { type: 'enemyAttack'; id: string; kind: EnemyKind }
  | { type: 'floorCollapsed'; id: string }
  | { type: 'fellIntoChasm'; id: string }
  | { type: 'gasEntered' }
  | { type: 'gasCleared' }
  | { type: 'blackoutEntered' }
  | { type: 'blackoutCleared' }
  | { type: 'gravityFlipped'; inverted: boolean }
  | { type: 'bossExposed' }
  | { type: 'bossHit'; damage: number; phase: BossPhase }
  | { type: 'bossEnraged' }
  | { type: 'bossStage'; stage: 2 | 3 }
  | { type: 'bossCoreSealed' }
  | { type: 'bossDefeated' }
  | { type: 'itemPurchased'; id: string }
  | { type: 'nodeRefunded'; id: string }
  | { type: 'purchaseRefused'; id: string; reason: 'punti' | 'atto' | 'gia-preso' | 'sconosciuto' }
  | { type: 'levelCompleted'; levelId: string; next: string | null }
  | { type: 'playerDied'; cause: 'turret' | 'boss' | 'enemy' }
  /** Solo Roguelike: la morte non chiude il livello, chiude l'atto.
   *  Sempre insieme a 'playerDied' nello stesso tick — questo è
   *  l'evento in più che dice al controller di non fare il respawn
   *  normale ma di ricostruire dal primo livello dell'atto. */
  | { type: 'actRestart' };
