# Perché il gioco sta in `docs/`

`index.html` è il gioco completo in **un unico file**: codice, stili e icona
inclusi, nessuna risorsa esterna, nessuna richiesta di rete. Funziona con un
doppio click anche senza connessione.

Sta in questa cartella perché GitHub Pages può pubblicare un sito solo dalla
radice del repository o da `/docs`, e la radice serve al codice sorgente. Questo
file diventa quindi la pagina che si apre su:

<https://bigfaces.github.io/pew-pew-campagna/>

`.nojekyll` disattiva l'elaborazione Jekyll, che Pages applica di default e che
qui non serve a nulla.

## È un artefatto di build committato

Di norma i file generati non si versionano. Qui è una deroga voluta: serve poter
provare il gioco senza installare Node né compilare niente.

Per rigenerarlo dopo una modifica al codice:

```powershell
pnpm --filter @workspace/arena-shooter run build:standalone
copy artifacts\arena-shooter\dist\standalone\index.html docs\index.html
```

Il sorgente da cui nasce è in `artifacts/arena-shooter/`.

## La guardia: `src/ui/pubblicato.test.ts`

Questo file è rimasto indietro una volta — congelato al giorno del fork
per tutta la costruzione della campagna, con tre atti interi nel
sorgente e irraggiungibili da chi apriva solo la pagina — ed è stato il
difetto peggiore del progetto. La suite di test del pacchetto
(`artifacts/arena-shooter/src/ui/pubblicato.test.ts`) esiste per non
farlo succedere una seconda volta: ogni volta che gira, legge questo
file e verifica che sia allineato al sorgente.

Lo fa in due modi, non uno solo:

- **per stringhe** — ogni voce di legenda, ogni nota di raccolta, ogni
  modalità di difficoltà, presa dai moduli veri e cercata dentro questo
  file. Dice *cosa* manca quando il file è vecchio.
- **per impronta** — un hash sha256 di tutti i sorgenti che entrano nel
  bundle standalone (`artifacts/arena-shooter/tools/impronta.ts`),
  calcolato leggendoli dal disco e inciso in un
  `<meta name="impronta-sorgenti">` dentro `<head>` quando si compila
  con `vite.config.standalone.ts`. Il test lo ricalcola e pretende che
  coincida esattamente. Copre il buco che le stringhe da sole non
  vedono: una modifica che cambia solo la *logica* — un ramo di uno
  `switch`, un calcolo corretto — senza toccare una parola a schermo.
  Le stringhe non se ne accorgerebbero; l'impronta sì, perché cambia a
  ogni byte di sorgente diverso, non solo a ogni stringa diversa.

**Se il test dell'impronta diventa rosso**, il messaggio di fallimento
dice già cosa fare: non è il test da correggere, è la build da rifare
con il comando qui sopra. Il messaggio elenca anche, come aiuto e non
come prova, i sorgenti con data di modifica più recente di questo file
— utile su una modifica locale, non affidabile su un clone fresco (git
non preserva le date), e per questo dichiarato tale nel messaggio
stesso.
