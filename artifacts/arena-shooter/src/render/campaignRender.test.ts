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
import { BEACON_LIFETIME_MS } from '../sim/campaign/constants';
import { ALL_LEVELS, levelById } from '../sim/campaign/levels';
import { emptyCampaignInput } from '../sim/campaign/types';
import { CampaignWorld } from '../sim/campaign/world';
import { CameraFx, SLICE_W, computeViewport, projectPoint } from './camera';
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

// ================================================================
// TRASPONDITORE — l'esca piantata, le cariche a terra, i richiamati
// ================================================================
// 'attracco' è scelto apposta: non ha gas, voragini né pavimenti che
// cedono (levels.ts), quindi ogni chiamata di disegno nello scenario
// isolato che segue è attribuibile solo a quello che il test ha messo
// in scena — nessuna decalcomania di livello a confondere il conteggio.
describe('Trasponditore', () => {
  let rec: Recorder;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    rec = { calls: [], bad: [] };
    installDom(rec);
    ctx = makeCtx(rec);
  });

  /** Un mondo vuoto tranne per quello che il test aggiunge: nessun
   *  core, scudo, turret, nemico o boss a produrre disegni non
   *  pertinenti al Trasponditore. */
  function bareWorld(): CampaignWorld {
    const world = new CampaignWorld(levelById('attracco'));
    world.state.cores = [];
    world.state.shields = [];
    world.state.turrets = [];
    world.state.enemies = [];
    world.state.boss = null;
    world.state.beaconPickups = [];
    world.state.beacon = { active: false, x: 0, y: 0, ms: 0 };
    return world;
  }

  function render(world: CampaignWorld, depth?: Float32Array): Recorder {
    rec = { calls: [], bad: [] };
    ctx = makeCtx(rec);
    const vp = computeViewport(960, 540, 1);
    const fx = new CameraFx();
    const p = world.state.player;
    const d = depth ?? new Float32Array(vp.numRays).fill(1e6);
    renderCampaignScenery(
      ctx,
      vp,
      fx,
      { x: p.x, y: p.y, angle: p.angle },
      d,
      world.level,
      world.state,
      true,
      true,
      500,
    );
    return rec;
  }

  it("l'esca attiva viene disegnata; inattiva no", () => {
    const world = bareWorld();
    const p = world.state.player;
    const beaconX = p.x + TILE * 3;
    const beaconY = p.y;

    const inactive = render(world);
    expect(inactive.bad).toHaveLength(0);
    const inactiveArcs = inactive.calls.filter((c) => c === 'arc').length;

    world.state.beacon = { active: true, x: beaconX, y: beaconY, ms: BEACON_LIFETIME_MS };
    const active = render(world);
    expect(active.bad).toHaveLength(0);
    const activeArcs = active.calls.filter((c) => c === 'arc').length;

    // La punta dell'antenna e le finestre di raccoglibili assenti sono
    // l'unica fonte di 'arc' in questa scena spoglia: se sale, è l'esca.
    expect(activeArcs).toBeGreaterThan(inactiveArcs);
  });

  it('la carica raccolta non viene disegnata, quella libera sì', () => {
    const world = bareWorld();
    const p = world.state.player;
    const chargeX = p.x + TILE * 2;
    const chargeY = p.y;

    world.state.beaconPickups = [{ id: 'test-charge', x: chargeX, y: chargeY, collected: true }];
    const collected = render(world);
    expect(collected.bad).toHaveLength(0);
    const collectedArcs = collected.calls.filter((c) => c === 'arc').length;

    world.state.beaconPickups = [{ id: 'test-charge', x: chargeX, y: chargeY, collected: false }];
    const free = render(world);
    expect(free.bad).toHaveLength(0);
    const freeArcs = free.calls.filter((c) => c === 'arc').length;

    expect(collectedArcs).toBe(0);
    expect(freeArcs).toBeGreaterThan(0);
  });

  it("l'esca dietro un muro è occlusa", () => {
    const world = bareWorld();
    const p = world.state.player;
    p.angle = 0;
    const beaconX = p.x + TILE * 3;
    const beaconY = p.y;
    world.state.beacon = { active: true, x: beaconX, y: beaconY, ms: BEACON_LIFETIME_MS };

    const vp = computeViewport(960, 540, 1);
    const fx = new CameraFx();
    const cam = { x: p.x, y: p.y, angle: p.angle };
    // Nessuno shake/bob in gioco (CameraFx appena creata): la colonna
    // che occlude l'esca è quella del suo screenX grezzo, senza offset.
    const proj = projectPoint(vp, fx, cam.x, cam.y, cam.angle, beaconX, beaconY, 0.5);
    expect(proj.visible).toBe(true);
    const col = Math.round(proj.screenX / SLICE_W);

    const visibleDepth = new Float32Array(vp.numRays).fill(1e6);
    const visible = render(world, visibleDepth);
    expect(visible.bad).toHaveLength(0);
    expect(visible.calls.filter((c) => c === 'arc').length).toBeGreaterThan(0);

    // Un muro più vicino dell'esca su quella sola colonna: la stessa
    // regola di profondità che occlude core, scudi e nemici (vedi
    // `occluded` in campaignScene.ts).
    const occludedDepth = new Float32Array(vp.numRays).fill(1e6);
    occludedDepth[col] = proj.perp - 50;
    const occluded = render(world, occludedDepth);
    expect(occluded.bad).toHaveLength(0);
    expect(occluded.calls.filter((c) => c === 'arc').length).toBe(0);
  });

  it('un nemico richiamato mostra il segno del richiamo', () => {
    const world = new CampaignWorld(levelById('attracco'));
    world.state.cores = [];
    world.state.shields = [];
    world.state.turrets = [];
    world.state.boss = null;
    world.state.beaconPickups = [];
    world.state.beacon = { active: false, x: 0, y: 0, ms: 0 };

    const e = world.state.enemies[0]!;
    const p = world.state.player;
    p.x = e.x - TILE * 3;
    p.y = e.y;
    p.angle = 0;
    world.state.enemies = [e];

    e.lured = false;
    const notLured = render(world);
    expect(notLured.bad).toHaveLength(0);

    e.lured = true;
    const lured = render(world);
    expect(lured.bad).toHaveLength(0);

    // Il segno è un triangolo pieno sopra la testa: un beginPath/fill in
    // più rispetto al caso non richiamato, senza toccare gli altri
    // overlay (punto debole, piastra, finestra), che restano identici a
    // parità di stato del nemico per il resto.
    expect(lured.calls.filter((c) => c === 'fill').length).toBeGreaterThan(
      notLured.calls.filter((c) => c === 'fill').length,
    );
  });

  it('non altera lo sfondo dietro l\'esca: nessun composito diverso da source-over', () => {
    // La trappola già pagata (vedi drawTintedFrame in spriteBaker.ts):
    // `source-atop` compone contro l'intera tela, non contro l'ultimo
    // disegno. Il mock qui non tiene un vero framebuffer, quindi non può
    // leggere "il pixel del muro non è cambiato" alla lettera — ma può
    // dimostrare che il disegno del Trasponditore non usa mai quella
    // tecnica: se non cambia mai `globalCompositeOperation`, non può
    // comporre contro nulla che non sia l'ultimo tratto, quindi non può
    // tingere lo sfondo. Il velo dei boss (drawBossBody) resta l'unico
    // punto che usa un composito diverso, ed è fuori da questo test.
    const world = bareWorld();
    const p = world.state.player;
    world.state.beacon = {
      active: true,
      x: p.x + TILE * 3,
      y: p.y,
      ms: BEACON_LIFETIME_MS,
    };
    world.state.beaconPickups = [
      { id: 'c', x: p.x + TILE * 2, y: p.y + TILE, collected: false },
    ];

    const composites: string[] = [];
    const c = ctx as unknown as { globalCompositeOperation: string };
    let value = 'source-over';
    Object.defineProperty(c, 'globalCompositeOperation', {
      configurable: true,
      get: () => value,
      set: (v: string) => {
        value = v;
        composites.push(v);
      },
    });

    const vp = computeViewport(960, 540, 1);
    const fx = new CameraFx();
    const depth = new Float32Array(vp.numRays).fill(1e6);
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
      500,
    );

    expect(rec.bad).toHaveLength(0);
    expect(composites.every((v) => v === 'source-over')).toBe(true);
  });
});
