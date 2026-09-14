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
import { CAMP_MAP_H, CAMP_MAP_W } from '../sim/campaign/map';
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

// ================================================================
// MINIMAPPA — nodi Percezione
// ================================================================
// La campagna non ha mai avuto una minimappa: il segnaposto nel menu
// prometteva "minimappa estesa", ma non c'era niente da estendere.
// Quindi il primo nodo *è* la minimappa, e il secondo aggiunge i
// contatti — cioè la parte che nel segnaposto si chiamava "estesa",
// stavolta guadagnata.
//
// Non riusa renderMinimap dell'Arena: quella è legata a MAP_W/MAP_H
// dell'Arena e ai suoi tipi Entity/PowerUp, e generalizzarla
// vorrebbe dire toccare un file da cui dipende il multiplayer. Stessa
// scelta già fatta per physics e raycast della campagna.
// ================================================================

/** Cache del fondo: i muri non cambiano mai tranne che per la porta,
 *  quindi ridisegnare 242 tile per frame sarebbe lavoro buttato. La
 *  chiave include lo stato della porta proprio perché quello cambia. */
let campMinimapCache: { canvas: HTMLCanvasElement; size: number; door: boolean } | null =
  null;

function campMinimapBackground(
  size: number,
  getTile: GetTileFn,
  doorClosed: boolean,
): HTMLCanvasElement {
  const cached = campMinimapCache;
  if (cached && cached.size === size && cached.door === doorClosed) return cached.canvas;

  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const sx = size / CAMP_MAP_W;
  const sy = size / CAMP_MAP_H;

  g.fillStyle = 'rgba(6, 12, 18, 0.82)';
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(120, 190, 230, 0.30)';
  for (let ty = 0; ty < CAMP_MAP_H; ty++) {
    for (let tx = 0; tx < CAMP_MAP_W; tx++) {
      if (getTile(tx, ty) !== 0) g.fillRect(tx * sx, ty * sy, sx + 0.5, sy + 0.5);
    }
  }
  g.strokeStyle = 'rgba(150, 220, 255, 0.45)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, size - 1, size - 1);

  campMinimapCache = { canvas: c, size, door: doorClosed };
  return c;
}

export interface MinimapContacts {
  cores: readonly CoreState[];
  drone: DroneState;
  droneX: number;
  droneY: number;
  boss: BossState;
  shieldX: number;
  shieldY: number;
  shieldAvailable: boolean;
}

/** Draws the sector minimap. `contacts` is null with only Scanner di
 *  Settore unlocked: you see the map and yourself, but not what is on
 *  it — which is exactly the difference the second node sells. */
/** Dove finisce la minimappa, in px CSS (vp.width è già in px CSS).
 *
 *  Esportata perché la HUD deve sapere quanto spazio lasciarle. La
 *  colonna centrale della HUD è larga quanto il suo contenuto, e senza
 *  questo dato le finisce sotto — è esattamente quello che faceva la
 *  prima versione, verificata su iPhone 13. Una formula sola, letta da
 *  chi disegna e da chi deve scansarsi, invece di due numeri da tenere
 *  d'accordo a mano ogni volta che uno dei due cambia.
 *
 *  La mappa è larga il doppio di quanto è alta (22x11): riservarle un
 *  quadrato sprecherebbe metà dello spazio su un telefono. */
export function campMinimapBox(vpWidth: number): { w: number; h: number; pad: number } {
  const w = Math.round(Math.min(200, Math.max(120, vpWidth * 0.17)));
  return { w, h: Math.round((w * CAMP_MAP_H) / CAMP_MAP_W), pad: 12 };
}

export function renderCampaignMinimap(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  getTile: GetTileFn,
  doorClosed: boolean,
  playerX: number,
  playerY: number,
  playerAngle: number,
  contacts: MinimapContacts | null,
): void {
  const { w, h, pad } = campMinimapBox(vp.width);
  const mx = vp.width - w - pad;
  const my = pad;
  const sx = w / (CAMP_MAP_W * TILE);
  const sy = h / (CAMP_MAP_H * TILE);

  ctx.save();
  ctx.globalAlpha = 0.92;
  // Il fondo è disegnato su un canvas quadrato di lato `w` e poi
  // schiacciato all'altezza reale: una sola cache, invece di una per
  // ogni rapporto di forma.
  ctx.drawImage(campMinimapBackground(w, getTile, doorClosed), mx, my, w, h);

  if (contacts) {
    for (const c of contacts.cores) {
      if (c.collected) continue;
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(mx + c.x * sx - 1.5, my + c.y * sy - 1.5, 3, 3);
    }
    if (contacts.shieldAvailable) {
      ctx.fillStyle = '#44ccff';
      ctx.fillRect(mx + contacts.shieldX * sx - 1.5, my + contacts.shieldY * sy - 1.5, 3, 3);
    }
    if (contacts.drone.alive) {
      ctx.fillStyle = '#ff5c5c';
      ctx.beginPath();
      ctx.arc(mx + contacts.droneX * sx, my + contacts.droneY * sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (contacts.boss.phase !== 'defeated') {
      ctx.fillStyle = '#ff7a2f';
      ctx.beginPath();
      ctx.arc(mx + contacts.boss.x * sx, my + contacts.boss.y * sy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Il giocatore per ultimo: un contatto non deve mai coprire la
  // freccia che dice dove sei.
  const px = mx + playerX * sx;
  const py = my + playerY * sy;
  ctx.fillStyle = '#eaf6ff';
  ctx.beginPath();
  ctx.moveTo(px + Math.cos(playerAngle) * 5, py + Math.sin(playerAngle) * 5);
  ctx.lineTo(px + Math.cos(playerAngle + 2.5) * 4, py + Math.sin(playerAngle + 2.5) * 4);
  ctx.lineTo(px + Math.cos(playerAngle - 2.5) * 4, py + Math.sin(playerAngle - 2.5) * 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
