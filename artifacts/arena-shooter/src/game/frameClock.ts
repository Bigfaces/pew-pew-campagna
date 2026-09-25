// ================================================================
// OROLOGIO DEL LOOP — il delta fra due frame, mai fuori misura
// ================================================================
// Estratto da CampaignGame.loop() (game/campaignGame.ts) per
// lo stesso motivo per cui campaignNarrative.ts vive per conto suo:
// CampaignGame usa `canvas`/`document` ovunque e questa suite gira
// senza jsdom (vedi package.json — nessun `environment` configurato),
// quindi una funzione che deve avere un test vero non può restare
// chiusa dentro quella classe.
//
// Il difetto che ha reso necessario questo modulo: `loop(ts)` calcolava
// `frameDt = Math.min(ts - this.lastFrame, 250)`, con un tetto ma senza
// un pavimento. `ts` è il timestamp del prossimo rAF; `lastFrame` viene
// scritto con `performance.now()` da start()/resume()/closeLegend()/
// resetProfile(). Le due letture non condividono lo stesso istante di
// misura — un rAF appena richiesto può ricevere, per il proprio frame,
// un `ts` anteriore a quando `performance.now()` era stato letto poco
// prima nello stesso giro di eventi — e `ts - lastFrame` usciva
// negativo. Misurato nel 30-40% dei casi subito dopo closeLegend() o
// resume(): un `frameDt` negativo propagato in updateFeel (il ramo
// `Math.max(0, this.adsT - rate)` con `rate` negativo, che SALE invece
// di scendere) portava adsT sopra 1 — osservato attorno a 4 — e da lì
// overlay.ts calcolava un raggio negativo: `IndexSizeError` su ogni
// `arc()`/`createRadialGradient()` della schermata dell'ottica.
//
// La correzione alla radice è qui: un pavimento a 0 oltre al tetto
// esistente. overlay.ts porta comunque una seconda guardia indipendente
// sullo stesso valore (vedi il commento in renderScope) — due controlli
// sullo stesso numero, uno in chi lo calcola e uno in chi lo consuma,
// perché un valore che può corrompere lo schermo non deve dipendere da
// una sola linea di difesa.
// ================================================================

/** Il delta fra due frame del loop principale, sempre in [0, maxMs].
 *  `maxMs` è lo stesso tetto che il loop usava già per non far correre
 *  troppi tick dopo una tab tornata in primo piano dopo una pausa lunga
 *  — qui si applica anche all'altro verso, un `rawDt` negativo per un
 *  disallineamento fra i due orologi del browser (rAF contro
 *  `performance.now()`). Un `rawDt` non finito (NaN, ±Infinity) non è
 *  un caso osservato ma non costa nulla scartarlo allo stesso modo: un
 *  frame senza un delta valido non deve far avanzare niente. */
export function clampFrameDt(rawDt: number, maxMs: number): number {
  if (!Number.isFinite(rawDt)) return 0;
  return Math.max(0, Math.min(rawDt, maxMs));
}
