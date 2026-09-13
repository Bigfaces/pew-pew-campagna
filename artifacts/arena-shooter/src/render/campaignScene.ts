// ================================================================
// CAMPAIGN SCENE RENDERING — walls, drone, boss, cores
// ================================================================
// Same wireframe/procedural-texture look as the Arena (GDD.md section
// 9: "gli sprite futuri... solo nemici/boss, muri restano wireframe"),
// reusing the Arena's own camera math and texture set — only the wall
// raycast is campaign-specific, since it walks a different map.
// ================================================================

import { TILE } from '../sim/constants';
import {
  BOSS_GRAZE_ARC_HALF,
  BOSS_REAR_ARC_HALF,
  DRONE_REACTION_MS,
} from '../sim/campaign/constants';
import { angleDelta } from '../sim/raycast';
import { campCastRay, type GetTileFn } from '../sim/campaign/raycast';
import type {
  BossPhase,
  BossState,
  CoreState,
  DroneState,
} from '../sim/campaign/types';
import {
  EYE_HEIGHT,
  SLICE_W,
  heightToScreenY,
  horizonY,
  projectPoint,
  type CameraFx,
  type Viewport,
} from './camera';
import { getTextures, shadedTile, TEX_SIZE } from './textures';
import type { CameraView } from './scene';

const CAMP_MAP_DIAGONAL_TILES = 25; // hypot(22,11), rounded up
const MAX_RENDER_DIST = CAMP_MAP_DIAGONAL_TILES * TILE;
const FOG_DIST = TILE * 14;

export function renderCampaignWalls(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  depth: Float32Array,
  getTile: GetTileFn,
  mapW: number,
  mapH: number,
): void {
  const tex = getTextures();
  const hy = horizonY(vp, fx);
  const shakeX = fx.shakeX + fx.bobX;

  for (let i = 0; i < vp.numRays; i++) {
    const cameraX = (2 * (i + 0.5)) / vp.numRays - 1;
    const rayAngle = cam.angle + Math.atan(cameraX * vp.tanHalfFovH);

    const hit = campCastRay(getTile, cam.x, cam.y, rayAngle, MAX_RENDER_DIST, mapW, mapH);
    const perp = Math.max(0.0001, hit.dist * Math.cos(rayAngle - cam.angle));
    depth[i] = perp;

    const wallH = (TILE / perp) * vp.projDist;
    const top = hy - ((TILE - EYE_HEIGHT) / perp) * vp.projDist;

    let darkness = Math.min(1, perp / FOG_DIST);
    if (hit.side === 'y') darkness = Math.min(1, darkness + 0.16);

    // Always the "stone" tile (1): the campaign map has no cover tiles,
    // and the sealed door renders identically to the wall around it —
    // it belongs, it does not announce itself.
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
      SLICE_W + 1,
      wallH,
    );
  }
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
  rotation: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.fillStyle = '#0d0f18';
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, size * 0.12);
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  cy: number,
  size: number,
  nowMs: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.26 + Math.sin(nowMs * 0.004) * 0.1;
  ctx.fillStyle = '#5eead4';
  ctx.beginPath();
  ctx.arc(screenX, cy, size * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawDiamond(ctx, screenX, cy, size, '#5eead4', nowMs * 0.0018);
}

function drawShield(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  cy: number,
  size: number,
  nowMs: number,
): void {
  // Blue, like the Arena's own shield pickup (render/palette.ts
  // PU_COLOR.shield) — a deliberate visual echo: same promise, one
  // hit of protection, even though the campaign's is a separate
  // pickup rather than that shared PowerUp type.
  ctx.save();
  ctx.globalAlpha = 0.3 + Math.sin(nowMs * 0.004) * 0.12;
  ctx.fillStyle = '#44ccff';
  ctx.beginPath();
  ctx.arc(screenX, cy, size * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawDiamond(ctx, screenX, cy, size, '#44ccff', nowMs * 0.0018);
}

function drawDrone(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  cy: number,
  size: number,
  drone: DroneState,
  nowMs: number,
): void {
  // Brightens and reddens as it locks on — the "linea di mira visibile
  // prima di sparare" the GDD calls for (drawn as a warning glow rather
  // than a literal beam, keeping the wireframe style).
  const droneReady =
    1 - Math.max(0, Math.min(1, drone.reactionTimer / DRONE_REACTION_MS));
  const pulse = 0.5 + Math.sin(nowMs * 0.02) * 0.5 * droneReady;

  ctx.save();
  ctx.globalAlpha = 0.3 + pulse * 0.4;
  ctx.fillStyle = '#ff3b3b';
  ctx.beginPath();
  ctx.arc(screenX, cy, size * (1.3 + pulse * 0.6), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawDiamond(
    ctx,
    screenX,
    cy,
    size,
    `rgb(255,${Math.round(60 + 100 * (1 - droneReady))},60)`,
    Math.PI / 4,
  );
}

const BOSS_PHASE_COLOR: Record<BossPhase, string> = {
  guard: '#8aa0c8',
  telegraph: '#ffb020',
  charge: '#ff3b3b',
  recover: '#c88a50',
  defeated: '#3d6b4a',
};

function drawBoss(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  floorY: number,
  tileH: number,
  cam: CameraView,
  boss: BossState,
  hasGraze: boolean,
  enraged: boolean,
  nowMs: number,
): void {
  const scale = boss.phase === 'charge' ? 1.12 : 1;
  const h = tileH * 1.7 * scale;
  const w = h * 0.62;
  const topY = floorY - h;

  // Contact shadow.
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(screenX, floorY - 1, w * 0.7, w * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = BOSS_PHASE_COLOR[boss.phase];
  ctx.fillRect(screenX - w / 2, topY, w, h);
  ctx.strokeStyle = '#0d0f18';
  ctx.lineWidth = Math.max(1.5, w * 0.05);
  ctx.strokeRect(screenX - w / 2, topY, w, h);

  // Whether the viewer is currently standing in front (shielded) or
  // behind (core exposed) the boss — the single most important piece
  // of feedback in this fight, so it is drawn regardless of phase.
  const angleToCam = Math.atan2(cam.y - boss.y, cam.x - boss.x);
  const frontDiff = Math.abs(angleDelta(boss.angle, angleToCam));
  const rearDiff = Math.PI - frontDiff;
  const solidExposed = rearDiff <= BOSS_REAR_ARC_HALF;
  // The wider graze arc only actually damages the boss once Danno di
  // Striscio is unlocked (see resolveBossHit in sim/campaign/world.ts)
  // — without it, standing there does nothing, so the telegraph must
  // not claim otherwise.
  const grazeExposed = hasGraze && rearDiff <= BOSS_GRAZE_ARC_HALF;
  const exposed = solidExposed || grazeExposed;
  const canDamageNow = boss.phase === 'charge' || boss.phase === 'recover';

  const patchW = w * 0.36;
  const patchH = h * 0.3;
  if (exposed && canDamageNow) {
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(nowMs * 0.012) * 0.25;
    ctx.fillStyle = solidExposed ? '#ff5050' : '#ffb37a';
    ctx.fillRect(screenX - patchW / 2, topY + h * 0.28, patchW, patchH);
    ctx.restore();
  } else if (frontDiff <= BOSS_REAR_ARC_HALF) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#dff0ff';
    ctx.fillRect(screenX - patchW / 2, topY + h * 0.28, patchW, patchH);
    ctx.restore();
  }

  // Seconda fase: un contorno che pulsa, così il cambio di ritmo si
  // vede prima di subirlo. Il colore della fase resta quello: questo
  // dice "è cambiata", non sostituisce "cosa sta facendo".
  if (enraged && boss.phase !== 'defeated') {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(nowMs * 0.009) * 0.35;
    ctx.strokeStyle = '#ff7a2f';
    ctx.lineWidth = Math.max(1.5, w * 0.07);
    ctx.strokeRect(screenX - w / 2 - w * 0.05, topY - h * 0.02, w * 1.1, h * 1.04);
    ctx.restore();
  }

  if (boss.phase === 'defeated') {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#7dfc9a';
    ctx.lineWidth = Math.max(1, w * 0.04);
    ctx.strokeRect(screenX - w / 2, topY, w, h);
    ctx.restore();
  }
}

interface CampaignBillboard {
  dist: number;
  draw: () => void;
}

/** Project and draw every non-wall entity, far to near — cores, the
 *  drone and the boss can all appear in the same shot in Magazzino, so
 *  they share one depth-sorted pass instead of three fixed-order ones
 *  that would let a farther entity paint over a nearer one. */
export function renderCampaignBillboards(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  depth: Float32Array,
  cores: readonly CoreState[],
  shieldAvailable: boolean,
  shieldX: number,
  shieldY: number,
  drone: DroneState,
  droneX: number,
  droneY: number,
  boss: BossState,
  hasGraze: boolean,
  enraged: boolean,
  nowMs: number,
): void {
  const list: CampaignBillboard[] = [];

  const occluded = (screenX: number, perp: number): boolean => {
    const col = Math.round((screenX - fx.shakeX - fx.bobX) / SLICE_W);
    if (col < 0 || col >= vp.numRays) return true;
    return depth[col]! < perp - 2;
  };

  for (const c of cores) {
    if (c.collected) continue;
    const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, c.x, c.y);
    if (!p.visible || occluded(p.screenX, p.perp)) continue;

    const bobZ = TILE * 0.4 + Math.sin(nowMs * 0.003 + c.x) * TILE * 0.08;
    const cy = heightToScreenY(vp, fx, p.perp, bobZ);
    const size = p.tileH * 0.36;
    list.push({ dist: p.perp, draw: () => drawCore(ctx, p.screenX, cy, size, nowMs) });
  }

  if (shieldAvailable) {
    const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, shieldX, shieldY);
    if (p.visible && !occluded(p.screenX, p.perp)) {
      const bobZ = TILE * 0.4 + Math.sin(nowMs * 0.003 + shieldX) * TILE * 0.08;
      const cy = heightToScreenY(vp, fx, p.perp, bobZ);
      const size = p.tileH * 0.36;
      list.push({ dist: p.perp, draw: () => drawShield(ctx, p.screenX, cy, size, nowMs) });
    }
  }

  if (drone.alive) {
    const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, droneX, droneY);
    if (p.visible && !occluded(p.screenX, p.perp)) {
      const cy = heightToScreenY(vp, fx, p.perp, TILE * 0.55);
      const size = p.tileH * 0.3;
      list.push({
        dist: p.perp,
        draw: () => drawDrone(ctx, p.screenX, cy, size, drone, nowMs),
      });
    }
  }

  {
    const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, boss.x, boss.y, 0.5);
    if (p.visible && !occluded(p.screenX, p.perp)) {
      const floorY = heightToScreenY(vp, fx, p.perp, 0);
      list.push({
        dist: p.perp,
        draw: () =>
          drawBoss(ctx, p.screenX, floorY, p.tileH, cam, boss, hasGraze, enraged, nowMs),
      });
    }
  }

  list.sort((a, b) => b.dist - a.dist);
  for (const b of list) b.draw();
}
