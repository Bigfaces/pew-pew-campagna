# Pew Pew Campagna — KESSLER-9

Campagna FPS per browser, in prima persona: tre atti, nove livelli, tre boss,
dieci tipi di nemico, un albero di abilità a diciassette nodi e un Banco di
Riconfigurazione fra un atto e l'altro. Gira interamente client-side — niente
plugin, niente asset da scaricare: le texture dei muri sono disegnate in
codice all'avvio e ogni suono è sintetizzato con Web Audio. Il piano
completo, con le misure dietro ogni scelta di bilanciamento, è in
[docs/GDD.md](docs/GDD.md).

Nasce come fork di un vecchio deathmatch multiplayer via WebRTC (l'Arena):
quella modalità è stata tolta per intero — bot, partite online, minimappa,
statistiche di carriera (docs/GDD.md §19). Quel che resta del fork è la base
tecnica: il raycaster su canvas 2D e il motore audio sintetizzato.

## Run & Operate

- `pnpm --filter @workspace/arena-shooter run dev` — il gioco (Vite, porta
  5173 di default)
- `pnpm --filter @workspace/arena-shooter run build:standalone` — rigenera il
  file singolo che poi va copiato a mano sopra `docs/index.html` (vedi
  README.md)
- `pnpm --filter @workspace/arena-shooter run build` — build web "normale",
  con asset separati invece del file unico
- `pnpm --filter @workspace/arena-shooter run balance:campaign` — banco di
  bilanciamento headless: gioca centinaia di partite e stampa le invarianti
  dell'albero delle abilità, il ritmo dei boss, la finestra reale del
  Trasponditore misurata sull'IA nemica, lo spazio delle build e il costo di
  ogni oggetto del Banco
- `pnpm run test` — tutta la suite, headless
- `pnpm run typecheck` — typecheck di tutti i pacchetti del workspace (prima
  `typecheck:libs`, perché `lib/*` deve emettere i suoi `.d.ts`)
- `pnpm run build` — typecheck + build ricorsiva di tutto il workspace,
  incluso `artifacts/api-server`, che il gioco non contatta più (vedi sotto)

Ambiente, letto da `vite.config.ts`:

- `PORT` — porta del dev server e della preview. Di default `5173` se
  assente; gli ambienti ospitati (Replit) la iniettano.
- `BASE_PATH` — prefisso base per gli asset (`base` di Vite), per servire il
  gioco sotto un sottopercorso diverso dalla radice. Di default `/`.

Non serve nient'altro per giocare: la campagna è single-player e il profilo
vive nel `localStorage` del browser, non su un server.

## Stack

pnpm workspaces · Node.js 22 o più recente (consigliato 24) · TypeScript 5.9
· Vite 7 · React 19 (solo per i menu) · canvas 2D per il mondo · Vitest.
`artifacts/api-server` (Express 5, PostgreSQL + Drizzle) resta nel
repository ma il client non lo contatta più — vedi "Cosa resta dell'Arena"
più sotto.

## Dove vive il codice

Tutto il gameplay sta in `artifacts/arena-shooter/src`:

| Percorso | Cosa c'è |
| --- | --- |
| `sim/` | Simulazione pura, più le costanti e i tipi comuni del motore. Niente DOM: gira headless nei test. |
| `sim/campaign/` | Le regole vere della campagna: `world.ts` (`CampaignWorld`, la simulazione autorevole — un'istanza simula un livello), `levels.ts` (i nove livelli), `enemies.ts`/`enemyAi.ts` (archetipi e IA), `physics.ts`, `skills.ts` (albero delle abilità e Banco), `constants.ts` (soglie XP, boss, Trasponditore). |
| `render/` | Disegno su canvas 2D: muri raycast e texture (`campaignScene.ts`, `textures.ts`), sprite (`spriteBaker.ts`, `enemySprites.ts`), sfondo (`backdrop.ts`), camera e viewport (`camera.ts`), overlay della HUD — banner, danno, ottica (`overlay.ts`). |
| `audio/` | Sintesi Web Audio, nessun file audio: `engine.ts` è il motore di base (impatti, colpi a segno, raccolte, esito partita), `campaignVoice.ts` è la voce narrativa della campagna (ARBITER, porte, gas, scatto...) — un'istanza separata, con un proprio `AudioContext`. |
| `game/` | Il controller a tick fissi: `campaignGame.ts` costruisce l'input, avanza la simulazione e smista i suoi eventi. `campaignNarrative.ts` (ordine delle battute di fine livello) e `campaignShop.ts` (logica del Banco lato controller) sono moduli a parte apposta, per poter essere testati senza `canvas`/`document` — la suite gira senza jsdom. |
| `ui/` | Schermate React: menu, HUD (`CampaignHud.tsx`), controlli touch (`TouchControls.tsx`), testi e ritmo delle battute di ARBITER (`arbiter.ts`). |
| `stats/` | Il profilo di campagna in `localStorage` (`campaignProfile.ts`): XP, nodi sbloccati, checkpoint, difficoltà, se la legenda del primo nemico è già stata vista. |
| `tools/` | `balance-campaign.mts`, il banco di bilanciamento headless; `impronta.ts`, l'hash dei sorgenti che finiscono nel bundle standalone, usato dalla build e dal test che sorveglia `docs/index.html`. |

## Decisioni architetturali

- **La simulazione è pura e avanza a tick fissi di 60 Hz**
  (`TICK_MS = 1000/60`, `sim/constants.ts`). Non dipende dal DOM, quindi gira
  nei test, e non dipende dall'orologio, quindi si comporta identica su un
  monitor a 60 Hz e a 240 Hz. Il renderer va libero (`requestAnimationFrame`)
  e interpola fra gli ultimi due tick.

- **L'input è l'unica leva che il controller ha sulla simulazione, tick per
  tick.** `CampaignGame` (`game/campaignGame.ts`) costruisce un
  `CampaignInput` da tastiera/mouse/joystick a schermo e lo passa a
  `CampaignWorld.step()`; non muta mai lo stato del mondo per conto suo. Le
  azioni fuori dal tick — comprare un nodo dell'albero o un innesto del
  Banco — passano da metodi dedicati (`tryUnlockNode`, `tryPurchase`), mai da
  una scorciatoia diretta sullo stato. (I nemici non condividono lo stesso
  tipo di input del giocatore: la loro IA produce un `EnemyIntent` a parte,
  letto da `updateEnemies()` nello stesso tick.)

- **Gli eventi della simulazione sono smistati dal controller, non generati
  da lei stessa in forma di audio o grafica.** `CampaignWorld.step()`
  ritorna un array di `CampaignEvent`; `campaignGame.ts` (il suo
  `handleEvents`) li traduce in audio, banner, callout e transizioni (fine
  livello, fine atto, schermata di avvistamento del primo nemico). La sim
  non tocca mai canvas o `AudioContext` direttamente.

- **Il gioco pubblicato è un solo file HTML** (`docs/index.html`), prodotto
  da `build:standalone` come script classico IIFE — non un modulo ESM,
  perché i browser bloccano `<script type="module">` su `file://` — e
  copiato a mano sopra il file committato. La sua integrità è sorvegliata da
  un'impronta sha256 di tutti i sorgenti che entrano nel bundle
  (`tools/impronta.ts`), incisa nell'HTML in fase di build e confrontata da
  `src/ui/pubblicato.test.ts` a ogni `pnpm run test`: vedi docs/GDD.md §21
  per la storia del buco che questo test copre — una modifica che cambia
  solo logica, senza toccare una stringa a schermo, che la sola guardia
  testuale non avrebbe visto.

- **Il profilo vive solo nel `localStorage` del browser**
  (`stats/campaignProfile.ts`): XP, nodi sbloccati, checkpoint, difficoltà.
  Niente server, quindi niente account e niente sincronizzazione fra
  dispositivi; un salvataggio che fallisce (navigazione privata) non blocca
  la partita, semplicemente non sopravvive alla sessione.

## Cosa resta dell'Arena

`artifacts/api-server` e i pacchetti `lib/*` sono sopravvissuti alla
rimozione dell'Arena (docs/GDD.md §19) ma il client di gioco non li contatta
più per nessuna ragione:

- `artifacts/api-server` (Express 5, CORS, log strutturati con pino) espone
  oggi solo `/api/healthz`. Serviva il signaling WebRTC e la classifica
  dell'Arena, entrambi tolti insieme a lei.
- `lib/db` tiene un'impalcatura di connessione a PostgreSQL via Drizzle
  (`getDb`/`isDatabaseConfigured`) con uno schema volutamente vuoto —
  pronta per un'eventuale classifica della modalità Roguelike, ma oggi
  `artifacts/api-server` non la importa nemmeno più nel proprio
  `package.json`.
- `lib/api-zod` e `lib/api-spec` restano come tipi condivisi e spec OpenAPI
  per quella stessa API, anch'essi fuori dal percorso che il client di
  gioco percorre.

Nessuno di questi pacchetti impedisce di giocare: sono candidati a un giro
di pulizia successivo, non qualcosa che serva toccare per giocare.
