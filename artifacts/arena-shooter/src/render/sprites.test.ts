// ================================================================
// SPRITE — piante dei corpi e geometria dell'atlante
// ================================================================
// Tre famiglie, e due di esse provano cose che si vedono solo
// guardando il risultato — cioè cose che, senza un test, si scoprono
// giocando. Che è esattamente ciò che in questo progetto nessuno può
// fare al posto mio.
//
//   1. **Nessuna scatola esce dal fotogramma.** Un corpo troppo largo
//      non dà errore: sborda nel riquadro accanto dell'atlante, e in
//      gioco il nemico si porta dietro un pezzo di sé girato da
//      un'altra parte. È successo davvero — le ali del Falco e i
//      rotori sconfinavano, ed è il motivo per cui i rotori
//      sembravano una barra continua invece di quattro bracci.
//   2. **Il punto debole ha del corpo sotto.** Se un archetipo ha la
//      debolezza sulla testa, nella banda alta della sagoma ci deve
//      essere una scatola: altrimenti il segno del punto debole
//      galleggia sopra il vuoto e si mira dove non c'è niente da
//      colpire. Anche questo è successo, coi volanti.
//   3. **Le direzioni.** L'indice dell'angolo deve concordare con la
//      regola del dorso, o quello che vedi non è quello che colpisci.
// ================================================================

import { describe, expect, it } from 'vitest';

import {
  ALL_ENEMY_KINDS,
  CORE_BAND_CENTRE,
  CORE_BAND_HALF,
  HEAD_BAND_LOW,
  archetypeOf,
} from '../sim/campaign/enemies';
import { BOSS_BODIES, ENEMY_BODIES } from './enemySprites';
import {
  FRAME_H,
  FRAME_W,
  SPRITE_ANGLES,
  SPRITE_FRAMES,
  angleIndex,
  bakeSprite,
  shade,
  spriteBox,
  type BodyPlan,
} from './spriteBaker';

/** Il margine interno del forno, ridichiarato qui apposta: se cambia
 *  di là e non di qua il test lo segnala invece di seguirlo in
 *  silenzio. */
const PAD = 3;
const SCALE = FRAME_H - PAD * 2;

/** Quanto spazio, in unità modello, il fotogramma concede per lato. */
const HALF_W = FRAME_W / 2 / SCALE;

/** Gli spostamenti che l'animazione può dare a una parte. Replicano
 *  partOffset() del forno: sono pochi e stabili, e averli qui rende il
 *  test una verifica indipendente invece di un'eco. */
function extremes(plan: BodyPlan, part: string | undefined): { dx: number; dz: number } {
  switch (part) {
    case 'legA':
    case 'legB':
      return { dx: plan.stride, dz: 0 };
    case 'armA':
    case 'armB':
      return { dx: plan.stride * 0.6, dz: 0 };
    case 'bob':
      return { dx: 0, dz: plan.bob };
    case 'spin':
      // Ruotando attorno all'asse del corpo, x e y si scambiano: il
      // caso peggiore è il raggio pieno su entrambi.
      return { dx: 0, dz: 0 };
    default:
      return { dx: 0, dz: 0 };
  }
}

const ALL_BODIES: [string, BodyPlan][] = [
  ...Object.entries(ENEMY_BODIES),
  ...Object.entries(BOSS_BODIES),
];

describe('sprite — nessuna scatola esce dal fotogramma', () => {
  for (const [name, plan] of ALL_BODIES) {
    it(`${name} sta dentro in larghezza`, () => {
      for (const b of plan.boxes) {
        const off = extremes(plan, b.part);
        // Il caso peggiore su tutti gli angoli: il centro può finire a
        // distanza hypot(x, y) dall'asse, e la semi-larghezza
        // proiettata non supera hypot(sx, sy).
        const reach = Math.hypot(Math.abs(b.x) + off.dx, Math.abs(b.y)) + Math.hypot(b.sx, b.sy);
        expect(reach, `${name}: una scatola arriva a ${reach.toFixed(3)}`).toBeLessThanOrEqual(
          HALF_W,
        );
      }
    });

    it(`${name} sta dentro in altezza`, () => {
      for (const b of plan.boxes) {
        const off = extremes(plan, b.part);
        expect(b.z - b.sz, `${name}: sotto il pavimento`).toBeGreaterThanOrEqual(-0.001);
        expect(b.z + b.sz + off.dz, `${name}: sopra la cima`).toBeLessThanOrEqual(1.001);
      }
    });
  }
});

describe('sprite — il punto debole ha del corpo sotto', () => {
  for (const kind of ALL_ENEMY_KINDS) {
    const a = archetypeOf(kind);
    const plan = ENEMY_BODIES[kind];

    it(`${kind}: c'è una scatola dove si colpisce`, () => {
      // La banda che la simulazione considera, in frazioni
      // dell'altezza — le stesse che resolveEnemyHit usa.
      const [low, high] =
        a.weakSpot === 'head'
          ? [HEAD_BAND_LOW, 1]
          : a.weakSpot === 'core'
            ? [CORE_BAND_CENTRE - CORE_BAND_HALF, CORE_BAND_CENTRE + CORE_BAND_HALF]
            : [0, 1]; // il dorso è una questione di angolo, non di quota

      const covered = plan.boxes.some((b) => b.z + b.sz >= low && b.z - b.sz <= high);
      expect(covered, `${kind}: la banda ${a.weakSpot} è vuota`).toBe(true);
    });
  }
});

describe('sprite — direzioni', () => {
  it('guardarlo in faccia è la colonna 0, di spalle è la metà', () => {
    expect(angleIndex(0)).toBe(0);
    expect(angleIndex(Math.PI)).toBe(SPRITE_ANGLES / 2);
    expect(angleIndex(-Math.PI)).toBe(SPRITE_ANGLES / 2);
  });

  it('gli angoli negativi tornano dentro, non fuori', () => {
    for (let i = -12; i <= 12; i++) {
      const idx = angleIndex((i / 6) * Math.PI);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(SPRITE_ANGLES);
    }
  });

  it('un giro completo torna al punto di partenza', () => {
    expect(angleIndex(Math.PI * 2)).toBe(angleIndex(0));
    expect(angleIndex(Math.PI * 4 + 0.3)).toBe(angleIndex(0.3));
  });

  it("l'atlante ha una colonna per direzione e una riga per fotogramma", () => {
    for (const [, plan] of ALL_BODIES) {
      expect(plan.boxes.length).toBeGreaterThan(0);
    }
    expect(SPRITE_ANGLES).toBe(8);
    expect(SPRITE_FRAMES).toBe(4);
  });
});

describe('sprite — la cottura gira davvero', () => {
  /** Il minimo DOM perché il forno possa lavorare, con ogni numero
   *  controllato mentre passa. Un NaN dentro fillRect non dà errore:
   *  non disegna e basta, e lo sprite esce vuoto. È la stessa
   *  precauzione di render.test.ts, per la stessa ragione. */
  function bakeAll(): { calls: number; bad: string[] } {
    const bad: string[] = [];
    let calls = 0;
    const check = (name: string, args: unknown[]): void => {
      calls++;
      for (const v of args) {
        if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${name}(${args.join(',')})`);
      }
    };
    const noop =
      (name: string) =>
      (...args: unknown[]): void =>
        check(name, args);
    const g = globalThis as Record<string, unknown>;
    const previous = g.document;
    g.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: '',
          strokeStyle: '',
          lineWidth: 1,
          fillRect: noop('fillRect'),
          strokeRect: noop('strokeRect'),
          save: noop('save'),
          restore: noop('restore'),
        }),
      }),
    };
    try {
      for (const [, plan] of ALL_BODIES) bakeSprite(plan);
    } finally {
      g.document = previous;
    }
    return { calls, bad };
  }

  it('cuoce tutti i corpi senza coordinate non finite', () => {
    const { calls, bad } = bakeAll();
    expect(bad, bad.slice(0, 3).join(' | ')).toHaveLength(0);
    // Tredici corpi, otto direzioni, quattro fotogrammi: qualche
    // migliaio di rettangoli. Il numero esatto non conta, che non sia
    // zero sì.
    expect(calls).toBeGreaterThan(1000);
  });
});

describe('sprite — colore e posa', () => {
  it('shade legge sia esadecimale sia rgb()', () => {
    // È il difetto che aveva reso neri metà degli sprite: shade si
    // applica due volte, e la seconda riceve l'uscita della prima.
    expect(shade('#808080', 1)).toBe('rgb(128,128,128)');
    expect(shade(shade('#808080', 1), 0.5)).toBe('rgb(64,64,64)');
    expect(shade('rgb(10,20,30)', 2)).toBe('rgb(20,40,60)');
  });

  it('i piedi finiscono dove glielo si chiede', () => {
    const box = spriteBox(100, 500, 400);
    // z=0 sta a PAD px dal fondo del fotogramma, in scala.
    const unit = 100 / SCALE;
    expect(box.dy + box.dh - PAD * unit).toBeCloseTo(400, 6);
    expect(box.dx + box.dw / 2).toBeCloseTo(500, 6);
    expect(box.dh / box.dw).toBeCloseTo(FRAME_H / FRAME_W, 6);
  });

  it('un nemico alto il doppio occupa il doppio', () => {
    const a = spriteBox(50, 0, 0);
    const b = spriteBox(100, 0, 0);
    expect(b.dh / a.dh).toBeCloseTo(2, 6);
  });
});
