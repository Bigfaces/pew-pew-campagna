# Guida rapida — Pew Pew Campagna

## Devo per forza usare il terminale?

**No.** Ci sono quattro modi, dal più semplice al più completo:

| Modo | Come | Cosa ottieni |
| --- | --- | --- |
| **Browser** | Apri <https://bigfaces.github.io/pew-pew-campagna/> | La campagna. Niente da scaricare. |
| **File singolo** | Doppio click su `docs/index.html` | Come sopra, ma funziona anche offline. |
| **Lanciatore** | Doppio click su `AVVIA.cmd` | Uguale, ma apre il browser da solo. |
| **Terminale** | Vedi §1 in poi | Uguale al lanciatore, ma vedi i log e puoi usare i test. |

### File singolo (il più semplice)

Il file è già nel progetto: **`docs/index.html`**, un unico file con dentro tutto —
codice, stili, icona. Puoi spostarlo dove vuoi, copiarlo su una chiavetta o
mandarlo via email: funziona con un doppio click, anche senza rete. È lo stesso
file che GitHub Pages pubblica all'indirizzo qui sopra.

Per rigenerarlo dopo una modifica al codice:

```powershell
pnpm --filter @workspace/arena-shooter run build:standalone
copy artifacts\arena-shooter\dist\standalone\index.html docs\index.html
```

È possibile perché il gioco non ha alcun asset: le texture dei muri sono disegnate in
codice all'avvio e ogni suono è sintetizzato da Web Audio. Non c'è nulla da scaricare.

### Lanciatore (con un doppio click)

Doppio click su **`AVVIA.cmd`** nella cartella del progetto. Avvia il gioco in
locale e apre il browser da solo. Se la porta è occupata te lo dice e ti chiede
se liberarla. Per uscire chiudi la finestra nera.

**Su un computer senza Node** non si arrende: te lo dice, ti ricorda che per
giocare basta `docs/index.html`, e si offre di scaricare da nodejs.org la
versione portable (37 MB) estraendola in
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

## 1. Giocare la campagna

**Non serve nessun server.** Il gioco è completamente client-side: simulazione,
nemici, rendering e audio girano tutti nel browser. I progressi si salvano nel
`localStorage` del browser, non su un server: restano sul computer da cui giochi.

```powershell
cd "percorso\della\cartella\del\progetto"
pnpm --filter @workspace/arena-shooter run dev
```

Apri **http://localhost:5173**, scegli la modalità e inizia.

### Modalità

Cambiano **solo cosa succede quando muori**, non la forza dei nemici:

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
| `ESC` | Pausa (la legenda è anche lì dentro; da lì si regola anche la sensibilità del mouse) |
| `M` | Muto |

Il **Trasponditore** lancia un'esca che richiama i nemici dove l'hai buttata.
Diversi nemici hanno il punto debole sulla schiena: l'esca è il modo di fartela
dare da guardare.

### Cosa c'è nella campagna

- **Nove livelli in tre atti**, ognuno diviso in stanze.
- **Tre boss**, uno per atto.
- **Dieci tipi di nemico** con punti deboli diversi.
- **Albero delle abilità a diciassette nodi**, comprato con l'XP guadagnato uccidendo.
- **Banco di Riconfigurazione**: tra un atto e l'altro puoi scambiare un punto
  per un oggetto che ti dà qualcosa e ti toglie qualcos'altro.
- **Trabocchetti** ambientali e core da raccogliere fuori dal percorso.

Il piano completo, con le misure dietro a ogni scelta di bilanciamento, è in
[docs/GDD.md](docs/GDD.md).

---

## 2. Eseguire i test

```powershell
cd "percorso\della\cartella\del\progetto"
pnpm run test
```

574 test: simulazione, rendering, campagna. Girano headless, senza browser (~3 s).

Per le metriche di bilanciamento della campagna — ritmo, distanze di ingaggio,
durata di una vita, spazio delle build dell'albero, costo reale di ogni oggetto
del Banco — c'è un harness dedicato che gioca centinaia di partite headless:

```powershell
pnpm --filter @workspace/arena-shooter run balance:campaign
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

## 3. Se qualcosa non va

| Sintomo                                   | Causa e rimedio                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `node` / `pnpm` non trovati               | Terminale aperto prima dell'installazione. Chiudi e riapri.                              |
| `Port 5173 is already in use`             | Un dev server precedente è rimasto vivo. Vedi §4.                                        |
| `pnpm install` fallisce su `sh`           | Lanciato da PowerShell. Lo script `preinstall` richiede `sh`: usa **Git Bash**.          |
| Errore TypeScript `TS6305`                | `.tsbuildinfo` stantii. Cancellali e rilancia `pnpm run typecheck`.                      |
| Il mouse non viene catturato              | Alcuni contesti (iframe, anteprime sandboxate) bloccano il Pointer Lock. Usa `Q`/`E`.    |
| Nessun audio                              | Il browser richiede un gesto prima di attivare l'audio: parte al primo click. O premi `M`. |

---

## 4. Porta occupata

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

## 5. Dov'è il codice

```
artifacts/arena-shooter/src/
  sim/           simulazione pura — niente DOM, gira headless nei test
    campaign/    livelli, nemici, boss, albero delle abilità, Banco
  render/        canvas: muri raycast, sprite, particelle, overlay, ottica
  audio/         sintesi Web Audio, nessun file audio
  game/          game loop a fixed timestep della campagna
  ui/            schermate React (menu, HUD, pausa, fine partita)
  stats/         profilo di campagna, con fallback su localStorage

artifacts/api-server/src/
  routes/health.ts   /api/healthz — l'unico endpoint rimasto
```

Le manopole comuni al fucile (velocità, cooldown, zoom dell'ottica) stanno in
`sim/constants.ts`. Le manopole della campagna stanno in
`sim/campaign/constants.ts`, e la mappa che si gioca davvero è in
`sim/campaign/levels.ts`.

`artifacts/api-server` (Express, PostgreSQL + Drizzle in `lib/db`) resta nel
repository come ossatura per una futura classifica della campagna (modalità
roguelike), ma il gioco non lo contatta: la campagna è single-player e i
progressi vivono solo nel browser da cui giochi.
