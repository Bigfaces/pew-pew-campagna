// ================================================================
// RAYCASTING — utilità angolare condivisa
// ================================================================
// Un tempo qui viveva `castRay`, il DDA contro la griglia di
// `sim/map.ts` (la mappa dell'Arena): serviva al renderer per le
// strip dei muri, a `hasLOS` per la visibilità dei bot e allo
// hitscan per fermare i proiettili. Con l'Arena rimossa nessuna
// modalità lo chiamava più — la campagna ha il proprio raycast contro
// la propria griglia in sim/campaign/raycast.ts — quindi `castRay`,
// `hasLOS`, `RayHit` e la mappa dell'Arena stessa (sim/map.ts) sono
// stati tolti in questo secondo giro di potatura. Resta solo
// `angleDelta`, che campagna e Arena condividevano ed è ancora usata
// ovunque un angolo va confrontato con un altro.
// ================================================================

/** Signed shortest angular difference, in (-PI, PI].
 *  Used everywhere two headings need comparing without wrap bugs. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
