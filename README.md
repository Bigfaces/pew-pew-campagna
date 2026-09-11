# Pew Pew Campagna

Fork di [Arena Sniper](https://github.com/bigfaces/arena-boom-shooter), usato
come base per costruire una **modalità Campagna** single-player: storia,
struttura a livelli, trabocchetti, boss e uno skill tree per le armi — con la
stessa grafica minimale (niente asset, tutto disegnato in codice) della
modalità Arena, che resta invariata e giocabile come prima.

Il piano della campagna è in [docs/GDD.md](docs/GDD.md).

---

# Arena Sniper

Sparatutto in prima persona ad arena, **tutti contro tutti**, con fucile di
precisione a otturatore: un colpo uccide. Gira **interamente nel browser** —
niente plugin, niente installazioni, nessun file grafico o sonoro da scaricare.

Vince chi arriva per primo al **traguardo di uccisioni** — che cresce col numero
di giocatori, così una partita dura più o meno lo stesso da 2 a 8 — o chi è in
testa quando scadono i **5 minuti**.

## ▶ [GIOCA ORA NEL BROWSER](https://bigfaces.github.io/ARENA-BOOM-SHOOTER/)

Un click. Niente da installare, niente da scaricare, nessun account.

---

## Gli altri modi di giocarlo

| Come | Cosa serve | Cosa ottieni |
| --- | --- | --- |
| [**Link qui sopra**](https://bigfaces.github.io/ARENA-BOOM-SHOOTER/) | Un browser | Partita contro i bot. Il modo più rapido. |
| **Doppio click su [`docs/index.html`](docs/index.html)** | Un browser | Lo stesso gioco, ma funziona anche **offline**. |
| **Doppio click su `AVVIA.cmd`** (Windows) | Niente: se manca Node si offre di scaricarlo | Tutto: bot **e** partite online. Apre il browser da solo. |
| **Terminale** | Node.js 20+ | Uguale, ma vedi i log e puoi lanciare i test. Vedi [GUIDA.md](GUIDA.md). |

Il gioco sta in **un unico file HTML da 276 kB** con dentro codice, stili e icona.
Puoi copiarlo su una chiavetta o mandarlo via email: funziona con un doppio click.

È possibile perché il gioco **non ha alcun asset**: le texture dei muri sono
disegnate in codice all'avvio e ogni suono è sintetizzato con Web Audio.

> Le **partite online** ci sono solo nella versione con `AVVIA.cmd` o da
> terminale. Aperto da un file locale o da Pages il gioco non ha un server di
> signaling da contattare, quindi i pulsanti sono nascosti invece di essere
> mostrati e fallire.

## Comandi

| Tasto | Azione |
| --- | --- |
| `W A S D` | Movimento (avanti / indietro / laterale) |
| Mouse | Mira — clicca una volta per catturare il puntatore |
| `Q` / `E` | Ruota senza mouse (funziona sempre) |
| Click sinistro | Spara — un colpo uccide, poi ~1,4 s di otturatore |
| **Click destro** | **Ottica** — tieni premuto per mirare col cannocchiale |
| `ESC` | Pausa |
| `M` | Muto |

L'ottica ingrandisce 2,6× e dimezza la sensibilità del mouse, ma ti rallenta al
45%: è uno scambio, non un bonus. Non cambia dove va il proiettile.

La **sensibilità del mouse** si regola da 0,25× a 3× nel menu e nella schermata
di pausa. In pausa cambia mentre trascini, che è l'unico posto da cui si capisca
se il valore è giusto. Resta salvata nel browser.

## Cosa c'è dentro

- **Arena 38×28** simmetrica per rotazione, con un bunker sigillato al centro
  che contiene l'unico scudo: due ingressi sfalsati, nessuna linea di tiro che
  lo attraversa. Ci si entra, e si può essere visti entrare.
- **Tre power-up:** scudo (assorbe un colpo), fuoco rapido, velocità.
- **Da 1 a 7 avversari**, bot o umani, mescolabili liberamente. Il numero non è
  una difficoltà: cambia il gioco, e il menu dice come.
- **Tre difficoltà** (facile / normale / difficile): cambiano reazione, mira,
  pazienza nel grilletto, velocità di rotazione e ampiezza di vista dei bot.
  Nessun livello rende i bot più veloci del giocatore.
- **Informazione guadagnata, non regalata:** la minimappa mostra solo chi vedi
  davvero e da dove è partito uno sparo; i passi degli avversari si sentono e si
  localizzano; l'ottica di chi ti ha in mira manda un lampo.
- **Partite online** peer-to-peer con un codice stanza di 4 caratteri.
- **Statistiche di carriera** e classifica globale (la classifica richiede un
  PostgreSQL; senza database le statistiche restano nel browser).
- **Audio posizionale:** uno sparo alla tua sinistra si sente a sinistra.
- Callout per multi-uccisioni e serie, indicatore della direzione da cui ti hanno
  colpito, conto alla rovescia iniziale, timer di partita.

## Com'è fatto

Nessun motore di gioco: raycaster 2.5D scritto a mano su canvas 2D.

```
artifacts/arena-shooter/src/
  sim/      simulazione pura — niente DOM, gira headless nei test
  render/   canvas: muri raycast, sprite, particelle, overlay, ottica
  audio/    sintesi Web Audio, nessun file audio
  net/      signaling, WebRTC, prediction e interpolazione
  game/     game loop a fixed timestep, tiene insieme tutto
  ui/       schermate React (menu, lobby, HUD, statistiche, fine partita)
  stats/    statistiche con fallback su localStorage
artifacts/api-server/   API + rendezvous WebRTC (non vede il traffico di gioco)
lib/                    schema DB, spec OpenAPI, tipi condivisi
```

Le scelte architetturali non ovvie sono spiegate in [replit.md](replit.md). Le tre
che contano:

- **La simulazione è pura e avanza a tick fissi di 60 Hz.** Non dipende dal DOM,
  quindi gira nei test, e non dipende dall'orologio, quindi si comporta identica
  su un monitor a 60 Hz e a 240 Hz. Il renderer va libero e interpola.
- **Tutto ciò che è casuale passa da un PRNG con seme** il cui stato vive nello
  stato del mondo: una partita è riproducibile da un seme e trasferibile tra peer.
- **L'input è l'unico modo di influenzare un'entità.** Tastiera, IA dei bot e
  pacchetti di rete producono la stessa struttura, quindi un posto occupato da un
  bot e uno occupato da un umano sono davvero interscambiabili.

Il bilanciamento non si discute a parole: `pnpm --filter @workspace/arena-shooter
run balance` fa girare la simulazione headless e stampa geometria della mappa,
ritmo, distanze di ingaggio, precisione dei bot e durata di una vita. Cambia una
costante o la mappa, rilancia, confronta.

## Sviluppo

```powershell
corepack enable                                            # abilita pnpm
pnpm install                                               # da Git Bash su Windows
pnpm --filter @workspace/arena-shooter run dev              # gioco su :5173
pnpm --filter @workspace/api-server  run dev                # API + signaling su :5000
pnpm --filter @workspace/arena-shooter run balance          # metriche di bilanciamento
pnpm run test                                              # 77 test, headless, ~2 s
pnpm run typecheck                                         # typecheck di tutti i pacchetti
pnpm run build                                             # typecheck + build
pnpm --filter @workspace/arena-shooter run build:standalone # rigenera il file singolo
```

Dopo `build:standalone`, per aggiornare il file pubblicato:

```powershell
copy artifacts\arena-shooter\dist\standalone\index.html docs\index.html
```

> `docs/index.html` è un artefatto di build committato di proposito, in deroga
> alla regola generale: è ciò che rende il gioco provabile senza toolchain, ed è
> anche la pagina che GitHub Pages serve. Dettagli in [docs/LEGGIMI.md](docs/LEGGIMI.md).

Le manopole di gioco (velocità, cooldown, vista dei bot, durata power-up, zoom
dell'ottica, durata partita, tabella delle difficoltà) stanno tutte in
`artifacts/arena-shooter/src/sim/constants.ts`. La mappa è in `sim/map.ts`.

## Stack

pnpm workspaces · Node.js 24 · TypeScript 5.9 · Vite · React 19 (solo per i menu)
· canvas 2D per il mondo · Express 5 + `ws` per il signaling · PostgreSQL +
Drizzle (opzionale) · Vitest
