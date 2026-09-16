// ================================================================
// NARRAZIONE DELLA CAMPAGNA — test del sequenziamento
// ================================================================
// campaignGame.ts non è istanziabile qui (usa canvas/document e la
// suite gira senza jsdom — vedi il commento in campaignNarrative.ts),
// quindi questi test provano direttamente ciò che è stato estratto
// per essere provabile: quali battute mostrare a fine livello, in
// quale ordine, e come si comporta la coda che le mette in scena una
// alla volta. La verifica che *appaiano davvero* sullo schermo resta
// al giro in browser (vedi il resoconto).
// ================================================================

import { describe, expect, it, vi } from 'vitest';

import {
  LEVEL_ATTRACCO,
  LEVEL_CONDOTTI,
  LEVEL_MOLO,
  LEVEL_NIDO,
  LEVEL_NUCLEO,
} from '../sim/campaign/levels';
import { ARBITER_LAST_WORDS } from '../ui/arbiter';
import { NarrativeQueue, planLevelCompletion } from './campaignNarrative';

describe('planLevelCompletion — outro a fine livello', () => {
  it('un livello a metà atto mostra solo il suo outro, senza fermare la campagna', () => {
    const plan = planLevelCompletion(LEVEL_ATTRACCO, LEVEL_ATTRACCO.next);
    expect(plan.lines).toEqual([LEVEL_ATTRACCO.outro]);
    expect(plan.actEnded).toBe(false);
    expect(plan.actCompleted).toBeNull();
  });

  it('vale anche per il livello che segue, non solo per il primo', () => {
    const plan = planLevelCompletion(LEVEL_CONDOTTI, LEVEL_CONDOTTI.next);
    expect(plan.lines).toEqual([LEVEL_CONDOTTI.outro]);
    expect(plan.actEnded).toBe(false);
  });
});

describe('planLevelCompletion — la schermata d’atto fra un atto e il successivo', () => {
  it('il molo (fine Atto I, Sentinella) chiude l’atto e non ha ultime parole', () => {
    const plan = planLevelCompletion(LEVEL_MOLO, LEVEL_MOLO.next);
    expect(plan.actEnded).toBe(true);
    expect(plan.actCompleted).toBe(1);
    // Solo l'outro: la Sentinella non è ARBITER, non ha ultime parole.
    expect(plan.lines).toEqual([LEVEL_MOLO.outro]);
  });

  it('il nucleo (fine Atto II, Custode) chiude l’atto allo stesso modo', () => {
    const plan = planLevelCompletion(LEVEL_NUCLEO, LEVEL_NUCLEO.next);
    expect(plan.actEnded).toBe(true);
    expect(plan.actCompleted).toBe(2);
    expect(plan.lines).toEqual([LEVEL_NUCLEO.outro]);
  });
});

describe('planLevelCompletion — la fine di ARBITER è il finale della campagna', () => {
  it('il nido (fine Atto III, ARBITER) mette le ultime parole prima dell’outro', () => {
    expect(LEVEL_NIDO.next).toBeNull();
    const plan = planLevelCompletion(LEVEL_NIDO, LEVEL_NIDO.next);
    expect(plan.actEnded).toBe(true);
    expect(plan.actCompleted).toBe(3);
    // Le ultime parole vengono TUTTE prima, nell'ordine dato in
    // ARBITER_LAST_WORDS, e solo in coda arriva l'outro del livello:
    // è esattamente l'ordine "ultime parole → outro → schermata"
    // richiesto per il finale.
    expect(plan.lines).toEqual([...ARBITER_LAST_WORDS, LEVEL_NIDO.outro]);
  });

  it('un livello senza next è sempre fine-atto, anche se levels.ts cambiasse la conta dei livelli', () => {
    // Non si assume "il terzo livello chiude l'atto": si guarda dove
    // porta. Questo test pinna quella scelta di design.
    const plan = planLevelCompletion(LEVEL_NIDO, null);
    expect(plan.actEnded).toBe(true);
  });
});

describe('NarrativeQueue — le battute in ordine, una alla volta', () => {
  it('mostra le righe in ordine e chiama onDone una sola volta alla fine', () => {
    const q = new NarrativeQueue(1000);
    const onDone = vi.fn();
    q.enqueue([...ARBITER_LAST_WORDS], onDone);

    const seen: string[] = [];
    let now = 0;
    // Un avanzamento per riga: se la coda saltasse un ordine o ne
    // ripetesse uno, `seen` divergerebbe da ARBITER_LAST_WORDS.
    for (let i = 0; i < ARBITER_LAST_WORDS.length; i++) {
      q.advance(now);
      seen.push(q.currentLine()!);
      now += 1000;
    }
    expect(seen).toEqual([...ARBITER_LAST_WORDS]);
    expect(onDone).not.toHaveBeenCalled();

    // Un ultimo avanzamento, a coda vuota: è quello che chiude la
    // sequenza e fa scattare la transizione (nel controller vero,
    // l'outro poi la schermata d'atto).
    q.advance(now);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(q.isIdle()).toBe(true);
  });

  it('non avanza finché la riga corrente non è scaduta', () => {
    const q = new NarrativeQueue(1000);
    q.enqueue(['uno', 'due']);
    q.advance(0);
    expect(q.currentLine()).toBe('uno');
    q.advance(400); // non ancora scaduta
    expect(q.currentLine()).toBe('uno');
    q.advance(1000); // scaduta esattamente ora
    expect(q.currentLine()).toBe('due');
  });

  it('due sequenze di fila (outro poi intro) restano in ordine anche quando accodate insieme', () => {
    // È il caso di un livello normale: planLevelCompletion consegna
    // un solo outro per volta, ma il canale è lo stesso dell'intro del
    // livello successivo — questo test dimostra solo che la coda non
    // mischia l'ordine di arrivo, qualunque sia la sorgente.
    const q = new NarrativeQueue(500);
    q.enqueue(['outro del livello']);
    q.advance(0);
    expect(q.currentLine()).toBe('outro del livello');
    q.advance(500);
    expect(q.isIdle()).toBe(true);
  });
});
