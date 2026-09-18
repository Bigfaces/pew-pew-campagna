// ================================================================
// CAMPAIGN WORLD — la simulazione autorevole di un livello
// ================================================================
// Single-player, tick-based like the Arena's World (sim/world.ts),
// but with campaign rules instead of FFA ones: a checkpoint per room
// instead of a respawn timer, timed doors and turrets instead of
// power-ups, a boss with a hit-phase fight instead of a kill target.
// See GDD.md sections 3-6 for the design this implements.
//
// Deliberately its own class rather than a mode flag on World: the
// two share no rules (win condition, respawn behaviour, what "input"
// even drives), so forcing them into one class would mean branching
// on mode everywhere instead of the Arena staying exactly as it is.
//
// Un mondo simula UN livello. Passare al livello successivo vuol dire
// costruirne un altro con lo stesso profilo, non mutare questo: i
// timer, i danni al boss e le posizioni di un livello non hanno senso
// nel successivo, e azzerarli uno a uno sarebbe una lista da
// aggiornare ogni volta che si aggiunge un trabocchetto.
// ================================================================

import {
  BACKWARD_MULT,
  ENTITY_RADIUS,
  PLAYER_SPEED,
  STRAFE_MULT,
  TICK_MS,
  TILE,
} from '../constants';
import {
  BOSS_CHARGE_MS,
  BOSS_CHARGE_SPEED,
  BOSS_ENRAGED_CHARGES,
  BOSS_ENRAGE_AT,
  BOSS_GRAZE_ARC_HALF,
  BOSS_GUARD_ENRAGED_MS,
  BOSS_GUARD_MS,
  BOSS_HITS_TO_DEFEAT,
  BOSS_RADIUS,
  BOSS_REAR_ARC_HALF,
  BOSS_RECOVER_ENRAGED_MS,
  BOSS_RECOVER_MS,
  BOSS_TELEGRAPH_ENRAGED_MS,
  BOSS_TELEGRAPH_MS,
  BOSS_TURN_RATE,
  BOSS_VOLLEY_RECOVER_MS,
  ARBITER_CORE_HITS,
  ARBITER_CORE_MANIPULATION_MS,
  ARBITER_CORE_TELL_MS,
  ARBITER_CORE_WINDOW_MS,
  ARBITER_HITS_TO_DEFEAT,
  ARBITER_HUNT_HITS,
  ARBITER_RADIUS,
  BLACKOUT_LINGER_MS,
  CHASM_GRACE_MS,
  CORE_PICKUP_RADIUS,
  CUSTODE_ENRAGE_AT,
  CUSTODE_EXPOSED_ENRAGED_MS,
  CUSTODE_EXPOSED_MS,
  CUSTODE_HITS_TO_DEFEAT,
  CUSTODE_MANIPULATION_ENRAGED_MS,
  CUSTODE_MANIPULATION_MS,
  CUSTODE_RADIUS,
  CUSTODE_TELL_MS,
  DASH_DURATION_MS,
  DASH_SPEED,
  RESPAWN_GRACE_MS,
  SHIELD_PICKUP_RADIUS,
  TURRET_RADIUS,
  XP_BOSS_DEFEAT,
  XP_BOSS_HIT_GRAZE,
  XP_BOSS_HIT_SOLID,
  XP_CORE,
  XP_ROOM_ENTER,
  XP_ENEMY_WEAK_HIT,
  XP_TURRET_DOWN,
  CROGIOLO_CLOUD_MS,
  BEACON_CHARGES_MAX,
  BEACON_WALL_MARGIN,
  CROGIOLO_CLOUD_TILES,
  ENEMY_REVEAL_MS,
  LEVEL_START_GRACE_MS,
  PLAYER_EYE_Z,
  levelForXp,
} from './constants';
import {
  roomAt,
  roomBoundsPx,
  roomOrder,
  tileAt,
  type BossKind,
  type EnemySpawnDef,
  type LevelDef,
  type TurretDef,
} from './levelTypes';
import {
  CLOSE_RANGE_TILES,
  CORE_BAND_CENTRE,
  CORE_BAND_HALF,
  ENEMY_FRONT_PLATE_HALF,
  ENEMY_REAR_ARC_HALF,
  HARDENED_MULT,
  HEAD_BAND_LOW,
  LONG_RANGE_TILES,
  VENT_WINDOW_MS,
  VULNERABILITY_MULT,
  WEAK_SPOT_MULT,
  archetypeOf,
  contactRange,
  type Vulnerability,
  type WeakSpot,
} from './enemies';
import { ENEMY_VISION_MARGIN_TILES, updateEnemyAi, type Leash } from './enemyAi';
import { campMoveEntity, distanceAlongRayToCircle, type IsSolidFn } from './physics';
import { campCastRay, campHasLOS } from './raycast';
import {
  beaconRevealsCloaked,
  beaconStatsFor,
  hasGrazeDamage,
  isValidNode,
  canRefundNode,
  isValidShopItem,
  movementStatsFor,
  resistsGravityFlip,
  nodeCost,
  pointsSpent,
  prereqMet,
  refillsShieldOnRoomEnter,
  shieldCapacity,
  shieldRefundsShot,
  shopItemCost,
  weaponStatsFor,
} from './skills';
import {
  CAMPAIGN_PROFILE_VERSION,
  emptyCampaignInput,
  type BossPhase,
  type CampaignDifficulty,
  type CampaignEvent,
  type Checkpoint,
  type EnemyState,
  type CampaignInput,
  type CampaignProfile,
  type CampaignState,
} from './types';

/** Signed shortest angular difference, in (-PI, PI]. Same helper as
 *  the Arena's raycast.ts angleDelta. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function centreOf(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}

/** Da dove parte ciascun boss. ARBITER comincia dietro i suoi moduli,
 *  il Custode manipolando, la Sentinella in guardia. */
function initialBossPhase(kind: BossKind): BossPhase {
  if (kind === 'custode') return 'blackout';
  if (kind === 'arbiter') return 'modules';
  return 'guard';
}

/** How much damage a hit on the boss's hurtbox actually does, given
 *  where the shooter is standing relative to the boss's facing.
 *  Positional, not aim-angle-based: "vulnerabile solo al core sul
 *  retro" (GDD.md section 6) is about where you stand, not how
 *  precisely you shoot. */
function resolveBossHit(
  bossX: number,
  bossY: number,
  bossAngle: number,
  bossPhase: string,
  shooterX: number,
  shooterY: number,
  canGraze: boolean,
): number {
  if (bossPhase !== 'charge' && bossPhase !== 'recover') return 0;
  const toShooter = Math.atan2(shooterY - bossY, shooterX - bossX);
  const rearDir = bossAngle + Math.PI;
  const diff = Math.abs(angleDelta(rearDir, toShooter));
  if (diff <= BOSS_REAR_ARC_HALF) return 1;
  if (canGraze && diff <= BOSS_GRAZE_ARC_HALF) return 0.5;
  return 0;
}

/** Da dove e quando arriva un colpo su un nemico. `aimZ` è la quota,
 *  in px dal pavimento, a cui il mirino punta *alla distanza del
 *  bersaglio*: la conversione da inclinazione della camera a pendenza
 *  la fa il controller, che è l'unico ad avere il viewport (vedi
 *  `aimSlope` in types.ts). */
export interface EnemyShot {
  shooterX: number;
  shooterY: number;
  aimZ: number;
  dist: number;
  ads: boolean;
}

export interface EnemyHitResult {
  damage: number;
  weakSpot: WeakSpot | null;
  vulnerability: Vulnerability | null;
}

/** Quanto vale questo colpo, e perché.
 *
 *  Due assi indipendenti che moltiplicano: *dove* colpisci (il punto
 *  debole) e *quando* (la vulnerabilità). Vedi la nota lunga in
 *  enemies.ts sul perché non ci sono elementi.
 *
 *  Il corpo si colpisce sempre, qualunque sia l'alzo: richiedere anche
 *  in verticale di stare dentro la sagoma avrebbe trasformato ogni
 *  colpo in un tiro di precisione, e in un motore dove l'orizzonte
 *  scorre invece di ruotare sarebbe stato un tiro che il giocatore non
 *  può mirare onestamente. L'alzo decide se il colpo vale di più, non
 *  se arriva.
 *
 *  Funzione di modulo e non metodo, come resolveBossHit qui sopra: non
 *  legge niente del mondo, e provarla non deve richiedere di
 *  costruirne uno — tanto più che nel tick reale l'IA muove i nemici
 *  *prima* che il colpo parta, quindi da fuori non si riesce a tenere
 *  ferma la scena abbastanza a lungo per interrogarla. */
export function resolveEnemyHit(e: EnemyState, shot: EnemyShot): EnemyHitResult {
  const a = archetypeOf(e.kind);
  const toShooter = Math.atan2(shot.shooterY - e.y, shot.shooterX - e.x);
  const frontDiff = Math.abs(angleDelta(e.angle, toShooter));

  // La piastra del Guardiano è un'immunità, non una riduzione: una
  // riduzione si supera sparando di più, e il punto è che non si debba
  // poter risolvere sparando di più.
  if (a.frontImmune && frontDiff <= ENEMY_FRONT_PLATE_HALF) {
    return { damage: 0, weakSpot: null, vulnerability: null };
  }

  const h = a.height * TILE;
  const base = (a.floatZ ?? 0) * TILE;

  let weak: WeakSpot | null = null;
  if (a.weakSpot === 'rear') {
    if (Math.PI - frontDiff <= ENEMY_REAR_ARC_HALF) weak = 'rear';
  } else if (a.weakSpot === 'core') {
    if (Math.abs(shot.aimZ - (base + CORE_BAND_CENTRE * h)) <= CORE_BAND_HALF * h) weak = 'core';
  } else if (shot.aimZ >= base + HEAD_BAND_LOW * h) {
    weak = 'head';
  }

  let vuln: Vulnerability | null = null;
  switch (a.vulnerability) {
    case 'mirato':
      if (shot.ads) vuln = 'mirato';
      break;
    case 'ravvicinato':
      if (shot.dist <= CLOSE_RANGE_TILES * TILE) vuln = 'ravvicinato';
      break;
    case 'distante':
      if (shot.dist >= LONG_RANGE_TILES * TILE) vuln = 'distante';
      break;
    case 'sfiatato':
      if (e.ventMs > 0) vuln = 'sfiatato';
      break;
    case 'immobile':
      if (e.still) vuln = 'immobile';
      break;
    case 'scoperto':
      if (e.closing || e.chargeMs > 0) vuln = 'scoperto';
      break;
    default:
      break;
  }

  let dmg = 1;
  if (weak) dmg *= WEAK_SPOT_MULT;
  if (vuln) dmg *= VULNERABILITY_MULT;
  if (e.hardened) dmg *= HARDENED_MULT;
  return { damage: dmg, weakSpot: weak, vulnerability: vuln };
}

export class CampaignWorld {
  readonly level: LevelDef;
  state: CampaignState;
  /** Events produced by the most recent step(). Drained by the
   *  presentation layer; the sim never reads it back. */
  events: CampaignEvent[] = [];

  /** Tile value as seen by movement, LOS, hitscan and the renderer:
   *  the static map, plus any sealed door, minus any collapsed floor.
   *  Public — the renderer needs it too, to draw the very door it can
   *  walk into.
   *
   *  Un pavimento ceduto NON diventa muro: resta attraversabile, ed è
   *  la trappola a decidere cosa succede a chi ci sta sopra. Renderlo
   *  solido avrebbe murato il pozzo a metà, trasformando un costo di
   *  tempo in un livello impossibile. */
  getTile = (tx: number, ty: number): number => {
    for (const d of this.state.doors) {
      if (!d.closed) continue;
      const def = this.level.doors.find((x) => x.id === d.id);
      if (def?.tiles.some((t) => t.tx === tx && t.ty === ty)) return 1;
    }
    return tileAt(this.level, tx, ty);
  };

  private isSolid: IsSolidFn = (tx, ty) => this.getTile(tx, ty) !== 0;

  /** I guinzagli sono una proprietà del livello, non del tick. */
  private leashCache = new Map<string, Leash | null>();

  /** Il checkpoint di partenza, clonato alla costruzione e mai più
   *  toccato: in modalità Medio è a questo — non all'ultimo
   *  checkpoint raggiunto — che si torna a ogni morte (vedi
   *  killPlayer). Tenerlo separato da state.checkpoint invece di
   *  ricalcolarlo da level.spawn evita di dover rifare qui la stessa
   *  roomAt/centreOf già fatta sotto. */
  private readonly spawnCheckpoint: Checkpoint;

  /** `profile` seeds a returning player: the character they built,
   *  never where they were standing (see CampaignProfile). Absent —
   *  or discarded as an unknown version — means a fresh start.
   *
   *  `difficulty` conta solo quando `profile` non c'è ancora: un
   *  personaggio esistente ha già fissato la sua nel profilo, e
   *  lasciare che il menu la cambi a metà campagna renderebbe le
   *  regole di morte incoerenti con quanto già giocato. */
  constructor(level: LevelDef, profile?: CampaignProfile, difficulty: CampaignDifficulty = 'tutorial') {
    this.level = level;
    const xp = profile?.xp ?? 0;
    const playerLevel = levelForXp(xp);
    const collected = new Set(profile?.collectedCoreIds ?? []);
    const spawn = centreOf(level.spawn.tx, level.spawn.ty);
    // Calcolati qui, prima del literal qui sotto, perché
    // player.beaconCharges ne ha bisogno subito: un personaggio che
    // torna con Doppio Innesco già comprato deve iniziare il livello
    // con tre cariche, non due corrette al primo tick.
    const unlockedNodes = [...(profile?.unlockedNodes ?? [])];
    const purchases = [...(profile?.purchases ?? [])];
    const beacon = beaconStatsFor(unlockedNodes, purchases);

    this.state = {
      tick: 0,
      levelId: level.id,
      checkpoint: {
        room: roomAt(level, level.spawn.tx, level.spawn.ty),
        x: spawn.x,
        y: spawn.y,
        angle: 0,
      },
      player: {
        x: spawn.x,
        y: spawn.y,
        angle: 0,
        pitch: 0,
        weaponCooldown: 0,
        // Vedi LEVEL_START_GRACE_MS: entrare in un livello è un
        // respawn come un altro, e merita lo stesso riguardo.
        respawnInvulnerableMs: LEVEL_START_GRACE_MS,
        shieldCharges: 0,
        dashTimer: 0,
        dashCooldown: 0,
        dashDirX: 0,
        dashDirY: 0,
        dashSpeed: DASH_SPEED,
        empMs: 0,
        darkMs: 0,
        gravityFlipped: false,
        beaconCharges: beacon.chargesStart,
      },
      doors: level.doors.map((d) => ({
        id: d.id,
        armed: false,
        closeTimer: 0,
        closed: false,
      })),
      turrets: level.turrets.map((t) => ({
        id: t.id,
        alive: true,
        reactionTimer: t.reactionMs,
        // Lo sfasamento è un cooldown iniziale: una turret che parte
        // "già a metà ricarica" apre il fuoco più tardi delle altre,
        // ed è tutto ciò che serve per il fuoco incrociato.
        fireCooldown: t.phaseMs,
      })),
      enemies: level.enemies.map((d) => {
        const a = archetypeOf(d.kind);
        const home = centreOf(d.tx, d.ty);
        const patrol = d.patrol ? centreOf(d.patrol.tx, d.patrol.ty) : null;
        return {
          id: d.id,
          kind: d.kind,
          alive: true,
          x: home.x,
          y: home.y,
          angle: d.facing ?? 0,
          hp: a.hp,
          ai: 'patrol' as const,
          reactionTimer: a.reactionMs,
          attackCooldown: 0,
          ventMs: 0,
          revealMs: 0,
          chargeMs: 0,
          chargeDirX: 0,
          chargeDirY: 0,
          postX: home.x,
          postY: home.y,
          patrolX: patrol ? patrol.x : null,
          patrolY: patrol ? patrol.y : null,
          goalX: null,
          goalY: null,
          patrolTimer: 0,
          lastSeenX: null,
          lastSeenY: null,
          // Falso, non vero: `still` vuol dire "si è piantato
          // apposta", ed è ciò che la vulnerabilità `immobile`
          // premia. Inizializzarlo a vero regalava il moltiplicatore
          // al primo colpo contro un nemico che non aveva ancora
          // deciso niente.
          still: false,
          closing: false,
          lured: false,
          hardened: false,
        };
      }),
      collapsingFloors: level.collapsingFloors.map((f) => ({
        id: f.id,
        standingMs: 0,
        collapsed: false,
        resetTimer: 0,
      })),
      chasms: level.chasms.map((c) => ({ id: c.id, hoverMs: 0 })),
      cores: level.cores.map((d) => ({
        id: d.id,
        ...centreOf(d.tx, d.ty),
        collected: collected.has(d.id),
      })),
      shields: level.shields.map((d) => ({
        id: d.id,
        ...centreOf(d.tx, d.ty),
        collected: false,
      })),
      beaconPickups: level.beacons.map((d) => ({
        id: d.id,
        ...centreOf(d.tx, d.ty),
        collected: false,
      })),
      beacon: { active: false, x: 0, y: 0, ms: 0 },
      coresCollected: collected.size,
      roomsAwarded: [...(profile?.roomsAwarded ?? [])],
      completedLevels: [...(profile?.completedLevels ?? [])],
      xp,
      level: playerLevel,
      // One point per level gained, so this follows from the level the
      // XP buys — never stored, never able to drift from it.
      skillPoints: playerLevel - 1,
      unlockedNodes,
      purchases,
      boss: level.boss
        ? {
            ...centreOf(level.boss.tx, level.boss.ty),
            angle: Math.PI,
            phase: initialBossPhase(level.boss.kind),
            phaseTimer:
              level.boss.kind === 'custode' ? CUSTODE_MANIPULATION_MS : BOSS_GUARD_MS,
            damageTaken: 0,
            chargeDirX: 0,
            chargeDirY: 0,
            chargesLeft: 0,
            stage: 1,
            stageDamage: 0,
          }
        : null,
      outcome: 'playing',
      difficulty: profile?.difficulty ?? difficulty,
      reachedRoom: roomAt(level, level.spawn.tx, level.spawn.ty),
    };
    this.spawnCheckpoint = { ...this.state.checkpoint };
  }

  get finished(): boolean {
    return this.state.outcome !== 'playing';
  }

  /** Seconda fase della Sentinella: derivata dal danno subito, non
   *  memorizzata, così non può restare accesa dopo un reset del boss
   *  che azzera il danno (vedi killPlayer). */
  get enraged(): boolean {
    const boss = this.state.boss;
    if (boss === null) return false;
    const at = this.level.boss!.kind === 'custode' ? CUSTODE_ENRAGE_AT : BOSS_ENRAGE_AT;
    return boss.damageTaken >= at;
  }

  /** Minimappa e ottica sono fuori uso: il gas le ha spente. */
  get blinded(): boolean {
    return this.state.player.empMs > 0;
  }

  /** Non si vede: blackout di settore, o il Custode che ha spento le
   *  luci. Al buio i sensori restano — è l'opposto del gas, e il
   *  motivo per cui le due trappole non sono la stessa. */
  get darkness(): number {
    const boss = this.state.boss;
    const fromBoss = boss !== null && boss.phase === 'blackout' ? 1 : 0;
    return Math.max(
      fromBoss,
      Math.min(1, this.state.player.darkMs / BLACKOUT_LINGER_MS),
    );
  }

  /** Il mondo è capovolto. */
  get gravityInverted(): boolean {
    return this.state.player.gravityFlipped;
  }

  /** Colpi necessari per il boss di questo livello. */
  get bossHitsToDefeat(): number {
    switch (this.level.boss?.kind) {
      case 'custode':
        return CUSTODE_HITS_TO_DEFEAT;
      case 'arbiter':
        return ARBITER_HITS_TO_DEFEAT;
      default:
        return BOSS_HITS_TO_DEFEAT;
    }
  }

  /** Il giocatore non può essere colpito adesso. Due sorgenti, una
   *  sola domanda: il lockout dopo un respawn, e lo scatto con il
   *  nodo Scatto Evasivo. Tenerle dietro un unico getter evita che un
   *  punto del codice ne conosca una e non l'altra. */
  private get invulnerable(): boolean {
    const p = this.state.player;
    if (p.respawnInvulnerableMs > 0) return true;
    return (
      p.dashTimer > 0 &&
      movementStatsFor(this.state.unlockedNodes, this.state.purchases).dashInvulnerable
    );
  }

  /** Skill points earned by leveling up but not yet spent on a node. */
  get availableSkillPoints(): number {
    return this.state.skillPoints - pointsSpent(this.state.unlockedNodes, this.state.purchases);
  }

  /** The part of this run worth carrying to the next one. */
  toProfile(): CampaignProfile {
    return {
      version: CAMPAIGN_PROFILE_VERSION,
      xp: this.state.xp,
      unlockedNodes: [...this.state.unlockedNodes],
      purchases: [...this.state.purchases],
      levelId: this.state.levelId,
      completedLevels: [...this.state.completedLevels],
      collectedCoreIds: this.state.cores.filter((c) => c.collected).map((c) => c.id),
      roomsAwarded: [...this.state.roomsAwarded],
      difficulty: this.state.difficulty,
    };
  }

  /** Advance one fixed tick. Returns the events generated. */
  step(input: CampaignInput = emptyCampaignInput()): CampaignEvent[] {
    this.events = [];
    this.state.tick++;

    const p = this.state.player;
    if (p.weaponCooldown > 0) p.weaponCooldown = Math.max(0, p.weaponCooldown - TICK_MS);
    if (p.respawnInvulnerableMs > 0) {
      p.respawnInvulnerableMs = Math.max(0, p.respawnInvulnerableMs - TICK_MS);
    }
    if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - TICK_MS);

    this.startDashIfRequested(input);
    this.applyMovement(input);
    this.updateCheckpoint();
    this.updateDoors();
    this.updateGas();
    this.updateBlackout();
    this.updateCollapsingFloors();
    this.updateChasms();
    this.updateCores();
    this.updateShieldPickups();
    this.updateBeaconPickups();
    // Prima di updateEnemies: se l'esca parte questo tick, il richiamo
    // deve valere già in questo stesso tick, non in quello dopo — e
    // deve valere anche prima di fireWeapon, così un lancio e un colpo
    // premuti insieme si risolvono nell'ordine giusto (vedi
    // throwBeacon).
    this.throwBeacon(input);
    this.updateBeacon();
    this.updateTurrets();
    this.updateEnemies();
    this.updateBoss();
    // Dopo il boss, non prima: il Custode capovolge la stanza come
    // fase, e leggere la gravità prima di aggiornarlo la lascerebbe
    // indietro di un tick rispetto a ciò che il giocatore vede.
    this.updateGravity();

    if (input.fire) this.fireWeapon(input);

    this.updateExit();

    return this.events;
  }

  /** Spend one available skill point to unlock a node. Returns
   *  whether it succeeded — false if the id is unknown, already
   *  unlocked, unaffordable, or still behind its prerequisite. */
  tryUnlockNode(id: string): boolean {
    if (!isValidNode(id)) return false;
    if (this.state.unlockedNodes.includes(id)) return false;
    if (!prereqMet(this.state.unlockedNodes, id)) return false;
    if (this.availableSkillPoints < nodeCost(id)) return false;
    this.state.unlockedNodes.push(id);
    this.events.push({ type: 'nodeUnlocked', id });
    return true;
  }

  /** Spend one available skill point on a Banco item. Stessa forma di
   *  tryUnlockNode, coi controlli suoi — sconosciuto, doppione, punti
   *  insufficienti — nello stesso ordine, ognuno col suo evento
   *  `purchaseRefused`.
   *
   *  Quello che NON controlla è se questo innesto è ancora offerto in
   *  questo atto: questo mondo simula un livello alla volta e non sa
   *  in che intervallo d'atto si trovi il giocatore. Quella domanda
   *  vive in src/game/campaignShop.ts, il solo posto che conosce il
   *  contesto — da cui il reason 'atto', dichiarato in types.ts ma mai
   *  restituito da qui. */
  tryPurchase(id: string, giveBack?: string): boolean {
    if (!isValidShopItem(id)) {
      this.events.push({ type: 'purchaseRefused', id, reason: 'sconosciuto' });
      return false;
    }
    if (this.state.purchases.includes(id)) {
      this.events.push({ type: 'purchaseRefused', id, reason: 'gia-preso' });
      return false;
    }
    // La seconda moneta del Banco: un nodo reso al posto di un punto.
    //
    // Non e' una gentilezza. L'albero si spende dalla pausa in
    // qualunque momento, quindi chi spende i punti appena li guadagna
    // arriva all'intervallo d'atto con in tasca solo quelli arrivati
    // col boss — misurati sul percorso vero, uno alla fine dell'Atto I
    // e ZERO alla fine dell'Atto II. Senza il reso, il Banco del
    // secondo atto non si sarebbe mai potuto aprire.
    //
    // Si rende PRIMA di ricontrollare i punti invece di scalare a mano
    // il costo: cosi' la sola fonte di verita' resta
    // `availableSkillPoints`, che deriva da entrambe le liste. Un
    // conto tenuto a parte sarebbe una seconda versione della stessa
    // verita' in attesa di litigare con la prima.
    if (this.availableSkillPoints < shopItemCost(id) && giveBack !== undefined) {
      if (canRefundNode(this.state.unlockedNodes, giveBack)) {
        this.state.unlockedNodes = this.state.unlockedNodes.filter((n) => n !== giveBack);
        this.events.push({ type: 'nodeRefunded', id: giveBack });
      }
    }
    if (this.availableSkillPoints < shopItemCost(id)) {
      this.events.push({ type: 'purchaseRefused', id, reason: 'punti' });
      return false;
    }
    this.state.purchases.push(id);
    this.events.push({ type: 'itemPurchased', id });
    return true;
  }

  // --------------------------------------------------------------------

  /** Add XP and raise the level (and skill points) for every threshold
   *  it now clears. A single big award — the boss-defeat bonus — can
   *  cross more than one threshold at once, so this loops rather than
   *  checking once. */
  private grantXp(amount: number): void {
    this.state.xp += amount;
    this.events.push({ type: 'xpGained', amount });

    const newLevel = levelForXp(this.state.xp);
    while (this.state.level < newLevel) {
      this.state.level++;
      this.state.skillPoints++;
      this.events.push({ type: 'levelUp', level: this.state.level });
    }
  }

  private turretDef(id: string): TurretDef {
    return this.level.turrets.find((t) => t.id === id)!;
  }

  private playerTile(): { tx: number; ty: number } {
    const p = this.state.player;
    return { tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) };
  }

  /** Lo scatto parte qui, non dentro applyMovement: applyMovement
   *  esce subito quando non c'è input di movimento, e uno scatto
   *  richiesto da fermo deve comunque partire. */
  private startDashIfRequested(input: CampaignInput): void {
    if (!input.dash) return;
    const p = this.state.player;
    if (p.dashTimer > 0 || p.dashCooldown > 0) return;

    const move = movementStatsFor(this.state.unlockedNodes, this.state.purchases);
    if (!move.hasDash) return;

    // Direzione: quella in cui si sta andando; da fermi, quella in cui
    // si guarda. input.aimAngle e non p.angle: questo metodo gira
    // *prima* di applyMovement, che è dove p.angle viene aggiornato.
    const fx = Math.cos(input.aimAngle);
    const fy = Math.sin(input.aimAngle);
    const rx = -Math.sin(input.aimAngle);
    const ry = Math.cos(input.aimAngle);
    let dx = fx * input.forward + rx * input.strafe;
    let dy = fy * input.forward + ry * input.strafe;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = fx;
      dy = fy;
    } else {
      dx /= len;
      dy /= len;
    }

    p.dashDirX = dx;
    p.dashDirY = dy;
    p.dashTimer = DASH_DURATION_MS;
    p.dashSpeed = move.dashSpeed;
    p.dashCooldown = move.dashCooldownMs;
    this.events.push({ type: 'dashStarted' });
  }

  private applyMovement(input: CampaignInput): void {
    const p = this.state.player;
    p.angle = input.aimAngle;

    // Uno scatto in corso ignora il joystick e tiene la direzione
    // fissata alla partenza: se seguisse l'input sarebbe una corsa
    // veloce sterzabile, mentre quello che serve al giocatore è uno
    // strappo da puntare *prima*, e da temporizzare.
    //
    // Col nodo Scatto Angolare questo si allenta, ma di poco: la
    // direzione insegue quella desiderata al massimo di dashSteerRate
    // radianti per tick, che a fine scatto fa circa un radiante in
    // tutto — abbastanza per finire dietro un bersaglio, non per
    // invertire la rotta a metà (vedi NODE_DASH_STEER_RATE).
    if (p.dashTimer > 0) {
      p.dashTimer = Math.max(0, p.dashTimer - TICK_MS);
      const steerRate = movementStatsFor(this.state.unlockedNodes, this.state.purchases)
        .dashSteerRate;
      if (steerRate > 0 && (input.forward !== 0 || input.strafe !== 0)) {
        // Stessa costruzione della direzione desiderata di
        // startDashIfRequested: quella in cui si sta spingendo, in
        // spazio mondo.
        const fx = Math.cos(input.aimAngle);
        const fy = Math.sin(input.aimAngle);
        const rx = -Math.sin(input.aimAngle);
        const ry = Math.cos(input.aimAngle);
        let wx = fx * input.forward + rx * input.strafe;
        let wy = fy * input.forward + ry * input.strafe;
        const wlen = Math.hypot(wx, wy);
        if (wlen > 1e-6) {
          wx /= wlen;
          wy /= wlen;
          const cur = Math.atan2(p.dashDirY, p.dashDirX);
          const want = Math.atan2(wy, wx);
          const delta = angleDelta(cur, want);
          const step = Math.max(-steerRate, Math.min(steerRate, delta));
          const next = cur + step;
          p.dashDirX = Math.cos(next);
          p.dashDirY = Math.sin(next);
        }
      }
      campMoveEntity(this.isSolid, p, p.dashDirX * p.dashSpeed, p.dashDirY * p.dashSpeed);
      return;
    }

    let forward = input.forward;
    const strafe = input.strafe;
    if (forward === 0 && strafe === 0) return;

    if (forward < 0) forward *= BACKWARD_MULT;

    const fx = Math.cos(p.angle);
    const fy = Math.sin(p.angle);
    const rx = -Math.sin(p.angle);
    const ry = Math.cos(p.angle);

    // A gravità invertita lo strafe si specchia insieme al mondo: la
    // vista è capovolta, quindi "destra" è dall'altra parte. Il nodo
    // Ancoraggio toglie proprio questo, e lascia solo il ribaltamento
    // visivo.
    const mirror =
      p.gravityFlipped && !resistsGravityFlip(this.state.unlockedNodes) ? -1 : 1;
    let vx = fx * forward + rx * strafe * mirror * STRAFE_MULT;
    let vy = fy * forward + ry * strafe * mirror * STRAFE_MULT;

    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }

    const stats = weaponStatsFor(this.state.unlockedNodes, this.state.purchases);
    const move = movementStatsFor(this.state.unlockedNodes, this.state.purchases);
    const speed = PLAYER_SPEED * move.speedMult * (input.ads ? stats.adsMoveMult : 1);
    campMoveEntity(this.isSolid, p, vx * speed, vy * speed);
  }

  /** Un checkpoint si prende dove si era al sicuro, e avanza soltanto.
   *
   *  La seconda meta' di questa frase c'era gia'. La prima e' nata da
   *  una partita vera: il checkpoint si prendeva nell'istante in cui si
   *  varcava la soglia di una stanza, cioe' nel punto peggiore
   *  possibile — la porta e' esattamente dove la stanza ti vede per
   *  primo. Nel MAGAZZINO dell'ATTRACCO quella soglia sta nella linea
   *  di tiro di un drone, che non ha cono visivo e reagisce in 500 ms:
   *  si rinasceva, si restava intoccabili per la grazia, e si moriva
   *  nel tick in cui la grazia finiva. Sempre. Misurato: 0,82 s di vita
   *  a testa, 49 volte di fila.
   *
   *  Alzare la grazia da sola non bastava: avrebbe spostato l'ora della
   *  morte, non evitata. Il difetto non e' quanto duri l'invulnerabilita',
   *  e' *dove* ti rimette in piedi. Quindi il checkpoint smette di
   *  essere "la soglia della stanza piu' avanzata" e diventa "l'ultimo
   *  punto in cui niente di vivo poteva spararti": un posto da cui si
   *  puo' ricominciare a giocare invece che ricominciare a morire.
   *
   *  Il prezzo, voluto: entrando in una stanza battuta da una torretta
   *  il checkpoint resta indietro, e morire li' dentro fa ripartire da
   *  prima della soglia. E' qualche passo da rifare — ed e' la
   *  differenza fra un gioco severo e un gioco bloccato. */
  private updateCheckpoint(): void {
    const p = this.state.player;
    const room = roomAt(this.level, Math.floor(p.x / TILE), Math.floor(p.y / TILE));

    // "Sono entrato nel MAGAZZINO" resta vero anche se li' dentro non
    // c'e' un metro quadro sicuro: la battuta, l'XP di stanza e la
    // ricarica dello scudo pendono da questo, non dal checkpoint.
    if (roomOrder(this.level, room) > roomOrder(this.level, this.state.reachedRoom)) {
      this.state.reachedRoom = room;
      this.events.push({ type: 'roomEntered', room });
      // Pagato una volta per profilo, e la chiave porta il livello:
      // altrimenti due livelli con una stanza omonima si
      // annullerebbero a vicenda, e uscire al menu per rientrare
      // sarebbe un ciclo di XP stabile.
      const key = `${this.level.id}/${room}`;
      if (!this.state.roomsAwarded.includes(key)) {
        this.state.roomsAwarded.push(key);
        this.grantXp(XP_ROOM_ENTER);
      }
      this.refillShieldOnRoomEnter();
    }

    // Indietro non si torna: ritirarsi per curarsi le idee non deve
    // costare il progresso gia' fatto.
    if (roomOrder(this.level, room) < roomOrder(this.level, this.state.checkpoint.room)) return;
    if (!this.isSafeToRespawn(p.x, p.y)) return;
    this.state.checkpoint = { room, x: p.x, y: p.y, angle: p.angle };
  }

  /** Vero se da (x, y) nessuno di vivo ha la linea di tiro.
   *
   *  Niente cono visivo, di proposito: un nemico si gira, e mentre si
   *  e' morti si gira di sicuro. Quello che non cambia e' il muro in
   *  mezzo, quindi e' la linea di tiro l'unica cosa onesta da
   *  chiedere. Le torrette contano sempre (non hanno cono e vedono
   *  fin dove arriva il corridoio), i nemici solo entro la loro
   *  portata piu' il margine — lo stesso numero che usa canSeeTarget
   *  in enemyAi.ts, per non avere due idee diverse di "mi vede". */
  private isSafeToRespawn(x: number, y: number): boolean {
    const tiro = (ax: number, ay: number): boolean =>
      campHasLOS(this.getTile, ax, ay, x, y, this.level.width, this.level.height);

    for (const t of this.state.turrets) {
      if (!t.alive) continue;
      const def = this.turretDef(t.id);
      const c = centreOf(def.tx, def.ty);
      if (tiro(c.x, c.y)) return false;
    }

    for (const e of this.state.enemies) {
      if (!e.alive) continue;
      const a = archetypeOf(e.kind);
      const visione =
        (a.attack === 'none' ? 9 : Math.max(a.rangeTiles, 4)) + ENEMY_VISION_MARGIN_TILES;
      if (Math.hypot(e.x - x, e.y - y) > visione * TILE) continue;
      if (tiro(e.x, e.y)) return false;
    }

    const boss = this.state.boss;
    if (boss && boss.phase !== 'defeated' && tiro(boss.x, boss.y)) return false;

    return true;
  }

  /** Riserva di Bordo. Ricarica solo uno scudo *già raccolto*: senza
   *  quella condizione il nodo consegnerebbe uno scudo prima ancora
   *  del punto in cui lo scudo si trova, e renderebbe inutile andarlo
   *  a prendere.
   *
   *  Non è sfruttabile in loop: i checkpoint avanzano soltanto, quindi
   *  tornare indietro e rientrare non conta come stanza nuova. */
  private refillShieldOnRoomEnter(): void {
    if (!this.state.shields.some((s) => s.collected)) return;
    if (!refillsShieldOnRoomEnter(this.state.unlockedNodes)) return;
    const capacity = shieldCapacity(this.state.unlockedNodes, this.state.purchases);
    const p = this.state.player;
    if (p.shieldCharges >= capacity) return;
    p.shieldCharges = capacity;
    this.events.push({ type: 'shieldRefilled', charges: p.shieldCharges });
  }

  private updateDoors(): void {
    for (const d of this.state.doors) {
      if (d.closed) continue;
      const def = this.level.doors.find((x) => x.id === d.id)!;

      if (!d.armed) {
        if (Math.floor(this.state.player.x / TILE) >= def.sensorTx) {
          d.armed = true;
          d.closeTimer = def.delayMs;
        }
        continue;
      }

      d.closeTimer -= TICK_MS;
      if (d.closeTimer <= 0) {
        d.closed = true;
        d.armed = false;
        this.events.push({ type: 'doorSealed', id: d.id });
      }
    }
  }

  /** Gas/EMP. Dentro la nube l'accecamento si ricarica a ogni tick;
   *  fuori scende. Il risultato è che entrare acceca subito e uscire
   *  lascia una coda, senza bisogno di ricordare quando si è entrati. */
  private updateGas(): void {
    const p = this.state.player;
    const { tx, ty } = this.playerTile();
    const inGas = this.level.gasZones.some((z) =>
      z.tiles.some((t) => t.tx === tx && t.ty === ty),
    );

    const wasBlind = p.empMs > 0;
    if (inGas) {
      const zone = this.level.gasZones.find((z) =>
        z.tiles.some((t) => t.tx === tx && t.ty === ty),
      )!;
      p.empMs = zone.lingerMs;
    } else if (p.empMs > 0) {
      p.empMs = Math.max(0, p.empMs - TICK_MS);
    }

    if (!wasBlind && p.empMs > 0) this.events.push({ type: 'gasEntered' });
    if (wasBlind && p.empMs <= 0) this.events.push({ type: 'gasCleared' });
  }

  /** Blackout. Stessa forma del gas — dentro si ricarica, fuori
   *  scende — ma quello che toglie è la vista, non i sensori. */
  private updateBlackout(): void {
    const p = this.state.player;
    const { tx, ty } = this.playerTile();
    const zone = this.level.blackouts.find((z) =>
      z.tiles.some((t) => t.tx === tx && t.ty === ty),
    );

    const wasDark = p.darkMs > 0;
    if (zone) p.darkMs = zone.lingerMs;
    else if (p.darkMs > 0) p.darkMs = Math.max(0, p.darkMs - TICK_MS);

    if (!wasDark && p.darkMs > 0) this.events.push({ type: 'blackoutEntered' });
    if (wasDark && p.darkMs <= 0) this.events.push({ type: 'blackoutCleared' });
  }

  /** Gravità alterata. Un interruttore, non una coda: uscire dal
   *  settore rimette il mondo dritto all'istante, perché restare
   *  capovolti fuori dalla zona che lo spiega sarebbe solo confusione
   *  senza causa visibile.
   *
   *  Il Custode la usa anche lui, e vince sul settore: durante la sua
   *  fase di inversione tutta l'arena è capovolta. */
  private updateGravity(): void {
    const p = this.state.player;
    const { tx, ty } = this.playerTile();
    const inZone = this.level.gravityZones.some((z) =>
      z.tiles.some((t) => t.tx === tx && t.ty === ty),
    );
    const fromBoss = this.state.boss?.phase === 'invert';
    const next = inZone || fromBoss === true;

    if (next !== p.gravityFlipped) {
      p.gravityFlipped = next;
      this.events.push({ type: 'gravityFlipped', inverted: next });
    }
  }

  /** Passerelle sospese. Si cade restando sul vuoto più di graceMs:
   *  camminare non basta, scattare sì. Il contatore vive sulla
   *  voragine e non sul giocatore solo per poterlo ispezionare nei
   *  test; il giocatore è uno, quindi non può esserne sopra due. */
  private updateChasms(): void {
    const { tx, ty } = this.playerTile();
    const p = this.state.player;

    for (const c of this.state.chasms) {
      const def = this.level.chasms.find((x) => x.id === c.id)!;
      const over = def.tiles.some((t) => t.tx === tx && t.ty === ty);
      if (!over) {
        c.hoverMs = 0;
        continue;
      }

      c.hoverMs += TICK_MS;
      if (c.hoverMs < def.graceMs) continue;

      c.hoverMs = 0;
      const landing = centreOf(def.landing.tx, def.landing.ty);
      p.x = landing.x;
      p.y = landing.y;
      p.dashTimer = 0;
      this.events.push({ type: 'fellIntoChasm', id: c.id });
    }
  }

  /** Pavimento che cede. Il contatore sale solo mentre ci si sta
   *  sopra e si azzera appena si esce: il pozzo va attraversato, non
   *  attraversato a rate. */
  private updateCollapsingFloors(): void {
    const { tx, ty } = this.playerTile();

    for (const f of this.state.collapsingFloors) {
      const def = this.level.collapsingFloors.find((x) => x.id === f.id)!;

      if (f.collapsed) {
        f.resetTimer -= TICK_MS;
        if (f.resetTimer <= 0) {
          f.collapsed = false;
          f.standingMs = 0;
        }
        continue;
      }

      const standing = def.tiles.some((t) => t.tx === tx && t.ty === ty);
      if (!standing) {
        f.standingMs = 0;
        continue;
      }

      f.standingMs += TICK_MS;
      if (f.standingMs >= def.holdMs) {
        f.collapsed = true;
        f.resetTimer = def.resetMs;
        f.standingMs = 0;
        const landing = centreOf(def.landing.tx, def.landing.ty);
        const p = this.state.player;
        p.x = landing.x;
        p.y = landing.y;
        // Lo scatto in corso va annullato, o trascinerebbe il
        // giocatore fuori dal punto di atterraggio appena impostato.
        p.dashTimer = 0;
        this.events.push({ type: 'floorCollapsed', id: f.id });
      }
    }
  }

  private updateCores(): void {
    const p = this.state.player;
    for (const c of this.state.cores) {
      if (c.collected) continue;
      if (Math.hypot(p.x - c.x, p.y - c.y) <= CORE_PICKUP_RADIUS) {
        c.collected = true;
        this.state.coresCollected++;
        this.events.push({ type: 'coreCollected', id: c.id });
        this.grantXp(XP_CORE);
      }
    }
  }

  private updateShieldPickups(): void {
    const p = this.state.player;
    for (const s of this.state.shields) {
      if (s.collected) continue;
      if (Math.hypot(p.x - s.x, p.y - s.y) <= SHIELD_PICKUP_RADIUS) {
        s.collected = true;
        p.shieldCharges = shieldCapacity(this.state.unlockedNodes, this.state.purchases);
        this.events.push({ type: 'shieldPickup', charges: p.shieldCharges });
      }
    }
  }

  /** A hit that would otherwise kill the player — spends one shield
   *  charge instead, if any are left. Tactical and disposable, unlike
   *  the skill tree: see GDD.md, "Potenziamenti vs progressione
   *  permanente". */
  private damagePlayer(cause: 'turret' | 'boss' | 'enemy'): void {
    const p = this.state.player;
    if (p.shieldCharges > 0) {
      p.shieldCharges--;
      this.events.push({ type: 'shieldBreak', chargesLeft: p.shieldCharges });
      // Piastra Reattiva: il colpo assorbito paga la finestra che
      // l'attaccante ha appena aperto su di sé. shieldBreak resta
      // comunque — sono due cose diverse da dire, e la seconda esiste
      // solo col nodo.
      if (shieldRefundsShot(this.state.unlockedNodes)) {
        p.weaponCooldown = 0;
        this.events.push({ type: 'shieldReactive' });
      }
      return;
    }
    this.killPlayer(cause);
  }

  /** Il Trasponditore: lancia un'esca che ruba il bersaglio ai nemici
   *  entro il suo raggio (vedi enemyAi.ts e updateEnemies più sotto).
   *
   *  Chiamato prima di fireWeapon apposta: se le due pressioni arrivano
   *  nello stesso tick il lancio vince, e il colpo cade da solo sul
   *  cooldown che il lancio ha appena impostato. Due mani sole — non se
   *  ne fanno due cose insieme. */
  private throwBeacon(input: CampaignInput): void {
    if (!input.beacon) return;
    const p = this.state.player;
    if (p.beaconCharges <= 0) return;
    // Si ricarica ancora dall'ultimo colpo: niente lancio finché le
    // mani non sono libere.
    if (p.weaponCooldown > 0) return;

    p.beaconCharges--;
    const beacon = beaconStatsFor(this.state.unlockedNodes, this.state.purchases);
    // Lanciare costa anche il tempo di un colpo: è il vincolo su cui è
    // tarata tutta la finestra (vedi BEACON_LIFETIME_MS in
    // constants.ts, e beacon.lifetimeMs qui sotto per chi ha comprato
    // Eco Ampio).
    p.weaponCooldown = weaponStatsFor(this.state.unlockedNodes, this.state.purchases).cooldownMs;

    const wall = campCastRay(
      this.getTile,
      p.x,
      p.y,
      input.aimAngle,
      beacon.rangeTiles * TILE,
      this.level.width,
      this.level.height,
    );
    // Si tira indietro dal muro di BEACON_WALL_MARGIN, o finirebbe
    // dentro la geometria; mai sotto zero, per un muro attaccato al
    // giocatore stesso.
    //
    // Il margine vale *solo se un muro c'è davvero*. Senza il controllo
    // su `wall.hit` si sottraeva anche in campo aperto — dove
    // campCastRay riporta comunque `dist = maxDist` — e l'esca non
    // arrivava mai alla portata dichiarata, ma sempre sei pixel prima.
    // Non è un difetto che si vede giocando: è un difetto che si vede
    // solo confrontando il codice con la costante che dice 6 tile.
    const range = beacon.rangeTiles * TILE;
    const dist = wall.hit ? Math.max(0, Math.min(wall.dist - BEACON_WALL_MARGIN, range)) : range;
    const x = p.x + Math.cos(input.aimAngle) * dist;
    const y = p.y + Math.sin(input.aimAngle) * dist;

    // Un'esca sola: due esche vorrebbero dire che il giocatore decide
    // dove guardano due gruppi diversi nello stesso momento, e la
    // finestra smetterebbe di essere una decisione per diventare una
    // regia.
    this.state.beacon = { active: true, x, y, ms: beacon.lifetimeMs };
    this.events.push({ type: 'beaconThrown', x, y });
  }

  /** Vita dell'esca piantata: scende ogni tick, e mentre è viva rivela
   *  chi si occulta col nodo Eco. */
  private updateBeacon(): void {
    const b = this.state.beacon;
    if (!b.active) return;

    b.ms -= TICK_MS;
    if (b.ms <= 0) {
      this.state.beacon = { active: false, x: 0, y: 0, ms: 0 };
      this.events.push({ type: 'beaconExpired' });
      return;
    }

    // Eco. Senza il nodo il Trasponditore non fa *niente* all'Araldo —
    // è un buco lasciato apposta (vedi skills.ts beaconRevealsCloaked):
    // il nemico più tardo della campagna resta un problema aperto
    // anche a chi ha comprato tutto il resto dell'albero.
    if (!beaconRevealsCloaked(this.state.unlockedNodes)) return;
    // Stesso raggio del richiamo dei nemici (vedi enemyAi.ts): "entro
    // quanto richiama" è la stessa domanda per un nemico che si volta
    // e per uno che smette di occultarsi, quindi Eco Ampio allunga
    // entrambi insieme invece che uno dei due soltanto.
    const lureTiles = beaconStatsFor(this.state.unlockedNodes, this.state.purchases).lureTiles;
    for (const e of this.state.enemies) {
      if (!e.alive || !archetypeOf(e.kind).cloaks) continue;
      if (Math.hypot(e.x - b.x, e.y - b.y) > lureTiles * TILE) continue;
      if (!campHasLOS(this.getTile, e.x, e.y, b.x, b.y, this.level.width, this.level.height)) {
        continue;
      }
      e.revealMs = Math.max(e.revealMs, ENEMY_REVEAL_MS);
    }
  }

  /** Raccoglibile del Trasponditore. Stessa forma di updateShieldPickups:
   *  una carica in più, mai oltre il tetto. */
  private updateBeaconPickups(): void {
    const p = this.state.player;
    for (const b of this.state.beaconPickups) {
      if (b.collected) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) <= SHIELD_PICKUP_RADIUS) {
        b.collected = true;
        p.beaconCharges = Math.min(BEACON_CHARGES_MAX, p.beaconCharges + 1);
        this.events.push({ type: 'beaconPickup', charges: p.beaconCharges });
      }
    }
  }

  // ---- nemici --------------------------------------------------

  private enemyDef(id: string): EnemySpawnDef {
    return this.level.enemies.find((e) => e.id === id)!;
  }

  /** Il rettangolo oltre il quale un nemico non insegue, memorizzato
   *  la prima volta: è una proprietà del livello, non del tick. */
  private leashFor(room: string): Leash | null {
    const cached = this.leashCache.get(room);
    if (cached !== undefined) return cached;
    const b = roomBoundsPx(this.level, room);
    this.leashCache.set(room, b);
    return b;
  }

  private hitEnemy(
    id: string,
    shooterX: number,
    shooterY: number,
    aimSlope: number,
    dist: number,
    ads: boolean,
  ): void {
    const e = this.state.enemies.find((x) => x.id === id)!;
    const res = resolveEnemyHit(e, {
      shooterX,
      shooterY,
      aimZ: PLAYER_EYE_Z + aimSlope * dist,
      dist,
      ads,
    });

    // Un colpo assorbito dalla piastra è comunque un evento: senza,
    // sparare a un Guardiano di fronte sarebbe indistinguibile dallo
    // sparare al muro, e la lezione non arriverebbe mai.
    this.events.push({
      type: 'enemyHit',
      id: e.id,
      kind: e.kind,
      damage: res.damage,
      weakSpot: res.weakSpot,
      vulnerability: res.vulnerability,
      hardened: e.hardened,
    });
    if (res.damage <= 0) return;

    // Vedere il colpo giusto pagare *subito*, e non solo alla morte,
    // è ciò che insegna il punto debole senza scriverlo nella HUD.
    if (res.weakSpot) this.grantXp(XP_ENEMY_WEAK_HIT);

    e.hp -= res.damage;
    if (e.hp > 0) {
      // Colpire da fuori dal cono visivo sveglia comunque: un nemico
      // che incassa senza accorgersene sarebbe un bersaglio da poligono.
      if (e.ai === 'patrol') {
        e.ai = 'search';
        e.lastSeenX = shooterX;
        e.lastSeenY = shooterY;
      }
      return;
    }

    this.killEnemy(e);
  }

  private killEnemy(e: EnemyState): void {
    const a = archetypeOf(e.kind);
    e.alive = false;
    e.hp = 0;
    e.chargeMs = 0;
    this.events.push({ type: 'enemyDown', id: e.id, kind: e.kind });
    this.grantXp(a.xp);

    if (!a.gasOnDeath) return;
    // La nube del Crogiolo non è una zona nuova: è la stessa cecità
    // del gas, concessa a chi era troppo vicino nel momento sbagliato.
    // Tenere una nube persistente avrebbe richiesto uno stato e un
    // disegno in più per una lezione che si impara al primo colpo —
    // e la lezione è "non ucciderlo in faccia", che questa versione
    // insegna identica.
    const p = this.state.player;
    if (Math.hypot(p.x - e.x, p.y - e.y) > CROGIOLO_CLOUD_TILES * TILE) return;
    const wasBlind = p.empMs > 0;
    p.empMs = Math.max(p.empMs, CROGIOLO_CLOUD_MS);
    if (!wasBlind) this.events.push({ type: 'gasEntered' });
  }

  private updateEnemies(): void {
    const p = this.state.player;
    const anyAlive = this.state.enemies.some((e) => e.alive);
    if (!anyAlive) return;

    // L'Archivista si legge prima di muovere chiunque, così la
    // riduzione vale per tutti nello stesso tick invece di dipendere
    // dall'ordine della lista.
    const minders = this.state.enemies.filter(
      (e) => e.alive && archetypeOf(e.kind).hardensAlliesTiles !== undefined,
    );
    for (const e of this.state.enemies) {
      if (!e.alive) continue;
      e.hardened = minders.some((m) => {
        if (m.id === e.id) return false;
        const r = archetypeOf(m.kind).hardensAlliesTiles! * TILE;
        return Math.hypot(m.x - e.x, m.y - e.y) <= r;
      });
    }

    // Una volta per tutti i nemici, non uno per ciascuno: il raggio di
    // richiamo dipende solo dagli innesti comprati, non da chi lo
    // legge.
    const lureTiles = beaconStatsFor(this.state.unlockedNodes, this.state.purchases).lureTiles;

    for (const e of this.state.enemies) {
      if (!e.alive) continue;
      const a = archetypeOf(e.kind);

      const intent = updateEnemyAi(e, {
        getTile: this.getTile,
        mapW: this.level.width,
        mapH: this.level.height,
        playerX: p.x,
        playerY: p.y,
        playerTargetable: !this.invulnerable,
        lure: this.state.beacon.active
          ? { x: this.state.beacon.x, y: this.state.beacon.y, tiles: lureTiles }
          : null,
        leash: this.leashFor(this.enemyDef(e.id).room),
        dtMs: TICK_MS,
      });

      e.angle = intent.angle;
      e.still = intent.still;
      e.closing = intent.closing;
      // Sul fronte di salita soltanto: un evento per ogni tick di
      // richiamo sarebbe rumore, e quello che serve — al suono e alla
      // HUD — è l'istante in cui il nemico si volta.
      if (intent.lured && !e.lured) {
        this.events.push({ type: 'enemyLured', id: e.id, kind: e.kind });
      }
      e.lured = intent.lured;

      if (intent.moveX !== 0 || intent.moveY !== 0) {
        const len = Math.hypot(intent.moveX, intent.moveY);
        campMoveEntity(
          this.isSolid,
          e,
          (intent.moveX / len) * intent.speed,
          (intent.moveY / len) * intent.speed,
          a.radius,
        );
      }

      // La carica colpisce toccando, e si spegne appena tocca: altro
      // che un treno che continua addosso a chi ha già incassato.
      if (e.chargeMs > 0) {
        if (Math.hypot(p.x - e.x, p.y - e.y) <= a.radius + ENTITY_RADIUS) {
          e.chargeMs = 0;
          e.attackCooldown = a.cooldownMs;
          // Una carica partita mentre il nemico era già richiamato
          // resta diretta verso l'esca (vedi enemyAi.ts): se travolge
          // comunque il giocatore per coincidenza geometrica, non deve
          // fargli male lo stesso.
          if (!this.invulnerable && !e.lured) this.damagePlayer('enemy');
        }
        continue;
      }

      if (!intent.attack) continue;

      this.events.push({ type: 'enemyAttack', id: e.id, kind: e.kind });
      e.ventMs = VENT_WINDOW_MS;
      e.revealMs = ENEMY_REVEAL_MS;
      if (this.invulnerable) continue;

      // Il richiamo si prende il bersaglio ma non il colpo: un nemico
      // attirato spara o carica verso l'esca, e quel punto non sente
      // niente. È voluto che l'evento, ventMs e revealMs restino sopra
      // comunque — un nemico richiamato apre la bocchetta di sfiato
      // esattamente come uno che ha sparato al giocatore vero, e la
      // vulnerabilità `sfiatato` resta sfruttabile. Senza contropartita
      // il Trasponditore sarebbe uno scudo assoluto, non un'arma.
      if (e.lured) continue;

      if (a.attack === 'contact') {
        if (Math.hypot(p.x - e.x, p.y - e.y) <= contactRange(a) + ENTITY_RADIUS) {
          this.damagePlayer('enemy');
        }
        continue;
      }
      // A distanza è un hitscan con preavviso, lo stesso contratto
      // delle turret. La linea di vista l'ha già verificata l'IA: qui
      // ricontrollarla vorrebbe dire poterla trovare rotta dopo che il
      // colpo è partito, cioè un colpo annunciato che poi non arriva.
      this.damagePlayer('enemy');
    }
  }

  /** Riporta al loro posto i nemici che passano `inScope`. Un
   *  predicato invece di un nome di stanza fisso perché Tutorial e
   *  Medio si dividono solo su questo: "solo la stanza del
   *  checkpoint" contro "tutto il livello" (vedi killPlayer). */
  private resetEnemiesIn(inScope: (room: string) => boolean): void {
    for (const e of this.state.enemies) {
      const def = this.enemyDef(e.id);
      if (!inScope(def.room)) continue;
      const home = centreOf(def.tx, def.ty);
      const a = archetypeOf(e.kind);
      e.alive = true;
      e.hp = a.hp;
      e.x = home.x;
      e.y = home.y;
      e.angle = def.facing ?? 0;
      e.ai = 'patrol';
      e.reactionTimer = a.reactionMs;
      e.attackCooldown = 0;
      e.ventMs = 0;
      e.revealMs = 0;
      e.chargeMs = 0;
      e.goalX = null;
      e.goalY = null;
      e.patrolTimer = 0;
      e.lastSeenX = null;
      e.lastSeenY = null;
      e.still = true;
      e.closing = false;
      e.lured = false;
      e.hardened = false;
    }
  }

  private updateTurrets(): void {
    const p = this.state.player;

    for (const t of this.state.turrets) {
      if (!t.alive) continue;
      const def = this.turretDef(t.id);
      const { x, y } = centreOf(def.tx, def.ty);

      const los = campHasLOS(
        this.getTile,
        x,
        y,
        p.x,
        p.y,
        this.level.width,
        this.level.height,
      );

      if (!los) t.reactionTimer = def.reactionMs;
      else if (t.reactionTimer > 0) {
        t.reactionTimer = Math.max(0, t.reactionTimer - TICK_MS);
      }
      // Il cooldown scende sempre, anche senza linea di vista: è
      // quello che rende lo sfasamento del fuoco incrociato un ritmo
      // stabile invece di qualcosa che dipende da dove guarda il
      // giocatore.
      if (t.fireCooldown > 0) t.fireCooldown = Math.max(0, t.fireCooldown - TICK_MS);

      // Trattenere il colpo invece di sprecarlo: è il comportamento
      // che il lockout da respawn aveva già, e lo scatto si limita a
      // entrare nella stessa condizione.
      if (los && t.reactionTimer <= 0 && t.fireCooldown <= 0 && !this.invulnerable) {
        t.fireCooldown = def.cooldownMs;
        this.damagePlayer('turret');
      }
    }
  }

  private updateBoss(): void {
    const boss = this.state.boss;
    if (!boss || boss.phase === 'defeated') return;
    const def = this.level.boss!;
    // The fight does not start until the player has actually reached
    // the boss room — a stray tick before that must not burn the timer.
    // Si legge da `deepestRoom` e non dal checkpoint perché il
    // checkpoint ora pretende un posto sicuro (vedi updateCheckpoint) e
    // in una sala del boss un posto sicuro può non esistere: legarci il
    // risveglio del boss vorrebbe dire un boss che non si sveglia mai.
    if (roomOrder(this.level, this.state.reachedRoom) < roomOrder(this.level, def.room)) return;

    if (def.kind === 'custode') {
      this.updateCustode();
      return;
    }
    if (def.kind === 'arbiter') {
      this.updateArbiter();
      return;
    }
    this.updateSentinella();
  }

  /** ARBITER, in tre atti.
   *
   *  Nessuno dei tre è una macchina nuova: sono quelle che il gioco ha
   *  già insegnato, rimesse in fila. Per questo il metodo è corto e
   *  delega — se avesse dovuto riscrivere carica e finestre sarebbe
   *  stato il segno che le due macchine precedenti non erano
   *  riusabili, cioè che erano scritte male.
   *
   *  1. `modules` — il corpo è intoccabile finché una delle turret
   *     modulo respira. È il corridoio a fuoco incrociato dell'Atto I,
   *     stavolta in cerchio attorno a te.
   *  2. caccia — la macchina della Sentinella, identica: guardia,
   *     telegrafo, carica, cono posteriore. Il giocatore la riconosce
   *     e sa già cosa fare, che è il punto di un test finale.
   *  3. `core*` — il Custode: manipolazione, preavviso, finestra. Solo
   *     che qui mancarla non costa una pausa, costa tornare alla
   *     caccia. */
  private updateArbiter(): void {
    const boss = this.state.boss!;

    if (boss.stage === 1) {
      // I moduli sono turret vere: la fase finisce quando finiscono
      // loro, non a tempo.
      if (this.arbiterModulesAlive() > 0) return;
      boss.stage = 2;
      boss.stageDamage = 0;
      boss.phase = 'guard';
      boss.phaseTimer = BOSS_GUARD_MS;
      this.events.push({ type: 'bossStage', stage: 2 });
      return;
    }

    if (boss.stage === 2) {
      this.updateSentinella();
      return;
    }

    boss.phaseTimer -= TICK_MS;
    if (boss.phaseTimer > 0) return;

    switch (boss.phase) {
      case 'coreSealed':
        boss.phase = 'coreOpening';
        boss.phaseTimer = ARBITER_CORE_TELL_MS;
        break;
      case 'coreOpening':
        boss.phase = 'coreOpen';
        boss.phaseTimer = ARBITER_CORE_WINDOW_MS;
        this.events.push({ type: 'bossExposed' });
        break;
      default:
        // Finestra mancata: si richiude e riparte la caccia. Non è una
        // punizione arbitraria — è dover riguadagnare quello che si
        // era guadagnato, che è l'unica posta che abbia senso alzare
        // per un boss finale.
        boss.stage = 2;
        boss.stageDamage = 0;
        boss.phase = 'guard';
        boss.phaseTimer = BOSS_GUARD_MS;
        this.events.push({ type: 'bossCoreSealed' });
        break;
    }
  }

  /** Quanti moduli di ARBITER sono ancora in piedi. */
  private arbiterModulesAlive(): number {
    const ids = this.level.boss?.moduleTurretIds ?? [];
    return this.state.turrets.filter((t) => t.alive && ids.includes(t.id)).length;
  }

  /** Custode del Reattore. Non insegue e non si muove: spegne le luci,
   *  capovolge la stanza, e fra una manipolazione e l'altra resta
   *  scoperto.
   *
   *  Il ciclo è manipolazione → preavviso → finestra → manipolazione
   *  successiva, alternando buio e inversione. Il preavviso esiste
   *  perché la finestra sia un appuntamento e non una sorpresa: senza,
   *  colpirlo sarebbe questione di essere già girati dalla parte
   *  giusta per caso.
   *
   *  Da metà danni non accelera — allunga le manipolazioni e accorcia
   *  la finestra. La Sentinella alterata diventa più aggressiva; il
   *  Custode alterato diventa più *avaro*, che è la sua idea di
   *  minaccia. */
  private updateCustode(): void {
    const boss = this.state.boss!;
    boss.phaseTimer -= TICK_MS;
    if (boss.phaseTimer > 0) return;

    const manipulation = this.enraged
      ? CUSTODE_MANIPULATION_ENRAGED_MS
      : CUSTODE_MANIPULATION_MS;

    switch (boss.phase) {
      case 'blackout':
      case 'invert':
        boss.phase = 'tell';
        boss.phaseTimer = CUSTODE_TELL_MS;
        break;
      case 'tell':
        boss.phase = 'exposed';
        boss.phaseTimer = this.enraged ? CUSTODE_EXPOSED_ENRAGED_MS : CUSTODE_EXPOSED_MS;
        this.events.push({ type: 'bossExposed' });
        break;
      default:
        // Dopo la finestra riparte, alternando le due manipolazioni:
        // `chargesLeft` fa da contatore del ciclo, riusato invece di
        // aggiungere un campo che solo questo boss userebbe.
        boss.chargesLeft++;
        boss.phase = boss.chargesLeft % 2 === 1 ? 'invert' : 'blackout';
        boss.phaseTimer = manipulation;
        break;
    }
  }

  /** La macchina della Sentinella. Girata anche da ARBITER nella sua
   *  fase di caccia — la stessa, non una copia: se fossero due, la
   *  prima correzione al comportamento della carica ne aggiusterebbe
   *  una sola. */
  private updateSentinella(): void {
    const boss = this.state.boss!;
    const p = this.state.player;

    switch (boss.phase) {
      case 'guard': {
        this.turnBossToward(p.x, p.y);
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          boss.phase = 'telegraph';
          boss.phaseTimer = this.enraged ? BOSS_TELEGRAPH_ENRAGED_MS : BOSS_TELEGRAPH_MS;
          // La raffica si decide qui, una volta: se la Sentinella si
          // altera a metà raffica, la raffica in corso resta quella
          // che il giocatore ha visto iniziare.
          boss.chargesLeft = this.enraged ? BOSS_ENRAGED_CHARGES : 1;
        }
        break;
      }
      case 'telegraph': {
        this.turnBossToward(p.x, p.y);
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          const dx = p.x - boss.x;
          const dy = p.y - boss.y;
          const len = Math.hypot(dx, dy) || 1;
          boss.chargeDirX = dx / len;
          boss.chargeDirY = dy / len;
          boss.angle = Math.atan2(dy, dx);
          boss.phase = 'charge';
          boss.phaseTimer = BOSS_CHARGE_MS;
        }
        break;
      }
      case 'charge': {
        campMoveEntity(
          this.isSolid,
          boss,
          boss.chargeDirX * BOSS_CHARGE_SPEED,
          boss.chargeDirY * BOSS_CHARGE_SPEED,
          BOSS_RADIUS - 1,
        );
        // La guardia sta *fuori* dal ramo che fa break, non dentro
        // damagePlayer: se un giocatore intoccabile fermasse comunque
        // il tick della carica, il boss resterebbe addosso a lui a
        // tempo fermo invece di passargli attraverso.
        if (!this.invulnerable) {
          const dist = Math.hypot(p.x - boss.x, p.y - boss.y);
          if (dist <= BOSS_RADIUS + ENTITY_RADIUS) {
            this.damagePlayer('boss');
            break;
          }
        }
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          boss.chargesLeft = Math.max(0, boss.chargesLeft - 1);
          boss.phase = 'recover';
          // Dentro la raffica la pausa è breve — le due cariche
          // devono leggersi come una sola sequenza. Quella dopo
          // l'ultima è la più lunga dello scontro: è il premio.
          boss.phaseTimer =
            boss.chargesLeft > 0
              ? BOSS_VOLLEY_RECOVER_MS
              : this.enraged
                ? BOSS_RECOVER_ENRAGED_MS
                : BOSS_RECOVER_MS;
        }
        break;
      }
      case 'recover': {
        boss.phaseTimer -= TICK_MS;
        if (boss.phaseTimer <= 0) {
          if (boss.chargesLeft > 0) {
            // Riparte senza tornare in guardia: la seconda carica
            // ri-mira, ma concede molto meno tempo per leggerla.
            boss.phase = 'telegraph';
            boss.phaseTimer = BOSS_TELEGRAPH_ENRAGED_MS;
          } else {
            boss.phase = 'guard';
            boss.phaseTimer = this.enraged ? BOSS_GUARD_ENRAGED_MS : BOSS_GUARD_MS;
          }
        }
        break;
      }
    }
  }

  private turnBossToward(x: number, y: number): void {
    const boss = this.state.boss!;
    const target = Math.atan2(y - boss.y, x - boss.x);
    const diff = angleDelta(boss.angle, target);
    if (Math.abs(diff) <= BOSS_TURN_RATE) boss.angle = target;
    else boss.angle += Math.sign(diff) * BOSS_TURN_RATE;
  }

  /** L'uscita chiude un livello senza boss. Controllata in coda al
   *  tick, dopo il fuoco: un colpo sparato nell'istante in cui si
   *  entra nell'uscita deve comunque valere. */
  private updateExit(): void {
    if (this.state.outcome !== 'playing') return;
    const exit = this.level.exit;
    if (!exit) return;
    const p = this.state.player;
    const { x, y } = centreOf(exit.tx, exit.ty);
    if (Math.hypot(p.x - x, p.y - y) > exit.radius) return;
    this.completeLevel();
  }

  private completeLevel(): void {
    if (!this.state.completedLevels.includes(this.level.id)) {
      this.state.completedLevels.push(this.level.id);
    }
    this.state.outcome = this.level.next === null ? 'victory' : 'levelComplete';
    this.events.push({
      type: 'levelCompleted',
      levelId: this.level.id,
      next: this.level.next,
    });
  }

  private fireWeapon(input: CampaignInput): void {
    const p = this.state.player;
    if (p.weaponCooldown > 0) return;

    const stats = weaponStatsFor(this.state.unlockedNodes, this.state.purchases);
    p.weaponCooldown = stats.cooldownMs;

    const wall = campCastRay(
      this.getTile,
      p.x,
      p.y,
      input.aimAngle,
      Infinity,
      this.level.width,
      this.level.height,
    );

    // Which target the shot reaches is decided by distance and walls,
    // never by which room the shooter is standing in. Gating on the
    // room looked equivalent, but a player standing *on* a doorway
    // tile belongs to the room behind them, so shots taken while
    // peeking through a threshold silently did nothing.
    let best: { dist: number; turretId: string | null; enemyId: string | null } | null = null;

    for (const t of this.state.turrets) {
      if (!t.alive) continue;
      const def = this.turretDef(t.id);
      const { x, y } = centreOf(def.tx, def.ty);
      const d = distanceAlongRayToCircle(p.x, p.y, input.aimAngle, x, y, TURRET_RADIUS);
      if (d === null || d > wall.dist) continue;
      if (!best || d < best.dist) best = { dist: d, turretId: t.id, enemyId: null };
    }

    for (const e of this.state.enemies) {
      if (!e.alive) continue;
      const d = distanceAlongRayToCircle(
        p.x,
        p.y,
        input.aimAngle,
        e.x,
        e.y,
        archetypeOf(e.kind).radius,
      );
      if (d === null || d > wall.dist) continue;
      if (!best || d < best.dist) best = { dist: d, turretId: null, enemyId: e.id };
    }

    const boss = this.state.boss;
    if (boss && boss.phase !== 'defeated') {
      const d = distanceAlongRayToCircle(
        p.x,
        p.y,
        input.aimAngle,
        boss.x,
        boss.y,
        this.level.boss!.kind === 'custode'
          ? CUSTODE_RADIUS
          : this.level.boss!.kind === 'arbiter'
            ? ARBITER_RADIUS
            : BOSS_RADIUS,
      );
      // Bersaglio più vicino vince: non si spara attraverso una
      // turret per arrivare al boss.
      if (d !== null && d <= wall.dist && (!best || d < best.dist)) {
        best = { dist: d, turretId: null, enemyId: null };
      }
    }

    if (!best) return;

    if (best.turretId !== null) {
      const t = this.state.turrets.find((x) => x.id === best!.turretId)!;
      t.alive = false;
      this.events.push({ type: 'turretDown', id: t.id, kind: this.turretDef(t.id).kind });
      this.grantXp(XP_TURRET_DOWN);
      return;
    }

    if (best.enemyId !== null) {
      this.hitEnemy(best.enemyId, p.x, p.y, input.aimSlope, best.dist, input.ads);
      return;
    }

    this.hitBoss(p.x, p.y);
  }

  private hitBoss(shooterX: number, shooterY: number): void {
    const boss = this.state.boss!;
    // Due boss, due regole di vulnerabilità. La Sentinella si colpisce
    // dove *stai* (il cono posteriore, mentre carica); il Custode si
    // colpisce *quando* (la finestra, da qualsiasi angolo). Chiedere
    // al Custode un arco posteriore lo renderebbe una Sentinella che
    // non si muove, cioè più facile invece che diversa.
    const kind = this.level.boss!.kind;
    const rearHit = (): number =>
      resolveBossHit(
        boss.x,
        boss.y,
        boss.angle,
        boss.phase,
        shooterX,
        shooterY,
        hasGrazeDamage(this.state.unlockedNodes),
      );

    let dmg: number;
    if (kind === 'custode') {
      dmg = boss.phase === 'exposed' ? 1 : 0;
    } else if (kind === 'arbiter') {
      // Una regola per atto, e sono le due già conosciute: nella
      // caccia vale il cono posteriore della Sentinella, nel finale la
      // finestra del Custode. Nella prima fase il corpo è intoccabile
      // e basta — i moduli si colpiscono come turret, non come boss.
      if (boss.stage === 2) dmg = rearHit();
      else if (boss.stage === 3) dmg = boss.phase === 'coreOpen' ? 1 : 0;
      else dmg = 0;
    } else {
      dmg = rearHit();
    }
    if (dmg <= 0) return;

    const wasEnraged = this.enraged;
    boss.damageTaken += dmg;
    boss.stageDamage += dmg;
    this.events.push({ type: 'bossHit', damage: dmg, phase: boss.phase });
    if (!wasEnraged && this.enraged) this.events.push({ type: 'bossEnraged' });
    this.grantXp(dmg >= 1 ? XP_BOSS_HIT_SOLID : XP_BOSS_HIT_GRAZE);

    // ARBITER passa alla terza fase quando la caccia è finita, non
    // quando il totale arriva a una soglia: i due conteggi divergono
    // ogni volta che una finestra mancata lo riporta indietro.
    if (
      kind === 'arbiter' &&
      boss.stage === 2 &&
      boss.stageDamage >= ARBITER_HUNT_HITS &&
      boss.damageTaken < this.bossHitsToDefeat
    ) {
      boss.stage = 3;
      boss.stageDamage = 0;
      boss.phase = 'coreSealed';
      boss.phaseTimer = ARBITER_CORE_MANIPULATION_MS;
      this.events.push({ type: 'bossStage', stage: 3 });
      return;
    }

    if (kind === 'arbiter' && boss.stage === 3 && boss.stageDamage >= ARBITER_CORE_HITS) {
      boss.phase = 'defeated';
      this.events.push({ type: 'bossDefeated' });
      this.grantXp(XP_BOSS_DEFEAT);
      this.completeLevel();
      return;
    }

    if (kind !== 'arbiter' && boss.damageTaken >= this.bossHitsToDefeat) {
      boss.phase = 'defeated';
      this.events.push({ type: 'bossDefeated' });
      this.grantXp(XP_BOSS_DEFEAT);
      this.completeLevel();
    }
  }

  private killPlayer(cause: 'turret' | 'boss' | 'enemy'): void {
    // Un'esca rimasta per terra dopo un respawn sarebbe un fantasma: il
    // giocatore è altrove, ma il richiamo (e l'evento) resterebbero
    // agganciati a un punto che non racconta più niente. Le cariche
    // restano intatte — è il lancio che si paga, non il tentativo.
    if (this.state.beacon.active) {
      this.state.beacon = { active: false, x: 0, y: 0, ms: 0 };
      this.events.push({ type: 'beaconExpired' });
    }

    if (this.state.difficulty === 'roguelike') {
      // "Morire fa ripartire l'intero atto" (GDD.md sezione 9): questo
      // mondo simula un livello solo (vedi il commento in cima al
      // file), quindi non può essere lui a ricostruire i tre livelli
      // dell'atto da capo — può solo dirlo. Niente reset qui sotto:
      // questo stato sta per essere buttato via dal controller, che
      // ne costruirà uno nuovo dal primo livello con lo stesso
      // profilo (xp, nodi, core raccolti restano — vedi
      // CampaignProfile — perché altrimenti morire diventerebbe un
      // modo per rifarmare esperienza sugli stessi core).
      this.state.outcome = 'actRestart';
      this.events.push({ type: 'playerDied', cause });
      this.events.push({ type: 'actRestart' });
      return;
    }

    const p = this.state.player;

    // Medio: "il checkpoint torna alla stanza di spawn" (GDD.md
    // sezione 9). Farlo *prima* di leggere `cp` sotto significa che il
    // resto del metodo — scritto per "riporta al checkpoint" — riporta
    // già allo spawn senza bisogno di un secondo percorso di codice.
    if (this.state.difficulty === 'medio') {
      this.state.checkpoint = { ...this.spawnCheckpoint };
    }
    const cp = this.state.checkpoint;

    p.x = cp.x;
    p.y = cp.y;
    p.angle = cp.angle;
    p.weaponCooldown = 0;
    p.respawnInvulnerableMs = RESPAWN_GRACE_MS[this.state.difficulty];
    // Uno scatto sopravvissuto alla morte trascinerebbe il giocatore
    // fuori dal checkpoint appena ripristinato.
    p.dashTimer = 0;
    p.dashCooldown = 0;
    // Il respawn schiarisce le idee, ma va *annunciato*: azzerare
    // empMs in silenzio lascerebbe chi ascolta gli eventi convinto che
    // il giocatore sia ancora cieco, perché il gasCleared di
    // updateGas si accorge solo delle transizioni che vede lui.
    if (p.empMs > 0) {
      p.empMs = 0;
      this.events.push({ type: 'gasCleared' });
    }
    if (p.darkMs > 0) {
      p.darkMs = 0;
      this.events.push({ type: 'blackoutCleared' });
    }
    if (p.gravityFlipped) {
      p.gravityFlipped = false;
      this.events.push({ type: 'gravityFlipped', inverted: false });
    }
    for (const c of this.state.chasms) c.hoverMs = 0;

    // "Nemici della stanza resettati" (GDD.md sezione 9, modalità
    // Tutorial) contro "resetta tutti i trabocchetti e i nemici del
    // livello" (modalità Medio). Con i trabocchetti come dato, la
    // differenza fra le due si riduce a questo unico predicato: ogni
    // cosa dichiara già a che stanza appartiene, quindi "solo quella
    // stanza" o "tutto il livello" è la sola domanda che cambia.
    // Aggiungere un trabocchetto a un livello non richiede di toccare
    // questo metodo in nessuna delle due modalità — che è esattamente
    // il motivo per cui `room` esiste nelle definizioni.
    const inScope = (room: string): boolean =>
      this.state.difficulty === 'medio' || room === cp.room;

    for (const d of this.state.doors) {
      if (!inScope(this.level.doors.find((x) => x.id === d.id)!.room)) continue;
      d.armed = false;
      d.closed = false;
      d.closeTimer = 0;
    }
    for (const t of this.state.turrets) {
      const def = this.turretDef(t.id);
      if (!inScope(def.room)) continue;
      t.alive = true;
      t.reactionTimer = def.reactionMs;
      t.fireCooldown = def.phaseMs;
    }
    this.resetEnemiesIn(inScope);
    for (const f of this.state.collapsingFloors) {
      if (!inScope(this.level.collapsingFloors.find((x) => x.id === f.id)!.room)) continue;
      f.collapsed = false;
      f.standingMs = 0;
      f.resetTimer = 0;
    }
    if (this.state.boss && inScope(this.level.boss!.room)) {
      const boss = this.state.boss;
      const home = centreOf(this.level.boss!.tx, this.level.boss!.ty);
      const kind = this.level.boss!.kind;
      boss.phase = initialBossPhase(kind);
      boss.phaseTimer = kind === 'custode' ? CUSTODE_MANIPULATION_MS : BOSS_GUARD_MS;
      boss.damageTaken = 0;
      boss.chargesLeft = 0;
      boss.stage = 1;
      boss.stageDamage = 0;
      boss.x = home.x;
      boss.y = home.y;
      boss.angle = Math.PI;
    }
    // Lo scudo torna raccoglibile ovunque stia, non solo nella stanza
    // del checkpoint: sta quasi sempre *prima* della minaccia che lo
    // rende utile, e un tentativo al boss è esattamente quando vale
    // la pena tornare a prenderlo.
    for (const s of this.state.shields) s.collected = false;

    this.events.push({ type: 'playerDied', cause });
  }
}
