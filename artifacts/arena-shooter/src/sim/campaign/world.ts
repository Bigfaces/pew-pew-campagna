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
  RESPAWN_INVULN_MS,
  SHIELD_PICKUP_RADIUS,
  TURRET_RADIUS,
  XP_BOSS_DEFEAT,
  XP_BOSS_HIT_GRAZE,
  XP_BOSS_HIT_SOLID,
  XP_CORE,
  XP_ROOM_ENTER,
  XP_TURRET_DOWN,
  levelForXp,
} from './constants';
import {
  roomAt,
  roomOrder,
  tileAt,
  type BossKind,
  type LevelDef,
  type TurretDef,
} from './levelTypes';
import { campMoveEntity, distanceAlongRayToCircle, type IsSolidFn } from './physics';
import { campCastRay, campHasLOS } from './raycast';
import {
  hasGrazeDamage,
  isValidNode,
  movementStatsFor,
  resistsGravityFlip,
  nodeCost,
  pointsSpent,
  prereqMet,
  refillsShieldOnRoomEnter,
  shieldCapacity,
  weaponStatsFor,
} from './skills';
import {
  CAMPAIGN_PROFILE_VERSION,
  emptyCampaignInput,
  type BossPhase,
  type CampaignEvent,
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

  /** `profile` seeds a returning player: the character they built,
   *  never where they were standing (see CampaignProfile). Absent —
   *  or discarded as an unknown version — means a fresh start. */
  constructor(level: LevelDef, profile?: CampaignProfile) {
    this.level = level;
    const xp = profile?.xp ?? 0;
    const playerLevel = levelForXp(xp);
    const collected = new Set(profile?.collectedCoreIds ?? []);
    const spawn = centreOf(level.spawn.tx, level.spawn.ty);

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
        respawnInvulnerableMs: 0,
        shieldCharges: 0,
        dashTimer: 0,
        dashCooldown: 0,
        dashDirX: 0,
        dashDirY: 0,
        dashSpeed: DASH_SPEED,
        empMs: 0,
        darkMs: 0,
        gravityFlipped: false,
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
      coresCollected: collected.size,
      roomsAwarded: [...(profile?.roomsAwarded ?? [])],
      completedLevels: [...(profile?.completedLevels ?? [])],
      xp,
      level: playerLevel,
      // One point per level gained, so this follows from the level the
      // XP buys — never stored, never able to drift from it.
      skillPoints: playerLevel - 1,
      unlockedNodes: [...(profile?.unlockedNodes ?? [])],
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
    };
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
    return p.dashTimer > 0 && movementStatsFor(this.state.unlockedNodes).dashInvulnerable;
  }

  /** Skill points earned by leveling up but not yet spent on a node. */
  get availableSkillPoints(): number {
    return this.state.skillPoints - pointsSpent(this.state.unlockedNodes);
  }

  /** The part of this run worth carrying to the next one. */
  toProfile(): CampaignProfile {
    return {
      version: CAMPAIGN_PROFILE_VERSION,
      xp: this.state.xp,
      unlockedNodes: [...this.state.unlockedNodes],
      levelId: this.state.levelId,
      completedLevels: [...this.state.completedLevels],
      collectedCoreIds: this.state.cores.filter((c) => c.collected).map((c) => c.id),
      roomsAwarded: [...this.state.roomsAwarded],
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
    this.updateTurrets();
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

    const move = movementStatsFor(this.state.unlockedNodes);
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
    if (p.dashTimer > 0) {
      p.dashTimer = Math.max(0, p.dashTimer - TICK_MS);
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

    const stats = weaponStatsFor(this.state.unlockedNodes);
    const move = movementStatsFor(this.state.unlockedNodes);
    const speed = PLAYER_SPEED * move.speedMult * (input.ads ? stats.adsMoveMult : 1);
    campMoveEntity(this.isSolid, p, vx * speed, vy * speed);
  }

  /** Checkpoints only ever advance: stepping back into an earlier
   *  room (e.g. retreating from the boss) must not lose progress. */
  private updateCheckpoint(): void {
    const p = this.state.player;
    const room = roomAt(this.level, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
    if (roomOrder(this.level, room) > roomOrder(this.level, this.state.checkpoint.room)) {
      this.state.checkpoint = { room, x: p.x, y: p.y, angle: p.angle };
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
    const capacity = shieldCapacity(this.state.unlockedNodes);
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
        p.shieldCharges = shieldCapacity(this.state.unlockedNodes);
        this.events.push({ type: 'shieldPickup', charges: p.shieldCharges });
      }
    }
  }

  /** A hit that would otherwise kill the player — spends one shield
   *  charge instead, if any are left. Tactical and disposable, unlike
   *  the skill tree: see GDD.md, "Potenziamenti vs progressione
   *  permanente". */
  private damagePlayer(cause: 'turret' | 'boss'): void {
    const p = this.state.player;
    if (p.shieldCharges > 0) {
      p.shieldCharges--;
      this.events.push({ type: 'shieldBreak', chargesLeft: p.shieldCharges });
      return;
    }
    this.killPlayer(cause);
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
    if (this.state.checkpoint.room !== def.room) return;

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

    const stats = weaponStatsFor(this.state.unlockedNodes);
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
    let best: { dist: number; turretId: string | null } | null = null;

    for (const t of this.state.turrets) {
      if (!t.alive) continue;
      const def = this.turretDef(t.id);
      const { x, y } = centreOf(def.tx, def.ty);
      const d = distanceAlongRayToCircle(p.x, p.y, input.aimAngle, x, y, TURRET_RADIUS);
      if (d === null || d > wall.dist) continue;
      if (!best || d < best.dist) best = { dist: d, turretId: t.id };
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
        best = { dist: d, turretId: null };
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

  private killPlayer(cause: 'turret' | 'boss'): void {
    const p = this.state.player;
    const cp = this.state.checkpoint;

    p.x = cp.x;
    p.y = cp.y;
    p.angle = cp.angle;
    p.weaponCooldown = 0;
    p.respawnInvulnerableMs = RESPAWN_INVULN_MS;
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
    // Tutorial). Con i trabocchetti come dato, la regola si applica
    // sola: ogni cosa dichiara a che stanza appartiene, e si resetta
    // solo ciò che sta nella stanza del checkpoint. Aggiungere un
    // trabocchetto a un livello non richiede di toccare questo
    // metodo — che è esattamente il motivo per cui `room` esiste
    // nelle definizioni.
    for (const d of this.state.doors) {
      if (this.level.doors.find((x) => x.id === d.id)!.room !== cp.room) continue;
      d.armed = false;
      d.closed = false;
      d.closeTimer = 0;
    }
    for (const t of this.state.turrets) {
      const def = this.turretDef(t.id);
      if (def.room !== cp.room) continue;
      t.alive = true;
      t.reactionTimer = def.reactionMs;
      t.fireCooldown = def.phaseMs;
    }
    for (const f of this.state.collapsingFloors) {
      if (this.level.collapsingFloors.find((x) => x.id === f.id)!.room !== cp.room) continue;
      f.collapsed = false;
      f.standingMs = 0;
      f.resetTimer = 0;
    }
    if (this.state.boss && this.level.boss!.room === cp.room) {
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
