// ================================================================
// CAMPAIGN MAP — Sprint 1 vertical slice
// ================================================================
// A separate, small, linear map: Attracco -> corridoio (porta a
// tempo) -> Magazzino (drone) -> Molo (boss). Deliberately its own
// grid rather than a variant of the Arena map, so nothing here can
// ever affect the Arena mode, which must stay exactly as it is.
//
// 22 x 11 tiles. Same encoding as the Arena map: 0 = floor, 1 = wall.
// Row 5 is the through-row that links every room; the doorway gaps
// between rooms (col 6, 11, 16) only open on that row.
// ================================================================

export const CAMP_MAP_W = 22;
export const CAMP_MAP_H = 11;

// prettier-ignore
export const CAMP_MAP_DATA: readonly (readonly number[])[] = [
// col: 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 0
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], // 1  Attracco | corridoio (wall) | Magazzino | (wall) | Molo
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], // 2
  [1,0,0,0,0,0,1,1,0,1,1,1,0,0,0,0,1,0,0,0,0,1], // 3  nicchia del secondo core a (8,3)
  [1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], // 4  corridoio aperto
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 5  riga di passaggio: doorway di ogni stanza
  [1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], // 6  corridoio aperto
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], // 7
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], // 8
  [1,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,1,0,0,0,0,1], // 9
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 10
];

export function campGetTile(tx: number, ty: number): number {
  if (tx < 0 || tx >= CAMP_MAP_W || ty < 0 || ty >= CAMP_MAP_H) return 1;
  return CAMP_MAP_DATA[ty]![tx]!;
}
