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
  canRefundNode,
  refundableNodes,
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

// ================================================================
// RENDERE UN NODO
// ================================================================
// Il Banco accetta un punto libero, oppure un nodo reso. Il secondo
// modo non è una gentilezza: senza, il Banco del secondo atto non si
// aprirebbe mai.
//
// L'albero si spende dalla pausa in qualunque momento, quindi chi
// spende i punti appena li guadagna arriva all'intervallo d'atto con
// in tasca solo quelli arrivati col boss. Misurati sul percorso vero
// di chi ripulisce tutto: uno alla fine dell'Atto I (la Sentinella fa
// scattare una soglia), ZERO alla fine dell'Atto II (il Custode non ne
// fa scattare nessuna). Le cifre le ricalcola `balance:campaign`.

describe('Banco — rendere un nodo in cambio di un innesto', () => {
  it('un nodo da cui non dipende nessuno si può rendere', () => {
    expect(refundableNodes(['passo-lungo'])).toContain('passo-lungo');
    expect(canRefundNode(['passo-lungo'], 'passo-lungo')).toBe(true);
  });

  it('un nodo da cui dipende un nodo posseduto NON si può rendere', () => {
    // Rendere `scatto` mentre si possiede `scatto-angolare` lascerebbe
    // un figlio senza padre: la lista smetterebbe di essere chiusa sui
    // prerequisiti, ed è la sola cosa che rende l'albero un albero.
    const con = ['scatto', 'scatto-angolare'];
    expect(refundableNodes(con)).not.toContain('scatto');
    expect(canRefundNode(con, 'scatto')).toBe(false);
    // Il figlio invece sì: da lui non dipende nessuno.
    expect(refundableNodes(con)).toContain('scatto-angolare');
  });

  it('lo stesso nodo torna rendibile quando il figlio non c\'è più', () => {
    expect(canRefundNode(['scatto'], 'scatto')).toBe(true);
  });

  it('vale anche in fondo a una catena lunga', () => {
    // Percezione è una scala di quattro. Solo l'ultimo gradino si può
    // rendere, e solo uno alla volta risalendo.
    const catena = ['scanner-di-settore', 'lettura-termica', 'sensori-inerziali', 'eco'];
    expect(refundableNodes(catena)).toEqual(['eco']);
    const senzaEco = catena.filter((n) => n !== 'eco');
    expect(refundableNodes(senzaEco)).toEqual(['sensori-inerziali']);
  });

  it('quello che resta dopo aver reso è sempre chiuso sui prerequisiti', () => {
    // L'invariante vera, provata invece che dedotta: si rende un nodo
    // qualsiasi fra quelli leciti e si controlla che nessun superstite
    // sia rimasto orfano.
    const costruita = [
      'scatto', 'scatto-angolare', 'slancio', 'piastra-aggiuntiva',
      'piastra-reattiva', 'scanner-di-settore', 'lettura-termica',
    ];
    for (const reso of refundableNodes(costruita)) {
      const dopo = costruita.filter((n) => n !== reso);
      for (const superstite of dopo) {
        const padre = ALL_SKILL_NODES.find((n) => n.id === superstite)?.requires;
        expect(padre === undefined || dopo.includes(padre), `${superstite} è rimasto orfano`).toBe(true);
      }
    }
  });

  it('un id che non è un nodo non si rende', () => {
    expect(refundableNodes(['non-esiste'])).toHaveLength(0);
    expect(canRefundNode(['non-esiste'], 'non-esiste')).toBe(false);
    // E nemmeno un innesto: gli innesti non tornano indietro.
    expect(canRefundNode(['eco-ampio'], 'eco-ampio')).toBe(false);
  });

  it('un albero vuoto non ha niente da rendere', () => {
    expect(refundableNodes([])).toHaveLength(0);
  });
});
