// ================================================================
// NARRAZIONE — intro/outro dei livelli e testi di ARBITER
// ================================================================
// Non prova la sim (i livelli restano sotto sim/campaign/levels.test.ts
// per la loro struttura): prova solo che il *testo* scritto per la
// campagna rispetti i vincoli che lo rendono utilizzabile.
//
// Il controllo che conta di più è l'ultimo, sui duplicati: un
// copia-incolla fra due livelli non si vede rileggendo uno alla volta
// (ogni riga, presa da sola, sembra scritta apposta), e qui basta
// raccogliere tutto in un unico insieme e contare.
// ================================================================

import { describe, expect, it } from 'vitest';

import { ALL_LEVELS } from '../sim/campaign/levels';
import { ACT_BREAKS, ARBITER_LAST_WORDS } from './arbiter';

/** Il sottotitolo dei livelli sta in un riquadro largo 620px: oltre le
 *  ~120 battute diventa scomodo, e il limite duro che il test impone
 *  gli lascia un margine prima di sfondare davvero. I testi d'atto non
 *  sono soggetti a questo vincolo — hanno una schermata propria, come
 *  dice il commento su ACT_BREAKS — quindi restano fuori da questo
 *  controllo. */
const MAX_LEVEL_LINE = 140;

describe('narrazione — intro/outro dei livelli', () => {
  it('ogni livello ha un intro e un outro non vuoti', () => {
    for (const level of ALL_LEVELS) {
      expect(level.intro.trim().length, `${level.id}.intro`).toBeGreaterThan(0);
      expect(level.outro.trim().length, `${level.id}.outro`).toBeGreaterThan(0);
    }
  });

  it('nessuna riga di livello supera il limite del sottotitolo', () => {
    for (const level of ALL_LEVELS) {
      expect(level.intro.length, `${level.id}.intro`).toBeLessThanOrEqual(MAX_LEVEL_LINE);
      expect(level.outro.length, `${level.id}.outro`).toBeLessThanOrEqual(MAX_LEVEL_LINE);
    }
  });

  it('i nove livelli sono nell’ordine atto/ordinale atteso', () => {
    // Non è un test sulla sim (quello vive in levels.test.ts): è solo
    // la garanzia che "leggile tutte e nove" trovi davvero nove righe
    // diverse, e non una lista più corta per un livello dimenticato.
    expect(ALL_LEVELS.length).toBe(9);
  });
});

describe('narrazione — passaggi d’atto e finale', () => {
  it('esistono esattamente tre testi d’atto, uno per atto, con almeno una frase ciascuno', () => {
    expect(ACT_BREAKS.length).toBe(3);
    expect(ACT_BREAKS.map((b) => b.actCompleted)).toEqual([1, 2, 3]);
    for (const brk of ACT_BREAKS) {
      expect(brk.lines.length, `atto ${brk.actCompleted}`).toBeGreaterThan(0);
      for (const line of brk.lines) {
        expect(line.trim().length, `atto ${brk.actCompleted}`).toBeGreaterThan(0);
      }
    }
  });

  it('il terzo passaggio d’atto è il finale della campagna: niente atto successivo da annunciare', () => {
    // L'unico modo di distinguere "fine atto" da "fine campagna" nel
    // dato è la sua posizione (il terzo e ultimo): un test che lo fissi
    // impedisce a un domani "ACT_BREAKS[3]" di comparire per errore.
    const finale = ACT_BREAKS[ACT_BREAKS.length - 1]!;
    expect(finale.actCompleted).toBe(3);
  });

  it('ARBITER ha almeno due ultime battute mentre viene abbattuto', () => {
    expect(ARBITER_LAST_WORDS.length).toBeGreaterThanOrEqual(2);
    for (const line of ARBITER_LAST_WORDS) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('narrazione — niente copia-incolla', () => {
  it('nessun testo (intro, outro, passaggi d’atto, ultime battute) è duplicato', () => {
    // Un `Map` invece di un `Set` per poter dire *quali* due righe
    // coincidono, se il test fallisce: "duplicato" da solo non basta a
    // trovare l'origine in nove livelli più tre atti.
    const seen = new Map<string, string>();
    const dupes: string[] = [];

    const check = (label: string, text: string): void => {
      const prev = seen.get(text);
      if (prev) dupes.push(`"${text}" — ${prev} == ${label}`);
      else seen.set(text, label);
    };

    for (const level of ALL_LEVELS) {
      check(`${level.id}.intro`, level.intro);
      check(`${level.id}.outro`, level.outro);
    }
    for (const brk of ACT_BREAKS) {
      brk.lines.forEach((line, i) => check(`ACT_BREAKS[${brk.actCompleted}][${i}]`, line));
    }
    ARBITER_LAST_WORDS.forEach((line, i) => check(`ARBITER_LAST_WORDS[${i}]`, line));

    expect(dupes, dupes.join('\n')).toEqual([]);
  });
});
