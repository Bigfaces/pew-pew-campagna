// ================================================================
// CAMPAIGN RAYCAST — DDA against the campaign tile grid
// ================================================================
// Same algorithm as the Arena's sim/raycast.ts, parametrized over a
// getTile function and map bounds instead of importing the Arena map
// directly. See physics.ts for why this is a separate copy rather
// than a shared, parametrized original.
//
// Returns the same side/tile/wallX fields the Arena's castRay does,
// even though the sim itself only ever reads hit/dist/x/y — the
// renderer needs them to texture a wall column, and one DDA walk
// serving both call sites is the whole point of this function.
// ================================================================

import { TILE } from '../constants';

/** Tile value at (tx,ty). 0 = floor, matching the campaign map's own
 *  encoding (see map.ts) — anything else counts as solid. */
export type GetTileFn = (tx: number, ty: number) => number;

export interface CampRayHit {
  hit: boolean;
  dist: number;
  x: number;
  y: number;
  side: 'x' | 'y';
  tile: number;
  wallX: number;
}

const MAX_STEPS = 80;

export function campCastRay(
  getTile: GetTileFn,
  ox: number,
  oy: number,
  angle: number,
  maxDist: number,
  mapW: number,
  mapH: number,
): CampRayHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  let tx = Math.floor(ox / TILE);
  let ty = Math.floor(oy / TILE);

  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;

  const deltaX = Math.abs(dx) < 1e-9 ? Infinity : Math.abs(TILE / dx);
  const deltaY = Math.abs(dy) < 1e-9 ? Infinity : Math.abs(TILE / dy);

  let sideX =
    Math.abs(dx) < 1e-9
      ? Infinity
      : dx > 0
        ? ((tx + 1) * TILE - ox) / dx
        : (ox - tx * TILE) / -dx;
  let sideY =
    Math.abs(dy) < 1e-9
      ? Infinity
      : dy > 0
        ? ((ty + 1) * TILE - oy) / dy
        : (oy - ty * TILE) / -dy;

  let dist = 0;
  let side: 'x' | 'y' = 'x';

  for (let i = 0; i < MAX_STEPS; i++) {
    if (sideX < sideY) {
      tx += stepX;
      dist = sideX;
      sideX += deltaX;
      side = 'x';
    } else {
      ty += stepY;
      dist = sideY;
      sideY += deltaY;
      side = 'y';
    }

    if (dist > maxDist) break;
    if (tx < 0 || tx >= mapW || ty < 0 || ty >= mapH) break;

    const tile = getTile(tx, ty);
    if (tile !== 0) {
      const hx = ox + dx * dist;
      const hy = oy + dy * dist;
      const raw = side === 'x' ? hy / TILE : hx / TILE;
      let wallX = raw - Math.floor(raw);
      if (side === 'x' && dx < 0) wallX = 1 - wallX;
      if (side === 'y' && dy > 0) wallX = 1 - wallX;
      return { hit: true, dist, x: hx, y: hy, side, tile, wallX };
    }
  }

  return {
    hit: false,
    dist: maxDist,
    x: ox + dx * maxDist,
    y: oy + dy * maxDist,
    side,
    tile: 1,
    wallX: 0,
  };
}

/** True when nothing solid blocks the segment between two points. */
export function campHasLOS(
  getTile: GetTileFn,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mapW: number,
  mapH: number,
): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1) return true;
  return !campCastRay(getTile, x0, y0, Math.atan2(y1 - y0, x1 - x0), d, mapW, mapH)
    .hit;
}
