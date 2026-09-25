// ================================================================
// OROLOGIO DEL LOOP — test
// ================================================================
// Prova diretta della correzione descritta in frameClock.ts —
// senza questo modulo l'unica cosa provabile sarebbe stata "il gioco
// non esplode dopo N cicli in un browser vero" (vedi lo script di
// verifica in Playwright), un test costoso e indiretto rispetto a
// quello che serve qui, cioè la funzione pura.
// ================================================================

import { describe, expect, it } from 'vitest';

import { clampFrameDt } from './frameClock';

describe('clampFrameDt', () => {
  it('lascia passare un delta normale', () => {
    expect(clampFrameDt(16, 250)).toBe(16);
  });

  it('non supera mai il tetto (una tab tornata in primo piano dopo una pausa lunga)', () => {
    expect(clampFrameDt(4000, 250)).toBe(250);
  });

  it('non scende mai sotto zero — il caso reale: rAF con un ts anteriore a lastFrame', () => {
    // Lo scenario reale: closeLegend()/resume() scrivono lastFrame con
    // performance.now(), e il ts del rAF successivo può arrivare
    // qualche millisecondo prima di quella lettura.
    expect(clampFrameDt(-1, 250)).toBe(0);
    expect(clampFrameDt(-37, 250)).toBe(0);
  });

  it('scarta un delta non finito invece di propagarlo', () => {
    expect(clampFrameDt(NaN, 250)).toBe(0);
    expect(clampFrameDt(Infinity, 250)).toBe(0);
    expect(clampFrameDt(-Infinity, 250)).toBe(0);
  });

  it('il pavimento e il tetto restano indipendenti dal valore di maxMs passato', () => {
    expect(clampFrameDt(-5, 33)).toBe(0);
    expect(clampFrameDt(999, 33)).toBe(33);
    expect(clampFrameDt(20, 33)).toBe(20);
  });
});
