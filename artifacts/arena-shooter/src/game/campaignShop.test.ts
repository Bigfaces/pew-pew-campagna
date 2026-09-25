// ================================================================
// BANCO DI RICONFIGURAZIONE — test del calcolo, non della schermata
// ================================================================
// campaignGame.ts non è istanziabile qui (usa canvas/document e la
// suite gira senza jsdom — vedi il commento in campaignShop.ts),
// quindi questi test provano direttamente ciò che è stato estratto
// per essere provabile: cosa offrire, cosa si può comprare e perché
// no, quanto costerebbe. Come il Banco appare a schermo resta al giro
// in browser.
// ================================================================

import { describe, expect, it } from 'vitest';

import { canPurchase, pointsAfter, purchasedItems, shopOffer, paymentFor } from './campaignShop';

describe('shopOffer — cosa mostra il Banco a ciascun varco', () => {
  it('dopo l’Atto I offre i tre innesti di quell’atto, nessuno posseduto, tutti alla portata di 3 punti', () => {
    const rows = shopOffer(1, [], 3);
    expect(rows.map((r) => r.item.id)).toEqual([
      'otturatore-spinto',
      'eco-ampio',
      'zavorra-alleggerita',
    ]);
    for (const row of rows) {
      expect(row.owned).toBe(false);
      expect(row.affordable).toBe(true);
      expect(row.buyable).toBe(true);
    }
  });

  it('dopo l’Atto II offre i tre innesti di quell’atto, non quelli dell’Atto I', () => {
    const rows = shopOffer(2, [], 3);
    expect(rows.map((r) => r.item.id)).toEqual(['doppio-innesco', 'scatto-teso', 'piastra-fusa']);
  });

  it('dopo l’Atto III l’offerta è vuota: non c’è un varco dopo ARBITER (buco noto, GDD sezione 13)', () => {
    expect(shopOffer(3, [], 99)).toEqual([]);
  });

  it('un innesto già preso è owned e mai buyable, anche con punti a sufficienza', () => {
    const rows = shopOffer(1, ['eco-ampio'], 5);
    const row = rows.find((r) => r.item.id === 'eco-ampio')!;
    expect(row.owned).toBe(true);
    expect(row.affordable).toBe(true); // i punti ci sarebbero...
    expect(row.buyable).toBe(false); // ...ma non serve, è già suo
  });

  it('un innesto non posseduto ma senza punti è affordable false e buyable false, per un motivo diverso dal precedente', () => {
    const rows = shopOffer(1, [], 0);
    const row = rows.find((r) => r.item.id === 'otturatore-spinto')!;
    expect(row.owned).toBe(false);
    expect(row.affordable).toBe(false);
    expect(row.buyable).toBe(false);
  });
});

describe('canPurchase — i quattro motivi di rifiuto, in ordine', () => {
  it('un id che non esiste è sempre sconosciuto, a prescindere da atto, acquisti o punti', () => {
    expect(canPurchase('non-esiste', 1, [], 99)).toEqual({
      ok: false,
      reason: 'sconosciuto',
    });
  });

  it('un innesto reale ma offerto in un altro atto è rifiutato per atto, non per sconosciuto', () => {
    // scatto-teso è dell'Atto II: chiederlo al varco dell'Atto I deve
    // fallire per il motivo "atto sbagliato", non "non esiste".
    expect(canPurchase('scatto-teso', 1, [], 99)).toEqual({
      ok: false,
      reason: 'atto',
    });
  });

  it('un innesto dell’atto giusto ma già preso è rifiutato per gia-preso, anche con punti in abbondanza', () => {
    expect(canPurchase('otturatore-spinto', 1, ['otturatore-spinto'], 99)).toEqual({
      ok: false,
      reason: 'gia-preso',
    });
  });

  it('un innesto offerto e non ancora preso ma senza punti è rifiutato per punti', () => {
    expect(canPurchase('otturatore-spinto', 1, [], 0)).toEqual({
      ok: false,
      reason: 'punti',
    });
  });

  it('atto giusto, non posseduto, punti sufficienti: acquisto valido', () => {
    expect(canPurchase('otturatore-spinto', 1, [], 1)).toEqual({ ok: true });
  });

  it('atto sbagliato precede gia-preso: un innesto già preso ma chiesto fuori dal suo atto resta un errore di atto', () => {
    // Non può succedere nel flusso normale (il Banco non lo offrirebbe
    // fuori dal suo atto), ma la funzione non conosce il flusso: fissa
    // solo l'ordine dei controlli richiesto dal contratto.
    expect(canPurchase('otturatore-spinto', 2, ['otturatore-spinto'], 99)).toEqual({
      ok: false,
      reason: 'atto',
    });
  });
});

describe('pointsAfter — l’anteprima di spesa prima di decidere', () => {
  it('comprare un innesto da 1 punto lascia availablePoints - 1', () => {
    expect(pointsAfter([], 3, 'otturatore-spinto')).toBe(2);
  });

  it('un innesto già posseduto non cambia i punti: non è un acquisto che può accadere', () => {
    expect(pointsAfter(['otturatore-spinto'], 3, 'otturatore-spinto')).toBe(3);
  });

  it('un id sconosciuto non cambia i punti: niente -Infinity in una HUD', () => {
    expect(pointsAfter([], 3, 'non-esiste')).toBe(3);
  });
});

describe('purchasedItems — il riassunto di fine campagna', () => {
  it('elenca gli innesti comprati in ordine di SHOP_ITEMS, non nell’ordine di acquisto', () => {
    // piastra-fusa è dopo scatto-teso in SHOP_ITEMS: passarli invertiti
    // deve comunque tornare nell'ordine del catalogo.
    const items = purchasedItems(['piastra-fusa', 'zavorra-alleggerita']);
    expect(items.map((i) => i.id)).toEqual(['zavorra-alleggerita', 'piastra-fusa']);
  });

  it('ignora un id che non si sa più leggere, in mezzo a due validi: un profilo vecchio non deve rompere il riassunto', () => {
    const items = purchasedItems([
      'otturatore-spinto',
      'innesto-rimosso-da-una-versione-vecchia',
      'eco-ampio',
    ]);
    expect(items.map((i) => i.id)).toEqual(['otturatore-spinto', 'eco-ampio']);
  });

  it('lista vuota per nessun acquisto', () => {
    expect(purchasedItems([])).toEqual([]);
  });
});

// ================================================================
// LE DUE MONETE
// ================================================================
// Il Banco accetta un punto libero oppure un nodo reso. La seconda
// via esiste per una ragione misurata, non per gentilezza: l'albero si
// spende dalla pausa in qualunque momento, quindi chi spende man mano
// arriva all'intervallo d'atto con i soli punti arrivati col boss —
// uno alla fine dell'Atto I, zero alla fine dell'Atto II. Senza il
// reso, il secondo Banco non si aprirebbe mai.

describe('paymentFor — come si paga, non se si può', () => {
  it('con un punto in tasca si paga col punto, e non si chiede nulla', () => {
    expect(paymentFor('eco-ampio', 1, [], 1, ['scatto'])).toEqual({ kind: 'punto' });
  });

  it('senza punti ma con un nodo rendibile, il Banco propone il reso', () => {
    const p = paymentFor('eco-ampio', 1, [], 0, ['scatto', 'passo-lungo']);
    expect(p.kind).toBe('reso');
    if (p.kind === 'reso') {
      expect(p.candidates).toContain('scatto');
      expect(p.candidates).toContain('passo-lungo');
    }
  });

  it('propone solo i nodi che si possono davvero rendere', () => {
    // `scatto` ha un figlio posseduto: renderlo lascerebbe un orfano.
    const p = paymentFor('eco-ampio', 1, [], 0, ['scatto', 'scatto-angolare']);
    expect(p.kind).toBe('reso');
    if (p.kind === 'reso') {
      expect(p.candidates).toEqual(['scatto-angolare']);
    }
  });

  it('senza punti e senza niente da rendere, è un no per i punti', () => {
    expect(paymentFor('eco-ampio', 1, [], 0, [])).toEqual({ kind: 'no', reason: 'punti' });
  });

  it('gli altri tre rifiuti non hanno una seconda via: non è il prezzo a mancare', () => {
    const albero = ['scatto', 'passo-lungo'];
    expect(paymentFor('non-esiste', 1, [], 0, albero)).toEqual({
      kind: 'no',
      reason: 'sconosciuto',
    });
    expect(paymentFor('doppio-innesco', 1, [], 0, albero)).toEqual({ kind: 'no', reason: 'atto' });
    expect(paymentFor('eco-ampio', 1, ['eco-ampio'], 0, albero)).toEqual({
      kind: 'no',
      reason: 'gia-preso',
    });
  });

  it('avere punti vince sul reso: non si rende un nodo se non serve', () => {
    // Il caso che conta davvero: con un punto libero E dei nodi
    // rendibili, il Banco non deve chiedere di rendere niente.
    expect(paymentFor('eco-ampio', 1, [], 3, ['scatto', 'passo-lungo'])).toEqual({ kind: 'punto' });
  });
});

describe('shopOffer — i candidati al reso', () => {
  it('con i punti che bastano non propone di rendere niente', () => {
    const righe = shopOffer(1, [], 3, ['scatto', 'passo-lungo']);
    expect(righe.length).toBeGreaterThan(0);
    for (const r of righe) expect(r.refundCandidates).toHaveLength(0);
  });

  it('senza punti propone i nodi rendibili, e solo quelli', () => {
    const righe = shopOffer(1, [], 0, ['scatto', 'scatto-angolare', 'passo-lungo']);
    for (const r of righe) {
      expect(r.buyable).toBe(false);
      expect([...r.refundCandidates].sort()).toEqual(['passo-lungo', 'scatto-angolare']);
    }
  });

  it("un innesto gia' preso non chiede niente in cambio", () => {
    const righe = shopOffer(1, ['eco-ampio'], 0, ['scatto']);
    const eco = righe.find((r) => r.item.id === 'eco-ampio');
    expect(eco?.owned).toBe(true);
    expect(eco?.refundCandidates).toHaveLength(0);
  });

  it("senza punti e con l'albero vuoto non c'e' seconda via", () => {
    const righe = shopOffer(1, [], 0, []);
    for (const r of righe) expect(r.refundCandidates).toHaveLength(0);
  });
});
