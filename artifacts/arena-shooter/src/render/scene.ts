// ================================================================
// SCENE RENDERING — walls, billboards, particles
// ================================================================

import { GLINT_CONE, MAP_H, MAP_W, TILE } from '../sim/constants';
import { angleDelta, castRay } from '../sim/raycast';
import type { Entity, PowerUp } from '../sim/types';
import {
  EYE_HEIGHT,
  SLICE_W,
  heightToScreenY,
  horizonY,
  projectPoint,
  type CameraFx,
  type Viewport,
} from './camera';
import { PU_COLOR, shade, skinOf } from './palette';
import type { Particle } from './particles';
import { getTextures, shadedTile, TEX_SIZE } from './textures';

/** Distance at which the fog reaches full strength. */
const FOG_DIST = TILE * 22;
const MAX_RENDER_DIST = Math.hypot(MAP_W, MAP_H) * TILE;

export interface CameraView {
  x: number;
  y: number;
  angle: number;
}

/** Ceiling and floor, drawn as two stretched gradient strips. */
export function renderBackdrop(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
): void {
  const tex = getTextures();
  const hy = horizonY(vp, fx);

  ctx.fillStyle = '#0b0c14';
  ctx.fillRect(0, 0, vp.width, vp.height);

  // The horizon moves with pitch, so the strips are drawn to fill
  // whatever space is above and below it rather than fixed halves.
  if (tex.sky && hy > 0) {
    ctx.drawImage(tex.sky, 0, 0, 1, tex.sky.height, 0, 0, vp.width, hy);
  }
  if (tex.ground && hy < vp.height) {
    ctx.drawImage(
      tex.ground,
      0,
      0,
      1,
      tex.ground.height,
      0,
      hy,
      vp.width,
      vp.height - hy,
    );
  }
}

/** Cast one ray per column and draw a textured vertical strip.
 *
 *  Writes perpendicular distances into `depth`, which the billboard
 *  pass reads to occlude sprites behind walls. The buffer is owned by
 *  the caller and reused every frame — the prototype allocated a
 *  fresh Float32Array per frame, i.e. 60 allocations a second of
 *  garbage for a buffer whose size never changes. */
export function renderWalls(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  depth: Float32Array,
): void {
  const tex = getTextures();
  const hy = horizonY(vp, fx);
  const shakeX = fx.shakeX + fx.bobX;

  for (let i = 0; i < vp.numRays; i++) {
    // Map the column to a point on the projection plane, then take
    // the angle to it. Using the plane (rather than an even angular
    // sweep) is what keeps straight walls straight.
    const cameraX = (2 * (i + 0.5)) / vp.numRays - 1;
    const rayAngle = cam.angle + Math.atan(cameraX * vp.tanHalfFovH);

    const hit = castRay(cam.x, cam.y, rayAngle, MAX_RENDER_DIST);
    // Perpendicular distance removes the fisheye that raw radial
    // distance would produce.
    const perp = Math.max(0.0001, hit.dist * Math.cos(rayAngle - cam.angle));
    depth[i] = perp;

    const wallH = (TILE / perp) * vp.projDist;
    const top = hy - (TILE - EYE_HEIGHT) / perp * vp.projDist;

    // Fog plus a fixed penalty on north/south faces: the cheap
    // directional-lighting trick that gives corners definition.
    let darkness = Math.min(1, perp / FOG_DIST);
    if (hit.side === 'y') darkness = Math.min(1, darkness + 0.16);

    const slice = shadedTile(tex, hit.tile, darkness);
    const sx = Math.min(TEX_SIZE - 1, Math.floor(hit.wallX * TEX_SIZE));

    ctx.drawImage(
      slice,
      sx,
      0,
      1,
      TEX_SIZE,
      i * SLICE_W + shakeX,
      top,
      SLICE_W + 1, // +1 avoids seams from fractional positions
      wallH,
    );
  }
}

// ----------------------------------------------------------------
// Billboards
// ----------------------------------------------------------------

interface Billboard {
  dist: number;
  draw: () => void;
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  e: Entity,
  screenX: number,
  perp: number,
  floorY: number,
  tileH: number,
  nowMs: number,
  glint: boolean,
): void {
  const skin = skinOf(e.skin);
  const k = 1 - Math.min(1, perp / FOG_DIST) * 0.82;

  if (!e.alive) {
    const w = tileH * 1.1;
    const h = tileH * 0.26;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = shade(skin.body, k * 0.6);
    ctx.fillRect(screenX - w / 2, floorY - h, w, h);
    ctx.restore();
    return;
  }

  const charH = tileH * 1.6;
  const bodyW = charH * 0.32;
  const headSize = charH * 0.23;
  const topY = floorY - charH;

  // Contact shadow — without it figures appear to hover.
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(screenX, floorY - 1, bodyW * 0.72, bodyW * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const body = shade(skin.body, k);
  const trim = shade(skin.trim, k);

  // Legs, with a subtle stride so movement is readable at distance.
  const stride = Math.sin(nowMs * 0.012 + e.id) * charH * 0.05;
  ctx.fillStyle = shade(skin.body, k * 0.78);
  ctx.fillRect(screenX - bodyW / 2, floorY - charH * 0.4, bodyW * 0.42, charH * 0.4 + stride);
  ctx.fillRect(screenX + bodyW * 0.08, floorY - charH * 0.4, bodyW * 0.42, charH * 0.4 - stride);

  // Torso.
  ctx.fillStyle = body;
  ctx.fillRect(screenX - bodyW / 2, floorY - charH * 0.76, bodyW, charH * 0.38);
  ctx.fillStyle = trim;
  ctx.fillRect(screenX - bodyW / 2, floorY - charH * 0.76, bodyW, charH * 0.07);

  // Head and helmet.
  ctx.fillStyle = trim;
  ctx.fillRect(screenX - headSize / 2, topY, headSize, headSize);
  ctx.fillStyle = body;
  ctx.fillRect(screenX - headSize / 2, topY, headSize, headSize * 0.32);

  // Rifle, held across the body toward the viewer.
  ctx.fillStyle = shade('#2a2a30', k);
  ctx.fillRect(screenX - bodyW * 0.1, floorY - charH * 0.6, bodyW * 0.95, charH * 0.06);

  // Scope glint: this one is pointed at you with a round chambered.
  // Drawn at full brightness regardless of distance — it is a warning,
  // and a warning that fades into the fog is no warning at all.
  if (glint) {
    const gx = screenX + bodyW * 0.6;
    const gy = floorY - charH * 0.63;
    // Pulses so it reads as a highlight catching the light rather than
    // as another static part of the sprite.
    const pulse = 0.62 + Math.sin(nowMs * 0.011) * 0.38;
    const r = Math.max(2.2, tileH * 0.1);

    ctx.save();
    ctx.globalAlpha = 0.4 * pulse;
    ctx.fillStyle = '#bfefff';
    ctx.beginPath();
    ctx.arc(gx, gy, r * 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(gx, gy, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Active power-up rings.
  const ringY = floorY - charH * 0.5;
  if (e.shieldActive) {
    ctx.save();
    ctx.strokeStyle = '#44ccff';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = Math.max(1, tileH * 0.03);
    ctx.beginPath();
    ctx.ellipse(screenX, ringY, bodyW * 0.9, charH * 0.52, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (e.rapidFireTimer > 0) {
    ctx.save();
    ctx.strokeStyle = '#ff7722';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, tileH * 0.022);
    ctx.setLineDash([tileH * 0.06, tileH * 0.06]);
    ctx.beginPath();
    ctx.ellipse(screenX, ringY, bodyW * 0.74, charH * 0.44, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (e.speedBoostTimer > 0) {
    ctx.save();
    ctx.strokeStyle = '#ffe022';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, tileH * 0.022);
    ctx.setLineDash([tileH * 0.04, tileH * 0.1]);
    ctx.beginPath();
    ctx.ellipse(screenX, ringY, bodyW, charH * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Name tag, fading out with distance.
  if (perp < TILE * 12) {
    const alpha = Math.max(0.2, 1 - perp / (TILE * 12));
    const fontPx = Math.max(9, Math.round(headSize * 0.62));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${fontPx}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const label = e.name;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(screenX - tw / 2 - 3, topY - fontPx - 6, tw + 6, fontPx + 4);
    ctx.fillStyle = skin.trim;
    ctx.fillText(label, screenX, topY - 7);
    ctx.restore();
  }
}

function drawPowerUp(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  pu: PowerUp,
  screenX: number,
  perp: number,
  tileH: number,
  nowMs: number,
): void {
  const bobZ = TILE * 0.34 + Math.sin(nowMs * 0.003 + pu.phase) * TILE * 0.09;
  const cy = heightToScreenY(vp, fx, perp, bobZ);
  const size = tileH * 0.42;
  const color = PU_COLOR[pu.kind];

  ctx.save();
  // Glow halo.
  ctx.globalAlpha = 0.24 + Math.sin(nowMs * 0.004 + pu.phase) * 0.1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(screenX, cy, size * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Rotating diamond body — reads as a pickup at any distance.
  ctx.save();
  ctx.translate(screenX, cy);
  ctx.rotate(nowMs * 0.0016 + pu.phase);
  ctx.fillStyle = '#0d0f18';
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, size * 0.11);
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();

  // Static glyph on top, so it stays legible while the box spins.
  ctx.save();
  ctx.fillStyle = color;
  const s = size * 0.24;
  if (pu.kind === 'speed') {
    ctx.beginPath();
    ctx.moveTo(screenX + s * 0.5, cy - s);
    ctx.lineTo(screenX - s * 0.6, cy + s * 0.15);
    ctx.lineTo(screenX - s * 0.05, cy + s * 0.15);
    ctx.lineTo(screenX - s * 0.5, cy + s);
    ctx.lineTo(screenX + s * 0.7, cy - s * 0.2);
    ctx.lineTo(screenX + s * 0.1, cy - s * 0.2);
    ctx.closePath();
    ctx.fill();
  } else if (pu.kind === 'rapidfire') {
    ctx.fillRect(screenX - s, cy - s * 0.75, s * 2, s * 0.4);
    ctx.fillRect(screenX - s, cy - s * 0.1, s * 1.5, s * 0.4);
    ctx.fillRect(screenX - s, cy + s * 0.55, s * 2, s * 0.4);
  } else {
    ctx.beginPath();
    ctx.moveTo(screenX, cy - s);
    ctx.lineTo(screenX + s * 0.85, cy - s * 0.35);
    ctx.lineTo(screenX + s * 0.5, cy + s);
    ctx.lineTo(screenX - s * 0.5, cy + s);
    ctx.lineTo(screenX - s * 0.85, cy - s * 0.35);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Project and draw everything that isn't a wall, far to near.
 *
 *  Occlusion is a depth-buffer test at the sprite's centre column.
 *  Exact per-column clipping would be more correct, but at this
 *  sprite scale the difference is invisible and the cost is not. */
export function renderBillboards(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  viewerId: number,
  entities: readonly Entity[],
  powerups: readonly PowerUp[],
  particles: readonly Particle[],
  depth: Float32Array,
  nowMs: number,
): void {
  const list: Billboard[] = [];

  const occluded = (screenX: number, perp: number): boolean => {
    const col = Math.round((screenX - fx.shakeX - fx.bobX) / SLICE_W);
    if (col < 0 || col >= vp.numRays) return true;
    return depth[col]! < perp - 2;
  };

  for (const e of entities) {
    if (e.id === viewerId) continue;
    const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, e.x, e.y);
    if (!p.visible || occluded(p.screenX, p.perp)) continue;
    // Aimed at the viewer, with the bolt closed. Both halves matter:
    // aimed alone would light up half the arena, ready alone says
    // nothing about who is in danger.
    const glint =
      e.alive &&
      e.weaponCooldown <= 0 &&
      Math.abs(
        angleDelta(e.angle, Math.atan2(cam.y - e.y, cam.x - e.x)),
      ) < GLINT_CONE;
    list.push({
      dist: p.perp,
      draw: () =>
        drawEntity(
          ctx, vp, fx, e, p.screenX, p.perp, p.floorY, p.tileH, nowMs, glint,
        ),
    });
  }

  for (const pu of powerups) {
    if (!pu.active) continue;
    const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, pu.x, pu.y);
    if (!p.visible || occluded(p.screenX, p.perp)) continue;
    list.push({
      dist: p.perp,
      draw: () => drawPowerUp(ctx, vp, fx, pu, p.screenX, p.perp, p.tileH, nowMs),
    });
  }

  for (const pt of particles) {
    if (!pt.active) continue;
    const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, pt.x, pt.y, 0.1);
    if (!p.visible || occluded(p.screenX, p.perp)) continue;
    const y = heightToScreenY(vp, fx, p.perp, pt.z);
    const size = Math.max(1, (pt.size / p.perp) * vp.projDist * 0.05);
    const t = pt.life / pt.maxLife;
    list.push({
      dist: p.perp,
      draw: () => {
        ctx.save();
        ctx.globalAlpha = Math.min(1, t * 1.4);
        if (pt.glow) {
          // Hot particles wash toward white as they burn out.
          const w = 1 - t;
          ctx.fillStyle = `rgb(${Math.round(pt.r + (255 - pt.r) * w)},${Math.round(
            pt.g + (255 - pt.g) * w,
          )},${Math.round(pt.b + (255 - pt.b) * w)})`;
        } else {
          ctx.fillStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
        }
        ctx.fillRect(p.screenX - size / 2, y - size / 2, size, size);
        ctx.restore();
      },
    });
  }

  list.sort((a, b) => b.dist - a.dist);
  for (const b of list) b.draw();
}
