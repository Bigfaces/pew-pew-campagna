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
