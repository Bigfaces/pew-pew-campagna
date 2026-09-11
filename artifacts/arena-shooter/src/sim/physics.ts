// ================================================================
// PHYSICS — collision, movement, spawning, hitscan
// ================================================================

import { ENTITY_RADIUS, TILE } from './constants';
import { SPAWN_POINTS, isSolid } from './map';
import { castRay } from './raycast';
import type { Entity } from './types';

/** True when a circle overlaps any solid tile.
 *
 *  Eight probes: four cardinal (catch flat walls) and four diagonal
 *  (catch inside corners, which cardinal probes slip through). */
export function circleHitsTile(x: number, y: number, r: number): boolean {
  const d = r * 0.71; // r / sqrt(2), the diagonal offset
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

const NUDGES: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/** Eject an entity that is already inside geometry.
 *
 *  Sums a repulsion vector away from every overlapping tile. When
 *  those vectors cancel exactly — an entity wedged symmetrically
 *  between two walls — the net force is zero and pure repulsion would
 *  loop forever, so we fall back to a deterministic nudge sequence,
 *  and finally to a spawn point. */
export function pushOutOfWalls(e: Entity): void {
  const r = ENTITY_RADIUS - 1;
  const d = r * 0.71;
  const probes: readonly [number, number][] = [
    [-r, 0],
    [r, 0],
    [0, -r],
    [0, r],
    [-d, -d],
    [d, -d],
    [-d, d],
    [d, d],
  ];

  for (let iter = 0; iter < 16; iter++) {
    if (!circleHitsTile(e.x, e.y, r)) return;

    let fx = 0;
    let fy = 0;
    for (const [ox, oy] of probes) {
      const tx = Math.floor((e.x + ox) / TILE);
      const ty = Math.floor((e.y + oy) / TILE);
      if (!isSolid(tx, ty)) continue;
      const cx = (tx + 0.5) * TILE;
      const cy = (ty + 0.5) * TILE;
      const ddx = e.x - cx;
      const ddy = e.y - cy;
      const len = Math.hypot(ddx, ddy) || 1;
      fx += ddx / len;
      fy += ddy / len;
    }

    const len = Math.hypot(fx, fy);
    if (len > 0.01) {
      e.x += (fx / len) * 2;
      e.y += (fy / len) * 2;
    } else {
      const [nx, ny] = NUDGES[iter % NUDGES.length]!;
      e.x += nx * 3;
      e.y += ny * 3;
    }
  }

  // Still stuck: teleport rather than leave the entity inside a wall.
  const safe = SPAWN_POINTS.find((sp) => !circleHitsTile(sp.x, sp.y, r));
  if (safe) {
    e.x = safe.x;
    e.y = safe.y;
  }
}

/** Move by (dx, dy), sliding along walls rather than stopping dead.
 *
 *  If the combined step is blocked we retry each axis alone, so
 *  grazing a wall at an angle preserves the tangential component
 *  instead of halting the entity. */
export function moveEntity(e: Entity, dx: number, dy: number): void {
  const r = ENTITY_RADIUS - 1;

  if (!circleHitsTile(e.x + dx, e.y + dy, r)) {
    e.x += dx;
    e.y += dy;
  } else {
    if (dx !== 0 && !circleHitsTile(e.x + dx, e.y, r)) e.x += dx;
    if (dy !== 0 && !circleHitsTile(e.x, e.y + dy, r)) e.y += dy;
  }

  if (circleHitsTile(e.x, e.y, r)) pushOutOfWalls(e);
}

/** Pick the spawn point furthest from every living opponent. */
export function chooseSafeSpawn(
  entities: readonly Entity[],
  respawningId: number,
): { x: number; y: number } {
  const living = entities.filter((e) => e.alive && e.id !== respawningId);

  let best = SPAWN_POINTS[0]!;
  let bestDist = -1;

  for (const sp of SPAWN_POINTS) {
    let minD = Infinity;
    for (const e of living) {
      const d = Math.hypot(e.x - sp.x, e.y - sp.y);
      if (d < minD) minD = d;
    }
    if (minD > bestDist) {
      bestDist = minD;
      best = sp;
    }
  }
  return best;
}

export interface HitscanResult {
  victim: Entity | null;
  /** Impact point — the victim if one was struck, else the wall. */
  x: number;
  y: number;
}

/** Fire an instant ray and return the first living entity struck
 *  before the ray reaches a wall.
 *
 *  Entities are treated as capsules facing the ray: we project each
 *  onto the ray and accept it when the perpendicular offset falls
 *  inside the hit radius. Testing against `nearest` as we go means
 *  the closest target wins, so you cannot shoot through someone. */
export function hitscan(
  entities: readonly Entity[],
  shooterId: number,
  ox: number,
  oy: number,
  angle: number,
): HitscanResult {
  const wall = castRay(ox, oy, angle, Infinity);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  // The hit radius is exactly the entity's physical radius: what you
  // see is what you hit.
  //
  // It used to be 1.4x the area, a padding borrowed from shooters where
  // aim is two-dimensional. Here it is not — pitch is a camera effect
  // and bullets travel on the horizontal only — so half the usual
  // difficulty of aiming is already absent, and padding the remaining
  // axis on top of that left almost nothing for the player's aim to
  // decide. All of the skill this weapon asks for lives in one axis;
  // it may as well be worth something.
  const hitR2 = ENTITY_RADIUS * ENTITY_RADIUS;

  let nearest = wall.dist;
  let victim: Entity | null = null;

  for (const e of entities) {
    if (e.id === shooterId || !e.alive) continue;
    const relX = e.x - ox;
    const relY = e.y - oy;
    const along = relX * dx + relY * dy;
    if (along < 0 || along > nearest) continue;
    const perpX = ox + dx * along - e.x;
    const perpY = oy + dy * along - e.y;
    if (perpX * perpX + perpY * perpY <= hitR2) {
      nearest = along;
      victim = e;
    }
  }

  return victim
    ? { victim, x: victim.x, y: victim.y }
    : { victim: null, x: wall.x, y: wall.y };
}
