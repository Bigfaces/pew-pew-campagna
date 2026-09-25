// ================================================================
// OVERLAY — l'ottica non deve mai chiedere un raggio negativo
// ================================================================
// `renderScope` prendeva `ads` così com'era e ci calcolava
// dentro `r = full * (2.1 - 1.1 * ads)`: con `ads` oltre ~1.9 (misurato
// intorno a 4 nel difetto vero, causato da un frameDt negativo — vedi
// game/frameClock.ts) `r` diventava negativo, e in un browser vero
// `ctx.arc(cx, cy, r, ...)` e `ctx.createRadialGradient(..., r)`
// lanciano `IndexSizeError: The radius provided (-N) is negative`.
//
// Il mock qui sotto non è un vero canvas — non c'è jsdom in questa
// suite (vedi src/ui/comandi.test.ts) — ma riproduce la sola regola
// che conta per questo difetto: un `arc`/`createRadialGradient`
// chiamato con un raggio negativo lancia, esattamente come fa il DOM
// vero. È la controprova diretta: senza la correzione in overlay.ts
// (il clamp di `ads` e il pavimento su `r`) questo test va rosso con
// `ads = 4`.
// ================================================================

import { describe, expect, it } from 'vitest';

import type { CameraFx, Viewport } from './camera';
import { renderScope, type WeaponReadout } from './overlay';

/** Un contesto 2D minimo che si comporta come il DOM vero sull'unica
 *  cosa che conta qui: un raggio negativo passato ad arc() o a
 *  createRadialGradient() lancia, non lo ignora silenziosamente. */
function makeStrictCtx(): CanvasRenderingContext2D {
  const checkRadius = (name: string, r: number): void => {
    if (r < 0) {
      throw new DOMException(
        `Failed to execute '${name}' on 'CanvasRenderingContext2D': The radius provided (${r}) is negative.`,
        'IndexSizeError',
      );
    }
  };
  const noop = (): void => {};
  const ctx: Record<string, unknown> = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    arc: (_cx: number, _cy: number, r: number): void => checkRadius('arc', r),
    createRadialGradient: (
      _x0: number,
      _y0: number,
      r0: number,
      _x1: number,
      _y1: number,
      r1: number,
    ) => {
      checkRadius('createRadialGradient', r0);
      checkRadius('createRadialGradient', r1);
      return { addColorStop: noop };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function makeFx(): CameraFx {
  return { bobX: 0, bobY: 0, shakeX: 0, shakeY: 0, pitch: 0 } as unknown as CameraFx;
}

const VP: Viewport = { width: 960, height: 540 } as unknown as Viewport;
const WEAPON_READY: WeaponReadout = { cooldownMs: 0, maxCooldownMs: 1400 };
const WEAPON_COOLING: WeaponReadout = { cooldownMs: 700, maxCooldownMs: 1400 };

describe('renderScope — il raggio non è mai negativo', () => {
  // Valori normali, più il valore osservato davvero nel difetto (~4,
  // vedi il commento in campaignGame.ts/updateFeel) e qualche estremo
  // in più per non provare solo il punto misurato.
  const adsValues = [0.01, 0.5, 1, 1.5, 2, 4, 100, -1, -0.5];

  for (const ads of adsValues) {
    it(`ads = ${ads} non lancia, con l'arma pronta`, () => {
      const ctx = makeStrictCtx();
      expect(() => renderScope(ctx, VP, makeFx(), WEAPON_READY, ads)).not.toThrow();
    });

    it(`ads = ${ads} non lancia, con l'arma in ricarica (arco del bolt-cycle)`, () => {
      // Il ramo "non pronto" disegna un arco in più (progress) che usa
      // anch'esso `r`: la stessa correzione deve reggere anche qui.
      const ctx = makeStrictCtx();
      expect(() => renderScope(ctx, VP, makeFx(), WEAPON_COOLING, ads)).not.toThrow();
    });
  }

  it('un ads fuori da [0,1] resta comunque visibile (clampato, non azzerato)', () => {
    // Il clamp deve solo raddrizzare il valore, non far sparire
    // l'ottica: con ads = 4 la scena deve continuare a disegnarsi come
    // se ads fosse 1 (aperture massima), non come se ads <= 0.005.
    const calls: string[] = [];
    const ctx = makeStrictCtx();
    const wrapped = new Proxy(ctx, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            calls.push(String(prop));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });
    renderScope(wrapped, VP, makeFx(), WEAPON_READY, 4);
    expect(calls).toContain('arc');
  });
});
