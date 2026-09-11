// ================================================================
// OVERLAY — viewmodel, crosshair, minimap, feedback
// ================================================================
// Screen-space only: nothing here is projected into the world.
// ================================================================

import {
  BULLET_COOLDOWN,
  COUNTDOWN_GO_MS,
  MAP_H,
  MAP_W,
  MINIMAP_PING_MS,
  RAPIDFIRE_CD,
  T_FLOOR,
  T_WALL,
  TILE,
} from '../sim/constants';
import { MAP_DATA } from '../sim/map';
import { angleDelta, hasLOS } from '../sim/raycast';
import type { Entity, PowerUp } from '../sim/types';
import type { CameraFx, Viewport } from './camera';
import { PU_COLOR, skinOf } from './palette';

export interface KillFeedEntry {
  killer: string;
  killerSkin: number;
  victim: string;
  victimSkin: number;
  /** Timestamp (ms) when it happened. */
  at: number;
  /** True when the local player is the killer — worth picking out of
   *  the list at a glance. */
  mine: boolean;
}

/** A centre-screen callout: multi-kill, streak, or the final seconds. */
export interface Banner {
  text: string;
  sub: string;
  /** Timestamp (ms) when it was raised. */
  at: number;
  color: string;
}

/** Who killed the viewer and from where, for the death screen. */
export interface DeathInfo {
  killer: string;
  killerSkin: number;
  /** World-space bearing from victim to killer, radians. */
  fromAngle: number;
}

const FEED_LIFETIME = 5000;
const BANNER_LIFETIME = 2100;

/** First-person rifle: idle sway, walk bob, and a recoil kick that
 *  settles as the bolt cycles.
 *
 *  `ads` (0..1) drops the weapon out of frame as the player raises the
 *  scope: while scoped the sight picture *is* the weapon, and drawing
 *  both would put the receiver across the middle of the view. */
export function renderViewmodel(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  player: Entity,
  nowMs: number,
  ads = 0,
): void {
  if (ads >= 0.995) return;

  const maxCd = player.rapidFireTimer > 0 ? RAPIDFIRE_CD : BULLET_COOLDOWN;
  const ready = player.weaponCooldown <= 0;
  // 1 right after firing, decaying to 0 as the weapon becomes ready.
  const recoil = ready ? 0 : player.weaponCooldown / maxCd;

  // Scale the whole weapon with viewport height so it occupies the
  // same fraction of the screen at any resolution.
  const s = vp.height / 600;

  const cx = vp.width / 2 + fx.bobX * 2.2 + fx.shakeX;
  const baseY = vp.height + fx.bobY * 1.6 + fx.shakeY + ads * 150 * s;
  // Sharp kick up and back, easing out.
  const kick = recoil * recoil * 26 * s;

  ctx.save();
  ctx.globalAlpha = 1 - ads;
  ctx.translate(cx, baseY - kick);
  ctx.rotate(recoil * 0.05);
  ctx.scale(s, s);

  // Stock.
  ctx.fillStyle = '#4a3520';
  ctx.fillRect(-26, -96, 52, 100);
  ctx.fillStyle = '#5c4227';
  ctx.fillRect(-26, -96, 52, 8);
  ctx.fillStyle = '#3a2917';
  ctx.fillRect(14, -96, 12, 100);

  // Receiver.
  ctx.fillStyle = '#26262c';
  ctx.fillRect(-18, -134, 36, 42);
  ctx.fillStyle = '#33333a';
  ctx.fillRect(-18, -134, 36, 4);

  // Bolt handle — pulled back while cycling, forward when ready.
  ctx.fillStyle = '#4a4a54';
  ctx.fillRect(16, -126 + recoil * 16, 16, 7);

  // Barrel.
  ctx.fillStyle = '#333339';
  ctx.fillRect(-7, -232, 14, 100);
  ctx.fillStyle = '#42424a';
  ctx.fillRect(-7, -232, 4, 100);

  // Scope.
  ctx.fillStyle = '#141418';
  ctx.fillRect(-15, -204, 30, 22);
  ctx.fillStyle = '#1e1e24';
  ctx.fillRect(-19, -200, 38, 6);
  // Lens, catching a little light.
  const lens = ctx.createLinearGradient(-11, -200, 11, -186);
  lens.addColorStop(0, '#6fa8d8');
  lens.addColorStop(0.5, '#2c4f74');
  lens.addColorStop(1, '#16283c');
  ctx.fillStyle = lens;
  ctx.fillRect(-11, -200, 22, 14);

  // Muzzle flash.
  if (recoil > 0.88) {
    const f = (recoil - 0.88) / 0.12;
    ctx.save();
    ctx.globalAlpha = f;
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(0, -236, 20 * f, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -236, 9 * f, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

export function renderCrosshair(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  player: Entity,
  ads = 0,
): void {
  const maxCd = player.rapidFireTimer > 0 ? RAPIDFIRE_CD : BULLET_COOLDOWN;
  const ready = player.weaponCooldown <= 0;
  const progress = ready ? 1 : 1 - player.weaponCooldown / maxCd;

  const cx = vp.width / 2;
  const cy = vp.height / 2;
  // Spread wide right after firing and close as the weapon recovers:
  // the crosshair itself communicates the cooldown.
  const gap = 4 + (1 - progress) * 12;
  const color = ready ? '#7dfc9a' : '#ff8a6a';

  ctx.save();
  // The scope has its own reticle; cross-fade rather than stack them.
  ctx.globalAlpha = 1 - ads;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - 13, cy);
  ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy);
  ctx.lineTo(cx + 13, cy);
  ctx.moveTo(cx, cy - 13);
  ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap);
  ctx.lineTo(cx, cy + 13);
  ctx.stroke();

  if (ready) {
    ctx.fillStyle = color;
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }

  // Hit marker — four short diagonals, the standard shooter idiom.
  if (fx.hitMarker > 0) {
    ctx.globalAlpha = fx.hitMarker;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    const r0 = 7;
    const r1 = 14;
    ctx.beginPath();
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      ctx.moveTo(cx + sx * r0, cy + sy * r0);
      ctx.lineTo(cx + sx * r1, cy + sy * r1);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Telescopic sight.
 *
 *  `ads` runs 0..1 as the player raises the scope. Everything scales
 *  from it so the transition is one continuous motion rather than a
 *  state swap: the aperture closes in, the mask darkens, the reticle
 *  fades up.
 *
 *  Drawn with an even-odd fill (viewport rectangle minus a circle)
 *  instead of a clip path, so the mask is a single fill call and no
 *  clipping state is left behind for later passes to trip over. */
export function renderScope(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  player: Entity,
  ads: number,
): void {
  if (ads <= 0.005) return;

  const maxCd = player.rapidFireTimer > 0 ? RAPIDFIRE_CD : BULLET_COOLDOWN;
  const ready = player.weaponCooldown <= 0;
  const progress = ready ? 1 : 1 - player.weaponCooldown / maxCd;

  // Scope sway is the bob, amplified: magnification multiplies hand
  // movement, and hiding that would make the zoom feel weightless.
  const cx = vp.width / 2 + fx.bobX * 2.6 + fx.shakeX * 1.5;
  const cy = vp.height / 2 + fx.bobY * 1.8 + fx.shakeY * 1.5;

  const full = Math.min(vp.width, vp.height) * 0.44;
  // Opens from wide to final aperture, so the mask appears to close in.
  const r = full * (2.1 - 1.1 * ads);
  const ring = Math.max(2, full * 0.035);

  ctx.save();

  // ---- Mask: everything outside the aperture ----
  ctx.globalAlpha = ads;
  ctx.fillStyle = '#04050a';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(vp.width, 0);
  ctx.lineTo(vp.width, vp.height);
  ctx.lineTo(0, vp.height);
  ctx.closePath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill('evenodd');

  // ---- Lens: inner vignette and a cold tint ----
  const lens = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
  lens.addColorStop(0, 'rgba(10,20,30,0)');
  lens.addColorStop(1, `rgba(4,8,14,${0.85 * ads})`);
  ctx.fillStyle = lens;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // ---- Housing rings ----
  ctx.globalAlpha = ads;
  ctx.strokeStyle = '#0a0c12';
  ctx.lineWidth = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, r + ring / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,170,200,0.28)';
  ctx.lineWidth = Math.max(1, ring * 0.22);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // ---- Reticle ----
  // Held back until the aperture is nearly settled: a reticle drawn at
  // half zoom sits at the wrong scale and reads as a glitch.
  const rt = Math.max(0, (ads - 0.45) / 0.55);
  if (rt > 0) {
    ctx.globalAlpha = rt;
    ctx.strokeStyle = ready ? 'rgba(160,255,190,0.85)' : 'rgba(255,150,110,0.9)';
    ctx.lineWidth = Math.max(1, full * 0.008);

    const gap = r * 0.09;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Mil-dot ticks down the lower vertical — the range ladder that
    // makes the sight read as an optic rather than a plain cross.
    ctx.lineWidth = Math.max(1, full * 0.006);
    ctx.beginPath();
    for (let i = 1; i <= 4; i++) {
      const ty = cy + (r * i) / 5;
      const w = r * 0.035;
      ctx.moveTo(cx - w, ty);
      ctx.lineTo(cx + w, ty);
    }
    ctx.stroke();

    // Centre dot only when the rifle can actually fire.
    if (ready) {
      ctx.fillStyle = 'rgba(160,255,190,0.95)';
      const d = Math.max(1.5, full * 0.012);
      ctx.fillRect(cx - d / 2, cy - d / 2, d, d);
    } else {
      // Bolt-cycle progress as an arc around the aperture, so the
      // reload is readable without leaving the sight picture.
      ctx.globalAlpha = rt * 0.9;
      ctx.strokeStyle = 'rgba(255,150,110,0.9)';
      ctx.lineWidth = Math.max(2, ring * 0.4);
      ctx.beginPath();
      ctx.arc(
        cx,
        cy,
        r * 0.88,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * progress,
      );
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Arc at the screen edge pointing at whoever just shot the viewer. */
export function renderHitDirection(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  viewAngle: number,
): void {
  if (fx.incoming <= 0.01) return;

  const cx = vp.width / 2;
  const cy = vp.height / 2;
  // Screen-relative bearing: 0 is dead ahead, positive is to the right.
  const rel = angleDelta(viewAngle, fx.incomingAngle);
  const radius = Math.min(vp.width, vp.height) * 0.34;
  const a = fx.incoming;

  ctx.save();
  ctx.translate(cx, cy);
  // Canvas screen space puts +Y down, and the arc is anchored to the
  // top of the screen, so the bearing rotates straight through.
  ctx.rotate(rel);
  ctx.globalAlpha = a * 0.85;
  ctx.strokeStyle = '#ff4d4d';
  ctx.lineWidth = Math.max(3, radius * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, radius, -Math.PI / 2 - 0.28, -Math.PI / 2 + 0.28);
  ctx.stroke();

  ctx.globalAlpha = a * 0.5;
  ctx.lineWidth = Math.max(1, radius * 0.02);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.1, -Math.PI / 2 - 0.16, -Math.PI / 2 + 0.16);
  ctx.stroke();
  ctx.restore();
}

/** Red vignette when the viewer is hit, and a wash while dead. */
export function renderDamageOverlay(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
): void {
  if (fx.damageFlash <= 0) return;
  const a = fx.damageFlash;
  const g = ctx.createRadialGradient(
    vp.width / 2,
    vp.height / 2,
    Math.min(vp.width, vp.height) * 0.22,
    vp.width / 2,
    vp.height / 2,
    Math.max(vp.width, vp.height) * 0.62,
  );
  g.addColorStop(0, 'rgba(150,10,10,0)');
  g.addColorStop(1, `rgba(150,10,10,${0.75 * a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, vp.width, vp.height);
}

// ----------------------------------------------------------------
// Minimap
// ----------------------------------------------------------------

let minimapCache: HTMLCanvasElement | null = null;

/** Walls never change, so the static layer is rasterized once. */
function minimapBackground(size: number): HTMLCanvasElement {
  if (minimapCache && minimapCache.width === size) return minimapCache;

  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const sx = size / (MAP_W * TILE);
  const sy = size / (MAP_H * TILE);

  ctx.fillStyle = 'rgba(8,9,14,0.82)';
  ctx.fillRect(0, 0, size, size);

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const t = MAP_DATA[ty]![tx]!;
      if (t === T_FLOOR) continue;
      ctx.fillStyle = t === T_WALL ? '#4a4c58' : '#7a5a2a';
      ctx.fillRect(
        tx * TILE * sx,
        ty * TILE * sy,
        Math.max(1, TILE * sx),
        Math.max(1, TILE * sy),
      );
    }
  }
  minimapCache = c;
  return c;
}

/** Where a shot was heard from, and when. */
export interface ShotPing {
  x: number;
  y: number;
  /** Timestamp (ms) of the shot. */
  at: number;
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  player: Entity,
  entities: readonly Entity[],
  powerups: readonly PowerUp[],
  pings: ReadonlyMap<number, ShotPing>,
  nowMs: number,
): void {
  const size = Math.round(Math.min(180, Math.max(110, vp.width * 0.16)));
  const pad = 14;
  const mx = vp.width - size - pad;
  const my = pad;
  const sx = size / (MAP_W * TILE);
  const sy = size / (MAP_H * TILE);

  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.drawImage(minimapBackground(size), mx, my, size, size);

  for (const pu of powerups) {
    if (!pu.active) continue;
    ctx.fillStyle = PU_COLOR[pu.kind];
    ctx.fillRect(mx + pu.x * sx - 1.5, my + pu.y * sy - 1.5, 3, 3);
  }

  // Gunshots: a fading ring at the spot the shot came from. Drawn
  // under the live contacts, so a visible enemy always wins.
  for (const [, ping] of pings) {
    const age = nowMs - ping.at;
    if (age < 0 || age > MINIMAP_PING_MS) continue;
    const t = 1 - age / MINIMAP_PING_MS;
    ctx.save();
    ctx.globalAlpha = t * 0.85;
    ctx.strokeStyle = '#ff8a5c';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    // Expands as it fades: reads as a sound, not as a position.
    ctx.arc(mx + ping.x * sx, my + ping.y * sy, 2 + (1 - t) * 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Live contacts: only opponents the player actually has a line to.
  // Anything else would be knowledge the player has no way to have.
  for (const e of entities) {
    if (e.id === player.id || !e.alive) continue;
    if (!hasLOS(player.x, player.y, e.x, e.y)) continue;
    ctx.fillStyle = skinOf(e.skin).body;
    ctx.beginPath();
    ctx.arc(mx + e.x * sx, my + e.y * sy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Viewer: facing cone plus arrow.
  ctx.save();
  ctx.translate(mx + player.x * sx, my + player.y * sy);
  ctx.rotate(player.angle);
  const skin = skinOf(player.skin);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = skin.body;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(20, -9);
  ctx.lineTo(20, 9);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = skin.trim;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-4, -3.6);
  ctx.lineTo(-4, 3.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(140,160,200,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + 0.5, my + 0.5, size - 1, size - 1);
  ctx.restore();
}

// ----------------------------------------------------------------

export function renderKillFeed(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  feed: readonly KillFeedEntry[],
  nowMs: number,
): void {
  const x = vp.width - 14;
  let y = Math.round(Math.min(180, Math.max(110, vp.width * 0.16))) + 30;

  ctx.save();
  ctx.font = '600 12px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (const entry of feed) {
    const age = nowMs - entry.at;
    if (age > FEED_LIFETIME) continue;
    // Hold at full opacity, then fade over the last second.
    const alpha = Math.min(1, (FEED_LIFETIME - age) / 900);

    const killer = entry.killer;
    const victim = entry.victim;
    const sep = '  ⌖  ';

    const wV = ctx.measureText(victim).width;
    const wS = ctx.measureText(sep).width;
    const wK = ctx.measureText(killer).width;
    const total = wV + wS + wK;

    ctx.globalAlpha = alpha * (entry.mine ? 0.72 : 0.55);
    ctx.fillStyle = entry.mine ? '#132033' : '#05060a';
    ctx.fillRect(x - total - 10, y - 10, total + 14, 20);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#8a8f9e';
    ctx.fillText(victim, x, y);
    ctx.fillStyle = '#5e6474';
    ctx.fillText(sep, x - wV, y);
    ctx.fillStyle = skinOf(entry.killerSkin).trim;
    ctx.fillText(killer, x - wV - wS, y);

    y += 24;
  }
  ctx.restore();
}

/** Centre-screen respawn notice.
 *
 *  `info` names the killer and points at where the shot came from.
 *  In a one-shot-kill game that is the only chance the player gets to
 *  learn anything from dying. */
export function renderDeathNotice(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  player: Entity,
  info: DeathInfo | null = null,
  viewAngle = 0,
): void {
  const cx = vp.width / 2;
  const cy = vp.height / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(70,6,6,0.34)';
  ctx.fillRect(0, 0, vp.width, vp.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff6b6b';
  ctx.font = '700 30px ui-monospace, monospace';
  ctx.fillText('ELIMINATO', cx, cy - 34);

  if (info) {
    ctx.font = '600 15px ui-monospace, monospace';
    ctx.fillStyle = skinOf(info.killerSkin).trim;
    ctx.fillText(`da ${info.killer}`, cx, cy - 4);

    // Arrow at the bearing of the killer, relative to where the corpse
    // is still facing.
    const rel = angleDelta(viewAngle, info.fromAngle);
    const rad = Math.min(vp.width, vp.height) * 0.2;
    ctx.save();
    ctx.translate(cx, cy - 4);
    ctx.rotate(rel);
    ctx.fillStyle = '#ff6b6b';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -rad - 14);
    ctx.lineTo(-9, -rad + 4);
    ctx.lineTo(9, -rad + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = '#ffb3b3';
  ctx.font = '400 14px ui-monospace, monospace';
  ctx.fillText(
    `rientro tra ${(player.respawnTimer / 1000).toFixed(1)}s`,
    cx,
    cy + 26,
  );
  ctx.restore();
}

/** Multi-kill and streak callouts. One at a time, centre screen,
 *  above the crosshair so it never covers what you are aiming at. */
export function renderBanner(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  banner: Banner,
  nowMs: number,
): void {
  const age = nowMs - banner.at;
  if (age < 0 || age > BANNER_LIFETIME) return;

  // Punch in over the first 140 ms, hold, then fade out.
  const rise = Math.min(1, age / 140);
  const fade = Math.min(1, (BANNER_LIFETIME - age) / 450);
  const scale = 0.82 + rise * 0.18;
  const cx = vp.width / 2;
  const cy = vp.height * 0.26;

  ctx.save();
  ctx.globalAlpha = Math.min(rise, fade);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  ctx.font = '700 30px ui-monospace, monospace';
  const w = ctx.measureText(banner.text).width;
  ctx.fillStyle = 'rgba(5,7,12,0.55)';
  ctx.fillRect(-w / 2 - 18, -26, w + 36, 52);

  ctx.fillStyle = banner.color;
  ctx.fillText(banner.text, 0, -6);
  if (banner.sub) {
    ctx.font = '500 12px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(230,233,242,0.8)';
    ctx.fillText(banner.sub, 0, 16);
  }
  ctx.restore();
}

/** Pre-match countdown. The world is frozen while this is on screen. */
export function renderCountdown(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  msLeft: number,
): void {
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const span = Math.min(vp.width, vp.height);

  // The tail of the countdown is the "GO", not a fourth number.
  const rem = msLeft - COUNTDOWN_GO_MS;
  const go = rem <= 0;
  const secs = Math.ceil(rem / 1000);
  // 0 at the start of each digit's second, 1 at its end.
  const t = go ? 1 + rem / COUNTDOWN_GO_MS : 1 - (rem % 1000) / 1000;

  ctx.save();
  ctx.fillStyle = 'rgba(4,6,12,0.55)';
  ctx.fillRect(0, 0, vp.width, vp.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(cx, cy);

  if (go) {
    // Swells and fades as it clears the screen.
    ctx.globalAlpha = Math.max(0, t);
    ctx.scale(1 + (1 - t) * 0.35, 1 + (1 - t) * 0.35);
    ctx.fillStyle = '#7dfc9a';
    ctx.font = `700 ${Math.round(span * 0.15)}px ui-monospace, monospace`;
    ctx.fillText('VIA!', 0, 0);
  } else {
    // Each digit lands large and settles.
    ctx.save();
    ctx.scale(1.3 - t * 0.3, 1.3 - t * 0.3);
    ctx.fillStyle = '#e6e9f2';
    ctx.font = `700 ${Math.round(span * 0.2)}px ui-monospace, monospace`;
    ctx.fillText(String(secs), 0, 0);
    ctx.restore();

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#858da3';
    ctx.font = '500 13px ui-monospace, monospace';
    ctx.fillText('PREPARATI', 0, span * 0.16);
  }
  ctx.restore();
}
