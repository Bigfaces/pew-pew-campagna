// ================================================================
// CAMPAIGN PHYSICS — collision and movement against the campaign map
// ================================================================
// A small, deliberately separate copy of the Arena's own physics
// primitives (sim/physics.ts). The Arena's versions import the Arena
// map directly, so reusing them here would mean either changing a
// file the multiplayer Arena depends on, or threading a map parameter
// through code that has never needed one. Duplicating the handful of
// functions the campaign actually uses keeps the Arena untouched.
// ================================================================

import { ENTITY_RADIUS, TILE } from '../constants';

export type IsSolidFn = (tx: number, ty: number) => boolean;

export interface Circle {
  x: number;
  y: number;
}

/** True when a circle overlaps any solid tile. Same eight-probe
 *  approach as the Arena's circleHitsTile. */
export function campCircleHitsTile(
  isSolid: IsSolidFn,
  x: number,
  y: number,
  r: number,
): boolean {
  const d = r * 0.71;
  return (
    isSolid(Math.floor((x - r) / TILE), Math.floor(y / TILE)) ||
    isSolid(Math.floor((x + r) / TILE), Math.floor(y / TILE)) ||
    isSolid(Math.floor(x / TILE), Math.floor((y - r) / TILE)) ||
    isSolid(Math.floor(x / TILE), Math.floor((y + r) / TILE)) ||
    isSolid(Math.floor((x - d) / TILE), Math.floor((y - d) / TILE)) ||
    isSolid(Math.floor((x + d) / TILE), Math.floor((y - d) / TILE)) ||
    isSolid(Math.floor((x - d) / TILE), Math.floor((y + d) / TILE)) ||
    isSolid(Math.floor((x + d) / TILE), Math.floor((y + d) / TILE))
  );
}

/** Move by (dx, dy), sliding along walls instead of stopping dead. */
export function campMoveEntity(
  isSolid: IsSolidFn,
  e: Circle,
  dx: number,
  dy: number,
  r: number = ENTITY_RADIUS - 1,
): void {
  if (!campCircleHitsTile(isSolid, e.x + dx, e.y + dy, r)) {
    e.x += dx;
    e.y += dy;
    return;
  }
  if (dx !== 0 && !campCircleHitsTile(isSolid, e.x + dx, e.y, r)) e.x += dx;
  if (dy !== 0 && !campCircleHitsTile(isSolid, e.x, e.y + dy, r)) e.y += dy;
}

/** Perpendicular distance-squared from `angle` at (ox,oy) to (cx,cy).
 *  Returns the distance along the ray if the circle is hit, else null
 *  — same projection the Arena's hitscan uses, generalized to any
 *  circle instead of only entities. */
export function distanceAlongRayToCircle(
  ox: number,
  oy: number,
  angle: number,
  cx: number,
  cy: number,
  r: number,
): number | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const relX = cx - ox;
  const relY = cy - oy;
  const along = relX * dx + relY * dy;
  if (along < 0) return null;
  const perpX = ox + dx * along - cx;
  const perpY = oy + dy * along - cy;
  if (perpX * perpX + perpY * perpY <= r * r) return along;
  return null;
}
