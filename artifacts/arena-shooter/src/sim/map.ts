// ================================================================
// ARENA MAP
// ================================================================
// 38 x 28 tiles. 0 = floor, 1 = wall, 2 = cover crate.
// Both wall types block movement, bullets and line-of-sight; they
// differ only in how the renderer textures them.
//
// The layout is symmetric under a 180° rotation rather than mirrored
// on both axes. Mirroring is equally fair but makes all four corners
// look alike, which leaves nothing to navigate by; rotating gives the
// same fairness while letting each half have its own landmarks.
//
// Its shape was deliberate, and measured (dal banco headless
// dell'Arena, rimosso insieme a lei): il primo arena era 6.5%
// ostruita con il 43% di tutte le coppie di posizioni in reciproca
// linea di tiro, il che in un gioco a un colpo solo voleva dire che
// la maggior parte delle morti arrivava da dove la vittima non stava
// guardando. Questa era ~24% ostruita:
//
//   • A sealed bunker at the centre, holding the only shield. Its two
//     entrances are on opposite faces and offset, so no line runs
//     through it — you have to go in, and going in can be watched.
//   • Corner rooms with two ways in each, so no corner is a trap.
//   • Blocks planted in the mid bands, which otherwise ran clear from
//     wall to wall. They are 2x2 or larger on purpose: a single tile
//     in open floor reads as litter and leaves the lane usable either
//     side of it anyway.
// ================================================================

import { MAP_H, MAP_W, T_COVER, T_WALL } from './constants';

// prettier-ignore
export const MAP_DATA: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 0
  [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,1], // 1
  [1,0,0,2,2,0,0,0,1,0,0,0,1,1,0,0,0,0,0,1,1,0,0,0,1,1,0,0,0,0,2,2,0,0,0,0,0,1], // 2
  [1,0,0,2,2,0,0,0,1,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,2,2,0,0,0,0,0,1], // 3
  [1,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,2,2,2,2,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,1], // 4
  [1,0,0,1,1,1,1,1,1,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 5
  [1,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,0,1,1,1], // 6
  [1,0,0,0,0,1,1,2,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,1], // 7
  [1,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,1,1,0,0,0,0,0,2,2,0,0,1], // 8
  [1,0,1,1,1,1,1,1,0,0,0,0,0,1,1,1,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,2,2,0,0,1], // 9
  [1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1], // 10
  [1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 11
  [1,1,1,1,1,1,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 12
  [1,0,0,0,0,0,0,0,0,1,1,0,2,2,0,0,0,0,0,0,0,1,0,0,2,2,0,1,1,0,0,0,0,0,0,0,0,1], // 13
  [1,0,0,0,0,0,0,0,0,1,1,0,2,2,0,0,1,0,0,0,0,0,0,0,2,2,0,1,1,0,0,0,0,0,0,0,0,1], // 14
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,1,1,1,1,1,1], // 15
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1], // 16
  [1,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1], // 17
  [1,0,0,2,2,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,1,1,1,0,0,0,0,0,1,1,1,1,1,1,0,1], // 18
  [1,0,0,2,2,0,0,0,0,0,1,1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,1], // 19
  [1,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,2,1,1,0,0,0,0,1], // 20
  [1,1,1,0,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,1], // 21
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,1,1,1,1,1,1,0,0,1], // 22
  [1,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,2,2,2,2,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,1], // 23
  [1,0,0,0,0,0,2,2,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,1,0,0,0,2,2,0,0,1], // 24
  [1,0,0,0,0,0,2,2,0,0,0,0,1,1,0,0,0,1,1,0,0,0,0,0,1,1,0,0,0,1,0,0,0,2,2,0,0,1], // 25
  [1,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1], // 26
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 27
];

/** Out-of-bounds reads return solid so rays and collision probes
 *  never need their own bounds checks. */
export function getTile(tx: number, ty: number): number {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return T_WALL;
  return MAP_DATA[ty]![tx]!;
}

export function isSolid(tx: number, ty: number): boolean {
  const t = getTile(tx, ty);
  return t === T_WALL || t === T_COVER;
}
