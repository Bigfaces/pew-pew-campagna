# Pew Pew Campagna

**KESSLER-9** — una campagna per browser in prima persona: tre atti, nove
livelli, tre boss, dieci tipi di nemico e un albero di abilità da diciassette
nodi. Fucile a otturatore: al punto debole uccide in un colpo, al corpo ne serve
il doppio, e la ricarica dura ~1,4 s, quindi
ogni colpo va guadagnato prima di essere sparato. Dall'altra parte si porta una
dotazione di due piastre, che assorbono un colpo ciascuna e tornano piene
entrando in una stanza nuova: sbagliare mira è un errore, non una condanna.

Gira **interamente nel browser** — niente plugin, niente installazione, nessun
file grafico o sonoro da scaricare. Le texture dei muri sono disegnate in codice
all'avvio e ogni suono è sintetizzato con Web Audio: non c'è nulla da scaricare
perché non esiste alcun asset.

Nasce come fork di [Arena Sniper](https://github.com/bigfaces/arena-boom-shooter),
ma l'Arena non c'è più: è stata tolta per intero — modalità, bot, partite
online, statistiche di carriera — per lasciare posto a una campagna sola,
senza due giochi diversi a contendersi lo stesso menu. Quel che resta del
fork è la base tecnica: il raycaster, il motore audio, il fucile a
otturatore.

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
| [**Link qui sopra**](https://bigfaces.github.io/pew-pew-campagna/) | Un browser | La campagna. Il modo più rapido. |
| **Doppio click su [`docs/index.html`](docs/index.html)** | Un browser | Lo stesso gioco, ma funziona anche **offline**. |
| **Doppio click su `AVVIA.cmd`** (Windows) | Niente: se manca Node si offre di scaricarlo | Uguale, ma apre il browser da solo. |
| **Terminale** | Node.js 22 o più recente (consigliato 24) | Uguale, ma vedi i log e puoi lanciare i test. Vedi [GUIDA.md](GUIDA.md). |

Il gioco sta in **un unico file HTML** con dentro codice, stili e icona. Puoi
copiarlo su una chiavetta o mandarlo via email: funziona con un doppio click,
anche senza rete. Non contatta nessun server: niente partite online, niente
classifica — la campagna è single-player e i progressi vivono solo nel
browser da cui giochi.

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
[docs/GDD.md](docs/GDD.md). Cosa resta da fare, e le decisioni ancora aperte,
è in [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Com'è fatto

Nessun motore di gioco: raycaster 2.5D scritto a mano su canvas 2D.

```
artifacts/arena-shooter/src/
  sim/           simulazione pura — niente DOM, gira headless nei test
    campaign/    livelli, nemici, boss, albero delle abilità, Banco
  render/        canvas: muri raycast, sprite, particelle, overlay, ottica
  audio/         sintesi Web Audio, nessun file audio
  game/          game loop a fixed timestep della campagna
  ui/            schermate React (menu, HUD, pausa, fine partita)
  stats/         profilo di campagna, con fallback su localStorage
```

Le scelte architetturali non ovvie sono spiegate in [replit.md](replit.md). Le due
che contano:

- **La simulazione è pura e avanza a tick fissi di 60 Hz.** Non dipende dal DOM,
  quindi gira nei test, e non dipende dall'orologio, quindi si comporta identica
  su un monitor a 60 Hz e a 240 Hz. Il renderer va libero e interpola.
- **Il controller parla alla simulazione solo con l'input.** Tastiera, mouse e
  comandi a schermo diventano un `CampaignInput` che `CampaignWorld.step()`
  applica; il controller non tocca mai lo stato del mondo da sé. I nemici
  hanno una propria intenzione (`EnemyIntent`, in `sim/campaign/enemyAi.ts`),
  calcolata dentro lo stesso tick.

Il bilanciamento non si discute a parole: il banco headless della campagna
(`balance:campaign`) stampa le invarianti dell'albero delle abilità, il ritmo
di Sentinella e Custode, la finestra reale del Trasponditore misurata
facendo girare l'IA nemica (non solo l'aritmetica degli HP), lo spazio delle
build dell'albero e il costo reale — in guadagni e rinunce — di ogni oggetto
del Banco di Riconfigurazione. Cambia una costante, rilancia, confronta.

## Sviluppo

```powershell
corepack enable                                            # abilita pnpm
pnpm install                                               # da Git Bash su Windows
pnpm --filter @workspace/arena-shooter run dev              # gioco su :5173
pnpm --filter @workspace/arena-shooter run balance:campaign  # metriche della campagna
pnpm run test                                              # tutta la suite, headless, ~3 s
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

Le manopole comuni al fucile (velocità, cooldown, zoom dell'ottica) sono rimaste
in `artifacts/arena-shooter/src/sim/constants.ts` — molto più piccolo da quando
l'Arena, che ne era la sola proprietaria, è stata tolta — e la campagna le
importa invece di ridichiararle. Le sue manopole proprie stanno in
`src/sim/campaign/constants.ts`; la mappa che si gioca davvero è in
`sim/campaign/levels.ts`. La mappa dell'Arena (`sim/map.ts`) e la minimappa
che la disegnava in `render/overlay.ts` sono state tolte in un secondo giro di
potatura: nessuna modalità le richiamava più. Con loro se ne sono andati
`castRay` e `hasLOS` di `sim/raycast.ts`, che leggevano quella mappa — il file
oggi contiene solo `angleDelta`, condivisa con la campagna.

## Stack

pnpm workspaces · Node.js 24 · TypeScript 5.9 · Vite 7 · React 19 (solo per i
menu) · canvas 2D per il mondo · Vitest.
