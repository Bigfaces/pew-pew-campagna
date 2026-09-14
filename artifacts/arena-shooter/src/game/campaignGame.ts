// ================================================================
// CAMPAIGN GAME CONTROLLER — Sprint 1 vertical slice
// ================================================================
// Same fixed-timestep accumulator loop as the Arena's Game (game.ts),
// pared down to what a single-player level needs: one camera, no
// net, no roster. See CampaignWorld (sim/campaign/world.ts) for the
// rules this drives.
// ================================================================

import { AudioEngine } from '../audio/engine';
import {
  campMinimapBox,
  renderCampaignMinimap,
  renderCampaignScenery,
  renderCampaignWalls,
  renderDarkness,
  renderGasVeil,
} from '../render/campaignScene';
import { CameraFx, computeViewport, type Viewport } from '../render/camera';
import {
  renderBanner,
  renderDamageOverlay,
  renderScope,
  type Banner,
} from '../render/overlay';
import { renderBackdrop } from '../render/scene';
import { buildBackdrops, getTextures } from '../render/textures';
import {
  ADS_SENS_MULT,
  ADS_ZOOM,
  MAX_PITCH,
  MAX_TICKS_PER_FRAME,
  MOUSE_SENSITIVITY,
  TICK_MS,
  TILE,
  TURN_SPEED,
  clampSensitivity,
} from '../sim/constants';
import {
  BOSS_HITS_TO_DEFEAT,
  DASH_COOLDOWN_MS,
  GAS_LINGER_MS,
  xpForNextLevel,
} from '../sim/campaign/constants';
import { ALL_LEVELS, FIRST_LEVEL_ID, levelById } from '../sim/campaign/levels';
import { roomName } from '../sim/campaign/levelTypes';
import {
  hasContacts,
  hasGrazeDamage,
  hasMinimap,
  movementStatsFor,
  scannerResistsGas,
  scopeResistsInterference,
  weaponStatsFor,
} from '../sim/campaign/skills';
import type { CampaignEvent, CampaignInput, RoomId } from '../sim/campaign/types';
import { CampaignWorld } from '../sim/campaign/world';
import { ArbiterVoice, ARBITER_LINE_MS, type ArbiterLine } from '../ui/arbiter';
import {
  clearCampaignProfile,
  loadCampaignProfile,
  saveCampaignProfile,
} from '../stats/campaignProfile';

export type CampaignPhase = 'playing' | 'paused' | 'over';

export interface CampaignHudSnapshot {
  phase: CampaignPhase;
  pointerLocked: boolean;
  muted: boolean;
  /** Nome della stanza, già pronto da mostrare: le stanze sono dato
   *  del livello, quindi la HUD non può più avere una tabella di
   *  etichette scritta a mano. */
  room: string;
  levelName: string;
  levelAct: number;
  levelOrdinal: number;
  /** Quanti livelli ha *questo* atto, non l'intera campagna: il
   *  giocatore conta i passi dentro l'atto in cui si trova. */
  levelCount: number;
  /** Il gas ha spento i sensori; il buio ha spento la vista. Sono due
   *  cose diverse e la HUD le mostra separate, perché al buio lo
   *  scanner è proprio ciò che ti salva. */
  dark: boolean;
  gravityInverted: boolean;
  /** Il gas ha spento minimappa e ottica. */
  blinded: boolean;
  coresCollected: number;
  xp: number;
  level: number;
  /** null once past the top of LEVEL_XP_THRESHOLDS — there is no next
   *  bar to fill, not a bug. */
  xpForNextLevel: number | null;
  availableSkillPoints: number;
  /** Cariche di scudo rimaste — 0 significa nessuno scudo. */
  shieldCharges: number;
  adsActive: boolean;
  /** Presente solo col nodo Scatto: 0..1, 1 = pronto. La HUD non deve
   *  mostrare un indicatore per una meccanica che il giocatore non ha
   *  ancora sbloccato. */
  dashReady: number | null;
  /** Px CSS che la colonna della HUD deve lasciare libera a destra
   *  perché la minimappa non le finisca sopra; 0 quando non c'è
   *  minimappa. Calcolato dalla stessa funzione che la disegna. */
  minimapReserve: number;
  /** La battuta di ARBITER da mostrare adesso, se ce n'è una viva. */
  arbiter: string | null;
  bossEnraged: boolean;
  unlockedNodes: string[];
  door: { armed: boolean; closeTimerMs: number };
  bossActive: boolean;
  /** Come si chiama il boss di questo livello: la HUD non può più
   *  scrivere "SENTINELLA" in duro, ce n'è più d'uno. */
  bossName: string;
  bossPhase: string;
  bossDamageTaken: number;
  bossHitsToDefeat: number;
  victory: boolean;
}

export interface CampaignGameOptions {
  onHud: (snap: CampaignHudSnapshot) => void;
  sensitivity?: number;
}

const HUD_INTERVAL = 120;

export class CampaignGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: CampaignGameOptions;

  /** Il mondo simula un livello per volta. Il profilo dice a quale
   *  dell'atto si era arrivati; dentro il livello si riparte
   *  dall'inizio, per la stessa ragione per cui non si salva la
   *  posizione (vedi CampaignProfile). */
  private world = CampaignGame.buildWorld(loadCampaignProfile());
  private fx = new CameraFx();
  audio = new AudioEngine();

  private vp: Viewport;
  private depth: Float32Array;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;

  private phase: CampaignPhase = 'playing';
  private yaw = 0;
  private keys = new Set<string>();
  private fireQueued = false;
  /** Edge-triggered come fireQueued: il tasto dello scatto va letto
   *  come una pressione, non come uno stato tenuto, altrimenti
   *  tenerlo giù farebbe ripartire lo scatto a ogni fine cooldown. */
  private dashQueued = false;

  private pointerLocked = false;
  private mouseDX = 0;
  private mouseDY = 0;
  private sensMult = 1;

  /** -1..1 each axis, driven by the on-screen joystick — added to
   *  keyboard input rather than replacing it, so a touch device with
   *  a keyboard attached still works either way. */
  private touchMoveX = 0;
  private touchMoveY = 0;

  /** Scope: held on the right mouse button, toggled by the on-screen
   *  button. `adsT` is the eased 0..1 the renderer uses, so the zoom
   *  travels instead of snapping between two fields of view. How fast
   *  it travels is itself a Precisione node (Aggancio Ottico). */
  private adsHeld = false;
  private adsT = 0;

  private accumulator = 0;
  private lastFrame = 0;
  private rafId = 0;
  private running = false;

  private prevX = 0;
  private prevY = 0;
  private lastHudPush = 0;
  private mutedFlag = false;
  private banner: Banner | null = null;
  private arbiterVoice = new ArbiterVoice();
  private arbiterLine: ArbiterLine | null = null;
  private wasReady = true;

  private ro: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement, opts: CampaignGameOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.sensMult = clampSensitivity(opts.sensitivity ?? 1);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.yaw = this.world.state.player.angle;
    this.prevX = this.world.state.player.x;
    this.prevY = this.world.state.player.y;

    getTextures();
    this.vp = computeViewport(1, 1, 1);
    this.depth = new Float32Array(1);
    this.resize();
    this.bindEvents();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.audio.init();
    this.requestPointerLock();
    this.rafId = requestAnimationFrame(this.loop);
    this.pushHud(true);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.unbindEvents();
    this.ro?.disconnect();
    this.audio.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    // A held mouse button is not reported while the pointer is
    // released, so the scope has to be dropped explicitly or it would
    // still be up on resume.
    this.adsHeld = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.pushHud(true);
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.requestPointerLock();
    this.pushHud(true);
  }

  toggleMute(): void {
    this.audio.setMuted(!this.mutedFlag);
    this.mutedFlag = !this.mutedFlag;
    this.pushHud(true);
  }

  setSensitivity(mult: number): void {
    this.sensMult = clampSensitivity(mult);
  }

  /** On-screen joystick, driven by a DOM overlay (ui/TouchControls.tsx)
   *  rather than raw touch listeners on the canvas — the drag itself
   *  is easier to get right with pointer-capture on a dedicated
   *  element than by hand-picking which touch belongs to which half
   *  of the canvas. `x`/`y` are -1..1, y positive = forward. */
  setTouchMove(x: number, y: number): void {
    this.touchMoveX = Math.max(-1, Math.min(1, x));
    this.touchMoveY = Math.max(-1, Math.min(1, y));
  }

  /** On-screen look drag. Feeds the same accumulator the mouse does,
   *  so sensitivity and the scope math never need to know which
   *  device produced the delta. */
  addTouchLook(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** The on-screen fire button. Unlike the mouse path this never waits
   *  on pointer lock — a touch device never acquires it. */
  queueFire(): void {
    if (this.phase === 'playing') this.fireQueued = true;
  }

  /** Richiede uno scatto: tastiera (MAIUSC) e pulsante a schermo
   *  finiscono qui. Se il nodo non è sbloccato o il cooldown non è
   *  finito, la simulazione ignora la richiesta — il controller non
   *  duplica quella regola. */
  queueDash(): void {
    if (this.phase === 'playing') this.dashQueued = true;
  }

  /** Raise or lower the scope. The mouse holds it; the on-screen
   *  button toggles it, because holding a finger on a button while
   *  aiming with the other is not a thing a phone can do. */
  setAds(on: boolean): void {
    if (this.adsHeld === on) return;
    this.adsHeld = on;
    this.audio.scope(on);
    this.pushHud(true);
  }

  toggleAds(): void {
    this.setAds(!this.adsHeld);
  }

  /** Spend an available skill point on a Precisione node — called
   *  from the HUD, not the fixed-tick loop, since it is a menu action
   *  rather than something that needs to be simulated. */
  tryUnlockNode(id: string): boolean {
    const ok = this.world.tryUnlockNode(id);
    if (ok) {
      saveCampaignProfile(this.world.toProfile());
      this.pushHud(true);
    }
    return ok;
  }

  /** Il mondo per un profilo: il livello a cui era arrivato, o il
   *  primo dell'atto se non c'è profilo. Statico perché serve anche
   *  all'inizializzatore di campo, prima che `this` esista. */
  private static buildWorld(profile: ReturnType<typeof loadCampaignProfile>): CampaignWorld {
    return new CampaignWorld(
      levelById(profile?.levelId ?? FIRST_LEVEL_ID),
      profile ?? undefined,
    );
  }

  /** Fine di un livello. Con un livello dopo si costruisce quello e si
   *  continua; senza, l'atto è finito.
   *
   *  Si costruisce un mondo nuovo invece di riusare questo: timer,
   *  danni al boss, porte e pavimenti del livello appena chiuso non
   *  hanno senso nel successivo, e azzerarli uno per uno sarebbe una
   *  lista da ricordare di aggiornare a ogni trabocchetto aggiunto.
   *  Il profilo è il solo ponte fra i due — cioè esattamente ciò che
   *  deve sopravvivere. */
  private finishLevel(next: string | null): void {
    const profile = this.world.toProfile();

    if (next === null) {
      saveCampaignProfile(profile);
      this.phase = 'over';
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      return;
    }

    const carried: typeof profile = { ...profile, levelId: next };
    saveCampaignProfile(carried);
    this.world = new CampaignWorld(levelById(next), carried);
    this.syncToWorld();
    this.raise(
      `LIVELLO ${this.world.level.ordinal} — ${this.world.level.name}`,
      'settore successivo',
      '#7dfc9a',
    );
    this.arbiterLine = {
      text: this.world.level.intro,
      at: performance.now(),
    };
    this.pushHud(true);
  }

  /** Riallinea il controller a un mondo appena costruito. La camera ha
   *  un suo yaw guidato dal mouse e una posizione interpolata dal tick
   *  precedente: senza questo, il primo frame del livello nuovo
   *  verrebbe disegnato guardando dove si era nel vecchio. */
  private syncToWorld(): void {
    this.yaw = this.world.state.player.angle;
    this.prevX = this.world.state.player.x;
    this.prevY = this.world.state.player.y;
    this.adsHeld = false;
    this.adsT = 0;
    this.vp = computeViewport(this.cssW, this.cssH, this.dpr, this.zoom());
  }

  /** Throw away the saved character and restart from nothing. Offered
   *  because a profile that has already bought every node makes the
   *  act unreplayable the way it was meant to be played. */
  resetProfile(): void {
    clearCampaignProfile();
    this.world = CampaignGame.buildWorld(null);
    this.yaw = this.world.state.player.angle;
    this.prevX = this.world.state.player.x;
    this.prevY = this.world.state.player.y;
    this.adsHeld = false;
    this.adsT = 0;
    this.banner = null;
    this.arbiterVoice = new ArbiterVoice();
    this.arbiterLine = null;
    this.fx.reset();
    this.phase = 'playing';
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.pushHud(true);
  }

  requestPointerLock(): void {
    try {
      const p = this.canvas.requestPointerLock() as unknown as
        | Promise<void>
        | undefined;
      void p?.catch?.(() => {
        // Blocked (sandboxed iframe); Q/E keyboard turning still works.
      });
    } catch {
      /* same fallback */
    }
  }

  // ---- sizing ----------------------------------------------------

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.floor(rect.width || window.innerWidth));
    const cssH = Math.max(240, Math.floor(rect.height || window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.vp = computeViewport(cssW, cssH, dpr, this.zoom());
    this.depth = new Float32Array(this.vp.numRays);
    buildBackdrops(getTextures(), cssW, cssH);

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Current magnification, eased so the zoom travels rather than
   *  snapping between two fields of view. */
  private zoom(): number {
    return 1 + (ADS_ZOOM - 1) * this.adsT;
  }

  // ---- input -------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.preventDefault();
    }
    if (k === 'escape') {
      if (this.phase === 'playing') this.pause();
      else if (this.phase === 'paused') this.resume();
    }
    if (k === 'm') this.toggleMute();
    // repeat: il browser ripete keydown mentre il tasto resta giù, e
    // senza questo filtro tenere premuto MAIUSC accoderebbe uno
    // scatto per ogni ripetizione.
    if (k === 'shift' && !e.repeat) this.queueDash();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.phase !== 'playing') return;
    if (e.button === 2) {
      e.preventDefault();
      this.setAds(true);
      return;
    }
    if (e.button !== 0) return;
    if (!this.pointerLocked) {
      this.requestPointerLock();
      return;
    }
    this.fireQueued = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.setAds(false);
  };

  private onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    this.pointerLocked = locked;
    if (!locked && this.phase === 'playing') this.pause();
    this.pushHud(true);
  };

  private onContextMenu = (e: Event): void => e.preventDefault();

  private onVisibility = (): void => {
    if (document.hidden && this.phase === 'playing') this.pause();
  };

  private onResize = (): void => this.resize();

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    // On the window, not the canvas: releasing the button after the
    // cursor has left the element must still lower the scope.
    window.addEventListener('mouseup', this.onMouseUp);

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.canvas);
    }
  }

  private unbindEvents(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('mouseup', this.onMouseUp);
  }

  private applyLook(frameDt: number): void {
    const k = this.keys;
    // Magnifying the view magnifies hand tremor with it, so the scope
    // has to slow the look down or aiming gets harder, not easier.
    const damp = 1 - this.adsT * (1 - ADS_SENS_MULT);
    const sens = MOUSE_SENSITIVITY * this.sensMult * damp;
    this.yaw += this.mouseDX * sens;
    this.fx.addPitch((-this.mouseDY * sens) / MAX_PITCH / 2);
    this.mouseDX = 0;
    this.mouseDY = 0;

    const turn = (TURN_SPEED * frameDt * damp) / 1000;
    if (k.has('q') || k.has('arrowleft')) this.yaw -= turn;
    if (k.has('e') || k.has('arrowright')) this.yaw += turn;
  }

  private buildInput(frameDt: number): CampaignInput {
    const k = this.keys;
    this.applyLook(frameDt);

    let forward = this.touchMoveY;
    let strafe = this.touchMoveX;
    if (k.has('w') || k.has('arrowup')) forward += 1;
    if (k.has('s') || k.has('arrowdown')) forward -= 1;
    if (k.has('d')) strafe += 1;
    if (k.has('a')) strafe -= 1;
    forward = Math.max(-1, Math.min(1, forward));
    strafe = Math.max(-1, Math.min(1, strafe));

    const input: CampaignInput = {
      forward,
      strafe,
      aimAngle: this.yaw,
      fire: this.fireQueued,
      dash: this.dashQueued,
      // The simulation applies the movement penalty itself from this
      // flag (see applyMovement), so the controller must not also
      // scale the input — that would charge the cost twice.
      ads: this.adsHeld,
    };
    this.fireQueued = false;
    this.dashQueued = false;
    return input;
  }

  // ---- events --------------------------------------------------------

  private handleEvents(events: readonly CampaignEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'roomEntered':
          this.raise(ev.room.toUpperCase(), '', '#9adfff');
          break;
        case 'coreCollected':
        case 'nodeUnlocked':
          this.audio.pickup(this.world.state.player.x, this.world.state.player.y);
          break;
        case 'xpGained':
          break;
        case 'levelUp':
          this.raise(`LIVELLO ${ev.level}`, 'nuovo punto abilità disponibile', '#7dfc9a');
          this.audio.callout(1);
          break;
        case 'doorSealed':
          this.audio.impact(this.world.state.player.x, this.world.state.player.y);
          break;
        case 'shieldPickup':
        case 'shieldRefilled':
          this.audio.pickup(this.world.state.player.x, this.world.state.player.y);
          break;
        case 'dashStarted':
          // Riusa il suono del respawn: è lo scatto d'aria più corto
          // del set sintetizzato, e la campagna non ha ancora una voce
          // propria per questo gesto.
          this.audio.respawn();
          break;
        case 'shieldBreak':
          this.audio.shieldBreak(this.world.state.player.x, this.world.state.player.y);
          break;
        case 'turretDown': {
          const def = this.world.level.turrets.find((t) => t.id === ev.id);
          if (def) this.audio.kill((def.tx + 0.5) * TILE, (def.ty + 0.5) * TILE);
          break;
        }
        case 'floorCollapsed':
          this.audio.impact(this.world.state.player.x, this.world.state.player.y);
          this.fx.shake(18);
          this.raise('IL PAVIMENTO CEDE', '', '#ff9a3c');
          // Il crollo teletrasporta: la camera va risincronizzata come
          // dopo una morte, o resta puntata dove si stava andando.
          this.prevX = this.world.state.player.x;
          this.prevY = this.world.state.player.y;
          break;
        case 'gasEntered':
          this.raise('CONTAMINANTE', 'niente scanner, niente ottica', '#9bff8c');
          break;
        case 'fellIntoChasm':
          this.audio.death();
          this.fx.shake(22);
          this.raise('SEI CADUTO', '', '#8899bb');
          // Il vuoto teletrasporta: la camera va risincronizzata come
          // dopo una morte, o resta puntata dove si stava andando.
          this.prevX = this.world.state.player.x;
          this.prevY = this.world.state.player.y;
          break;
        case 'blackoutEntered':
          this.raise('BLACKOUT DI SETTORE', 'lo scanner regge', '#7788aa');
          break;
        case 'gravityFlipped':
          if (ev.inverted) {
            this.audio.callout(1);
            this.raise('GRAVITÀ INVERTITA', '', '#b07adf');
          }
          break;
        case 'bossExposed':
          this.audio.callout(1);
          break;
        case 'levelCompleted':
          this.finishLevel(ev.next);
          break;
        case 'bossHit':
          this.audio.hitMarker();
          this.fx.shake(10);
          break;
        case 'bossDefeated':
          this.audio.matchEnd(true);
          this.raise('SENTINELLA ABBATTUTA', '', '#7dfc9a');
          break;
        case 'playerDied':
          this.audio.death();
          this.fx.flashDamage();
          this.fx.shake(20);
          // The world already snapped the player back to the checkpoint
          // (position and facing) by the time this event arrives; the
          // camera's own yaw is driven independently by the mouse, so
          // it must be re-synced or the view keeps facing whatever
          // direction killed the player, ignoring the teleport.
          this.yaw = this.world.state.player.angle;
          break;
      }
    }
  }

  private raise(text: string, sub: string, color: string): void {
    this.banner = { text, sub, at: performance.now(), color };
  }

  // ---- loop ------------------------------------------------------------

  private loop = (ts: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    const frameDt = Math.min(ts - this.lastFrame, 250);
    this.lastFrame = ts;

    if (this.phase === 'playing') {
      this.accumulator += frameDt;
      let ticks = 0;
      while (
        this.accumulator >= TICK_MS &&
        ticks < MAX_TICKS_PER_FRAME &&
        this.phase === 'playing'
      ) {
        this.tick();
        this.accumulator -= TICK_MS;
        ticks++;
      }
      if (ticks >= MAX_TICKS_PER_FRAME) this.accumulator = 0;
    }

    this.updateFeel(frameDt);
    this.render(this.accumulator / TICK_MS);
    this.pushHud(false);
  };

  private tick(): void {
    this.prevX = this.world.state.player.x;
    this.prevY = this.world.state.player.y;

    const input = this.buildInput(TICK_MS);
    const events = this.world.step(input);
    this.handleEvents(events);

    const line = this.arbiterVoice.lineFor(events, performance.now());
    if (line) this.arbiterLine = line;

    // Every form of progression goes through grantXp, so one event
    // type covers the lot: cores, rooms, kills, the boss bonus.
    if (events.some((e) => e.type === 'xpGained')) {
      saveCampaignProfile(this.world.toProfile());
    }
  }

  private updateFeel(frameDt: number): void {
    // Ease the scope toward wherever the button is. Aggancio Ottico
    // is exactly this number, so an unlocked node is felt as a faster
    // sight picture rather than read off a menu.
    const stats = weaponStatsFor(this.world.state.unlockedNodes);
    // Il gas spegne l'ottica ("disattiva minimappa o HUD ottico", GDD
    // sezione 4), e a testa in giù non si tiene la mira. Si abbassa da
    // sé invece di ignorare il tasto, così il giocatore vede *perché*
    // non sta più mirando. Mira Stabile toglie entrambe le cose.
    const interference =
      (this.world.blinded || this.world.gravityInverted) &&
      !scopeResistsInterference(this.world.state.unlockedNodes);
    const wantAds = this.adsHeld && this.phase === 'playing' && !interference;
    const prevAds = this.adsT;
    const rate = frameDt / stats.adsTransitionMs;
    this.adsT = wantAds ? Math.min(1, this.adsT + rate) : Math.max(0, this.adsT - rate);

    // Rebuild the projection only on frames where the zoom moved,
    // including the one it settles on — stopping a frame early would
    // leave the view fractionally short of full magnification.
    // The ray count is independent of zoom, so the depth buffer is
    // left alone — reallocating it here would be a fresh array every
    // frame of every transition, for a length that never changes.
    if (this.adsT !== prevAds) {
      this.vp = computeViewport(this.cssW, this.cssH, this.dpr, this.zoom());
    }

    const moving =
      this.phase === 'playing' &&
      (this.keys.has('w') ||
        this.keys.has('a') ||
        this.keys.has('s') ||
        this.keys.has('d') ||
        this.keys.has('arrowup') ||
        this.keys.has('arrowdown'));
    this.fx.update(frameDt, moving, 0.72);

    const ready = this.world.state.player.weaponCooldown <= 0;
    if (ready && !this.wasReady) this.audio.boltCycle();
    this.wasReady = ready;
  }

  private render(alpha: number): void {
    const { ctx, vp, fx, world } = this;
    const p = world.state.player;

    const x = this.prevX + (p.x - this.prevX) * alpha;
    const y = this.prevY + (p.y - this.prevY) * alpha;
    const cam = { x, y, angle: this.yaw };

    this.audio.updateListener(cam.x, cam.y, cam.angle);

    const now = performance.now();

    // Gravità invertita: si ribalta il *mondo*, non l'interfaccia. Un
    // solo flip verticale attorno a tutto il disegno della scena —
    // muri, billboard, decalcomanie — mentre HUD e mirino restano
    // dritti, perché sono attaccati al casco e non alla stanza.
    const flipped = world.gravityInverted;
    ctx.save();
    if (flipped) {
      ctx.translate(0, vp.height);
      ctx.scale(1, -1);
    }

    renderBackdrop(ctx, vp, fx);
    renderCampaignWalls(
      ctx,
      vp,
      fx,
      cam,
      this.depth,
      world.getTile,
      world.level.width,
      world.level.height,
    );
    renderCampaignScenery(
      ctx,
      vp,
      fx,
      cam,
      this.depth,
      world.level,
      world.state,
      hasGrazeDamage(world.state.unlockedNodes),
      world.enraged,
      now,
    );

    // I veli vanno sopra il mondo e sotto l'interfaccia: accecano
    // quello che si guarda, non quello che si legge. Ancora dentro il
    // flip, così al buio l'alone resta centrato sulla scena.
    renderGasVeil(ctx, vp, world.state.player.empMs / GAS_LINGER_MS, now);
    renderDarkness(ctx, vp, world.darkness);

    ctx.restore();

    renderScope(
      ctx,
      vp,
      fx,
      {
        cooldownMs: p.weaponCooldown,
        maxCooldownMs: weaponStatsFor(world.state.unlockedNodes).cooldownMs,
      },
      this.adsT,
    );
    // Dopo la scena e prima del mirino: la minimappa è un pannello
    // dell'interfaccia, non un oggetto del mondo, e il mirino resta
    // l'ultima cosa disegnata perché è quella che non deve mai finire
    // sotto a nient'altro.
    // Il gas spegne lo scanner: è il punto del trabocchetto. Il
    // controllo sta qui e non dentro il renderer perché "avere il
    // nodo" e "poterlo usare adesso" sono due domande diverse, e la
    // seconda è una regola di gioco.
    // Il gas spegne lo scanner, il buio no: è la differenza fra le due
    // trappole, ed è anche il momento in cui Percezione si ripaga. Il
    // nodo Sensori Inerziali toglie pure il primo dei due.
    const scannerUp =
      hasMinimap(world.state.unlockedNodes) &&
      (!world.blinded || scannerResistsGas(world.state.unlockedNodes));
    if (scannerUp) {
      renderCampaignMinimap(
        ctx,
        vp,
        world.level,
        world.state,
        world.getTile,
        hasContacts(world.state.unlockedNodes),
      );
    }

    this.renderCrosshair();
    renderDamageOverlay(ctx, vp, fx);
    if (this.banner) renderBanner(ctx, vp, this.banner, now);

    if (this.phase === 'paused') {
      ctx.fillStyle = 'rgba(6,7,12,0.72)';
      ctx.fillRect(0, 0, vp.width, vp.height);
    }
  }

  private renderCrosshair(): void {
    const { ctx, vp } = this;
    const ready = this.world.state.player.weaponCooldown <= 0;
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    const size = ready ? 7 : 4;

    ctx.save();
    ctx.strokeStyle = ready ? '#e8f4ff' : 'rgba(232,244,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - size, cy);
    ctx.lineTo(cx - 2, cy);
    ctx.moveTo(cx + 2, cy);
    ctx.lineTo(cx + size, cy);
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx, cy - 2);
    ctx.moveTo(cx, cy + 2);
    ctx.lineTo(cx, cy + size);
    ctx.stroke();
    ctx.restore();
  }

  // ---- HUD bridge --------------------------------------------------

  private pushHud(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastHudPush < HUD_INTERVAL) return;
    this.lastHudPush = now;

    const s = this.world.state;
    this.opts.onHud({
      phase: this.phase,
      pointerLocked: this.pointerLocked,
      muted: this.mutedFlag,
      room: roomName(this.world.level, s.checkpoint.room),
      levelName: this.world.level.name,
      levelAct: this.world.level.act,
      levelOrdinal: this.world.level.ordinal,
      levelCount: ALL_LEVELS.filter((l) => l.act === this.world.level.act).length,
      dark: this.world.darkness > 0,
      gravityInverted: this.world.gravityInverted,
      blinded: this.world.blinded,
      coresCollected: s.coresCollected,
      xp: s.xp,
      level: s.level,
      xpForNextLevel: xpForNextLevel(s.level),
      availableSkillPoints: this.world.availableSkillPoints,
      shieldCharges: s.player.shieldCharges,
      adsActive: this.adsHeld,
      dashReady: movementStatsFor(s.unlockedNodes).hasDash
        ? 1 - Math.min(1, s.player.dashCooldown / DASH_COOLDOWN_MS)
        : null,
      minimapReserve: hasMinimap(s.unlockedNodes)
        ? campMinimapBox(this.cssW).w + campMinimapBox(this.cssW).pad * 2
        : 0,
      arbiter:
        this.arbiterLine && now - this.arbiterLine.at < ARBITER_LINE_MS
          ? this.arbiterLine.text
          : null,
      bossEnraged: this.world.enraged && s.boss?.phase !== 'defeated',
      unlockedNodes: s.unlockedNodes,
      // La porta più urgente fra quelle armate: un livello può averne
      // più d'una, ma la HUD deve mostrare quella che sta per chiudersi
      // adesso, non un elenco.
      door: (() => {
        const armed = s.doors.filter((d) => d.armed);
        if (armed.length === 0) return { armed: false, closeTimerMs: 0 };
        const soonest = armed.reduce((a, b) => (b.closeTimer < a.closeTimer ? b : a));
        return { armed: true, closeTimerMs: soonest.closeTimer };
      })(),
      bossActive: s.boss !== null && s.checkpoint.room === this.world.level.boss?.room,
      bossName: this.world.level.boss?.kind === 'custode' ? 'CUSTODE' : 'SENTINELLA',
      bossPhase: s.boss?.phase ?? 'defeated',
      bossDamageTaken: s.boss?.damageTaken ?? 0,
      bossHitsToDefeat: this.world.bossHitsToDefeat,
      victory: this.world.finished,
    });
  }

  /** Weapon cooldown as configured by unlocked nodes — read by the HUD
   *  to label the Otturatore Rapido node with its actual effect. */
  weaponStats() {
    return weaponStatsFor(this.world.state.unlockedNodes);
  }
}
