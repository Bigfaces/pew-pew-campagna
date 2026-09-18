# Guida rapida — Pew Pew Campagna

## Devo per forza usare il terminale?

**No.** Ci sono quattro modi, dal più semplice al più completo:

| Modo | Come | Cosa ottieni |
| --- | --- | --- |
| **Browser** | Apri <https://bigfaces.github.io/pew-pew-campagna/> | Campagna e Arena contro i bot. Niente da scaricare. |
| **File singolo** | Doppio click su `docs/index.html` | Come sopra, ma funziona anche offline. |
| **Lanciatore** | Doppio click su `AVVIA.cmd` | Tutto: bot **e** partite online. Apre il browser da solo. |
| **Terminale** | Vedi §1 in poi | Uguale al lanciatore, ma vedi i log e puoi usare i test. |

### File singolo (il più semplice)

Il file è già nel progetto: **`docs/index.html`**, **un unico file da 412 kB** con
dentro tutto — codice, stili, icona. Puoi spostarlo dove vuoi, copiarlo su una
chiavetta o mandarlo via email: funziona con un doppio click, anche senza rete.
È lo stesso file che GitHub Pages pubblica all'indirizzo qui sopra.

Per rigenerarlo dopo una modifica al codice:

```powershell
pnpm --filter @workspace/arena-shooter run build:standalone
copy artifacts\arena-shooter\dist\standalone\index.html docs\index.html
```

È possibile perché il gioco non ha alcun asset: le texture dei muri sono disegnate in
codice all'avvio e ogni suono è sintetizzato da Web Audio. Non c'è nulla da scaricare.

Le partite online **non** ci sono in questa versione: aperto da `file://` il browser non
ha un'origine da cui raggiungere il server di signaling, quindi i pulsanti sono
nascosti invece di essere mostrati e fallire.

### Lanciatore (tutto, con un doppio click)

Doppio click su **`AVVIA.cmd`** nella cartella del progetto. Avvia il server, avvia il
gioco, apre il browser. Se la porta è occupata te lo dice e ti chiede se liberarla.
Per uscire chiudi la finestra nera: chiude anche il server.

**Su un computer senza Node** non si arrende: te lo dice, ti ricorda che per
giocare contro i bot basta `docs/index.html`, e si offre di scaricare da
nodejs.org la versione portable (37 MB) estraendola in
`%USERPROFILE%\tools\node-v24.18.0-win-x64`. Nessun installer, nessun permesso di
amministratore, niente PATH di sistema modificato: per disfare tutto si cancella
quella cartella. Il pacchetto viene verificato con l'impronta SHA-256 pubblicata
da nodejs.org prima di essere usato, e la cartella scelta è una di quelle che il
lanciatore già controlla, quindi dal secondo avvio non scarica più niente.

---

## 0. Prerequisito (una volta sola)

Serve **Node.js 20 o superiore**. Scaricalo da <https://nodejs.org> oppure usa una
copia portable. `pnpm` arriva con Node tramite corepack:

```powershell
corepack enable
```

Verifica:

```powershell
node --version    # v20 o superiore
pnpm --version
```

> **Importante:** se hai appena installato Node, i terminali **già aperti** non
> vedono il PATH aggiornato. Chiudi e riapri il terminale.

`AVVIA.cmd` cerca Node da solo anche quando non è nel PATH (`Program Files`,
`%LOCALAPPDATA%\Programs\nodejs`, `%USERPROFILE%\tools\node-*`), e se non lo
trova da nessuna parte si offre di scaricarlo. Quindi questo prerequisito serve
davvero solo a chi lavora da terminale: per giocare basta il doppio click.

Se non vuoi installare nulla, salta tutto: gioca su
<https://bigfaces.github.io/pew-pew-campagna/> oppure apri `docs/index.html`.

---

## 1. Giocare contro i bot — il caso più semplice

**Non serve nessun server.** Il gioco è completamente client-side: simulazione, bot,
rendering e audio girano tutti nel browser.

```powershell
cd "percorso\della\cartella\del\progetto"
pnpm --filter @workspace/arena-shooter run dev
```

Apri **http://localhost:5173**, scegli il numero di bot, premi **SINGLE PLAYER**.

Comandi:

| Tasto        | Azione                                                   |
| ------------ | -------------------------------------------------------- |
| `W A S D`    | Movimento (avanti / indietro / laterale)                  |
| Mouse        | Mira — **clicca una volta** per catturare il puntatore    |
| `Q` / `E`    | Ruota senza mouse (funziona sempre, anche senza puntatore)|
| Click sin.   | Spara (un colpo uccide, poi ~1,4 s di ricarica)           |
| **Click des.** | **Ottica** — tieni premuto per mirare col cannocchiale  |
| `ESC`        | Pausa (rilascia il mouse, e da lì si regola la sensibilità)|
| `M`          | Muto                                                      |

Vince chi arriva per primo al traguardo di uccisioni, **oppure** chi è in testa
quando scadono i 5 minuti. Il traguardo cresce col numero di giocatori (10 in una
partita da 4) perché in una mischia si accumulano uccisioni molto più in fretta:
il menu lo scrive sotto la scelta degli avversari, e l'HUD lo ricorda in basso.
Il tempo restante è in alto al centro e diventa rosso negli ultimi 30 s.

L'**ottica** (click destro) ingrandisce 2,6× e dimezza la sensibilità del mouse,
ma ti rallenta al 45%: è uno scambio, non un bonus gratuito. Non cambia dove va
il proiettile — lo zoom è solo una proprietà della camera.

La **sensibilità del mouse** è un moltiplicatore da 0,25× a 3×, con 1× la
taratura su cui è calibrato tutto il resto. Lo trovi nel menu e — più utile —
nella schermata di pausa: lì si applica mentre trascini il cursore, così puoi
riprendere, provare una mira, rimettere in pausa e correggere. Vale solo per il
mouse: `Q` / `E` girano sempre alla stessa velocità, perché un tasto tenuto
premuto non ha una velocità di mano da calibrare. La scelta resta salvata in
questo browser.

Prima di ogni partita c'è un **conto alla rovescia di 3 secondi**: il mondo è
fermo ma puoi già guardarti intorno.

La **difficoltà** si sceglie nel menu (FACILE / NORMALE / DIFFICILE) e cambia
reazione, errore di mira, pazienza nel grilletto, velocità di rotazione e
ampiezza di vista dei bot — nient'altro nella simulazione sa quale livello è
selezionato. `NORMALE` è la taratura di riferimento, quella su cui sono
calibrate le metriche di `run balance`.

### Cosa guardare per capire se il motore funziona

- **Velocità costante:** muoviti e controlla che la velocità non dipenda dagli FPS.
  Era il bug principale del prototipo.
- **I bot non ti vedono più alle spalle.** Mettiti dietro a un bot: non deve reagire
  finché non si gira. Prima aveva visione a 360°.
- **I bot ruotano gradualmente**, non a scatto istantaneo.
- **I bot raccolgono i power-up** di proposito, non per caso.
- **I bot si piantano per sparare.** Chi prende la mira si ferma un istante: è il
  momento in cui è più facile colpirlo.
- **La minimappa non ti regala niente.** Mostra solo chi hai davvero in linea di
  vista, più un anello arancione che si allarga dove è partito uno sparo. Se un
  avversario tace e sta coperto, sparisce.
- **Senti i passi.** Un avversario che corre si sente e si localizza; uno che
  striscia dietro una cassa quasi no. Il ritmo dipende dalla distanza percorsa,
  non da un timer, quindi chi ha preso VELOCITÀ lo senti arrivare.
- **Il lampo dell'ottica.** Se un avversario ti ha in mira *e* ha l'otturatore
  pronto, la sua lente manda un lampo. Se ha appena sparato non lampeggia: quello
  è il tuo momento per avanzare.
- **Le texture dei muri** danno il senso di movimento camminando lungo una parete.
- **Audio posizionale:** uno sparo alla tua sinistra si sente a sinistra. Girati
  sul posto mentre un bot spara: il suono deve ruotare con te.
- **Particelle 3D** su impatti e sangue, occluse correttamente dietro i muri.
- **Ridimensiona la finestra:** la vista si adatta, niente letterboxing.
- **Ottica:** tieni il click destro. Lo zoom entra progressivamente, il fucile
  scende fuori inquadratura, il reticolo compare a zoom quasi completo. Mentre
  ricarichi, l'anello arancione intorno all'ottica misura l'otturatore.
- **Da dove mi hanno sparato:** quando ti colpiscono compare un arco rosso sul
  bordo nella direzione dello sparo, e la schermata di morte dice *da chi* con una
  freccia. Provalo facendoti colpire di spalle.
- **Power-up attivi:** raccogli VELOCITÀ o FUOCO RAPIDO e guarda in basso a
  sinistra: etichetta, secondi residui e barra che si svuota.
- **Callout:** due uccisioni entro ~3 s danno "DOPPIA UCCISIONE"; a 3, 5, 7 e 10
  uccisioni di fila arriva "IN SERIE ×N".
- **Difficoltà:** con FACILE i bot ti concedono quasi un secondo prima di sparare,
  con DIFFICILE circa 0,3 s. Nessun livello rende i bot più veloci di te.

---

## 2. Eseguire i test

```powershell
cd "percorso\della\cartella\del\progetto"
pnpm run test
```

77 test: simulazione, rendering, netcode. Girano headless, senza browser (~2 s).

Per le metriche di bilanciamento — geometria della mappa, ritmo, distanze di
ingaggio, precisione dei bot, durata di una vita — c'è un harness dedicato che
gioca centinaia di partite headless:

```powershell
pnpm --filter @workspace/arena-shooter run balance
```

In watch mode mentre modifichi:

```powershell
pnpm --filter @workspace/arena-shooter run test:watch
```

Controllo completo (typecheck di tutti i pacchetti + build):

```powershell
pnpm run typecheck
pnpm run build
```

---

## 3. Partita online con un amico

Qui **serve** l'API server, ma solo per far incontrare i giocatori: una volta
connessi il traffico di gioco è diretto browser-a-browser.

Servono **due terminali**.

**Terminale A — server di signaling:**

```powershell
cd "percorso\della\cartella\del\progetto"
pnpm --filter @workspace/api-server run dev
```

**Terminale B — il gioco:**

In locale il gioco sta sulla 5173 e l'API sulla 5000, quindi va detto al gioco dove
trovare il signaling:

```powershell
cd "percorso\della\cartella\del\progetto"
$env:VITE_SIGNAL_URL = "ws://localhost:5000/ws"
pnpm --filter @workspace/arena-shooter run dev
```

Poi:

1. Apri http://localhost:5173 in **due finestre** del browser.
2. Nella prima: **HOST ONLINE MATCH** → compare un codice di 4 caratteri.
3. Nella seconda: **JOIN WITH CODE** → inserisci il codice → **CONNECT**.
4. Torna alla prima: scegli quanti bot aggiungere → **START MATCH**.

Durante la partita l'HUD mostra in alto `HOSTING` / `GUEST` e il ping.

> Due finestre sulla stessa macchina funzionano, ma **solo una alla volta può
> catturare il mouse**. Per un test serio usa `Q`/`E` in una delle due, oppure due
> computer diversi sulla stessa rete.

> Su internet aperto, chi ha un NAT simmetrico non riuscirà a connettersi: manca un
> server TURN. L'errore viene mostrato invece di restare appeso.

---

## 4. Statistiche e classifica (opzionale)

Senza database il gioco funziona lo stesso: le statistiche di carriera finiscono nel
`localStorage` del browser, e la classifica risponde `503 {available:false}`.

Per attivare la persistenza serve un PostgreSQL:

```powershell
$env:DATABASE_URL = "postgres://utente:password@host:5432/nomedb"
pnpm --filter @workspace/db run push        # crea la tabella
pnpm --filter @workspace/api-server run dev
```

Endpoint:

- `GET  /api/healthz` — stato del server
- `GET  /api/stats/health` — dice se il database c'è
- `POST /api/matches` — registra una partita
- `GET  /api/leaderboard` — classifica aggregata
- `GET  /api/stats/:callsign` — statistiche di un giocatore

---

## 5. Se qualcosa non va

| Sintomo                                   | Causa e rimedio                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `node` / `pnpm` non trovati               | Terminale aperto prima dell'installazione. Chiudi e riapri.                              |
| `Port 5173 is already in use`             | Un dev server precedente è rimasto vivo. Vedi §6.                                        |
| `pnpm install` fallisce su `sh`           | Lanciato da PowerShell. Lo script `preinstall` richiede `sh`: usa **Git Bash**.          |
| Errore TypeScript `TS6305`                | `.tsbuildinfo` stantii. Cancellali e rilancia `pnpm run typecheck`.                      |
| Il mouse non viene catturato              | Alcuni contesti (iframe, anteprime sandboxate) bloccano il Pointer Lock. Usa `Q`/`E`.    |
| Nessun audio                              | Il browser richiede un gesto prima di attivare l'audio: parte al primo click. O premi `M`. |
| "room not found" entrando in una partita  | Il codice è scaduto o l'host ha chiuso. Fatti rigenerare un codice.                      |

---

## 6. Porta occupata

`vite.config.ts` usa `strictPort: true`: se la 5173 è occupata il server **fallisce**
invece di spostarsi silenziosamente sulla 5174. È voluto — altrimenti apriresti
localhost:5173 e vedresti la versione vecchia rimasta appesa, chiedendoti perché le
modifiche non si vedono.

Chiudere il processo rimasto (PowerShell):

```powershell
# chi occupa la porta
Get-NetTCPConnection -LocalPort 5173 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess }

# chiudilo
Get-NetTCPConnection -LocalPort 5173 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Oppure, per fare piazza pulita di tutti i server Node del progetto:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

> Attenzione: l'ultimo comando chiude **ogni** processo Node, non solo quelli di questo
> progetto. Se hai altro che gira in Node, usa la versione mirata sulla porta.

Chiudere il terminale non sempre basta: un dev server avviato in background sopravvive
alla shell che lo ha lanciato.

---

## 7. Dov'è il codice

```
artifacts/arena-shooter/src/
  sim/      simulazione pura — niente DOM, gira headless nei test
  render/   disegno su canvas: muri raycast, sprite, particelle, HUD
  audio/    sintesi Web Audio, nessun file audio
  net/      signaling, WebRTC, prediction e interpolazione
  game/     game loop a fixed timestep, tiene insieme tutto
  ui/       schermate React (menu, lobby, HUD, fine partita)
  stats/    statistiche con fallback su localStorage

artifacts/api-server/src/
  signaling.ts   rendezvous WebRTC (non vede mai il traffico di gioco)
  routes/stats.ts  statistiche e classifica
```

Le manopole di gioco (velocità, cooldown, FOV dei bot, durata power-up, zoom
dell'ottica, durata partita, tabella delle difficoltà) stanno tutte in
`sim/constants.ts`. La mappa è in `sim/map.ts`.

Per cambiare la difficoltà dei bot si modifica **solo** la tabella `BOT_TUNING`:
nessun altro punto della simulazione sa quale livello è selezionato.
