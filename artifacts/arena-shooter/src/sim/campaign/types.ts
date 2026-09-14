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
}

export function emptyCampaignInput(): CampaignInput {
  return {
    forward: 0,
    strafe: 0,
    aimAngle: 0,
    fire: false,
    ads: false,
    dash: false,
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

/** 'levelComplete' è il gemello di 'victory': un livello senza boss
 *  finisce raggiungendo l'uscita, uno con il boss finisce abbattendolo.
 *  Tenerli distinti serve al chiamante, che nel primo caso deve
 *  costruire il livello successivo e nel secondo mostrare la fine. */
export type CampaignOutcome = 'playing' | 'levelComplete' | 'victory';

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
}

/** 2: il profilo ha imparato che esiste più di un livello. I profili
 *  di versione 1 vengono scartati, non migrati — è la politica
 *  dichiarata fin dall'inizio, e l'atto dura pochi minuti. */
export const CAMPAIGN_PROFILE_VERSION = 2;

export interface CampaignState {
  tick: number;
  /** Il livello che questo mondo sta simulando. */
  levelId: string;
  checkpoint: Checkpoint;
  player: CampaignPlayer;
  doors: DoorState[];
  turrets: TurretState[];
  collapsingFloors: CollapsingFloorState[];
  chasms: ChasmState[];
  cores: CoreState[];
  shields: ShieldPickupState[];
  coresCollected: number;
  /** Chiavi `livello/stanza` già pagate — una volta per profilo, non
   *  una per visita. */
  roomsAwarded: string[];
  completedLevels: string[];
  /** Esperienza totale accumulata — non scende mai, nemmeno alla
   *  morte: solo la posizione e i nemici della stanza si resettano,
   *  il progresso no (vedi GDD.md, modalità Tutorial). */
  xp: number;
  level: number;
  /** Punti guadagnati salendo di livello, non ancora spesi
   *  sull'albero. `unlockedNodes` è la fonte di verità per quanto è
   *  già speso — vedi skills.ts `pointsSpent`. */
  skillPoints: number;
  unlockedNodes: string[];
  /** null nei livelli senza boss. */
  boss: BossState | null;
  outcome: CampaignOutcome;
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
  | { type: 'turretDown'; id: string; kind: 'drone' | 'turret' }
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
  | { type: 'levelCompleted'; levelId: string; next: string | null }
  | { type: 'playerDied'; cause: 'turret' | 'boss' };
