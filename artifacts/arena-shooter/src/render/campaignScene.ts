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
} from '../sim/campaign/constants';
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

function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

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

export function renderCampaignCores(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  depth: Float32Array,
  cores: readonly CoreState[],
  nowMs: number,
): void {
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

    ctx.save();
    ctx.globalAlpha = 0.26 + Math.sin(nowMs * 0.004) * 0.1;
    ctx.fillStyle = '#5eead4';
    ctx.beginPath();
    ctx.arc(p.screenX, cy, size * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawDiamond(ctx, p.screenX, cy, size, '#5eead4', nowMs * 0.0018);
  }
}

export function renderCampaignDrone(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  depth: Float32Array,
  drone: DroneState,
  droneX: number,
  droneY: number,
  nowMs: number,
): void {
  if (!drone.alive) return;

  const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, droneX, droneY);
  const col = Math.round((p.screenX - fx.shakeX - fx.bobX) / SLICE_W);
  if (!p.visible || col < 0 || col >= vp.numRays || depth[col]! < p.perp - 2) {
    return;
  }

  const cy = heightToScreenY(vp, fx, p.perp, TILE * 0.55);
  const size = p.tileH * 0.3;

  // Brightens and reddens as it locks on — the "linea di mira visibile
  // prima di sparare" the GDD calls for (drawn as a warning glow rather
  // than a literal beam, keeping the wireframe style).
  const droneReady = 1 - Math.max(0, Math.min(1, drone.reactionTimer / 600));
  const pulse = 0.5 + Math.sin(nowMs * 0.02) * 0.5 * droneReady;

  ctx.save();
  ctx.globalAlpha = 0.3 + pulse * 0.4;
  ctx.fillStyle = '#ff3b3b';
  ctx.beginPath();
  ctx.arc(p.screenX, cy, size * (1.3 + pulse * 0.6), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawDiamond(ctx, p.screenX, cy, size, `rgb(255,${Math.round(60 + 100 * (1 - droneReady))},60)`, Math.PI / 4);
}

const BOSS_PHASE_COLOR: Record<BossPhase, string> = {
  guard: '#8aa0c8',
  telegraph: '#ffb020',
  charge: '#ff3b3b',
  recover: '#c88a50',
  defeated: '#3d6b4a',
};

export function renderCampaignBoss(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  depth: Float32Array,
  boss: BossState,
  nowMs: number,
): void {
  const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, boss.x, boss.y, 0.5);
  const col = Math.round((p.screenX - fx.shakeX - fx.bobX) / SLICE_W);
  if (!p.visible || col < 0 || col >= vp.numRays || depth[col]! < p.perp - 2) {
    return;
  }

  const scale = boss.phase === 'charge' ? 1.12 : 1;
  const h = p.tileH * 1.7 * scale;
  const w = h * 0.62;
  const floorY = heightToScreenY(vp, fx, p.perp, 0);
  const topY = floorY - h;

  // Contact shadow.
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(p.screenX, floorY - 1, w * 0.7, w * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const baseColor = BOSS_PHASE_COLOR[boss.phase];
  ctx.fillStyle = baseColor;
  ctx.fillRect(p.screenX - w / 2, topY, w, h);
  ctx.strokeStyle = '#0d0f18';
  ctx.lineWidth = Math.max(1.5, w * 0.05);
  ctx.strokeRect(p.screenX - w / 2, topY, w, h);

  // Whether the viewer is currently standing in front (shielded) or
  // behind (core exposed) the boss — the single most important piece
  // of feedback in this fight, so it is drawn regardless of phase.
  const angleToCam = Math.atan2(cam.y - boss.y, cam.x - boss.x);
  const frontDiff = Math.abs(angleDelta(boss.angle, angleToCam));
  const rearDiff = Math.PI - frontDiff;
  const exposed = rearDiff <= BOSS_GRAZE_ARC_HALF;
  const solidExposed = rearDiff <= BOSS_REAR_ARC_HALF;
  const canDamageNow = boss.phase === 'charge' || boss.phase === 'recover';

  const patchW = w * 0.36;
  const patchH = h * 0.3;
  if (exposed && canDamageNow) {
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(nowMs * 0.012) * 0.25;
    ctx.fillStyle = solidExposed ? '#ff5050' : '#ffb37a';
    ctx.fillRect(p.screenX - patchW / 2, topY + h * 0.28, patchW, patchH);
    ctx.restore();
  } else if (frontDiff <= BOSS_REAR_ARC_HALF) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#dff0ff';
    ctx.fillRect(p.screenX - patchW / 2, topY + h * 0.28, patchW, patchH);
    ctx.restore();
  }

  if (boss.phase === 'defeated') {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#7dfc9a';
    ctx.lineWidth = Math.max(1, w * 0.04);
    ctx.strokeRect(p.screenX - w / 2, topY, w, h);
    ctx.restore();
  }
}
