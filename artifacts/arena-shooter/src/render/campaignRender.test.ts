// ================================================================
// SCENA DELLA CAMPAGNA — che il disegno giri davvero
// ================================================================
// Il typecheck dimostra che il percorso di rendering compila, non che
// funziona: un NaN dentro drawImage non solleva niente, semplicemente
// non disegna. È la stessa ragione per cui esiste render.test.ts per
// l'Arena, e serve qui almeno altrettanto — i boss stanno in fondo a
// livelli con gallerie a chicane, e guidarci un browser fin lì per
// guardarli non è una verifica ripetibile.
//
// Quindi si guida la vera renderCampaignScenery, con mondi veri, e si
// controlla che ogni numero che passa per il contesto sia finito.
// ================================================================

import { beforeEach, describe, expect, it } from 'vitest';

import { TILE } from '../sim/constants';
import { ALL_LEVELS, levelById } from '../sim/campaign/levels';
import { emptyCampaignInput } from '../sim/campaign/types';
import { CampaignWorld } from '../sim/campaign/world';
import { CameraFx, computeViewport } from './camera';
import { renderCampaignScenery } from './campaignScene';

interface Recorder {
  calls: string[];
  bad: string[];
}

function makeCtx(rec: Recorder): CanvasRenderingContext2D {
  const check = (name: string, args: unknown[]): void => {
    rec.calls.push(name);
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) {
        rec.bad.push(`${name}(${args.join(', ')})`);
        return;
      }
    }
  };
  const noop =
    (name: string) =>
    (...args: unknown[]): void =>
      check(name, args);
  const ctx: Record<string, unknown> = {
    canvas: { width: 960, height: 540 },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: false,
    globalCompositeOperation: 'source-over',
    fillRect: noop('fillRect'),
    strokeRect: noop('strokeRect'),
    clearRect: noop('clearRect'),
    drawImage: noop('drawImage'),
    beginPath: noop('beginPath'),
    closePath: noop('closePath'),
    moveTo: noop('moveTo'),
    lineTo: noop('lineTo'),
    arc: noop('arc'),
    ellipse: noop('ellipse'),
    fill: noop('fill'),
    stroke: noop('stroke'),
    save: noop('save'),
    restore: noop('restore'),
    translate: noop('translate'),
    rotate: noop('rotate'),
    scale: noop('scale'),
    setLineDash: noop('setLineDash'),
    fillText: noop('fillText'),
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    getContext: () => ctx,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

/** Il minimo DOM perché il forno degli sprite possa lavorare. */
function installDom(rec: Recorder): void {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {};
      return { width: 0, height: 0, getContext: () => makeCtx(rec) };
    },
  };
  g.window = { devicePixelRatio: 1 };
}

describe('scena della campagna', () => {
  let rec: Recorder;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    rec = { calls: [], bad: [] };
    installDom(rec);
    ctx = makeCtx(rec);
  });

  function drawWorld(world: CampaignWorld, ticks: number): Recorder {
    for (let i = 0; i < ticks; i++) world.step(emptyCampaignInput());
    const vp = computeViewport(960, 540, 1);
    const fx = new CameraFx();
    fx.pitch = 0.25;
    fx.shake(10);
    fx.update(16, true, 1);
    const depth = new Float32Array(vp.numRays).fill(1e6);
    const p = world.state.player;
    renderCampaignScenery(
      ctx,
      vp,
      fx,
      { x: p.x, y: p.y, angle: p.angle },
      depth,
      world.level,
      world.state,
      true,
      true,
      1234,
    );
    return rec;
  }

  for (const level of ALL_LEVELS) {
    it(`${level.name} si disegna senza coordinate non finite`, () => {
      const out = drawWorld(new CampaignWorld(level), 40);
      expect(out.bad, out.bad.slice(0, 2).join(' | ')).toHaveLength(0);
      expect(out.calls.length).toBeGreaterThan(0);
    });
  }

  for (const [id, name] of [
    ['molo', 'Sentinella'],
    ['nucleo', 'Custode'],
    ['nido', 'ARBITER'],
  ] as const) {
    it(`${name} si disegna in ogni sua fase`, () => {
      // Il boss va messo davanti al giocatore: disegnarlo alle spalle
      // lo scarterebbe come fuori campo, e il test proverebbe che non
      // disegnare niente non dà errore.
      const level = levelById(id);
      const world = new CampaignWorld(level);
      const boss = world.state.boss!;
      const p = world.state.player;
      p.x = boss.x - TILE * 4;
      p.y = boss.y;
      p.angle = 0;
      world.state.checkpoint.room = level.boss!.room;

      // ARBITER resta nella prima fase finché i suoi moduli sono in
      // piedi, ed è giusto così: è la regola. Per vederlo cambiare
      // fase vanno tolti, esattamente come farebbe un giocatore.
      for (const id of level.boss!.moduleTurretIds ?? []) {
        const t = world.state.turrets.find((x) => x.id === id);
        if (t) t.alive = false;
      }

      const phases = new Set<string>();
      for (let i = 0; i < 1400; i++) {
        world.step(emptyCampaignInput());
        phases.add(boss.phase);
        if (i % 90 === 0) drawWorld(world, 0);
      }
      expect(rec.bad, rec.bad.slice(0, 2).join(' | ')).toHaveLength(0);
      // Se il boss restasse in una fase sola, il test coprirebbe un
      // ottavo di quello che dice di coprire.
      expect(phases.size, `fasi viste: ${[...phases].join(',')}`).toBeGreaterThan(1);
    });
  }

  it('disegna i nemici da tutte le direzioni', () => {
    // Otto direzioni, otto colonne dell'atlante: se una scegliesse un
    // indice fuori posto, drawImage riceverebbe una sorgente sbagliata
    // — o un NaN.
    const world = new CampaignWorld(levelById('archivio'));
    const e = world.state.enemies[0]!;
    const p = world.state.player;
    p.x = e.x - TILE * 3;
    p.y = e.y;
    for (let i = 0; i < 16; i++) {
      e.angle = (i / 16) * Math.PI * 2;
      drawWorld(world, 0);
    }
    expect(rec.bad, rec.bad.slice(0, 2).join(' | ')).toHaveLength(0);
    expect(rec.calls.filter((c) => c === 'drawImage').length).toBeGreaterThan(8);
  });
});
