// ================================================================
// IL BANCO — il contratto
// ================================================================
// Questo file non prova che il Banco funzioni: prova che è fatto come
// dice di essere fatto. Il comportamento dentro un mondo vivo sta in
// acquisti.test.ts.
//
// L'invariante attorno a cui è costruito tutto è la prima: **nessun
// innesto è guadagno puro**. È l'unica cosa che i diciassette nodi
// dell'albero non hanno — lì ogni scelta è un regalo — ed è la ragione
// per cui il Banco esiste (vedi GDD.md sezione 13, "Cosa dicono le
// misure"). Il giorno in cui qualcuno aggiungesse un innesto che dà e
// basta, questo file diventerebbe rosso prima che arrivi in partita.
// ================================================================

import { describe, expect, it } from 'vitest';

import { BULLET_COOLDOWN } from '../constants';
import {
  ALL_SKILL_NODES,
  LEVEL_XP_THRESHOLDS,
  SHOP_ITEMS,
  SHOP_ITEM_COST,
  shopItemsForAct,
} from './constants';
import {
  beaconStatsFor,
  isValidShopItem,
  movementStatsFor,
  pointsSpent,
  shieldCapacity,
  shopItemById,
  shopItemCost,
  weaponStatsFor,
} from './skills';

const TUTTI = SHOP_ITEMS.map((i) => i.id);

describe('Banco — forma degli innesti', () => {
  it('nessun innesto è guadagno puro: ognuno toglie qualcosa', () => {
    for (const item of SHOP_ITEMS) {
      expect(item.takes.trim().length, `${item.id} non toglie niente`).toBeGreaterThan(0);
      expect(item.gives.trim().length, `${item.id} non dà niente`).toBeGreaterThan(0);
    }
  });

  it('ogni innesto costa come un nodo: è il confronto a rendere la scelta leggibile', () => {
    for (const item of SHOP_ITEMS) expect(item.cost).toBe(SHOP_ITEM_COST);
  });

  it('gli id sono distinti e riconosciuti', () => {
    expect(new Set(TUTTI).size).toBe(SHOP_ITEMS.length);
    for (const id of TUTTI) {
      expect(isValidShopItem(id)).toBe(true);
      expect(shopItemById(id)?.id).toBe(id);
      expect(shopItemCost(id)).toBe(SHOP_ITEM_COST);
    }
  });

  it('un id inventato non costa zero, costa infinito', () => {
    // Il contrario di nodeCost, e di proposito: la clemenza verso i
    // profili vecchi vive in pointsSpent, non in "posso comprarlo".
    expect(isValidShopItem('sconto-amici')).toBe(false);
    expect(shopItemById('sconto-amici')).toBeNull();
    expect(shopItemCost('sconto-amici')).toBe(Infinity);
  });

  it('gli innesti si dividono fra i due intervalli d\'atto, e nessuno resta fuori', () => {
    const a1 = shopItemsForAct(1);
    const a2 = shopItemsForAct(2);
    expect(a1.length).toBeGreaterThan(0);
    expect(a2.length).toBeGreaterThan(0);
    expect(a1.length + a2.length).toBe(SHOP_ITEMS.length);
    // L'Atto III non ha un intervallo dopo di sé: è il buco noto.
    expect(shopItemsForAct(3)).toHaveLength(0);
  });
});

describe('Banco — quanto costa, e a chi lo toglie', () => {
  it('gli innesti spendono gli stessi punti dei nodi', () => {
    const soloNodi = pointsSpent(['scatto', 'passo-lungo']);
    const nodiEInnesti = pointsSpent(['scatto', 'passo-lungo'], ['eco-ampio']);
    expect(nodiEInnesti).toBe(soloNodi + SHOP_ITEM_COST);
  });

  it('un innesto sconosciuto in un profilo vecchio non blocca la spesa', () => {
    // Stessa clemenza dei nodi: costa zero invece di infinito, perché
    // un profilo che non si sa più leggere non deve congelare i punti.
    expect(pointsSpent([], ['innesto-che-non-esiste-piu'])).toBe(0);
  });

  it('comprare tutto il Banco lascia comunque dei punti per l\'albero', () => {
    // Se un giorno il Banco costasse più dei punti disponibili,
    // esisterebbero build impossibili da completare in nessun modo.
    const punti = LEVEL_XP_THRESHOLDS.length - 1;
    expect(SHOP_ITEMS.length * SHOP_ITEM_COST).toBeLessThan(punti);
  });

  it('albero e Banco insieme costano più dei punti: si deve rinunciare a qualcosa', () => {
    const punti = LEVEL_XP_THRESHOLDS.length - 1;
    const tutto = ALL_SKILL_NODES.length + SHOP_ITEMS.length;
    expect(tutto).toBeGreaterThan(punti);
  });
});

describe('Banco — come si compongono gli effetti', () => {
  it('senza innesti le statistiche sono quelle di prima', () => {
    expect(weaponStatsFor(['otturatore-rapido'])).toEqual(
      weaponStatsFor(['otturatore-rapido'], []),
    );
    expect(movementStatsFor(['scatto'])).toEqual(movementStatsFor(['scatto'], []));
    expect(beaconStatsFor([])).toEqual(beaconStatsFor([], []));
  });

  it('Otturatore Spinto e Piastra Fusa si sommano invece di annullarsi', () => {
    const base = weaponStatsFor([]).cooldownMs;
    const spinto = weaponStatsFor([], ['otturatore-spinto']).cooldownMs;
    const fusa = weaponStatsFor([], ['piastra-fusa']).cooldownMs;
    const entrambi = weaponStatsFor([], ['otturatore-spinto', 'piastra-fusa']).cooldownMs;
    expect(spinto).toBeLessThan(base);
    expect(fusa).toBeGreaterThan(base);
    expect(entrambi).toBe(base + (spinto - base) + (fusa - base));
  });

  it("l'ordine in cui si comprano non cambia il risultato", () => {
    // La lista sembra un insieme e deve comportarsi come tale:
    // altrimenti l'ordine sarebbe stato nascosto dentro un array.
    expect(weaponStatsFor([], ['otturatore-spinto', 'piastra-fusa'])).toEqual(
      weaponStatsFor([], ['piastra-fusa', 'otturatore-spinto']),
    );
    expect(movementStatsFor(['scatto'], ['zavorra-alleggerita', 'scatto-teso'])).toEqual(
      movementStatsFor(['scatto'], ['scatto-teso', 'zavorra-alleggerita']),
    );
    expect(beaconStatsFor([], ['eco-ampio', 'doppio-innesco'])).toEqual(
      beaconStatsFor([], ['doppio-innesco', 'eco-ampio']),
    );
  });

  it('Zavorra e Scatto Teso quasi si annullano sul passo, e tengono i due guadagni', () => {
    const base = movementStatsFor(['scatto']);
    const due = movementStatsFor(['scatto'], ['zavorra-alleggerita', 'scatto-teso']);
    // Il passo torna quasi dov'era: entro il 5%.
    expect(Math.abs(due.speedMult / base.speedMult - 1)).toBeLessThan(0.05);
    // Ma lo scatto è più veloce e più raro: i due guadagni restano.
    expect(due.dashSpeed).toBeGreaterThan(base.dashSpeed);
    expect(due.dashCooldownMs).toBeGreaterThan(base.dashCooldownMs);
  });

  it('ogni innesto peggiora davvero qualcosa, non solo a parole', () => {
    // Il gemello misurato del primo test del file: là si controlla che
    // `takes` non sia vuoto, qui che corrisponda a un numero peggiore.
    expect(weaponStatsFor([], ['otturatore-spinto']).adsTransitionMs).toBeGreaterThan(
      weaponStatsFor([]).adsTransitionMs,
    );
    expect(beaconStatsFor([], ['eco-ampio']).lifetimeMs).toBeLessThan(
      beaconStatsFor([]).lifetimeMs,
    );
    expect(movementStatsFor(['scatto'], ['zavorra-alleggerita']).dashCooldownMs).toBeGreaterThan(
      movementStatsFor(['scatto']).dashCooldownMs,
    );
    expect(beaconStatsFor([], ['doppio-innesco']).rangeTiles).toBeLessThan(
      beaconStatsFor([]).rangeTiles,
    );
    expect(movementStatsFor(['scatto'], ['scatto-teso']).speedMult).toBeLessThan(
      movementStatsFor(['scatto']).speedMult,
    );
    expect(weaponStatsFor([], ['piastra-fusa']).cooldownMs).toBeGreaterThan(
      weaponStatsFor([]).cooldownMs,
    );
  });

  it('e ogni innesto migliora davvero qualcosa', () => {
    expect(weaponStatsFor([], ['otturatore-spinto']).cooldownMs).toBeLessThan(BULLET_COOLDOWN);
    expect(beaconStatsFor([], ['eco-ampio']).lureTiles).toBeGreaterThan(beaconStatsFor([]).lureTiles);
    expect(movementStatsFor([], ['zavorra-alleggerita']).speedMult).toBeGreaterThan(1);
    expect(beaconStatsFor([], ['doppio-innesco']).chargesStart).toBeGreaterThan(
      beaconStatsFor([]).chargesStart,
    );
    expect(movementStatsFor(['scatto'], ['scatto-teso']).dashSpeed).toBeGreaterThan(
      movementStatsFor(['scatto']).dashSpeed,
    );
    expect(shieldCapacity([], ['piastra-fusa'])).toBeGreaterThan(shieldCapacity([]));
  });
});
