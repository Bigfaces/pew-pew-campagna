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
/** Linea di vista fra due punti, **simmetrica per costruzione**.
 *
 *  Un DDA che rade lo spigolo di un tile può decidere di infilarsi da
 *  una parte o dall'altra a seconda di dove parte, e su una mappa a
 *  stanze quadrate succede: su 2939 coppie turret/tile dei sei livelli
 *  ce n'erano nove in cui A vedeva B ma B non vedeva A. Quattro di
 *  quelle erano posti in cui una turret ti sparava e tu non potevi
 *  risponderle — ingiusto per costruzione, e invisibile giocando
 *  finché non ci capiti.
 *
 *  La soluzione non è raffinare il DDA ma togliergli la scelta:
 *  si ordina la coppia sempre allo stesso modo e si tira il raggio da
 *  lì. Quale dei due estremi sia il "primo" non conta — conta che sia
 *  sempre lo stesso, così la risposta non può dipendere da chi
 *  domanda. */
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

  // Ordine canonico: per x, e a parità per y.
  const swap = x1 < x0 || (x1 === x0 && y1 < y0);
  const ax = swap ? x1 : x0;
  const ay = swap ? y1 : y0;
  const bx = swap ? x0 : x1;
  const by = swap ? y0 : y1;

  return !campCastRay(getTile, ax, ay, Math.atan2(by - ay, bx - ax), d, mapW, mapH).hit;
}
