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
  renderCampaignBillboards,
  renderCampaignWalls,
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
  TURN_SPEED,
  clampSensitivity,
} from '../sim/constants';
import {
  BOSS_HITS_TO_DEFEAT,
  DRONE_X,
  DRONE_Y,
  SHIELD_X,
  SHIELD_Y,
  xpForNextLevel,
} from '../sim/campaign/constants';
import { CAMP_MAP_H, CAMP_MAP_W } from '../sim/campaign/map';
import { hasGrazeDamage, weaponStatsFor } from '../sim/campaign/skills';
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
  room: RoomId;
  coresCollected: number;
  xp: number;
  level: number;
  /** null once past the top of LEVEL_XP_THRESHOLDS — there is no next
   *  bar to fill, not a bug. */
  xpForNextLevel: number | null;
  availableSkillPoints: number;
  shieldActive: boolean;
  adsActive: boolean;
  /** La battuta di ARBITER da mostrare adesso, se ce n'è una viva. */
  arbiter: string | null;
  bossEnraged: boolean;
  unlockedNodes: string[];
  door: { armed: boolean; closeTimerMs: number };
  bossActive: boolean;
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

  private world = new CampaignWorld(loadCampaignProfile() ?? undefined);
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

  /** Throw away the saved character and restart from nothing. Offered
   *  because a profile that has already bought every node makes the
   *  level unreplayable the way it was meant to be played. */
  resetProfile(): void {
    clearCampaignProfile();
    this.world = new CampaignWorld();
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
      // The simulation applies the movement penalty itself from this
      // flag (see applyMovement), so the controller must not also
      // scale the input — that would charge the cost twice.
      ads: this.adsHeld,
    };
    this.fireQueued = false;
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
          this.audio.pickup(this.world.state.player.x, this.world.state.player.y);
          break;
        case 'shieldBreak':
          this.audio.shieldBreak(this.world.state.player.x, this.world.state.player.y);
          break;
        case 'droneDown':
          this.audio.kill(DRONE_X, DRONE_Y);
          break;
        case 'bossHit':
          this.audio.hitMarker();
          this.fx.shake(10);
          break;
        case 'bossDefeated':
          this.audio.matchEnd(true);
          this.raise('SENTINELLA ABBATTUTA', '', '#7dfc9a');
          this.phase = 'over';
          if (document.pointerLockElement === this.canvas) {
            document.exitPointerLock();
          }
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
    const wantAds = this.adsHeld && this.phase === 'playing';
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
    renderBackdrop(ctx, vp, fx);
    renderCampaignWalls(ctx, vp, fx, cam, this.depth, world.getTile, CAMP_MAP_W, CAMP_MAP_H);
    renderCampaignBillboards(
      ctx,
      vp,
      fx,
      cam,
      this.depth,
      world.state.cores,
      !world.state.shield.collected,
      SHIELD_X,
      SHIELD_Y,
      world.state.drone,
      DRONE_X,
      DRONE_Y,
      world.state.boss,
      hasGrazeDamage(world.state.unlockedNodes),
      world.enraged,
      now,
    );

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
      room: s.checkpoint.room,
      coresCollected: s.coresCollected,
      xp: s.xp,
      level: s.level,
      xpForNextLevel: xpForNextLevel(s.level),
      availableSkillPoints: this.world.availableSkillPoints,
      shieldActive: s.player.shieldActive,
      adsActive: this.adsHeld,
      arbiter:
        this.arbiterLine && now - this.arbiterLine.at < ARBITER_LINE_MS
          ? this.arbiterLine.text
          : null,
      bossEnraged: this.world.enraged && s.boss.phase !== 'defeated',
      unlockedNodes: s.unlockedNodes,
      door: { armed: s.door.armed, closeTimerMs: s.door.closeTimer },
      bossActive: s.checkpoint.room === 'molo',
      bossPhase: s.boss.phase,
      bossDamageTaken: s.boss.damageTaken,
      bossHitsToDefeat: BOSS_HITS_TO_DEFEAT,
      victory: this.world.finished,
    });
  }

  /** Weapon cooldown as configured by unlocked nodes — read by the HUD
   *  to label the Otturatore Rapido node with its actual effect. */
  weaponStats() {
    return weaponStatsFor(this.world.state.unlockedNodes);
  }
}
