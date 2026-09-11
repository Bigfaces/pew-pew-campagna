// ================================================================
// CAMPAIGN RAYCAST — DDA against the campaign tile grid
// ================================================================
// Same algorithm as the Arena's sim/raycast.ts, parametrized over an
// isSolid function and map bounds instead of importing the Arena map
// directly. See physics.ts for why this is a separate copy rather
// than a shared, parametrized original.
// ================================================================

import { TILE } from '../constants';
import type { IsSolidFn } from './physics';

export interface CampRayHit {
  hit: boolean;
  dist: number;
  x: number;
  y: number;
}

const MAX_STEPS = 80;

export function campCastRay(
  isSolid: IsSolidFn,
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

  for (let i = 0; i < MAX_STEPS; i++) {
    if (sideX < sideY) {
      tx += stepX;
      dist = sideX;
      sideX += deltaX;
    } else {
      ty += stepY;
      dist = sideY;
      sideY += deltaY;
    }

    if (dist > maxDist) break;
    if (tx < 0 || tx >= mapW || ty < 0 || ty >= mapH) break;

    if (isSolid(tx, ty)) {
      return { hit: true, dist, x: ox + dx * dist, y: oy + dy * dist };
    }
  }

  return {
    hit: false,
    dist: maxDist,
    x: ox + dx * maxDist,
    y: oy + dy * maxDist,
  };
}

/** True when nothing solid blocks the segment between two points. */
export function campHasLOS(
  isSolid: IsSolidFn,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mapW: number,
  mapH: number,
): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1) return true;
  return !campCastRay(isSolid, x0, y0, Math.atan2(y1 - y0, x1 - x0), d, mapW, mapH)
    .hit;
}
