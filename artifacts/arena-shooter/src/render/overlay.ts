// ================================================================
// OVERLAY — mirino telescopico, vignette danno, banner
// ================================================================
// Screen-space only: nothing here is projected into the world.
//
// Un tempo questo file copriva anche viewmodel, crosshair a schermo
// intero, minimappa e kill-feed dell'Arena: quelle funzioni non erano
// più chiamate da nessuna modalità (la campagna disegna la propria
// minimappa in render/campaignScene.ts e il proprio mirino in
// game/campaignGame.ts) e sono state tolte in questo secondo giro di
// potatura post-Arena. Vedi README.md e docs/GDD.md §19 per i dettagli.
// ================================================================

import type { CameraFx, Viewport } from './camera';

/** A centre-screen callout: multi-kill, streak, or the final seconds. */
export interface Banner {
  text: string;
  sub: string;
  /** Timestamp (ms) when it was raised. */
  at: number;
  color: string;
}

const BANNER_LIFETIME = 2100;

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
/** What the scope needs to draw its bolt-cycle arc. Deliberately not
 *  `Entity`: which cooldown applies — the bolt-action one, the
 *  rapid-fire pickup's, or a campaign node's shortened one — is a rule
 *  belonging to whoever is firing, not to the thing drawing a ring. */
export interface WeaponReadout {
  /** ms left before the weapon can fire again. */
  cooldownMs: number;
  /** ms the current cooldown counts down from — what the arc fills
   *  against. */
  maxCooldownMs: number;
}

export function renderScope(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  weapon: WeaponReadout,
  adsRaw: number,
): void {
  // `adsRaw` è CampaignGame.adsT, che a monte è già tenuto in
  // [0,1] (vedi il commento in updateFeel) — ma quella era l'unica
  // guardia, e un frameDt negativo (rAF con un ts anteriore a
  // performance.now(), osservato nel 30-40% dei casi subito dopo
  // closeLegend()/resume()) lo aveva fatto salire a ~4. Con
  // `full * (2.1 - 1.1 * ads)` un ads oltre ~1.9 rende `r` negativo, e
  // ogni arc()/createRadialGradient qui sotto lancia IndexSizeError —
  // un'eccezione che in `pnpm dev` copre lo schermo con l'overlay
  // d'errore di Vite. Si blinda anche qui, non solo alla fonte: due
  // guardie indipendenti sullo stesso valore, una in chi lo calcola e
  // una in chi lo consuma.
  const ads = Math.max(0, Math.min(1, adsRaw));
  if (ads <= 0.005) return;

  const ready = weapon.cooldownMs <= 0;
  const progress = ready ? 1 : 1 - weapon.cooldownMs / weapon.maxCooldownMs;

  // Scope sway is the bob, amplified: magnification multiplies hand
  // movement, and hiding that would make the zoom feel weightless.
  const cx = vp.width / 2 + fx.bobX * 2.6 + fx.shakeX * 1.5;
  const cy = vp.height / 2 + fx.bobY * 1.8 + fx.shakeY * 1.5;

  const full = Math.min(vp.width, vp.height) * 0.44;
  // Opens from wide to final aperture, so the mask appears to close in.
  // Con `ads` già in [0,1] questo non scende mai sotto `full`, ma il
  // pavimento resta: è la seconda guardia di cui parla il commento qui
  // sopra, quella che tiene fermo anche chi consuma `r` — arc() e
  // createRadialGradient() più sotto — indipendentemente da qualunque
  // ipotesi su `ads`.
  const r = Math.max(0, full * (2.1 - 1.1 * ads));
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
