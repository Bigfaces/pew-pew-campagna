// ================================================================
// CAMERA — viewport geometry, projection, and screen feel
// ================================================================
// The prototype hard-coded a 672x668 canvas, so the game letterboxed
// on every display that wasn't that exact size and looked soft on
// HiDPI screens. The viewport is now derived from the actual element
// size and device pixel ratio, and every projection constant follows
// from it.
// ================================================================

import { MAX_PITCH, TILE } from '../sim/constants';

/** Vertical field of view is the fixed quantity; the horizontal one
 *  is derived from the aspect ratio ("Hor+"). A wider window reveals
 *  more of the world to the sides rather than stretching what is
 *  already on screen. */
const FOV_V = (Math.PI / 3) * 0.92;

/** Width of one rendered wall column, in logical pixels. Two gives
 *  the chunky retro look while halving the number of rays. */
export const SLICE_W = 2;

/** Eye height above the floor, in world units. Half a tile puts the
 *  horizon exactly at the vertical midpoint of a wall. */
export const EYE_HEIGHT = TILE / 2;

export interface Viewport {
  /** Logical (CSS) pixel size — all drawing uses these units. */
  width: number;
  height: number;
  dpr: number;
  /** Distance from the eye to the projection plane. */
  projDist: number;
  halfFovH: number;
  tanHalfFovH: number;
  numRays: number;
}

/** `zoom` is the scope magnification (1 = hip fire). It multiplies the
 *  projection distance, which narrows both fields of view by the same
 *  factor — the correct way to zoom a raycaster, because every other
 *  projection quantity is already derived from projDist and follows for
 *  free. The ray *count* is untouched, so the depth buffer keeps its
 *  size and scoping costs nothing extra to render. */
export function computeViewport(
  width: number,
  height: number,
  dpr: number,
  zoom = 1,
): Viewport {
  const projDist = (height / 2 / Math.tan(FOV_V / 2)) * zoom;
  const halfFovH = Math.atan(width / 2 / projDist);
  return {
    width,
    height,
    dpr,
    projDist,
    halfFovH,
    tanHalfFovH: Math.tan(halfFovH),
    numRays: Math.ceil(width / SLICE_W),
  };
}

/** Transient, purely cosmetic camera offsets.
 *
 *  Kept strictly out of the simulation: shake and bob must never
 *  influence where a bullet goes, or two players watching the same
 *  authoritative state would disagree about what was hit. */
export class CameraFx {
  /** Vertical look, -1..1. */
  pitch = 0;
  private shakeAmount = 0;
  private shakeTime = 0;
  private bobPhase = 0;
  /** Current bob offsets in logical pixels. */
  bobX = 0;
  bobY = 0;
  shakeX = 0;
  shakeY = 0;
  /** 0..1 red flash when the viewer takes a hit. */
  damageFlash = 0;
  /** 0..1 white flash when the viewer lands a hit. */
  hitMarker = 0;
  /** World-space bearing from the viewer to whoever last shot at it,
   *  and the 0..1 life of that indicator. With one-shot kills, "where
   *  did that come from" is otherwise unanswerable. */
  incomingAngle = 0;
  incoming = 0;

  addPitch(delta: number): void {
    this.pitch = Math.max(-1, Math.min(1, this.pitch + delta));
  }

  shake(amount: number): void {
    // Take the strongest concurrent source rather than summing, so a
    // burst of events can't stack into an unreadable screen.
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = 1;
  }

  flashDamage(): void {
    this.damageFlash = 1;
  }

  markHit(): void {
    this.hitMarker = 1;
  }

  /** Record where incoming fire came from, in world-space radians. */
  markIncoming(angle: number): void {
    this.incomingAngle = angle;
    this.incoming = 1;
  }

  update(dtMs: number, moving: boolean, speed01: number): void {
    const dt = dtMs / 1000;

    // Head bob — amplitude follows actual movement speed.
    if (moving) {
      this.bobPhase += dt * 9 * (0.6 + speed01 * 0.6);
      const amp = 2.6 * speed01;
      this.bobX = Math.cos(this.bobPhase) * amp;
      // Vertical bob runs at double rate: one dip per footfall.
      this.bobY = Math.abs(Math.sin(this.bobPhase)) * amp * 0.9;
    } else {
      // Idle sway, much slower and smaller, so the view is never
      // perfectly static.
      this.bobPhase += dt * 1.6;
      this.bobX += (Math.cos(this.bobPhase) * 0.7 - this.bobX) * 0.08;
      this.bobY += (Math.sin(this.bobPhase) * 0.5 - this.bobY) * 0.08;
    }

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt * 5);
      // Decays quadratically — a sharp initial jolt that settles fast.
      const mag = this.shakeAmount * this.shakeTime * this.shakeTime;
      this.shakeX = (Math.random() - 0.5) * 2 * mag;
      this.shakeY = (Math.random() - 0.5) * 2 * mag;
      if (this.shakeTime === 0) this.shakeAmount = 0;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }

    if (this.damageFlash > 0) {
      this.damageFlash = Math.max(0, this.damageFlash - dt * 1.7);
    }
    if (this.hitMarker > 0) {
      this.hitMarker = Math.max(0, this.hitMarker - dt * 3.2);
    }
    // Lingers longer than the other flashes: it is information to act
    // on, not just feedback that something happened.
    if (this.incoming > 0) {
      this.incoming = Math.max(0, this.incoming - dt * 0.55);
    }
  }

  reset(): void {
    this.pitch = 0;
    this.shakeAmount = 0;
    this.shakeTime = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.bobX = 0;
    this.bobY = 0;
    this.damageFlash = 0;
    this.hitMarker = 0;
    this.incoming = 0;
    this.incomingAngle = 0;
  }
}

/** Screen-space Y of the horizon, including pitch, bob and shake.
 *
 *  Pitch is faked by sliding the horizon rather than rotating the
 *  camera — the only option in a column-based raycaster — which is
 *  why MAX_PITCH keeps it well short of straight up or down. */
export function horizonY(vp: Viewport, fx: CameraFx): number {
  return (
    vp.height / 2 +
    fx.pitch * MAX_PITCH * vp.height +
    fx.bobY +
    fx.shakeY
  );
}

/** Signed shortest angle from `from` to `to`, in (-PI, PI]. */
function wrapAngle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface Projected {
  /** Horizontal screen position, logical px. */
  screenX: number;
  /** Perpendicular distance to the projection plane. */
  perp: number;
  /** Screen Y of the point where this position meets the floor. */
  floorY: number;
  /** Screen height of one full tile at this depth. */
  tileH: number;
  /** False when the point is behind the camera or outside the FOV. */
  visible: boolean;
}

/** Project a world position onto the screen.
 *
 *  Shared by every billboard — entities, pickups and particles — so
 *  they are all grounded consistently against the walls. */
export function projectPoint(
  vp: Viewport,
  fx: CameraFx,
  camX: number,
  camY: number,
  camAngle: number,
  x: number,
  y: number,
  margin = 0.35,
  /** Mezza larghezza dello sprite in unità di mondo, se chi disegna la
   *  conosce. Serve solo a dare un pavimento a `perp`: un oggetto il
   *  cui centro è più vicino dell'oggetto stesso è un oggetto dentro
   *  cui stai, e un billboard non sa disegnarlo — senza pavimento
   *  tileH tende all'infinito e riempie il fotogramma di tinta piatta.
   *  Con il pavimento lo sprite si ferma alla taglia che avrebbe con la
   *  propria superficie appoggiata all'occhio, che è il massimo che
   *  possa voler dire qualcosa. */
  semiWorld = 0,
): Projected {
  const dx = x - camX;
  const dy = y - camY;
  const dist = Math.hypot(dx, dy);
  const rel = wrapAngle(Math.atan2(dy, dx) - camAngle);

  // Un quarto di giro è il limite fisico, non una preferenza: a 90
  // gradi esatti il punto giace SUL piano di proiezione, oltre ci sta
  // dietro. Lì cos(rel) è nullo o negativo, `perp` smette di
  // significare una distanza, e tileH = TILE/perp*projDist esplode:
  // misurati 3e8 pixel per un nucleo a sei tile, cioè un rettangolo di
  // tinta piatta su tutto il fotogramma. Il margine serve a non far
  // sparire di scatto uno sprite che tocca ancora il bordo — è una
  // tolleranza, e nessuna tolleranza può spostare dove sta il piano.
  if (Math.abs(rel) >= Math.PI / 2) {
    return { screenX: 0, perp: 1, floorY: 0, tileH: 0, visible: false };
  }
  if (Math.abs(rel) > vp.halfFovH + margin) {
    return { screenX: 0, perp: 1, floorY: 0, tileH: 0, visible: false };
  }

  const perp = Math.max(0.0001, semiWorld, dist * Math.cos(rel));
  const screenX =
    vp.width / 2 + (Math.tan(rel) / vp.tanHalfFovH) * (vp.width / 2) + fx.shakeX + fx.bobX;
  const tileH = (TILE / perp) * vp.projDist;
  const floorY = horizonY(vp, fx) + (EYE_HEIGHT / perp) * vp.projDist;

  return { screenX, perp, floorY, tileH, visible: true };
}

/** Screen Y of a point `z` world units above the floor at `perp`. */
export function heightToScreenY(
  vp: Viewport,
  fx: CameraFx,
  perp: number,
  z: number,
): number {
  return horizonY(vp, fx) + ((EYE_HEIGHT - z) / perp) * vp.projDist;
}
