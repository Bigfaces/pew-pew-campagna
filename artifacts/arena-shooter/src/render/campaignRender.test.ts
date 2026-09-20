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
import { archetypeOf } from '../sim/campaign/enemies';
import { emptyCampaignInput } from '../sim/campaign/types';
import { CampaignWorld } from '../sim/campaign/world';
import type { LevelDef } from '../sim/campaign/levelTypes';
import { CameraFx, SLICE_W, computeViewport, projectPoint } from './camera';
import { SEMI_TILE, margineBillboard, renderCampaignScenery } from './campaignScene';

interface Recorder {
  calls: string[];
  bad: string[];
  /** Disegni di dimensione assurda. Un numero finito non basta: una
   *  proiezione che esplode produce numeri finiti e giganteschi, e a
   *  schermo diventano una tinta piatta su tutto il fotogramma. */
  enormi: string[];
}

/** Oltre questo nessun disegno è più uno sprite: è una parete di
 *  colore. Il viewport dei test è 960x540, quindi il limite vale
 *  venti schermate — larghissimo di proposito, perché deve scattare
 *  solo sulla patologia, non sul nemico appiccicato alla faccia. */
const LIMITE_DISEGNO = 20_000;

function makeCtx(rec: Recorder): CanvasRenderingContext2D {
  const check = (name: string, args: unknown[]): void => {
    rec.calls.push(name);
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) {
        rec.bad.push(`${name}(${args.join(', ')})`);
        return;
      }
      if (typeof a === 'number' && Math.abs(a) > LIMITE_DISEGNO) {
        rec.enormi.push(`${name}(${args.join(', ')})`);
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
    // Il ritaglio per colonna dei billboard (vedi `ritagliato` in
    // campaignScene.ts) passa da qui: senza queste due il finto
    // contesto non regge più la scena, e l'occlusione parziale non
    // sarebbe provabile affatto.
    rect: noop('rect'),
    clip: noop('clip'),
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
    rec = { calls: [], bad: [], enormi: [] };
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
      world.state.reachedRoom = world.state.checkpoint.room;

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
    rec = { calls: [], bad: [], enormi: [] };
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
    rec = { calls: [], bad: [], enormi: [] };
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
    const proj = projectPoint(vp, fx, cam.x, cam.y, cam.angle, beaconX, beaconY, 0.5);
    expect(proj.visible).toBe(true);

    const visibleDepth = new Float32Array(vp.numRays).fill(1e6);
    const visible = render(world, visibleDepth);
    expect(visible.bad).toHaveLength(0);
    expect(visible.calls.filter((c) => c === 'arc').length).toBeGreaterThan(0);

    // Un muro più vicino dell'esca *su tutta la sua fascia*. Il muro va
    // messo dappertutto e non su una colonna sola: da quando
    // l'occlusione è per colonna (vedi `colonneVisibili` in
    // campaignScene.ts) una colonna coperta nasconde una colonna, non
    // uno sprite — ed è esattamente la correzione che la prova qui
    // sotto tiene ferma.
    const occludedDepth = new Float32Array(vp.numRays).fill(proj.perp - 50);
    const occluded = render(world, occludedDepth);
    expect(occluded.bad).toHaveLength(0);
    expect(occluded.calls.filter((c) => c === 'arc').length).toBe(0);
  });

  it('una colonna coperta nasconde una colonna, non tutto lo sprite', () => {
    // La guardia del difetto che il primo tester ha descritto come
    // "sparisce la sprite ma non il nemico, e ti spara qualcosa di
    // invisibile".
    //
    // L'occlusione dei billboard guardava **una sola colonna**, quella
    // del centro dello sprite, e da quella decideva se disegnare
    // *tutto* o *niente*. Un nemico dietro lo stipite di una porta ha
    // il centro coperto e i fianchi in vista: spariva per intero,
    // restando vivo e continuando a sparare. Lo stesso al bordo dello
    // schermo, dove la colonna usciva dall'intervallo e la risposta era
    // "coperto" invece di "tagliato".
    //
    // L'esca serve da campione perché è il billboard più semplice del
    // gioco — un arco pieno — ma la regola sotto la prova è la stessa
    // per nemici, boss, core e scudi: passano tutti da `push`.
    const world = bareWorld();
    const p = world.state.player;
    p.angle = 0;
    const beaconX = p.x + TILE * 3;
    const beaconY = p.y;
    world.state.beacon = { active: true, x: beaconX, y: beaconY, ms: BEACON_LIFETIME_MS };

    const vp = computeViewport(960, 540, 1);
    const fx = new CameraFx();
    const cam = { x: p.x, y: p.y, angle: p.angle };
    const proj = projectPoint(vp, fx, cam.x, cam.y, cam.angle, beaconX, beaconY, 0.5);
    const col = Math.round(proj.screenX / SLICE_W);

    const depth = new Float32Array(vp.numRays).fill(1e6);
    depth[col] = proj.perp - 50;
    const out = render(world, depth);

    expect(out.bad).toHaveLength(0);
    // Si vede ancora: è il punto.
    expect(out.calls.filter((c) => c === 'arc').length).toBeGreaterThan(0);
    // E si vede *ritagliato*, non intero: senza il clip sarebbe
    // disegnato sopra il muro invece che accanto.
    expect(out.calls).toContain('clip');
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

// ================================================================
// GIRARSI NON DEVE ANNERIRE LO SCHERMO
// ================================================================
// Il secondo tester: «quando si gira verso un muro schermo nero e
// muore, o flash rosso». Non era il muro, ed era una cosa sola.
//
// `projectPoint` scarta un punto solo quando esce dal campo visivo più
// un margine, e i raccoglibili chiedevano margine 1 rad. Su uno schermo
// 16:9 il semicampo orizzontale è ~0,75 rad, quindi il taglio cadeva a
// ~1,75 rad: oltre i 90 gradi. Un punto oltre i 90 gradi sta DIETRO il
// piano di proiezione, cos(rel) è negativo, e `perp` finiva sul suo
// pavimento di 0,0001. Da lì tileH = TILE/perp*projDist diventa ~3e8
// pixel, e drawDiamond riempie il fotogramma del suo `#0d0f18`:
// misurato nel browser, 13,15,24 sul 100% dei pixel campionati. La
// stessa cosa con una torretta dà l'alone rosso: «o flash rosso».
//
// L'ho reso visibile io: la vecchia occlusione a colonna singola
// rispondeva "coperto" quando screenX usciva dallo schermo, e per puro
// caso scartava anche questi. Tolta quella, il difetto è venuto fuori.
describe('proiezione — niente sprite da dietro la camera', () => {
  let rec: Recorder;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    rec = { calls: [], bad: [], enormi: [] };
    installDom(rec);
    ctx = makeCtx(rec);
  });

  it('un punto oltre i 90 gradi non è mai visibile, per quanto largo sia il margine', () => {
    const vp = computeViewport(1920, 1080, 1);
    const fx = new CameraFx();
    // Il margine che i raccoglibili chiedevano. Anche con questo, un
    // punto dietro il piano di proiezione non è un punto proiettabile.
    for (const gradi of [90.001, 91, 95, 120, 179]) {
      const rel = (gradi * Math.PI) / 180;
      const d = TILE * 6;
      const p = projectPoint(vp, fx, 0, 0, 0, Math.cos(rel) * d, Math.sin(rel) * d, 1);
      expect(p.visible, `${gradi} gradi: perp=${p.perp} tileH=${p.tileH}`).toBe(false);
    }
  });

  it('girandosi, un nucleo non diventa una tinta piatta su tutto lo schermo', () => {
    // Il giro completo, un grado alla volta: la banda cieca misurata è
    // larga una decina di gradi, quindi un passo grosso la scavalcava
    // e il test sarebbe passato senza guardare niente.
    const level = levelById('attracco');
    const world = new CampaignWorld(level);
    const core = world.state.cores[0]!;
    const p = world.state.player;
    p.x = core.x - TILE * 6;
    p.y = core.y;

    const vp = computeViewport(1920, 1080, 1);
    const fx = new CameraFx();
    const depth = new Float32Array(vp.numRays).fill(1e6);
    for (let g = 0; g < 360; g++) {
      p.angle = (g * Math.PI) / 180;
      renderCampaignScenery(
        ctx,
        vp,
        fx,
        { x: p.x, y: p.y, angle: p.angle },
        depth,
        level,
        world.state,
        true,
        true,
        1234,
      );
    }
    expect(rec.bad, rec.bad.slice(0, 2).join(' | ')).toHaveLength(0);
    expect(rec.enormi, rec.enormi.slice(0, 3).join(' | ')).toHaveLength(0);
  });

  it('girandosi, una torretta non lava lo schermo di rosso', () => {
    // Stessa patologia, altro oggetto: l'alone della torretta è un
    // arc() il cui raggio segue tileH. È il «flash rosso» del tester.
    const level = levelById('attracco');
    const world = new CampaignWorld(level);
    const def = level.turrets[0]!;
    const p = world.state.player;
    p.x = (def.tx + 0.5) * TILE - TILE * 6;
    p.y = (def.ty + 0.5) * TILE;

    const vp = computeViewport(1920, 1080, 1);
    const fx = new CameraFx();
    const depth = new Float32Array(vp.numRays).fill(1e6);
    for (let g = 0; g < 360; g++) {
      p.angle = (g * Math.PI) / 180;
      renderCampaignScenery(
        ctx,
        vp,
        fx,
        { x: p.x, y: p.y, angle: p.angle },
        depth,
        level,
        world.state,
        true,
        true,
        1234,
      );
    }
    expect(rec.enormi, rec.enormi.slice(0, 3).join(' | ')).toHaveLength(0);
  });
});

// ================================================================
// LA STESSA PROVA, SU TUTTA LA MAPPA
// ================================================================
// I due test qui sopra guidano la scena vera, ma da due punti soli.
// Questo rinuncia al contesto di disegno e tiene la geometria, che è
// dove sta il difetto: ogni tile calpestabile di ogni livello, giro
// completo, ogni billboard, e la domanda è sempre la stessa — quanto
// diventa largo a schermo. Prima della correzione il massimo misurato
// era 367 262 schermate; dopo, 0,96, e quel caso è un nemico a una
// tile il cui centro cade comunque fuori dallo schermo.
//
// Semilarghezze da SEMI_TILE e margine da margineBillboard, cioè le
// stesse funzioni che usa `push`: riscriverne qui una copia a mano
// vorrebbe dire che rimettere il difetto nel codice vero lascerebbe
// questo test verde. Resta fuori solo il cablaggio fra push e i siti
// di disegno, ed è quello che provano i due test qui sopra.
describe('proiezione — nessuna posizione della mappa fa esplodere uno sprite', () => {
  // Il 21:9 non è un capriccio: più è largo lo schermo, più è ampio il
  // semicampo orizzontale, e il difetto viveva proprio nello spazio fra
  // il semicampo e i 90 gradi. Su un telefono in verticale non si
  // vedeva affatto — per questo non l'avevo mai visto io.
  for (const [w, h] of [[1920, 1080], [2560, 1080]] as const) {
    it(`${w}x${h}: nessuno sprite supera una schermata e mezza`, () => {
      const vp = computeViewport(w, h, 1);
      const fx = new CameraFx();
      let peggio = 0;
      let dove = '';
      for (const level of ALL_LEVELS) {
        const world = new CampaignWorld(level);
        const st = world.state;
        const oggetti: [number, number, number, string][] = [];
        for (const c of st.cores) oggetti.push([c.x, c.y, SEMI_TILE.nucleo, 'nucleo']);
        for (const sh of st.shields) oggetti.push([sh.x, sh.y, SEMI_TILE.scudo, 'scudo']);
        for (const b of st.beaconPickups) {
          oggetti.push([b.x, b.y, SEMI_TILE.trasponditore, 'trasponditore']);
        }
        for (const t of level.turrets) {
          oggetti.push([(t.tx + 0.5) * TILE, (t.ty + 0.5) * TILE, SEMI_TILE.torretta, 'torretta']);
        }
        if (level.exit) {
          oggetti.push([
            (level.exit.tx + 0.5) * TILE,
            (level.exit.ty + 0.5) * TILE,
            SEMI_TILE.uscita,
            'uscita',
          ]);
        }
        for (const e of st.enemies) {
          oggetti.push([e.x, e.y, archetypeOf(e.kind).height * 0.5, 'nemico']);
        }
        if (st.boss) oggetti.push([st.boss.x, st.boss.y, SEMI_TILE.boss, 'boss']);

        for (let ty = 0; ty < level.height; ty++) {
          for (let tx = 0; tx < level.width; tx++) {
            if (world.getTile(tx, ty) !== 0) continue;
            const cx = (tx + 0.5) * TILE;
            const cy = (ty + 0.5) * TILE;
            // Passo di 5 gradi: la banda cieca misurata era larga fra i
            // 10 e i 19 gradi a seconda dello schermo, quindi un passo
            // così non può scavalcarla.
            for (let g = 0; g < 360; g += 5) {
              const ang = (g * Math.PI) / 180;
              for (const [ox, oy, semiTile, nome] of oggetti) {
                const { margine, semiMondo } = margineBillboard(
                  semiTile,
                  Math.hypot(ox - cx, oy - cy),
                );
                const p = projectPoint(vp, fx, cx, cy, ang, ox, oy, margine, semiMondo);
                if (!p.visible) continue;
                const semiPx = p.tileH * semiTile;
                if (semiPx > peggio) {
                  peggio = semiPx;
                  dove = `${level.id} (${tx},${ty}) ${g}deg ${nome} perp=${p.perp.toFixed(2)}`;
                }
              }
            }
          }
        }
      }
      expect(peggio, `${(peggio / h).toFixed(2)} schermate — ${dove}`).toBeLessThan(h * 1.5);
    });
  }
});

// ================================================================
// DECALCOMANIE A PAVIMENTO — occlusione e ritaglio (GDD §20)
// ================================================================
// drawFloorTile aveva due modi per far sparire un tile intero (gas,
// voragine, pavimento che cede) quando in realtà ne restava visibile
// una parte consistente:
//
//  (a) l'occlusione guardava una sola colonna, quella del centro del
//      tile, e in base a quella teneva o buttava *tutto* il poligono
//      — sia quando un muro copriva solo il centro, sia quando quella
//      colonna cadeva semplicemente fuori dallo schermo mentre il
//      resto del tile restava a vista.
//  (b) i quattro angoli venivano proiettati con `projectPoint`, e se
//      anche uno solo risultava non proiettabile (fuori campo visivo o
//      dietro il piano della camera) l'intero tile veniva scartato:
//      avvicinandosi a un tile, o standoci sopra, basta un angolo per
//      far sparire tutta la decalcomania.
//
// Le prove sotto isolano l'una dall'altra, sul modello di quelle già
// esistenti per i billboard qui sopra.
describe('decalcomanie a pavimento', () => {
  /** Un livello base senza decalcomanie proprie (attracco non ne ha),
   *  con le proprie sostituite da quelle passate: isola il conteggio
   *  di `fill` a quello che il test mette in scena. */
  function livelloConGas(tiles: { tx: number; ty: number }[]): LevelDef {
    const base = levelById('attracco');
    return {
      ...base,
      gasZones: [{ id: 'sonda-gas', tiles, lingerMs: 0, room: 'sonda' }],
      chasms: [],
      gravityZones: [],
      collapsingFloors: [],
    };
  }

  /** Stato spoglio: nessun core, scudo, turret, nemico, boss o esca a
   *  produrre `fill` non pertinenti. */
  function statoSpoglio(level: LevelDef) {
    const world = new CampaignWorld(level);
    world.state.cores = [];
    world.state.shields = [];
    world.state.turrets = [];
    world.state.enemies = [];
    world.state.boss = null;
    world.state.beaconPickups = [];
    world.state.beacon = { active: false, x: 0, y: 0, ms: 0 };
    world.state.collapsingFloors = [];
    return world.state;
  }

  function render(
    level: LevelDef,
    cam: { x: number; y: number; angle: number },
    depth: Float32Array,
  ): Recorder {
    const rec: Recorder = { calls: [], bad: [], enormi: [] };
    installDom(rec);
    const ctx = makeCtx(rec);
    const vp = computeViewport(960, 540, 1);
    const fx = new CameraFx();
    const state = statoSpoglio(level);
    renderCampaignScenery(ctx, vp, fx, cam, depth, level, state, true, true, 500);
    return rec;
  }

  it('(b) un angolo dietro la camera non deve far sparire tutta la decalcomania', () => {
    // Tile (10,10), camera dentro il tile stesso a 0.3 tile dal centro,
    // rivolta verso l'interno: misurato in probe-b.mts, a questa
    // distanza almeno due dei quattro angoli sono "dietro la camera"
    // per projectPoint (|rel| >= 90°), eppure la maggior parte del
    // poligono resta davanti all'occhio e dovrebbe restare a schermo —
    // è esattamente "la nube di gas sparisce entrandoci dentro".
    const tx = 10, ty = 10;
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    const cam = { x: cx - 0.3 * TILE, y: cy, angle: 0 };

    const level = livelloConGas([{ tx, ty }]);
    const vp = computeViewport(960, 540, 1);
    const depth = new Float32Array(vp.numRays).fill(1e6); // nessun muro: isola (b) da (a)

    const out = render(level, cam, depth);
    expect(out.bad).toHaveLength(0);
    // Prima della correzione: `if (!p.visible) return;` nel ciclo sui
    // quattro angoli buttava via l'intero tile, quindi zero 'fill'.
    expect(out.calls.filter((c) => c === 'fill').length).toBeGreaterThan(0);
  });

  it('(a) una colonna coperta nasconde una colonna, non tutta la decalcomania', () => {
    // Stessa geometria della prova gemella sui billboard più sopra,
    // applicata a un tile: il tile (8,5) proietta sulle colonne
    // ~188-292 di 480 con la camera a (5,5)+centro, e la sua colonna
    // centrale è la 240. Si copre SOLO quella con un muro fittizio.
    const camX = 5 * TILE + TILE / 2;
    const camY = 5 * TILE + TILE / 2;
    const cam = { x: camX, y: camY, angle: 0 };
    const level = livelloConGas([{ tx: 8, ty: 5 }]);

    const vp = computeViewport(960, 540, 1);
    const cx = 8 * TILE + TILE / 2;
    const cy = 5 * TILE + TILE / 2;
    const centre = projectPoint(vp, new CameraFx(), camX, camY, 0, cx, cy);
    const col = Math.round(centre.screenX / SLICE_W);

    const depth = new Float32Array(vp.numRays).fill(1e6);
    depth[col] = centre.perp - 50; // muro che copre solo la colonna centrale

    const out = render(level, cam, depth);
    expect(out.bad).toHaveLength(0);
    // Si vede ancora: prima della correzione, la sola colonna centrale
    // coperta buttava via l'intero tile (zero 'fill').
    expect(out.calls.filter((c) => c === 'fill').length).toBeGreaterThan(0);
    // E si vede ritagliato, non intero: senza il clip per-colonna
    // sarebbe disegnato sopra il muro anziché ai suoi lati.
    expect(out.calls).toContain('clip');
  });

  it('(a) colonna centrale fuori schermo non è "coperto": il resto del tile visibile a schermo si vede', () => {
    // Caso concreto trovato per il canvas 960x540 dei test (numRays =
    // 480): con la camera a (284.8, 388.8) rivolta a 0°, il tile
    // (10,10) proietta il proprio centro sulla colonna -26 — fuori
    // dall'intervallo [0,480) — ma i suoi angoli coprono comunque le
    // colonne 0-99 a schermo. Nessun muro in mezzo: `depth` è tutto
    // scoperto.
    const cam = { x: 284.8, y: 388.8, angle: 0 };
    const level = livelloConGas([{ tx: 10, ty: 10 }]);
    const vp = computeViewport(960, 540, 1);
    const depth = new Float32Array(vp.numRays).fill(1e6);

    const out = render(level, cam, depth);
    expect(out.bad).toHaveLength(0);
    // Prima della correzione: `col < 0 || col >= vp.numRays` scartava
    // il tile per intero, anche se non era affatto coperto — solo
    // "tagliato" da una colonna di riferimento fuori standard.
    expect(out.calls.filter((c) => c === 'fill').length).toBeGreaterThan(0);
  });
});
