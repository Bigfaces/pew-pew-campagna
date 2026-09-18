// ================================================================
// BANCO DI RICONFIGURAZIONE — cosa si può comprare, non come si vede
// ================================================================
// Stesso principio di campaignNarrative.ts, per lo stesso motivo:
// CampaignGame (game/campaignGame.ts) usa `canvas`/`document` ovunque
// e la suite gira senza jsdom (nessun `environment` in vite.config.ts,
// nessuna dipendenza jsdom in package.json), quindi una classe non è
// istanziabile qui. Il Banco è per giunta una schermata che dovrà
// vivere dentro quella stessa classe — la ragione di tenerne fuori la
// logica è ancora più forte che per la narrazione: qui c'è un vero
// calcolo (posso permettermelo? l'ho già preso? è ancora offerto?),
// non solo un ordine di eventi, ed è esattamente il genere di cosa
// che si vuole provare senza un browser.
//
// Il contratto (SHOP_ITEMS, ShopItemDef, shopItemsForAct,
// SHOP_ITEM_COST in sim/campaign/constants.ts; shopItemById,
// isValidShopItem, shopItemCost in sim/campaign/skills.ts; il tipo di
// rifiuto in sim/campaign/types.ts) è già scritto e congelato: questo
// modulo non lo ridefinisce, lo usa.
//
// Il cancello dell'atto — "questo innesto si vende solo dopo l'atto
// che lo offre" — vive SOLO qui, in canPurchase. CampaignWorld, che
// applica 'itemPurchased'/'purchaseRefused' dentro la simulazione di
// un livello, non può saperlo: simula un livello alla volta e non ha
// il contesto dell'intervallo fra un atto e l'altro (quale atto è
// appena finito, quali innesti sono "di questo giro"). I suoi
// controlli restano meccanici — id sconosciuto, doppione, punti — gli
// stessi che shopItemCost e isValidShopItem già gli danno.
// ================================================================

import { SHOP_ITEMS, shopItemsForAct, type ShopItemDef } from '../sim/campaign/constants';
import { refundableNodes, shopItemById, shopItemCost } from '../sim/campaign/skills';

/** Un innesto offerto al Banco, con il suo stato per QUESTA visita.
 *
 *  Tre campi distinti apposta, non un `disabled` solo: la HUD deve
 *  poter dire "già preso" e "non basta il punto" in due modi diversi
 *  (un segno di spunta contro un prezzo in rosso, per dire), e
 *  collassarli in un booleano la costringerebbe a ricalcolare da capo
 *  la distinzione che questo modulo ha già fatto. */
export interface ShopRow {
  item: ShopItemDef;
  /** Già comprato in questa run (o in una run precedente il cui
   *  profilo l'ha portato fin qui). */
  owned: boolean;
  /** Vero se i punti disponibili bastano al costo dell'innesto, a
   *  prescindere dal fatto che sia già posseduto. */
  affordable: boolean;
  /** Vero solo se non posseduto E affordable: è la condizione che
   *  decide se il tasto "Innesta" della HUD è premibile col punto. */
  buyable: boolean;
  /** I nodi che il Banco accetterebbe al posto del punto, quando il
   *  punto non c'è. Vuota quando i punti bastano — chiedere di rendere
   *  qualcosa a chi può pagare sarebbe una domanda inutile — e vuota
   *  anche quando non c'è proprio niente di rendibile.
   *
   *  Non è un ripiego: senza questa seconda moneta il Banco del
   *  secondo atto non si aprirebbe mai. L'albero si spende dalla pausa
   *  in qualunque momento, quindi chi spende man mano arriva
   *  all'intervallo d'atto con i soli punti arrivati col boss — uno
   *  alla fine dell'Atto I, zero alla fine dell'Atto II. */
  refundCandidates: readonly string[];
}

/** Gli innesti offerti al varco dopo `actCompleted`, ciascuno con il
 *  proprio stato rispetto a `purchases` e `availablePoints`. Vuoto per
 *  un atto senza offerta — oggi l'Atto III, dopo ARBITER: non c'è un
 *  intervallo in cui spendere, ed è un buco noto (vedi GDD sezione 13
 *  e il commento su `shopItemsForAct`). */
export function shopOffer(
  actCompleted: number,
  purchases: readonly string[],
  availablePoints: number,
  unlocked: readonly string[] = [],
): readonly ShopRow[] {
  // Calcolata una volta sola e non per riga: la lista dei nodi
  // rendibili non dipende da quale innesto si sta guardando.
  const rendibili = refundableNodes(unlocked);
  return shopItemsForAct(actCompleted).map((item) => {
    const owned = purchases.includes(item.id);
    const affordable = availablePoints >= item.cost;
    return {
      item,
      owned,
      affordable,
      buyable: !owned && affordable,
      refundCandidates: !owned && !affordable ? rendibili : [],
    };
  });
}

/** L'esito di un tentativo d'acquisto, con il motivo del rifiuto —
 *  stesse quattro stringhe di `purchaseRefused` in sim/campaign/types.ts,
 *  perché questa funzione è la fonte di verità che la HUD interroga
 *  PRIMA di mandare l'acquisto alla simulazione: deve poter dire lo
 *  stesso "perché no" che la sim direbbe dopo, non un altro. */
export type PurchaseCheck = { ok: true } | { ok: false; reason: 'punti' | 'atto' | 'gia-preso' | 'sconosciuto' };

/** Decide se `id` è comprabile adesso, al varco dopo `actCompleted`.
 *
 *  L'ordine dei controlli non è arbitrario: un id che non esiste non
 *  è "offerto in un atto sbagliato", è sconosciuto punto e basta,
 *  quindi quel controllo viene prima di ogni altro; un innesto offerto
 *  nell'atto giusto ma già preso è un rifiuto diverso da uno mai
 *  offerto, quindi 'atto' precede 'gia-preso'; i punti sono l'ultimo
 *  perché sono l'unica condizione che cambia comprando altro nella
 *  stessa visita — le prime tre dipendono solo da cosa è `id` e da
 *  cosa il giocatore ha già, non da quanto gli resta in tasca. */
export function canPurchase(
  id: string,
  actCompleted: number,
  purchases: readonly string[],
  availablePoints: number,
): PurchaseCheck {
  const item = shopItemById(id);
  if (!item) return { ok: false, reason: 'sconosciuto' };
  if (item.act !== actCompleted) return { ok: false, reason: 'atto' };
  if (purchases.includes(id)) return { ok: false, reason: 'gia-preso' };
  if (availablePoints < item.cost) return { ok: false, reason: 'punti' };
  return { ok: true };
}

/** COME si paga un innesto, non SE si può.
 *
 *  Il Banco accetta due monete: un punto abilità non ancora speso,
 *  oppure un nodo reso. La seconda non è una gentilezza — senza, il
 *  Banco del secondo atto non si aprirebbe mai. L'albero si spende
 *  dalla pausa in qualunque momento, quindi chi spende i punti appena
 *  li guadagna arriva all'intervallo d'atto con in tasca soltanto
 *  quelli arrivati col boss: misurati sul percorso vero, uno alla fine
 *  dell'Atto I e ZERO alla fine dell'Atto II.
 *
 *  Le due monete valgono uguale, e non per comodità: un punto speso è
 *  un nodo non comprato, quindi in entrambi i casi si finisce la
 *  campagna con quattordici cose in tutto. Lo spazio delle build
 *  misurato non cambia di una riga a seconda di come si è pagato. */
export type Payment =
  | { kind: 'punto' }
  | { kind: 'reso'; candidates: readonly string[] }
  | { kind: 'no'; reason: 'punti' | 'atto' | 'gia-preso' | 'sconosciuto' };

export function paymentFor(
  id: string,
  actCompleted: number,
  purchases: readonly string[],
  availablePoints: number,
  unlocked: readonly string[],
): Payment {
  const check = canPurchase(id, actCompleted, purchases, availablePoints);
  if (check.ok) return { kind: 'punto' };
  // Solo la mancanza di punti ha una seconda via. Un id sconosciuto,
  // un atto sbagliato o un innesto già preso restano no: non è il
  // prezzo a mancare.
  if (check.reason !== 'punti') return { kind: 'no', reason: check.reason };
  const candidates = refundableNodes(unlocked);
  if (candidates.length === 0) return { kind: 'no', reason: 'punti' };
  return { kind: 'reso', candidates };
}

/** Quanti punti resterebbero comprando `id` — la domanda che la HUD fa
 *  PRIMA di lasciar decidere, che è il punto del Banco: mostrare il
 *  costo di una scelta prima di prenderla, non solo dopo.
 *
 *  Un id già posseduto o inesistente non cambia i punti: non è un
 *  acquisto che può accadere, quindi non è una spesa da anticipare — a
 *  differenza di `canPurchase`, che deve DIRE perché non si può
 *  comprare, questa funzione deve solo prevedere un numero, e un
 *  acquisto impossibile non sposta quel numero. (Restituire
 *  `availablePoints - Infinity` per un id sconosciuto sarebbe tecnicamente
 *  corretto ma inutile a chi legge una HUD.) */
export function pointsAfter(
  purchases: readonly string[],
  availablePoints: number,
  id: string,
): number {
  if (purchases.includes(id)) return availablePoints;
  const cost = shopItemCost(id);
  if (!Number.isFinite(cost)) return availablePoints;
  return availablePoints - cost;
}

/** Gli innesti già comprati, in ordine di SHOP_ITEMS — per la
 *  schermata di fine campagna, che riassume l'equipaggiamento finale
 *  del giocatore. Un id in `purchases` che non si sa più leggere (un
 *  profilo vecchio, un innesto rimosso) viene ignorato invece di
 *  rompere il riassunto: stessa clemenza di `pointsSpent` verso i
 *  profili datati, qui applicata a una lista invece che a un conteggio. */
export function purchasedItems(purchases: readonly string[]): readonly ShopItemDef[] {
  return SHOP_ITEMS.filter((item) => purchases.includes(item.id));
}
