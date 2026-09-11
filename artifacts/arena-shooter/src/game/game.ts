// ================================================================
// GAME CONTROLLER
// ================================================================
// Owns the fixed-timestep loop and wires the pure simulation to the
// renderer, the audio engine and the React UI.
//
// The loop is an accumulator: real elapsed time is banked and spent
// in whole ticks, with any remainder used to interpolate the frame.
// Rendering therefore runs as fast as the display allows while the
// simulation always advances in identical steps — the fix for the
// prototype, where a 144 Hz monitor simply moved you faster.
// ================================================================

import { AudioEngine } from '../audio/engine';
import {
  CameraFx,
  computeViewport,
  type Viewport,
} from '../render/camera';
import {
  renderBanner,
  renderCountdown,
  renderCrosshair,
  renderDamageOverlay,
  renderDeathNotice,
  renderHitDirection,
  renderKillFeed,
  renderMinimap,
  renderScope,
  renderViewmodel,
  type Banner,
  type DeathInfo,
  type KillFeedEntry,
  type ShotPing,
} from '../render/overlay';
import { PU_RGB, skinOf } from '../render/palette';
import { ParticleSystem } from '../render/particles';
import { renderBackdrop, renderBillboards, renderWalls } from '../render/scene';
import { buildBackdrops, getTextures } from '../render/textures';
import {
  ADS_MOVE_MULT,
  ADS_SENS_MULT,
  ADS_TRANSITION_MS,
  ADS_ZOOM,
  BULLET_COOLDOWN,
  COUNTDOWN_GO_MS,
  clampSensitivity,
  FOOTSTEP_STRIDE,
  MAX_PITCH,
  MAX_TICKS_PER_FRAME,
  MOUSE_SENSITIVITY,
  MULTIKILL_WINDOW_MS,
  PU_RAPID_DUR,
  PU_SPEED_DUR,
  RAPIDFIRE_CD,
  START_COUNTDOWN_MS,
  TICK_MS,
  TILE,
  TIME_WARNING_MS,
  TURN_SPEED,
  type Difficulty,
} from '../sim/constants';
import { applyRemotePoses, type NetAdapter } from '../net/session';
import {
  emptyInput,
  type Entity,
  type InputState,
  type PowerUpKind,
  type SimEvent,
} from '../sim/types';
import { World, type InputMap, type SlotConfig } from '../sim/world';

export type Phase = 'menu' | 'playing' | 'paused' | 'over';

export interface ScoreRow {
  id: number;
  name: string;
  skin: number;
  kills: number;
  deaths: number;
  alive: boolean;
  isLocal: boolean;
}

/** One power-up the local player is currently carrying. */
export interface ActivePower {
  kind: PowerUpKind;
  /** Milliseconds left, or null when the exact figure is not known —
   *  a guest is told only *that* a power-up is active, because the host
   *  owns expiry and shipping the countdown every tick would cost more
   *  than it tells anyone. Shield has no timer either: it lasts until
   *  it absorbs a hit. */
  msLeft: number | null;
  /** Fraction 0..1 of the original duration, for the meter. */
  fraction: number | null;
}

/** The slice of game state the React layer renders. Deliberately
 *  small and pushed on a timer rather than every frame — re-rendering
 *  React 60 times a second to update a kill counter is pure waste. */
export interface HudSnapshot {
  phase: Phase;
  scores: ScoreRow[];
  winnerId: number | null;
  localId: number;
  accuracy: number;
  bestStreak: number;
  pointerLocked: boolean;
  muted: boolean;
  /** null in single-player. */
  net: 'host' | 'guest' | null;
  ping: number;
  /** Power-ups the local player is carrying right now. */
  powers: ActivePower[];
  /** Simulated milliseconds left in the match. */
  timeLeftMs: number;
  /** Consecutive kills without dying, counted locally. */
  streak: number;
  /** >0 while the pre-match countdown is holding the world still. */
  countdownMs: number;
  /** Kills needed to win this match — scales with the roster. */
  killTarget: number;
}

export interface GameOptions {
  slots: SlotConfig[];
  onHud: (snap: HudSnapshot) => void;
  /** Called once when a match finishes, for stats persistence. */
  onMatchEnd?: (summary: MatchSummary) => void;
  difficulty?: Difficulty;
  /** Multiplier on MOUSE_SENSITIVITY; 1 when the player has never
   *  touched the setting. */
  sensitivity?: number;
}

export interface MatchSummary {
  won: boolean;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  bestStreak: number;
  durationMs: number;
  opponents: number;
}

interface Interp {
  x: number;
  y: number;
}

const HUD_INTERVAL = 120; // ms between React pushes

/** Streak lengths that earn a callout. Sparse on purpose: a banner on
 *  every kill stops being information. */
const STREAK_CALLOUTS: readonly number[] = [3, 5, 7, 10];

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: GameOptions;

  private world: World;
  private particles = new ParticleSystem();
  private fx = new CameraFx();
  audio = new AudioEngine();

  private vp: Viewport;
  private depth: Float32Array;
  /** Viewport size in logical pixels, kept so the zoom can rebuild the
   *  projection without another layout read. */
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;

  private phase: Phase = 'menu';
  private localId = 0;
  private difficulty: Difficulty;

  /** Live view angle, driven by mouse/keys outside the tick loop so
   *  aiming never lags the display refresh. */
  private yaw = 0;
  private keys = new Set<string>();
  private fireQueued = false;
  private inputSeq = 0;

  private pointerLocked = false;
  private mouseDX = 0;
  private mouseDY = 0;
  /** The player's sensitivity multiplier. Lives here rather than in
   *  the world because it changes how a hand moves a camera, not how
   *  the arena behaves: two peers with different settings must still
   *  simulate the same match. */
  private sensMult = 1;

  /** Right button held. `adsT` is the eased 0..1 the renderer uses, so
   *  the zoom is continuous rather than a jump on the frame the button
   *  goes down. */
  private adsHeld = false;
  private adsT = 0;

  private accumulator = 0;
  private lastFrame = 0;
  private rafId = 0;
  private running = false;

  /** Positions at the start of the current tick, for interpolation. */
  private prev = new Map<number, Interp>();
  private killFeed: KillFeedEntry[] = [];
  private matchStart = 0;
  private lastHudPush = 0;
  private stepAudioTimer = 0;
  private wasReady = true;

  /** Where each opponent was last heard firing, keyed by shooter id.
   *  Feeds the minimap, which no longer knows anything else about them. */
  private shotPings = new Map<number, ShotPing>();
  /** Distance each opponent has walked since its last footstep sound,
   *  in world units. Footsteps are a presentation concern, so they are
   *  measured off rendered movement rather than added to the
   *  simulation's event stream. */
  private strideAccum = new Map<number, number>();
  private lastPos = new Map<number, Interp>();

  /** Pre-match freeze. Counts down on real frame time, not ticks —
   *  the simulation is deliberately not running yet. */
  private countdownMs = 0;
  private lastCountdownBeep = -1;

  /** Presentation-only kill bookkeeping.
   *
   *  Counted locally instead of read off the entity because a guest
   *  never simulates combat: its own `streak` field is whatever its
   *  prediction guessed, while these two are driven by the host's
   *  authoritative kill events. */
  private localStreak = 0;
  private recentKills: number[] = [];
  private banner: Banner | null = null;
  private deathInfo: DeathInfo | null = null;
  private warnedTime = false;

  private ro: ResizeObserver | null = null;

  /** null for single-player. Set before newMatch() to go online. */
  private net: NetAdapter | null = null;

  constructor(canvas: HTMLCanvasElement, opts: GameOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.difficulty = opts.difficulty ?? 'normale';
    this.sensMult = clampSensitivity(opts.sensitivity ?? 1);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.world = new World(
      opts.slots,
      (Math.random() * 0xffffffff) >>> 0,
      this.difficulty,
    );
    this.localId =
      this.world.entities.find((e) => e.controller === 'local')?.id ?? 0;

    getTextures();
    this.vp = computeViewport(1, 1, 1);
    this.depth = new Float32Array(1);
    this.resize();

    this.bindEvents();
  }

  // ---- lifecycle -----------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.unbindEvents();
    this.ro?.disconnect();
    this.audio.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Attach (or detach) a network session. Must be set before
   *  newMatch() so the first tick already routes correctly. */
  setNetwork(net: NetAdapter | null): void {
    this.net = net;
  }

  /** Change the look sensitivity, including mid-match: the pause
   *  screen offers this slider precisely because a menu is the one
   *  place you cannot tell whether the value is right. Takes effect on
   *  the next frame; nothing has to be rebuilt. */
  setSensitivity(mult: number): void {
    this.sensMult = clampSensitivity(mult);
  }

  /** Feed host-authored effect events into the local presentation
   *  layers. Guests never generate these themselves, because they do
   *  not simulate combat. */
  ingestRemoteEvents(events: SimEvent[]): void {
    this.replayEvents(events);
  }

  /** Begin a fresh match.
   *  `seed` lets every peer start from the same world. */
  newMatch(
    slots?: SlotConfig[],
    seed?: number,
    localId?: number,
    difficulty?: Difficulty,
  ): void {
    if (slots) this.opts.slots = slots;
    if (difficulty) this.difficulty = difficulty;
    this.world = new World(
      this.opts.slots,
      seed ?? (Math.random() * 0xffffffff) >>> 0,
      this.difficulty,
    );
    this.localId =
      localId ??
      this.world.entities.find((e) => e.controller === 'local')?.id ??
      0;
    this.particles.clear();
    this.fx.reset();
    this.killFeed = [];
    this.prev.clear();
    this.shotPings.clear();
    this.strideAccum.clear();
    this.lastPos.clear();
    this.accumulator = 0;
    this.adsHeld = false;
    this.adsT = 0;
    this.localStreak = 0;
    this.recentKills = [];
    this.banner = null;
    this.deathInfo = null;
    this.warnedTime = false;
    this.countdownMs = START_COUNTDOWN_MS;
    this.lastCountdownBeep = -1;
    this.yaw = this.world.byId(this.localId)?.angle ?? 0;
    this.matchStart = performance.now();
    this.phase = 'playing';
    this.audio.init();
    this.requestPointerLock();
    this.pushHud(true);
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
    // Drop time accumulated while paused instead of simulating it.
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.requestPointerLock();
    this.pushHud(true);
  }

  toMenu(): void {
    this.phase = 'menu';
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.pushHud(true);
  }

  toggleMute(): void {
    this.audio.setMuted(!this.mutedFlag);
    this.mutedFlag = !this.mutedFlag;
    this.pushHud(true);
  }

  private mutedFlag = false;

  requestPointerLock(): void {
    try {
      const p = this.canvas.requestPointerLock() as unknown as
        | Promise<void>
        | undefined;
      void p?.catch?.(() => {
        // Blocked (sandboxed iframe, or the browser's unlock cooldown).
        // Q/E keyboard turning stays available, so play continues.
      });
    } catch {
      /* same fallback */
    }
  }

  // ---- sizing --------------------------------------------------------

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.floor(rect.width || window.innerWidth));
    const cssH = Math.max(240, Math.floor(rect.height || window.innerHeight));

    // Cap the backing store on very dense displays: at 3x DPR a 4K
    // window would mean casting rays for 12k device pixels per row,
    // which costs far more than it shows.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);

    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.vp = computeViewport(cssW, cssH, dpr, this.zoom());
    this.depth = new Float32Array(this.vp.numRays);
    buildBackdrops(getTextures(), cssW, cssH);

    // Draw in logical pixels; the transform handles the device scale.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Current magnification. Eased, so it interpolates the whole way in
   *  and out rather than snapping between two field of view values. */
  private zoom(): number {
    return 1 + (ADS_ZOOM - 1) * this.adsT;
  }

  // ---- input ---------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.preventDefault();
    }
    if (k === 'escape') {
      if (this.phase === 'playing') this.pause();
    }
    if (k === 'm') this.toggleMute();
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

  private setAds(on: boolean): void {
    if (this.adsHeld === on) return;
    this.adsHeld = on;
    this.audio.scope(on);
  }

  private onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    this.pointerLocked = locked;
    // Losing the lock mid-match (Esc, alt-tab) pauses rather than
    // leaving the player unable to aim without knowing why.
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
    // Bound on the window, not the canvas: releasing the button after
    // the cursor has left the element must still lower the scope.
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

  /** Translate held keys and accumulated mouse motion into the input
   *  the simulation consumes. */
  /** Fold accumulated mouse motion and held turn keys into the view
   *  angle.
   *
   *  Separate from buildLocalInput because it also has to run while the
   *  world is frozen for the countdown: deltas left in the accumulator
   *  for three seconds would otherwise all land on the first tick and
   *  snap the view across the arena. */
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

    // Keyboard turning always works, so the game stays playable when
    // pointer lock is unavailable (sandboxed previews block it). It is
    // deliberately not scaled by the sensitivity setting: that slider
    // calibrates a hand against a mouse, and a held key has no hand
    // speed to calibrate against.
    const turn = (TURN_SPEED * frameDt * damp) / 1000;
    if (k.has('q') || k.has('arrowleft')) this.yaw -= turn;
    if (k.has('e') || k.has('arrowright')) this.yaw += turn;
  }

  private buildLocalInput(frameDt: number): InputState {
    const k = this.keys;

    this.applyLook(frameDt);

    let forward = 0;
    let strafe = 0;
    if (k.has('w') || k.has('arrowup')) forward += 1;
    if (k.has('s') || k.has('arrowdown')) forward -= 1;
    if (k.has('d')) strafe += 1;
    if (k.has('a')) strafe -= 1;

    // The price of the scope. Expressed as reduced movement *intent*,
    // exactly as a partly-deflected analog stick would be, so the
    // simulation needs no concept of aiming down sights and the wire
    // format does not change: World already treats fractional input as
    // proportional speed.
    const move = 1 - this.adsT * (1 - ADS_MOVE_MULT);
    forward *= move;
    strafe *= move;

    const input: InputState = {
      forward,
      strafe,
      aimAngle: this.yaw,
      fire: this.fireQueued,
      seq: ++this.inputSeq,
    };
    this.fireQueued = false;
    return input;
  }

  // ---- simulation events --------------------------------------------

  private handleEvents(): void {
    this.replayEvents(this.world.events);
  }

  /** Turn simulation events into particles, sound and UI.
   *
   *  Shared by both roles: the host feeds it its own events, a guest
   *  feeds it the host's, so the two see identical effects without
   *  the guest ever simulating combat. */
  private replayEvents(events: readonly SimEvent[]): void {
    const local = this.world.byId(this.localId);

    for (const ev of events) {
      switch (ev.type) {
        case 'shot': {
          this.particles.muzzle(ev.x, ev.y, ev.angle);
          const isLocal = ev.shooterId === this.localId;
          this.audio.rifle(isLocal ? undefined : ev.x, isLocal ? undefined : ev.y);
          if (isLocal) this.fx.shake(9);

          // A shot is loud, so it is the one thing you always learn
          // about an opponent you cannot see.
          if (!isLocal) {
            this.shotPings.set(ev.shooterId, {
              x: ev.x,
              y: ev.y,
              at: performance.now(),
            });
          }

          // Taking fire: remember the bearing to the shooter. The shot
          // event carries the shooter's position, which the kill event
          // does not — it reports where the *victim* fell.
          if (ev.hitEntityId === this.localId && local) {
            this.fx.markIncoming(
              Math.atan2(ev.y - local.y, ev.x - local.x),
            );
          }

          if (ev.hitEntityId === null) {
            this.particles.bulletImpact(ev.hitX, ev.hitY, ev.angle);
            this.audio.impact(ev.hitX, ev.hitY);
          } else {
            this.particles.blood(ev.hitX, ev.hitY);
            if (isLocal) {
              this.fx.markHit();
              this.audio.hitMarker();
            }
          }
          break;
        }

        case 'kill': {
          const killer = this.world.byId(ev.killerId);
          const victim = this.world.byId(ev.victimId);
          const mine = ev.killerId === this.localId;
          if (killer && victim) {
            this.killFeed.unshift({
              killer: killer.name,
              killerSkin: killer.skin,
              victim: victim.name,
              victimSkin: victim.skin,
              at: performance.now(),
              mine,
            });
            this.killFeed.length = Math.min(this.killFeed.length, 6);
          }
          this.audio.kill(ev.x, ev.y);

          if (mine) this.creditKill();

          if (ev.victimId === this.localId) {
            this.fx.flashDamage();
            this.fx.shake(20);
            this.audio.death();
            this.localStreak = 0;
            this.recentKills = [];
            this.deathInfo = killer
              ? {
                  killer: killer.name,
                  killerSkin: killer.skin,
                  // The bearing recorded from the shot that landed is
                  // more accurate than the killer's position now, which
                  // has already moved on by the time this is drawn.
                  fromAngle: this.fx.incoming > 0
                    ? this.fx.incomingAngle
                    : Math.atan2(killer.y - ev.y, killer.x - ev.x),
                }
              : null;
          }
          break;
        }

        case 'shieldBreak':
          this.particles.shieldShatter(ev.x, ev.y);
          this.audio.shieldBreak(ev.x, ev.y);
          if (ev.entityId === this.localId) this.fx.flashDamage();
          break;

        case 'pickup':
          this.particles.pickup(ev.x, ev.y, PU_RGB[ev.kind]);
          this.audio.pickup(ev.x, ev.y);
          break;

        case 'spawn':
          this.particles.spawnBurst(ev.x, ev.y);
          if (ev.entityId === this.localId) {
            this.audio.respawn();
            this.fx.reset();
            this.deathInfo = null;
            // Re-align the view with the angle the simulation chose,
            // otherwise the camera snaps to a stale heading.
            this.yaw = this.world.byId(this.localId)?.angle ?? this.yaw;
          }
          break;

        case 'matchEnd': {
          this.phase = 'over';
          const won = ev.winnerId === this.localId;
          this.audio.matchEnd(won);
          if (document.pointerLockElement === this.canvas) {
            document.exitPointerLock();
          }
          if (local && this.opts.onMatchEnd) {
            this.opts.onMatchEnd({
              won,
              kills: local.kills,
              deaths: local.deaths,
              shotsFired: local.shotsFired,
              shotsHit: local.shotsHit,
              bestStreak: local.bestStreak,
              durationMs: performance.now() - this.matchStart,
              opponents: this.world.entities.length - 1,
            });
          }
          this.pushHud(true);
          break;
        }
      }
    }
  }

  /** Book a kill for the local player and raise a callout if it earned
   *  one. Multi-kills take precedence over streak milestones: two
   *  banners on the same frame would just overwrite each other, and
   *  the rarer event is the one worth reading. */
  private creditKill(): void {
    const now = performance.now();
    this.localStreak++;
    this.recentKills.push(now);
    this.recentKills = this.recentKills.filter(
      (t) => now - t <= MULTIKILL_WINDOW_MS,
    );

    const multi = this.recentKills.length;
    if (multi >= 2) {
      const label =
        multi === 2
          ? 'DOPPIA UCCISIONE'
          : multi === 3
            ? 'TRIPLA UCCISIONE'
            : multi === 4
              ? 'QUADRUPLA UCCISIONE'
              : 'MASSACRO';
      this.raise(label, `${multi} in ${(MULTIKILL_WINDOW_MS / 1000).toFixed(0)}s`, '#ffd23c');
      this.audio.callout(multi);
      return;
    }

    if (STREAK_CALLOUTS.includes(this.localStreak)) {
      this.raise(
        `IN SERIE ×${this.localStreak}`,
        'senza mai cadere',
        '#7dfc9a',
      );
      this.audio.callout(Math.min(4, Math.floor(this.localStreak / 2)));
    }
  }

  private raise(text: string, sub: string, color: string): void {
    this.banner = { text, sub, at: performance.now(), color };
  }

  /** Call the endgame once, so a match decided on time has a run-in
   *  rather than simply stopping. */
  private checkTimeWarning(): void {
    if (this.warnedTime || this.world.finished) return;
    if (this.world.timeLeftMs > TIME_WARNING_MS) return;
    this.warnedTime = true;
    this.raise(
      `ULTIMI ${Math.round(TIME_WARNING_MS / 1000)} SECONDI`,
      'vince chi è in testa allo scadere',
      '#ff9d3c',
    );
    this.audio.callout(2);
  }

  // ---- loop ----------------------------------------------------------

  private loop = (ts: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    const frameDt = Math.min(ts - this.lastFrame, 250);
    this.lastFrame = ts;

    if (this.phase === 'playing' && this.countdownMs > 0) {
      this.tickCountdown(frameDt);
    }

    if (this.phase === 'playing' && this.countdownMs <= 0) {
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

      // Backlog too deep to catch up on (long stall, slow machine):
      // discard it rather than spiralling further behind every frame.
      if (ticks >= MAX_TICKS_PER_FRAME) this.accumulator = 0;

      this.checkTimeWarning();
    }

    this.particles.update(frameDt);
    this.updateFeel(frameDt);
    this.render(this.accumulator / TICK_MS);
    this.pushHud(false);
  };

  /** Hold the world still before the first tick, and beep once per
   *  second on the way down.
   *
   *  Runs on real frame time because the simulation is deliberately not
   *  advancing: this is the one piece of timing in the game that is not
   *  measured in ticks. */
  private tickCountdown(frameDt: number): void {
    const before = this.countdownMs;
    this.countdownMs = Math.max(0, this.countdownMs - frameDt);

    // Looking around while waiting is allowed, and draining the mouse
    // accumulator every frame is also what stops three seconds of
    // motion from arriving at once on the first tick.
    this.applyLook(frameDt);

    // A click banked during the freeze must not fire the instant the
    // match starts.
    this.fireQueued = false;

    // Same reckoning the overlay uses, so the beep lands on the digit.
    const secs = Math.ceil((this.countdownMs - COUNTDOWN_GO_MS) / 1000);
    if (secs !== this.lastCountdownBeep) {
      this.lastCountdownBeep = secs;
      this.audio.countdownBeep(secs <= 0);
    }

    if (before > 0 && this.countdownMs <= 0) {
      // The clock on the scoreboard starts now, not when the screen
      // first appeared.
      this.matchStart = performance.now();
      this.accumulator = 0;
    }
  }

  /** Advance the world by one fixed tick, routed by network role. */
  private tick(): void {
    for (const e of this.world.entities) {
      this.prev.set(e.id, { x: e.x, y: e.y });
    }

    const net = this.net;

    // ---- Single-player, or the authoritative host --------------------
    if (!net || net.mode === 'host') {
      const inputs: InputMap = net ? net.drainInputs() : {};
      inputs[this.localId] = this.buildLocalInput(TICK_MS);
      this.world.step(inputs);
      this.handleEvents();
      net?.publish(this.world, this.world.events);
      return;
    }

    // ---- Guest: predict movement only --------------------------------
    // Rewind to the last authoritative state and re-apply everything
    // the host has not confirmed yet.
    const replay = net.takeCorrection(this.world, this.localId);
    for (const past of replay) {
      this.world.step({ [this.localId]: { ...past, fire: false } });
    }

    const input = this.buildLocalInput(TICK_MS);
    net.submitInput(input);

    // The trigger is predicted only as far as the cooldown, so the
    // crosshair reacts instantly. The shot itself is never traced
    // locally: a guest that resolved its own hits would show kills
    // the host never agreed to, and then have to un-kill them.
    const local = this.world.byId(this.localId);
    if (input.fire && local?.alive && local.weaponCooldown <= 0) {
      local.weaponCooldown =
        local.rapidFireTimer > 0 ? RAPIDFIRE_CD : BULLET_COOLDOWN;
      this.fx.shake(9);
    }

    this.world.step({ [this.localId]: { ...input, fire: false } });
    // Anything the local step inferred is a prediction, not truth;
    // the authoritative versions arrive over the reliable channel.
    this.world.events.length = 0;
  }

  private updateFeel(frameDt: number): void {
    const local = this.world.byId(this.localId);

    // Ease the scope toward wherever the button is. Dying drops it: a
    // corpse holding a magnified view of the floor is not useful.
    const wantAds = this.adsHeld && !!local?.alive && this.phase === 'playing';
    const rate = frameDt / ADS_TRANSITION_MS;
    const prevAds = this.adsT;
    this.adsT = wantAds
      ? Math.min(1, this.adsT + rate)
      : Math.max(0, this.adsT - rate);

    // Rebuild the projection only on frames where the zoom moved,
    // including the one it settles on — stopping a frame early would
    // leave the view fractionally short of full magnification.
    if (this.adsT !== prevAds) {
      this.vp = computeViewport(this.cssW, this.cssH, this.dpr, this.zoom());
    }

    const moving =
      this.phase === 'playing' &&
      this.countdownMs <= 0 &&
      !!local?.alive &&
      (this.keys.has('w') ||
        this.keys.has('a') ||
        this.keys.has('s') ||
        this.keys.has('d') ||
        this.keys.has('arrowup') ||
        this.keys.has('arrowdown'));

    const speed01 = local && local.speedBoostTimer > 0 ? 1 : 0.72;
    this.fx.update(frameDt, moving, speed01);

    if (moving) {
      this.stepAudioTimer -= frameDt;
      if (this.stepAudioTimer <= 0) {
        this.audio.footstep();
        this.stepAudioTimer = local && local.speedBoostTimer > 0 ? 260 : 380;
      }
    } else {
      this.stepAudioTimer = 0;
    }

    this.updateOpponentFootsteps();

    // Bolt-cycle click at the moment the weapon becomes ready again.
    if (local) {
      const ready = local.weaponCooldown <= 0;
      if (ready && !this.wasReady && local.alive) this.audio.boltCycle();
      this.wasReady = ready;
    }
  }

  /** Sound an opponent's footfalls once per stride of actual travel.
   *
   *  Driven off observed movement rather than a simulation event: the
   *  simulation has no notion of a footstep, and giving it one would
   *  mean every peer shipping them over the wire for a purely local
   *  effect. Distance-based rather than timed, so how fast something is
   *  moving is audible. */
  private updateOpponentFootsteps(): void {
    if (this.phase !== 'playing' || this.countdownMs > 0) return;

    for (const e of this.world.entities) {
      if (e.id === this.localId) continue;

      const prev = this.lastPos.get(e.id);
      this.lastPos.set(e.id, { x: e.x, y: e.y });
      if (!prev || !e.alive) continue;

      const moved = Math.hypot(e.x - prev.x, e.y - prev.y);
      // A respawn is a teleport, not a stride.
      if (moved > TILE) continue;

      const stride = (this.strideAccum.get(e.id) ?? 0) + moved;
      if (stride < FOOTSTEP_STRIDE) {
        this.strideAccum.set(e.id, stride);
        continue;
      }
      this.strideAccum.set(e.id, 0);
      this.audio.footstep(e.x, e.y);
    }
  }

  private render(alpha: number): void {
    const { ctx, vp, fx } = this;
    const local = this.world.byId(this.localId);
    if (!local) return;

    // Interpolate positions between the two most recent ticks, but
    // take the camera angle live from the mouse: interpolating the
    // yaw would add a tick of aim latency for no visual benefit.
    const lerp = (e: Entity): { x: number; y: number } => {
      const p = this.prev.get(e.id);
      if (!p) return { x: e.x, y: e.y };
      return {
        x: p.x + (e.x - p.x) * alpha,
        y: p.y + (e.y - p.y) * alpha,
      };
    };

    const camPos = lerp(local);
    const cam = { x: camPos.x, y: camPos.y, angle: this.yaw };

    // Move the audio listener with the camera. Without this every
    // panned sound is positioned against a listener parked at the map
    // origin, so "a shot on your left is heard on your left" only holds
    // if you happen to be standing in the corner.
    this.audio.updateListener(cam.x, cam.y, cam.angle);

    // Snapshot interpolated positions so walls, sprites and particles
    // are all drawn against the same instant in time.
    const drawn = this.world.entities.map((e) => {
      const p = lerp(e);
      return { ...e, x: p.x, y: p.y };
    });

    // A guest never simulates other players, so their local positions
    // are stale by definition. Overwrite them with poses sampled from
    // snapshot history, rendered on a deliberate delay.
    if (this.net?.mode === 'guest') {
      const poses = this.net.sampleRemote(performance.now());
      if (poses) applyRemotePoses(drawn, poses, this.localId);
    }

    renderBackdrop(ctx, vp, fx);
    renderWalls(ctx, vp, fx, cam, this.depth);
    renderBillboards(
      ctx,
      vp,
      fx,
      cam,
      this.localId,
      drawn,
      this.world.state.powerups,
      this.particles.all,
      this.depth,
      performance.now(),
    );

    const now = performance.now();

    if (local.alive && this.phase !== 'over') {
      renderViewmodel(ctx, vp, fx, local, now, this.adsT);
      renderScope(ctx, vp, fx, local, this.adsT);
      renderCrosshair(ctx, vp, fx, local, this.adsT);
    }

    renderDamageOverlay(ctx, vp, fx);
    renderHitDirection(ctx, vp, fx, this.yaw);
    renderMinimap(
      ctx,
      vp,
      local,
      drawn,
      this.world.state.powerups,
      this.shotPings,
      now,
    );
    renderKillFeed(ctx, vp, this.killFeed, now);
    if (this.banner) renderBanner(ctx, vp, this.banner, now);

    if (!local.alive && this.phase === 'playing') {
      renderDeathNotice(ctx, vp, local, this.deathInfo, this.yaw);
    }

    if (this.countdownMs > 0 && this.phase === 'playing') {
      renderCountdown(ctx, vp, this.countdownMs);
    }

    if (this.phase === 'paused') {
      ctx.fillStyle = 'rgba(6,7,12,0.72)';
      ctx.fillRect(0, 0, vp.width, vp.height);
    }
  }

  // ---- HUD bridge ----------------------------------------------------

  private pushHud(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastHudPush < HUD_INTERVAL) return;
    this.lastHudPush = now;

    const local = this.world.byId(this.localId);
    const scores: ScoreRow[] = this.world.entities
      .map((e) => ({
        id: e.id,
        name: e.name,
        skin: e.skin,
        kills: e.kills,
        deaths: e.deaths,
        alive: e.alive,
        isLocal: e.id === this.localId,
      }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    this.opts.onHud({
      phase: this.phase,
      scores,
      winnerId: this.world.state.winnerId,
      localId: this.localId,
      accuracy:
        local && local.shotsFired > 0
          ? (local.shotsHit / local.shotsFired) * 100
          : 0,
      bestStreak: local?.bestStreak ?? 0,
      pointerLocked: this.pointerLocked,
      muted: this.mutedFlag,
      net: this.net?.mode ?? null,
      ping: Math.round(this.net?.ping ?? 0),
      powers: local ? this.activePowers(local) : [],
      timeLeftMs: this.world.timeLeftMs,
      streak: this.localStreak,
      countdownMs: this.countdownMs,
      killTarget: this.world.state.killTarget,
    });
  }

  /** What the local player is carrying, with a countdown where one is
   *  actually known. */
  private activePowers(local: Entity): ActivePower[] {
    // A guest is told only that a power-up is on, never how much is
    // left (see applyEntity), so quoting a figure there would be
    // inventing one.
    const exact = this.net?.mode !== 'guest';
    const out: ActivePower[] = [];

    if (local.shieldActive) {
      // No timer by design: the shield lasts until it eats a bullet.
      out.push({ kind: 'shield', msLeft: null, fraction: null });
    }
    if (local.rapidFireTimer > 0) {
      out.push({
        kind: 'rapidfire',
        msLeft: exact ? local.rapidFireTimer : null,
        fraction: exact ? local.rapidFireTimer / PU_RAPID_DUR : null,
      });
    }
    if (local.speedBoostTimer > 0) {
      out.push({
        kind: 'speed',
        msLeft: exact ? local.speedBoostTimer : null,
        fraction: exact ? local.speedBoostTimer / PU_SPEED_DUR : null,
      });
    }
    return out;
  }

  /** Name of a skin index, for the UI. */
  static skinName(i: number): string {
    return skinOf(i).name;
  }
}
