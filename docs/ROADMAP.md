# Cosa resta da fare

Lista di lavoro nata dalla revisione completa del 24 settembre (la storia è
in [GDD.md](GDD.md) §23). Tre parti: le **decisioni** che spettano al
proprietario del progetto e che nessuna correzione può prendere al suo posto,
i **difetti noti** ancora aperti, e gli **step** proposti, in ordine.

Quando una voce si chiude, la si toglie da qui e la storia va nel GDD, come
per tutto il resto del progetto.

---

## Decisioni da prendere

Ognuna ha una raccomandazione, ma nessuna è ovvia: cambiano il gioco o il
repository in modi che vale la pena scegliere, non dedurre.

| # | Domanda | Raccomandazione | Perché |
| --- | --- | --- | --- |
| D2 | `render/particles.ts` (297 righe, mai importato da nessuno dal giorno del fork): collegarlo o toglierlo? | **Collegarlo** | Lo sparo ha il suono da questo giro ma nessun segno visivo: niente lampo alla canna, niente scintille sul muro. Il modulo ha già `muzzle()`, `bulletImpact()`, `blood()`, `shieldShatter()`. |
| D3 | XP dei colpi al boss: oggi ogni colpo paga (`XP_BOSS_HIT_SOLID/GRAZE`) anche dopo una morte che rimette il boss in piedi. | **Pagarli una sola volta per fase** | È l'ultimo varco per rifarmare XP morendo apposta: nemici e torrette sono stati chiusi in questo giro (§9, «morire non deve poter rifarmare esperienza»). |
| D4 | ARBITER diventa «alterato» dopo 2 colpi su 3 della fase di caccia: la soglia è quella della Sentinella (`BOSS_ENRAGE_AT = 1,5`), riusata senza commento. | **Soglia propria**, su `stageDamage` | Non è chiaro se sia voluto; se lo è, basta un commento. |
| D5 | Dopo l'Atto III non c'è un Banco (§14, «il buco noto»), e i boss pagano solo XP (§13). | **Aspettare il primo playtest umano completo** | Nessuno ha ancora giocato la campagna fino in fondo: progettare una ricompensa finale prima di sapere com'è arrivarci è progettare al buio. |
| D6 | Formattazione: Prettier è installato ma non configurato, e 56 file su 58 non lo rispettano. ESLint non c'è. | **Configurare Prettier con lo stile attuale e formattare tutto in un commit solo**, poi aggiungerlo alla CI | Un commit di sola formattazione, fatto una volta, non sporca i diff dopo. |

## Difetti noti, ancora aperti

In ordine di quanto pesano su chi gioca.

1. **Atti II e III mai provati nel browser.** Non esiste un modo di saltare
   a un livello, quindi il playtest automatico si ferma all'ATTRACCO. I test
   headless coprono la simulazione di tutti e nove i livelli, ma non il
   rendering, la HUD e l'audio di Custode, ARBITER, Banco e passaggi d'atto.
2. **Il Trasponditore non si insegna da solo.** Il README lo chiama «la cosa
   meno ovvia del gioco». Il punto debole ha la sua schermata al primo nemico
   (§22), l'esca no: si parte con due cariche senza che nessuno lo dica, e il
   primo livello non ne ha a terra.
3. **«PRIMO CONTATTO» scatta quasi subito** nell'ATTRACCO: il primo nemico è
   a pochi passi dallo spawn, e la schermata interrompe prima che si sia
   visto la stanza.
4. **La battuta di ARBITER sulla prima morte per il boss nomina la
   Sentinella** anche se il boss è il Custode o ARBITER stesso (chi riprende
   un profilo già nell'Atto II). L'evento `playerDied` non dice di che boss
   si tratta.
5. **Prestazioni da misurare su una macchina vera.** In Chromium headless
   senza GPU il gioco gira a 10-12 fps a 1920×1080. Probabilmente è il
   rendering software, ma nessuno l'ha verificato su hardware reale.
6. **§17.3 del GDD dice che nessun livello arriva a zero morti** restando
   fermi: da §18 non è più vero per CONDOTTI e ANELLO. O si aggiorna la
   frase, o si aggiunge una minaccia vicino allo spawn di quei due.
7. Minori: il ridimensionamento della finestra viene gestito due volte
   (`resize` e `ResizeObserver`); `maximum-scale=1` in `index.html` blocca
   lo zoom con due dita; le righe dinamiche della HUD non hanno
   `aria-live`; `AVVIA.cmd` dice ancora «Node 20 o superiore» nel messaggio
   di fallback; `AudioEngine` ha sei metodi rimasti dall'Arena e mai chiamati
   (`respawn`, `countdownBeep`, `footstep`, `uiClick`, `setVolume`,
   `enabled`).

## Debito tecnico

Non rompe niente oggi, ma rende ogni correzione futura più cara.

- **`sim/campaign/world.ts` ha 2 300 righe.** I due difetti più gravi di
  questo giro vivevano entrambi nella parte checkpoint/respawn. Spezzarlo per
  responsabilità — `respawn.ts`, `boss.ts`, `hazards.ts`, `combat.ts`,
  `beacon.ts` — sullo schema già usato da `enemyAi.ts` (funzioni pure con
  contesto esplicito), lasciando a `CampaignWorld` il ruolo di chi le chiama.
- **`game/campaignGame.ts` ha 1 700 righe e nessun test diretto**, perché usa
  `canvas` e `document`. Estrarre lo smistamento degli eventi e il montaggio
  della HUD in funzioni pure, come già fatto con `campaignNarrative.ts`,
  `campaignShop.ts` e ora `frameClock.ts`.
- **`render/campaignScene.ts` ha 1 500 righe**: billboard, decalcomanie a
  pavimento e minimappa sono già separati nei commenti, non nei file.
- **Due motori audio con la stessa infrastruttura scritta due volte**
  (`engine.ts` e `campaignVoice.ts`). Aveva senso con l'Arena multigiocatore;
  ora basterebbe un nucleo Web Audio comune.
- **Test mancanti**: `stats/campaignProfile.ts` (profilo corrotto,
  `localStorage` che lancia, versione diversa), `audio/engine.ts`,
  `ui/TouchControls.tsx` (la matematica del joystick è pura),
  `render/camera.ts` (i casi limite di `projectPoint`, cuore della
  correzione di §17.1).
- **Le vulnerabilità restanti di `pnpm audit`** (10, nessuna critica): nove
  nella catena di build e test del gioco (`vitest`, `postcss`, `nanoid`,
  `browserslist`, `baseline-browser-mapping`) e una in `esbuild`. Sono tutte
  dipendenze di sviluppo e nessuna finisce nel file pubblicato, ma vanno
  aggiornate.
- `tsconfig.base.json` spegne `strictFunctionTypes` e `noImplicitOverride`
  senza dire perché.

---

## Step proposti

Ognuno si chiude da solo e lascia il gioco pubblicabile.

1. **Portare questo giro su `main`.** GitHub Pages pubblica da `main`: finché
   il branch della revisione non ci arriva, chi apre il link gioca con lo
   sparo muto e l'ottica che può andare in eccezione.
2. **Vedere tutta la campagna.** Un parametro d'URL attivo solo in sviluppo
   (per esempio `?livello=archivio`) per partire da qualunque livello, poi un
   playtest automatico di Atti II e III e dei passaggi d'atto. Subito dopo, il
   playtest umano dall'inizio alla fine che il README chiede da sempre: è il
   dato che manca per decidere D5.
3. **Il colpo si deve vedere, oltre che sentire.** D2 (particelle), più
   l'onboarding del Trasponditore e il «PRIMO CONTATTO» un po' più tardi
   (difetti 2 e 3).
4. **Pulizia.** D6 (Prettier nella CI), i metodi audio morti, i minori del
   punto 7.
5. **Refactoring** di `world.ts` e `campaignGame.ts`, con i test mancanti
   scritti *prima* di spostare il codice, così provano che niente è cambiato.
6. **Contenuti**, solo dopo il playtest umano: D3, D4, D5.
