// ================================================================
// RAYCASTING — DDA against the tile grid
// ================================================================
// One function serves three very different callers:
//   • the renderer, for wall strips (needs side + wallX + tile type)
//   • line-of-sight checks, for bot vision (needs only `hit`)
//   • hitscan shooting, for bullet stops (needs `dist`)
//
// Keeping a single implementation means bullets can never disagree
// with what the player sees, which is the classic source of "I shot
// him through the wall" bugs.
// ================================================================

import { MAP_H, MAP_W, T_WALL, TILE } from './constants';
import { getTile, isSolid } from './map';

export interface RayHit {
  hit: boolean;
  /** Euclidean distance from the origin to the impact point. */
  dist: number;
  x: number;
  y: number;
  /** Which grid axis was crossed on the final step. Used both for
   *  fake directional lighting and to pick the texture axis. */
  side: 'x' | 'y';
  tile: number;
  /** Where along the wall face the ray landed, 0..1. This is the
   *  horizontal texture coordinate. */
  wallX: number;
}

/** Maximum DDA steps. The grid diagonal is ~47 tiles, so 160 leaves
 *  generous headroom while still bounding the loop. */
const MAX_STEPS = 160;

export function castRay(
  ox: number,
  oy: number,
  angle: number,
  maxDist: number,
): RayHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  let tx = Math.floor(ox / TILE);
  let ty = Math.floor(oy / TILE);

  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;

  // Distance covered per full tile crossing on each axis.
  const deltaX = Math.abs(dx) < 1e-9 ? Infinity : Math.abs(TILE / dx);
  const deltaY = Math.abs(dy) < 1e-9 ? Infinity : Math.abs(TILE / dy);

  // Distance to the first grid line on each axis.
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
    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) break;

    if (isSolid(tx, ty)) {
      const hx = ox + dx * dist;
      const hy = oy + dy * dist;
      // Texture U runs along whichever face we struck.
      const raw = side === 'x' ? hy / TILE : hx / TILE;
      let wallX = raw - Math.floor(raw);
      // Mirror on the two faces that would otherwise show the texture
      // reversed, so adjacent walls line up seamlessly at corners.
      if (side === 'x' && dx < 0) wallX = 1 - wallX;
      if (side === 'y' && dy > 0) wallX = 1 - wallX;

      return {
        hit: true,
        dist,
        x: hx,
        y: hy,
        side,
        tile: getTile(tx, ty),
        wallX,
      };
    }
  }

  return {
    hit: false,
    dist: maxDist,
    x: ox + dx * maxDist,
    y: oy + dy * maxDist,
    side,
    tile: T_WALL,
    wallX: 0,
  };
}

/** True when nothing solid blocks the segment between two points. */
export function hasLOS(x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1) return true;
  return !castRay(x0, y0, Math.atan2(y1 - y0, x1 - x0), d).hit;
}

/** Signed shortest angular difference, in (-PI, PI].
 *  Used everywhere two headings need comparing without wrap bugs. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
