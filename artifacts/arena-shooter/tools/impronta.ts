// ================================================================
// IMPRONTA DEI SORGENTI — hash deterministico di ciò che entra nel bundle
// ================================================================
// `docs/index.html` è un artefatto di build committato (vedi
// docs/LEGGIMI.md e `src/ui/pubblicato.test.ts`): non si aggiorna da
// solo, e quel file racconta già come sia rimasto indietro per tutta
// la costruzione della campagna senza che nessun test se ne accorgesse.
//
// La guardia per stringhe che ne è nata prende ogni deriva che cambia
// *testo* — una voce di legenda nuova, una nota di raccolta diversa —
// ma è cieca a chi cambia solo *logica*: uno switch riordinato, un
// `case` duplicato tolto, un calcolo corretto senza toccare una parola
// a schermo. Questo modulo copre quel buco: calcola un'impronta di
// tutti i sorgenti che entrano nel bundle standalone, la build la
// incide nell'HTML pubblicato (vedi `classicScript` in
// vite.config.standalone.ts) e il test la confronta. Se un solo byte
// di un solo sorgente cambia, l'impronta cambia — non serve che cambi
// anche una stringa visibile.
//
// Non è una firma crittografica né una difesa da manomissione: è solo
// un hash di comodo. sha256 è scelto per la sua disponibilità in
// `node:crypto`, non per le sue proprietà di sicurezza.
// ================================================================

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Radice del pacchetto: questo file vive in tools/, un livello sopra
 *  src/ — esattamente come balance-campaign.mts. Calcolata da
 *  `import.meta.dirname` e non da `process.cwd()`, così l'impronta
 *  risulta la stessa da qualunque cartella si lanci il comando. */
const RADICE_PACCHETTO = path.resolve(import.meta.dirname, '..');

/** Estensioni che finiscono nel bundle standalone: markup, stili e
 *  codice TypeScript/TSX. Niente altro (immagini, font, json...) entra
 *  oggi nella build — il gioco non ha asset esterni, vedi il commento
 *  in cima a vite.config.standalone.ts. */
const ESTENSIONI_SORGENTE = new Set(['.ts', '.tsx', '.css']);

/** I test non entrano mai nel bundle: includerli farebbe diventare
 *  rossa l'impronta a ogni modifica di un test, che è rumore puro e
 *  non un motivo per rigenerare il file pubblicato. */
const RE_FILE_DI_TEST = /\.test\.tsx?$/;

/** File fuori da src/ che entrano comunque nella build standalone:
 *  la pagina HTML che vite.config.standalone.ts riscrive, la config
 *  stessa (cambia come il bundle viene assemblato) e l'icona che
 *  `classicScript` inlinea come data-URI. Percorsi relativi alla
 *  radice del pacchetto. */
const FILE_FISSI = ['index.html', 'vite.config.standalone.ts', 'public/favicon.svg'];

/** Cammina ricorsivamente `src/` e restituisce, in ordine di visita
 *  qualunque (viene riordinato subito dopo da chi chiama), i percorsi
 *  — relativi alla radice del pacchetto, sempre con `/` — di ogni file
 *  sorgente non di test. */
function camminaSrc(radice: string): string[] {
  const trovati: string[] = [];

  function ricorri(dir: string): void {
    for (const voce of readdirSync(dir, { withFileTypes: true })) {
      const assoluto = path.join(dir, voce.name);
      if (voce.isDirectory()) {
        ricorri(assoluto);
        continue;
      }
      if (!voce.isFile()) continue;
      if (!ESTENSIONI_SORGENTE.has(path.extname(voce.name))) continue;
      if (RE_FILE_DI_TEST.test(voce.name)) continue;
      trovati.push(toPosix(path.relative(radice, assoluto)));
    }
  }

  ricorri(path.join(radice, 'src'));
  return trovati;
}

/** Normalizza il separatore di percorso a `/` anche su Windows: il
 *  repository porta un `AVVIA.cmd`, e un checkout da quella parte non
 *  deve produrre un'impronta diversa solo perché `path.sep` è `\`. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Elenco ordinato — e quindi stabile — di tutti i file che entrano
 *  nell'impronta: i sorgenti sotto src/ più i file fissi, uniti e
 *  ordinati per nome così che l'ordine di lettura del filesystem
 *  (che non è garantito) non influisca sul risultato. */
export function elencoFileImpronta(radice: string = RADICE_PACCHETTO): string[] {
  return [...camminaSrc(radice), ...FILE_FISSI].sort();
}

export interface ImprontaSorgenti {
  /** sha256 esadecimale, mescolato su percorso *e* contenuto di ogni
   *  file, in ordine stabile. */
  hash: string;
  /** Gli stessi file che sono entrati nel calcolo, nello stesso
   *  ordine — serve al messaggio d'errore del test, per dire *quali*
   *  file la build guarda, non solo che l'impronta non torna. */
  file: readonly string[];
}

/** Calcola l'impronta dei sorgenti che entrano nel bundle standalone,
 *  leggendoli dal disco. Deterministica: stesso albero di file, stesso
 *  hash, indipendentemente da cwd, ordine di lettura del filesystem o
 *  fine-riga del checkout (CRLF viene normalizzato a LF prima di
 *  entrare nell'hash). */
export function calcolaImpronta(radice: string = RADICE_PACCHETTO): ImprontaSorgenti {
  const file = elencoFileImpronta(radice);
  const hash = createHash('sha256');

  for (const relativo of file) {
    const contenuto = readFileSync(path.join(radice, relativo), 'utf8').replace(/\r\n/g, '\n');
    // Il percorso entra nell'hash quanto il contenuto: rinominare o
    // spostare un file cambia l'impronta anche se il testo che porta
    // resta identico, ed è corretto che sia così, perché cambia
    // comunque cosa la build assembla. Il byte nullo come separatore
    // non è una garanzia crittografica contro un contenuto ostile —
    // non serve, non è quel tipo di guardia — basta a non confondere
    // "fine del percorso" con "inizio del contenuto" nell'uso normale.
    hash.update(relativo, 'utf8');
    hash.update('\0');
    hash.update(contenuto, 'utf8');
    hash.update('\0');
  }

  return { hash: hash.digest('hex'), file };
}
