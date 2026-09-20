// ================================================================
// COLLEGAMENTO EVENTO → HUD/AUDIO — un buco che un test di funzione
// pura non può vedere
// ================================================================
// `pickupNotice` (src/ui/arbiter.ts) è provata a fondo come funzione
// pura, in src/ui/raccoglibili.test.ts e src/ui/pubblicato.test.ts: le
// si passa un evento e si controlla il testo che restituisce. Nessuno
// dei due prova però che l'evento *arrivi* a `pickupNotice` — cioè che
// il cablaggio in `handleEvents` (campaignGame.ts) inoltri davvero
// ogni tipo di raccoglibile alla riga della HUD. Un difetto lì è
// invisibile a chi prova solo la funzione pura, per costruzione.
//
// È esattamente quello che è successo: `case 'coreCollected'` compariva
// due volte nello `switch (ev.type)` di `handleEvents` — una prima
// insieme a `nodeUnlocked` (solo suono), una seconda insieme a
// `beaconPickup` (solo riga HUD). In uno `switch` vince il primo ramo
// che combacia, quindi il nucleo suonava ma non scriveva mai la sua
// riga — un difetto di rendering "silenzioso": tutto compila (a parte
// il warning di esbuild sul case morto), tutti i test di
// `pickupNotice` restano verdi, e il giocatore non vede comunque
// niente quando raccoglie un nucleo.
//
// La guardia qui sotto non riprova `pickupNotice`: legge il sorgente
// di `campaignGame.ts` da disco (stesso approccio di
// src/ui/pubblicato.test.ts, che già legge file dal disco dentro un
// test) e fallisce se una stessa etichetta `case` compare due volte
// nello stesso `switch`, in un punto qualunque del file. È
// deliberatamente generale — non cerca `coreCollected` per nome —
// perché la classe di difetto è "un ramo morto in uno switch di
// smistamento eventi", non un singolo evento: la prossima volta potrebbe
// essere un altro tipo di evento, e la guardia deve prenderlo lo
// stesso.
// ================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/** Vitest gira con la radice del pacchetto come cwd (vedi
 *  src/ui/pubblicato.test.ts per lo stesso pattern). */
const CAMPAIGN_GAME = path.resolve(process.cwd(), 'src/game/campaignGame.ts');

interface DuplicateCase {
  /** Etichetta del case ripetuto, così com'è scritta nel sorgente. */
  label: string;
  /** Quante volte compare nello stesso switch. */
  count: number;
  /** Riga (1-based) in cui inizia lo `switch` incriminato, per non
   *  dover andare a cercarlo a mano quando il test è rosso. */
  switchLine: number;
}

/**
 * Cerca ogni `switch (...) { ... }` nel sorgente e, per ciascuno,
 * elenca le etichette `case` che compaiono più di una volta *allo
 * stesso livello di quello switch* (non dentro uno switch annidato o
 * un blocco `{ }` di un altro case).
 *
 * Il trucco è mascherare il contenuto dei blocchi annidati (contando
 * le graffe) prima di cercare `case ...:` con una regex: così un case
 * che vive dentro il blocco `{ }` di un case esterno, o dentro uno
 * switch annidato, non viene mai confuso con un case diretto di questo
 * switch — esattamente come intende il linguaggio, dove le etichette
 * `case` di uno switch sono solo quelle al primo livello del suo
 * corpo.
 */
function findDuplicateCaseLabels(source: string): DuplicateCase[] {
  const results: DuplicateCase[] = [];
  const switchOpenRe = /switch\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = switchOpenRe.exec(source))) {
    const bodyStart = match.index + match[0].length; // subito dopo la '{' dello switch
    const switchLine = source.slice(0, match.index).split('\n').length;

    // Trova la graffa di chiusura di *questo* switch contando la
    // profondità a partire da 1 (la sua stessa apertura).
    let depth = 1;
    let i = bodyStart;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
    }
    const bodyEnd = i - 1; // esclude la graffa di chiusura dello switch
    const body = source.slice(bodyStart, bodyEnd);

    // Maschera tutto ciò che sta dentro blocchi annidati (profondità
    // > 0 relativa all'inizio di `body`), lasciando gli a-capo intatti
    // così i numeri di riga restano corretti nel testo mascherato.
    let nestedDepth = 0;
    let masked = '';
    for (const ch of body) {
      if (ch === '{') {
        masked += nestedDepth === 0 ? ch : ' ';
        nestedDepth++;
      } else if (ch === '}') {
        nestedDepth--;
        masked += nestedDepth === 0 ? ch : ' ';
      } else if (ch === '\n') {
        masked += '\n';
      } else {
        masked += nestedDepth === 0 ? ch : ' ';
      }
    }

    const counts = new Map<string, number>();
    const caseRe = /\bcase\s+([^:]+?):/g;
    let caseMatch: RegExpExecArray | null;
    while ((caseMatch = caseRe.exec(masked))) {
      const label = caseMatch[1].trim();
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    for (const [label, count] of counts) {
      if (count > 1) results.push({ label, count, switchLine });
    }
  }

  return results;
}

describe('handleEvents — nessuna etichetta case viva due volte nello stesso switch', () => {
  it('campaignGame.ts non ha case duplicati (un case duplicato è un ramo morto: vince solo il primo)', () => {
    const source = readFileSync(CAMPAIGN_GAME, 'utf8');
    const duplicates = findDuplicateCaseLabels(source);
    expect(
      duplicates,
      duplicates
        .map(
          (d) =>
            `case ${d.label} compare ${d.count} volte nello switch che inizia a riga ${d.switchLine} di ${CAMPAIGN_GAME}: solo il primo ramo verrà mai eseguito`,
        )
        .join('\n') || undefined,
    ).toEqual([]);
  });
});
