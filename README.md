# Pew Pew Campagna

**KESSLER-9** — una campagna per browser in prima persona: tre atti, nove
livelli, tre boss, dieci tipi di nemico e un albero di abilità da diciassette
nodi. Fucile a otturatore: al punto debole uccide in un colpo, al corpo ne serve
il doppio, e la ricarica dura ~1,4 s, quindi
ogni colpo va guadagnato prima di essere sparato.

Gira **interamente nel browser** — niente plugin, niente installazione, nessun
file grafico o sonoro da scaricare. Le texture dei muri sono disegnate in codice
all'avvio e ogni suono è sintetizzato con Web Audio: non c'è nulla da scaricare
perché non esiste alcun asset.

Nasce come fork di [Arena Sniper](https://github.com/bigfaces/arena-boom-shooter),
che resta dentro e giocabile esattamente com'era.

## ▶ [GIOCA ORA NEL BROWSER](https://bigfaces.github.io/pew-pew-campagna/)

Un click. Niente da installare, niente da scaricare, nessun account.

---

## Se la stai provando

Grazie. È in **beta**: è completa e nessun test è rosso, ma **nessuno l'ha
ancora giocata dall'inizio alla fine** — nemmeno io. So che è attraversabile
perché lo dimostra un bot che cammina tutte e nove le mappe; non so ancora se è
divertente per quaranta minuti di fila. Quello lo dici tu.

### Scegli la modalità prima di entrare

Sono tre e cambiano **solo cosa succede quando muori**. Non rendono i nemici più
forti o più deboli:

| Modalità | Morire significa |
| --- | --- |
| **TUTORIAL** | Torni alla stanza che avevi raggiunto: si resettano solo i nemici e i trabocchetti lì dentro. |
| **MEDIO** | Torni allo spawn del livello: si resetta tutto il livello, non solo la stanza. |
| **ROGUELIKE** | Riparte l'intero atto dal primo livello. Personaggio e core raccolti restano tuoi. |

Se è la prima volta scegli **TUTORIAL** — è già selezionata all'apertura.

### Comandi

| Tasto | Azione |
| --- | --- |
| `W A S D` | Movimento — avanti, indietro, laterale |
| Mouse | Mira — clicca una volta per catturare il puntatore |
| `Q` / `E` | Rotazione — funziona sempre, anche senza mouse |
| Click sinistro | Sparo — otturatore manuale, uno alla volta. Al corpo serve il doppio |
| *(il punto debole)* | Vale **tre volte**: dietro, il nucleo o la testa. La HUD dice quale, puntando il nemico |
| Click destro | Ottica — tieni premuto per mirare col cannocchiale |
| `MAIUSC` | Scatto — dal nodo Scatto in poi, nella direzione in cui vai |
| `F` | **Trasponditore** — lancia un'esca, se ne hai una carica |
| `ESC` | Pausa (la legenda è anche lì dentro) |
| `M` | Muto |

Da telefono i comandi sono a schermo e non serve sapere niente di tutto questo.

Il **Trasponditore** è la cosa meno ovvia del gioco, e vale la pena spenderci
due righe: lancia un'esca che richiama i nemici dove l'hai buttata. Diversi
nemici hanno il punto debole sulla schiena e il colpo lì vale il triplo —
l'esca è il modo di fartela dare da guardare. Contro il MARTELLO va lanciata
**di lato**, non dritta davanti: da lì il suo fianco resta scoperto molto più a
lungo.

### Cosa mi serve sapere

Più di «bello» o «brutto», mi servono queste:

- **Dove ti sei annoiato** e dove ti sei perso senza capire dove andare.
- **Un nemico che ti è sembrato ingiusto**, o che non hai capito come si uccide.
- **Fin dove sei arrivato prima di smettere** — anche «ho mollato al terzo
  livello» è un dato, anzi è il dato più utile che ci sia.
- Qualunque cosa sembri rotta: schermo nero, muri attraversabili, numeri strani,
  nemici che sparano attraverso le pareti.
- Se hai usato il Trasponditore e il Banco di Riconfigurazione, o se li hai
  ignorati perché non era chiaro a cosa servissero.

Scrivimi, oppure apri una
[segnalazione](https://github.com/Bigfaces/pew-pew-campagna/issues/new).

I progressi si salvano **nel browser**, non su un server: restano sul computer
da cui giochi e non seguono l'account. Per ricominciare da capo, cancella i dati
del sito.

---

## Gli altri modi di giocarlo

| Come | Cosa serve | Cosa ottieni |
| --- | --- | --- |
| [**Link qui sopra**](https://bigfaces.github.io/pew-pew-campagna/) | Un browser | Campagna e Arena contro i bot. Il modo più rapido. |
| **Doppio click su [`docs/index.html`](docs/index.html)** | Un browser | Lo stesso gioco, ma funziona anche **offline**. |
| **Doppio click su `AVVIA.cmd`** (Windows) | Niente: se manca Node si offre di scaricarlo | Tutto: campagna, bot **e** partite online dell'Arena. Apre il browser da solo. |
| **Terminale** | Node.js 20+ | Uguale, ma vedi i log e puoi lanciare i test. Vedi [GUIDA.md](GUIDA.md). |

Il gioco sta in **un unico file HTML da 412 kB** con dentro codice, stili e
icona. Puoi copiarlo su una chiavetta o mandarlo via email: funziona con un
doppio click, anche senza rete.

> Le **partite online** ci sono solo nella versione con `AVVIA.cmd` o da
> terminale, e riguardano solo l'Arena. Aperto da un file locale o da Pages il
> gioco non ha un server di signaling da contattare, quindi i pulsanti sono
> nascosti invece di essere mostrati e fallire.

---

## Cosa c'è nella campagna

- **Nove livelli in tre atti**, ognuno diviso in stanze: attracco, condotti e
  molo; anello, refrigerante e nucleo; plancia, archivio e nido.
- **Tre boss**, uno per atto. L'ultimo, ARBITER, combatte in tre fasi.
- **Dieci tipi di nemico** con punti deboli diversi. Il colpo sul punto debole
  vale ×3, quello su un nemico vulnerabile ×2: la differenza tra sparare e
  sparare bene è tutta lì.
- **Trasponditore**: un'esca lanciabile che richiama i nemici e ti regala le
  loro spalle.
- **Albero delle abilità a diciassette nodi**, su due livelli, comprato con l'XP
  guadagnato uccidendo.
- **Banco di Riconfigurazione**: tra un atto e l'altro puoi scambiare un punto
  per un oggetto che ti dà qualcosa **e ti toglie qualcos'altro**. Non esistono
  potenziamenti gratis, e ogni scambio è misurato — vedi
  [docs/GDD.md](docs/GDD.md) §14.
- **Trabocchetti** ambientali e core da raccogliere fuori dal percorso.

Il piano completo, con le misure dietro a ogni scelta di bilanciamento, è in
[docs/GDD.md](docs/GDD.md).

---

# Arena Sniper

La modalità originale, invariata: sparatutto ad arena **tutti contro tutti**.
Vince chi arriva per primo al **traguardo di uccisioni** — che cresce col numero
di giocatori, così una partita dura più o meno lo stesso da 2 a 8 — o chi è in
testa quando scadono i **5 minuti**.

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

L'ottica ingrandisce 2,6× e dimezza la sensibilità del mouse, ma ti rallenta al
45%: è uno scambio, non un bonus. Non cambia dove va il proiettile.

---

## Com'è fatto

Nessun motore di gioco: raycaster 2.5D scritto a mano su canvas 2D.

```
artifacts/arena-shooter/src/
  sim/           simulazione pura — niente DOM, gira headless nei test
    campaign/    livelli, nemici, boss, albero delle abilità, Banco
  render/        canvas: muri raycast, sprite, particelle, overlay, ottica
  audio/         sintesi Web Audio, nessun file audio
  net/           signaling, WebRTC, prediction e interpolazione
  game/          game loop a fixed timestep, tiene insieme tutto
  ui/            schermate React (menu, lobby, HUD, statistiche, fine partita)
  stats/         statistiche e profilo di campagna, con fallback su localStorage
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

Il bilanciamento non si discute a parole: i due banchi headless stampano
geometria delle mappe, ritmo, distanze di ingaggio, durata di una vita, spazio
delle build dell'albero e il costo reale di ogni oggetto del Banco. Cambia una
costante, rilancia, confronta.

## Sviluppo

```powershell
corepack enable                                            # abilita pnpm
pnpm install                                               # da Git Bash su Windows
pnpm --filter @workspace/arena-shooter run dev              # gioco su :5173
pnpm --filter @workspace/api-server  run dev                # API + signaling su :5000
pnpm --filter @workspace/arena-shooter run balance          # metriche dell'Arena
pnpm --filter @workspace/arena-shooter run balance:campaign  # metriche della campagna
pnpm run test                                              # 654 test, headless, ~3 s
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

Le manopole dell'Arena (velocità, cooldown, vista dei bot, durata power-up, zoom
dell'ottica, durata partita, tabella delle difficoltà) stanno in
`artifacts/arena-shooter/src/sim/constants.ts`; quelle della campagna in
`src/sim/campaign/constants.ts`. Le mappe sono in `sim/map.ts` e
`sim/campaign/levels.ts`.

## Stack

pnpm workspaces · Node.js 24 · TypeScript 5.9 · Vite 7 · React 19 (solo per i
menu) · canvas 2D per il mondo · Express 5 + `ws` per il signaling · PostgreSQL +
Drizzle (opzionale) · Vitest
