// ================================================================
// IL BANCO — tryPurchase e i suoi sei innesti
// ================================================================
// Due bersagli, come in beacon.test.ts: il meccanismo di spesa (stessa
// forma di tryUnlockNode — sconosciuto, doppione, punti, in
// quell'ordine, ognuno col suo evento) e l'effetto di ogni innesto
// dentro un mondo vivo. Il "questo innesto è ancora offerto in questo
// atto?" NON si prova qui: quella domanda vive in campaignShop.ts, che
// conosce il contesto d'atto che CampaignWorld non ha.
// ================================================================

import { describe, expect, it } from 'vitest';

import { TICK_MS, TILE } from '../constants';
import {
  BEACON_LIFETIME_MS,
  BEACON_RANGE_TILES,
  DASH_COOLDOWN_MS,
  DASH_SPEED,
  SHIELD_CHARGES_BASE,
  SHOP_DOPPIO_INNESCO_CHARGES,
  SHOP_DOPPIO_INNESCO_RANGE_TILES,
  SHOP_ECO_AMPIO_LIFETIME_MS,
  SHOP_PIASTRA_FUSA_CHARGES_DELTA,
  SHOP_PIASTRA_FUSA_COOLDOWN_DELTA_MS,
  SHOP_SCATTO_TESO_DASH_MULT,
  SHOP_SCATTO_TESO_SPEED_MULT,
  SHOP_ZAVORRA_DASH_COOLDOWN_MS,
  SHOP_ZAVORRA_SPEED_MULT,
} from './constants';
import { archetypeOf } from './enemies';
import { updateEnemyAi, type EnemyAiCtx } from './enemyAi';
import { LEVEL_ATTRACCO } from './levels';
import { beaconStatsFor, weaponStatsFor } from './skills';
import { attracco, centre, quiet } from './testSupport';
import {
  CAMPAIGN_PROFILE_VERSION,
  emptyCampaignInput,
  type CampaignInput,
  type CampaignProfile,
  type EnemyState,
} from './types';
import { CampaignWorld } from './world';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

/** Un profilo minimo, con solo gli innesti che serve fissare *prima*
 *  che il mondo nasca — cioè `beaconCharges`, l'unico effetto del
 *  Banco che il costruttore legge una volta sola e non ricalcola mai
 *  più (vedi world.ts, commento sopra `beacon.chargesStart`). Tutti
 *  gli altri effetti si possono testare assegnando `state.purchases`
 *  dopo la costruzione, che è quello che fa il resto del file. */
function profileWith(purchases: string[]): CampaignProfile {
  return {
    version: CAMPAIGN_PROFILE_VERSION,
    xp: 0,
    unlockedNodes: [],
    purchases,
    levelId: LEVEL_ATTRACCO.id,
    completedLevels: [],
    collectedCoreIds: [],
    roomsAwarded: [],
    difficulty: 'tutorial',
  };
}

// ================================================================
// tryPurchase — il meccanismo di spesa
// ================================================================

describe('tryPurchase', () => {
  it('id sconosciuto: rifiutato, evento con reason "sconosciuto"', () => {
    const w = quiet(attracco());
    expect(w.tryPurchase('non-esiste')).toBe(false);
    expect(w.events).toContainEqual({
      type: 'purchaseRefused',
      id: 'non-esiste',
      reason: 'sconosciuto',
    });
  });

  it('senza punti disponibili: rifiutato, evento con reason "punti"', () => {
    const w = quiet(attracco());
    // Un personaggio appena creato (livello 1) non ha punti da spendere.
    expect(w.availableSkillPoints).toBe(0);
    expect(w.tryPurchase('eco-ampio')).toBe(false);
    expect(w.events).toContainEqual({
      type: 'purchaseRefused',
      id: 'eco-ampio',
      reason: 'punti',
    });
  });

  it('doppione: il secondo acquisto dello stesso innesto è rifiutato', () => {
    const w = quiet(attracco());
    w.state.skillPoints = 1;
    expect(w.tryPurchase('eco-ampio')).toBe(true);
    expect(w.tryPurchase('eco-ampio')).toBe(false);
    expect(w.events).toContainEqual({
      type: 'purchaseRefused',
      id: 'eco-ampio',
      reason: 'gia-preso',
    });
  });

  it('un acquisto riuscito costa un punto e resta nel profilo', () => {
    const w = quiet(attracco());
    w.state.skillPoints = 1;
    expect(w.availableSkillPoints).toBe(1);

    expect(w.tryPurchase('zavorra-alleggerita')).toBe(true);

    expect(w.availableSkillPoints).toBe(0);
    expect(w.events).toContainEqual({ type: 'itemPurchased', id: 'zavorra-alleggerita' });
    expect(w.toProfile().purchases).toContain('zavorra-alleggerita');
  });
});

// ================================================================
// DOPPIO INNESCO — più cariche, meno gittata
// ================================================================

describe('Doppio Innesco', () => {
  it('il livello comincia con tre cariche invece di due', () => {
    const w = attracco(profileWith(['doppio-innesco']));
    expect(w.state.player.beaconCharges).toBe(SHOP_DOPPIO_INNESCO_CHARGES);
  });

  it("l'esca atterra più vicino: gittata 4 tile invece di 6", () => {
    const w = quiet(attracco());
    w.state.purchases = ['doppio-innesco'];
    const p = w.state.player;
    // Stessa riga di passaggio usata in beacon.test.ts: aperta oltre
    // la portata massima, quindi nessun muro a confondere la misura.
    w.step(input({ beacon: true, aimAngle: 0 }));

    const dist = Math.hypot(w.state.beacon.x - p.x, w.state.beacon.y - p.y);
    expect(dist).toBeCloseTo(SHOP_DOPPIO_INNESCO_RANGE_TILES * TILE, 3);
    expect(dist).toBeLessThan(BEACON_RANGE_TILES * TILE);
  });
});

// ================================================================
// ECO AMPIO — richiamo più largo, esca più corta
// ================================================================

describe('Eco Ampio', () => {
  /** Lancia l'esca e conta i tick fino a `beaconExpired`. Si misura la
   *  simulazione vera, non si legge la costante: è la garanzia che il
   *  filo fra l'acquisto e beaconStatsFor sia quello che gira davvero
   *  nel tick, non quello che il codice *dovrebbe* fare. */
  function ticksToExpire(w: CampaignWorld): number {
    w.step(input({ beacon: true, aimAngle: 0 }));
    expect(w.state.beacon.active).toBe(true);

    let ticks = 0;
    let expired = false;
    while (!expired && ticks < 1000) {
      const events = w.step(input());
      ticks++;
      if (events.some((ev) => ev.type === 'beaconExpired')) expired = true;
    }
    expect(expired).toBe(true);
    return ticks;
  }

  it("con l'innesto l'esca muore prima", () => {
    const base = ticksToExpire(quiet(attracco()));

    const w = quiet(attracco());
    w.state.purchases = ['eco-ampio'];
    const withEco = ticksToExpire(w);

    expect(withEco).toBeLessThan(base);
    // La differenza attesa è dell'ordine di (2600-1800)/TICK_MS tick,
    // non di un tick di arrotondamento: se il collegamento si fosse
    // rotto e l'esca vivesse ancora BEACON_LIFETIME_MS, la differenza
    // sarebbe zero.
    const expectedGap = Math.floor((BEACON_LIFETIME_MS - SHOP_ECO_AMPIO_LIFETIME_MS) / TICK_MS) - 1;
    expect(base - withEco).toBeGreaterThanOrEqual(expectedGap);
  });

  it('a sei tile dall’esca: il raggio base non richiama, Eco Ampio sì', () => {
    // Prova diretta su enemyAi.ts (come le altre "IA — il richiamo" in
    // beacon.test.ts): il campo nuovo è EnemyAiCtx.lure.tiles, e questo
    // è il punto in cui verificare che world.ts lo riempia con lureTiles
    // e non con la costante fissa sarebbe indiretto e più fragile.
    const lureBase = beaconStatsFor([], []).lureTiles;
    const lureEco = beaconStatsFor([], ['eco-ampio']).lureTiles;
    expect(lureBase).toBeLessThan(6);
    expect(lureEco).toBeGreaterThanOrEqual(6);

    function guardiano(): EnemyState {
      const a = archetypeOf('guardiano');
      return {
        id: 'prova',
        kind: 'guardiano',
        alive: true,
        x: 6 * TILE,
        y: 0,
        angle: 0,
        hp: a.hp,
        ai: 'patrol',
        reactionTimer: a.reactionMs,
        attackCooldown: 0,
        ventMs: 0,
        revealMs: 0,
        chargeMs: 0,
        chargeDirX: 0,
        chargeDirY: 0,
        postX: 6 * TILE,
        postY: 0,
        patrolX: null,
        patrolY: null,
        goalX: null,
        goalY: null,
        patrolTimer: 0,
        lastSeenX: null,
        lastSeenY: null,
        still: true,
        closing: false,
        lured: false,
        hardened: false,
      };
    }

    const ctx = (tiles: number): EnemyAiCtx => ({
      getTile: () => 0,
      mapW: 40,
      mapH: 40,
      playerX: 30 * TILE,
      playerY: 30 * TILE,
      playerTargetable: true,
      lure: { x: 0, y: 0, tiles },
      leash: null,
      dtMs: TICK_MS,
    });

    expect(updateEnemyAi(guardiano(), ctx(lureBase)).lured).toBe(false);
    expect(updateEnemyAi(guardiano(), ctx(lureEco)).lured).toBe(true);
  });
});

// ================================================================
// PIASTRA FUSA — una carica di scudo in più, ricarica più lunga
// ================================================================

describe('Piastra Fusa', () => {
  const SHIELD = (() => {
    const d = LEVEL_ATTRACCO.shields[0]!;
    return centre(d.tx, d.ty);
  })();

  it('una carica di scudo in più alla raccolta', () => {
    const w = quiet(attracco());
    w.state.purchases = ['piastra-fusa'];
    w.state.player.x = SHIELD.x;
    w.state.player.y = SHIELD.y;

    const events = w.step();

    expect(events.some((e) => e.type === 'shieldPickup')).toBe(true);
    expect(w.state.player.shieldCharges).toBe(
      SHIELD_CHARGES_BASE + SHOP_PIASTRA_FUSA_CHARGES_DELTA,
    );
  });

  it("allunga la ricarica dell'arma — si vede nel mondo, non solo nella funzione pura", () => {
    const withIt = weaponStatsFor([], ['piastra-fusa']).cooldownMs;
    const without = weaponStatsFor([]).cooldownMs;
    expect(withIt).toBe(without + SHOP_PIASTRA_FUSA_COOLDOWN_DELTA_MS);

    const w = quiet(attracco());
    w.state.purchases = ['piastra-fusa'];
    w.step(input({ fire: true, aimAngle: Math.PI / 2 }));

    expect(w.state.player.weaponCooldown).toBe(withIt);
  });
});

// ================================================================
// ZAVORRA ALLEGGERITA e SCATTO TESO — passo, scatto, cooldown
// ================================================================
// Stessa forma del test "Passo Lungo alza la velocità base" in
// skilltree.test.ts: si cammina N tick e si confronta lo spostamento,
// dentro un mondo vivo — non la sola funzione pura, che skills.ts
// prova già per conto suo.

describe('Zavorra Alleggerita e Scatto Teso', () => {
  function worldWithPurchase(id: string | null): CampaignWorld {
    const w = quiet(attracco());
    w.state.unlockedNodes = ['scatto'];
    if (id) w.state.purchases = [id];
    w.state.player.x = 2.5 * TILE;
    w.state.player.y = 5.5 * TILE;
    w.state.player.angle = 0;
    return w;
  }

  it('Zavorra Alleggerita: passo più veloce, scatto più raro', () => {
    const base = worldWithPurchase(null);
    const w = worldWithPurchase('zavorra-alleggerita');
    for (let i = 0; i < 10; i++) {
      base.step(input({ forward: 1 }));
      w.step(input({ forward: 1 }));
    }
    const baseD = base.state.player.x - 2.5 * TILE;
    const withD = w.state.player.x - 2.5 * TILE;
    expect(withD).toBeCloseTo(baseD * SHOP_ZAVORRA_SPEED_MULT, 3);

    w.step(input({ dash: true, aimAngle: 0 }));
    expect(w.state.player.dashCooldown).toBe(SHOP_ZAVORRA_DASH_COOLDOWN_MS);
    expect(w.state.player.dashCooldown).toBeGreaterThan(DASH_COOLDOWN_MS);
  });

  it('Scatto Teso: scatto più forte, passo più corto', () => {
    const base = worldWithPurchase(null);
    const w = worldWithPurchase('scatto-teso');
    for (let i = 0; i < 10; i++) {
      base.step(input({ forward: 1 }));
      w.step(input({ forward: 1 }));
    }
    const baseD = base.state.player.x - 2.5 * TILE;
    const withD = w.state.player.x - 2.5 * TILE;
    expect(withD).toBeCloseTo(baseD * SHOP_SCATTO_TESO_SPEED_MULT, 3);

    w.step(input({ dash: true, aimAngle: 0 }));
    expect(w.state.player.dashSpeed).toBeCloseTo(DASH_SPEED * SHOP_SCATTO_TESO_DASH_MULT, 6);
  });
});

// ================================================================
// LA SECONDA MONETA — rendere un nodo
// ================================================================
// Il Banco accetta un punto libero, oppure un nodo reso. La seconda
// via non è una gentilezza: senza, il Banco del secondo atto non si
// aprirebbe mai.
//
// L'albero si spende dalla pausa in qualunque momento, quindi chi
// spende i punti appena li guadagna arriva all'intervallo d'atto con
// in tasca solo quelli arrivati col boss. Misurati sul percorso vero
// di chi ripulisce tutto: uno alla fine dell'Atto I (la Sentinella fa
// scattare una soglia), ZERO alla fine dell'Atto II. Le cifre le
// ricalcola `balance:campaign`.
//
// Questo blocco prova quel caso, non uno inventato: un giocatore che
// ha guadagnato un punto e l'ha già speso sull'albero.

/** Un profilo con esattamente un punto guadagnato e già speso: è la
 *  condizione in cui arriva al Banco chi spende man mano. */
function speseTutte(nodi: string[]): CampaignProfile {
  return { ...profileWith([]), xp: 60, unlockedNodes: nodi };
}

describe('tryPurchase — rendere un nodo al posto del punto', () => {
  it('chi ha speso tutto arriva a zero punti: è il caso che rende il reso necessario', () => {
    const w = quiet(attracco(speseTutte(['scatto'])));
    expect(w.availableSkillPoints).toBe(0);
    // Senza nodo reso è un no.
    expect(w.tryPurchase('eco-ampio')).toBe(false);
    expect(w.state.purchases).toHaveLength(0);
  });

  it('rendendo un nodo, lo stesso acquisto passa', () => {
    const w = quiet(attracco(speseTutte(['scatto'])));
    expect(w.tryPurchase('eco-ampio', 'scatto')).toBe(true);
    expect(w.state.purchases).toContain('eco-ampio');
    expect(w.state.unlockedNodes).not.toContain('scatto');
    // Il conto torna: un nodo in meno, un innesto in più, zero punti.
    expect(w.availableSkillPoints).toBe(0);
  });

  it('il reso emette il suo evento, sulla lista che tryPurchase riempie', () => {
    const w = quiet(attracco(speseTutte(['scatto'])));
    w.tryPurchase('eco-ampio', 'scatto');
    expect(w.events).toContainEqual({ type: 'nodeRefunded', id: 'scatto' });
    expect(w.events).toContainEqual({ type: 'itemPurchased', id: 'eco-ampio' });
  });

  it('...ma il tick successivo la azzera, ed è il motivo per cui il controller non ci si appoggia', () => {
    // Non è un difetto della simulazione: `step()` azzera `events`
    // come prima cosa perché la lista è l'uscita di UN tick. Ma
    // tryPurchase è un'azione di menu, chiamata fuori dal tick — e
    // durante l'intervallo d'atto il tick non gira nemmeno, perché il
    // gioco è fermo e subito dopo si costruisce un mondo nuovo.
    //
    // Chi legge questi eventi per dare un suono o un banner non li
    // vedrebbe mai. Il controller (game/campaignGame.ts) dà infatti il
    // suo riscontro dal valore di ritorno, come fa già per
    // tryUnlockNode. Questo test è qui perché quella scelta abbia una
    // prova invece di un commento.
    const w = quiet(attracco(speseTutte(['scatto'])));
    w.tryPurchase('eco-ampio', 'scatto');
    expect(w.events.length).toBeGreaterThan(0);
    const dopo = w.step(emptyCampaignInput());
    expect(dopo).not.toContainEqual({ type: 'itemPurchased', id: 'eco-ampio' });
  });

  it('non si rende un nodo da cui dipende un nodo posseduto', () => {
    // Renderlo lascerebbe `scatto-angolare` senza padre.
    const w = quiet(attracco({ ...profileWith([]), xp: 180, unlockedNodes: ['scatto', 'scatto-angolare'] }));
    expect(w.availableSkillPoints).toBe(0);
    expect(w.tryPurchase('eco-ampio', 'scatto')).toBe(false);
    expect(w.state.unlockedNodes).toContain('scatto');
    expect(w.state.purchases).toHaveLength(0);
  });

  it('il figlio invece si rende, e allora l\'acquisto passa', () => {
    const w = quiet(attracco({ ...profileWith([]), xp: 180, unlockedNodes: ['scatto', 'scatto-angolare'] }));
    expect(w.tryPurchase('eco-ampio', 'scatto-angolare')).toBe(true);
    expect(w.state.unlockedNodes).toEqual(['scatto']);
  });

  it('chi ha un punto libero non perde il nodo che offre', () => {
    // Il caso che sarebbe facile sbagliare: il reso deve scattare solo
    // quando serve, altrimenti il Banco farebbe pagare due volte.
    const w = quiet(attracco({ ...profileWith([]), xp: 180, unlockedNodes: ['scatto'] }));
    expect(w.availableSkillPoints).toBe(1);
    expect(w.tryPurchase('eco-ampio', 'scatto')).toBe(true);
    expect(w.state.unlockedNodes).toContain('scatto');
    expect(w.availableSkillPoints).toBe(0);
  });

  it('un nodo che non si possiede non compra niente', () => {
    const w = quiet(attracco(speseTutte(['scatto'])));
    expect(w.tryPurchase('eco-ampio', 'passo-lungo')).toBe(false);
    expect(w.state.unlockedNodes).toEqual(['scatto']);
  });

  it("rendere non aggira gli altri rifiuti: un doppione resta un doppione", () => {
    const w = quiet(attracco({ ...profileWith(['eco-ampio']), xp: 60, unlockedNodes: ['scatto'] }));
    expect(w.tryPurchase('eco-ampio', 'scatto')).toBe(false);
    expect(w.state.unlockedNodes).toContain('scatto');
  });

  it("e l'effetto dell'innesto comprato col reso è quello vero", () => {
    // Non basta che la lista si riempia: l'esca deve davvero vivere
    // meno, altrimenti avremmo comprato una riga di testo.
    const w = quiet(attracco(speseTutte(['scatto'])));
    w.tryPurchase('eco-ampio', 'scatto');
    expect(beaconStatsFor(w.state.unlockedNodes, w.state.purchases).lifetimeMs).toBe(
      SHOP_ECO_AMPIO_LIFETIME_MS,
    );
  });
});
