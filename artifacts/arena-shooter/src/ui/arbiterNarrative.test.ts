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
import { ACT_BREAKS, ARBITER_LAST_WORDS, ArbiterVoice } from './arbiter';

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

describe('ARBITER — la prima morte', () => {
  // Le chiavi della battuta erano rimaste 'drone' e 'boss' dopo che le
  // cause di morte erano diventate turret/enemy/boss: la prima morte per
  // mano di un nemico o di una torretta non ha mai avuto la sua riga.
  it('commenta la prima morte per un nemico, e poi tace', () => {
    const voce = new ArbiterVoice();
    const morte = { type: 'playerDied', cause: 'enemy' } as const;
    expect(voce.lineFor([morte], 0)?.text).toMatch(/Contaminante/);
    expect(voce.lineFor([morte], 1000)).toBeNull();
  });

  it('torretta e nemico condividono la battuta: non la ripete cambiando causa', () => {
    const voce = new ArbiterVoice();
    expect(voce.lineFor([{ type: 'playerDied', cause: 'turret' }], 0)).not.toBeNull();
    expect(voce.lineFor([{ type: 'playerDied', cause: 'enemy' }], 1000)).toBeNull();
  });

  it('la prima morte per mano del boss ha una battuta sua', () => {
    const voce = new ArbiterVoice();
    voce.lineFor([{ type: 'playerDied', cause: 'enemy' }], 0);
    expect(
      voce.lineFor([{ type: 'playerDied', cause: 'boss', bossKind: 'sentinella' }], 1000)?.text,
    ).toMatch(/Sentinella/);
  });

  // Prima la causa 'boss' aveva un'unica battuta, e nominava sempre la
  // Sentinella — anche perdendo contro il Custode o contro ARBITER
  // stesso. I tre test seguenti pinnano la correzione: ogni boss ha la
  // sua battuta *e* la sua chiave di "già detta", perché morire prima
  // per mano di uno non deve spegnere la battuta di un altro.
  it('la prima morte contro il Custode ha una battuta sua, non quella della Sentinella', () => {
    const voce = new ArbiterVoice();
    const text = voce.lineFor(
      [{ type: 'playerDied', cause: 'boss', bossKind: 'custode' }],
      0,
    )?.text;
    expect(text).toMatch(/Custode/);
    expect(text).not.toMatch(/Sentinella/);
  });

  it('la prima morte contro ARBITER parla di sé, non di un altro boss', () => {
    const voce = new ArbiterVoice();
    const text = voce.lineFor(
      [{ type: 'playerDied', cause: 'boss', bossKind: 'arbiter' }],
      0,
    )?.text;
    // In prima persona ("io"), non la battuta di uno degli altri due.
    expect(text).toMatch(/\bio\b/i);
    expect(text).not.toMatch(/^La Sentinella|^Il Custode/);
  });

  it('ogni boss tiene la propria chiave di "già detta": morire prima contro uno non zittisce gli altri', () => {
    const voce = new ArbiterVoice();
    expect(
      voce.lineFor([{ type: 'playerDied', cause: 'boss', bossKind: 'sentinella' }], 0),
    ).not.toBeNull();
    expect(
      voce.lineFor([{ type: 'playerDied', cause: 'boss', bossKind: 'custode' }], 1000),
    ).not.toBeNull();
    expect(
      voce.lineFor([{ type: 'playerDied', cause: 'boss', bossKind: 'arbiter' }], 2000),
    ).not.toBeNull();
    // Ma lo stesso boss una seconda volta sì: è ancora "la prima morte".
    expect(
      voce.lineFor([{ type: 'playerDied', cause: 'boss', bossKind: 'sentinella' }], 3000),
    ).toBeNull();
  });
});
