// ================================================================
// PARTICELLE — disegno e occlusione (guida la vera renderCampaignScenery)
// ================================================================
// Stesso approccio di render/campaignRender.test.ts: un contesto 2D
// finto che registra ogni chiamata e segnala coordinate non finite o
// fuori misura (docs/GDD.md §17.1, §20 — proiezioni sbagliate hanno
// già fatto nero lo schermo, due volte, per due difetti diversi). Qui
// si isola il passo nuovo — drawParticles dentro renderCampaignScenery
// — da un mondo altrimenti spoglio (bareLevel/bareState più sotto),
// così ogni `arc` registrato è attribuibile a una particella e a
// nessun'altra cosa disegnata in scena.
//
// Le particelle non passano da `push`/`colonneVisibili` come gli altri
// billboard (vedi il commento in testa a drawParticles in
// campaignScene.ts): il controllo dell'occlusione qui sotto prova che
// il percorso più snello dà comunque la stessa risposta sui casi che
// contano — davanti, dietro un muro, dietro la camera — e la
// controprova in fondo ripete lo stesso muro anche su un billboard
// vero (l'esca), per mostrare che le due strade non si pestano i piedi
// sullo stesso depth buffer.
// ================================================================

import { describe, expect, it } from 'vitest';

import { TILE } from '../sim/constants';
import { levelById } from '../sim/campaign/levels';
import { CampaignWorld } from '../sim/campaign/world';
import type { LevelDef } from '../sim/campaign/levelTypes';
import type { CampaignState } from '../sim/campaign/types';
import { CameraFx, computeViewport, type Viewport } from './camera';
import { renderCampaignScenery } from './campaignScene';
import { ParticleSystem, type Particle } from './particles';

interface Recorder {
  arcs: { cx: number; cy: number; r: number }[];
  calls: string[];
  bad: string[];
  enormi: string[];
}

/** Oltre questo, un disegno è patologico, non solo grande — stessa
 *  soglia e stesso ragionamento di LIMITE_DISEGNO in
 *  campaignRender.test.ts: larga apposta per non scattare su una
 *  particella semplicemente vicina. */
const LIMITE_DISEGNO = 20_000;

function makeCtx(): { ctx: CanvasRenderingContext2D; rec: Recorder } {
  const rec: Recorder = { arcs: [], calls: [], bad: [], enormi: [] };
  const check = (name: string, args: number[]): void => {
    rec.calls.push(name);
    for (const a of args) {
      if (!Number.isFinite(a)) {
        rec.bad.push(`${name}(${args.join(', ')})`);
        return;
      }
      if (Math.abs(a) > LIMITE_DISEGNO) {
        rec.enormi.push(`${name}(${args.join(', ')})`);
        return;
      }
    }
  };
  const noop =
    (name: string) =>
    (...args: number[]): void =>
      check(name, args);
  const ctx: Record<string, unknown> = {
    canvas: { width: 960, height: 540 },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    globalCompositeOperation: 'source-over',
    fillRect: noop('fillRect'),
    strokeRect: noop('strokeRect'),
    clearRect: noop('clearRect'),
    drawImage: noop('drawImage'),
    beginPath: noop('beginPath'),
    closePath: noop('closePath'),
    rect: noop('rect'),
    clip: noop('clip'),
    moveTo: noop('moveTo'),
    lineTo: noop('lineTo'),
    ellipse: noop('ellipse'),
    fill: noop('fill'),
    stroke: noop('stroke'),
    save: noop('save'),
    restore: noop('restore'),
    setLineDash: noop('setLineDash'),
    arc: (cx: number, cy: number, r: number, a0: number, a1: number): void => {
      check('arc', [cx, cy, r, a0, a1]);
      rec.arcs.push({ cx, cy, r });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rec };
}

/** Un livello e uno stato spogli: nessun core, scudo, turret, nemico,
 *  boss, esca o decalcomania a produrre `arc` non pertinenti — stesso
 *  principio di bareWorld() in campaignRender.test.ts. Il livello vero
 *  serve solo perché renderCampaignScenery vuole le sue liste
 *  (gasZones, chasms, ...), qui tutte già vuote in 'attracco'. */
function bareScene(): { level: LevelDef; state: CampaignState } {
  const world = new CampaignWorld(levelById('attracco'));
  world.state.cores = [];
  world.state.shields = [];
  world.state.turrets = [];
  world.state.enemies = [];
  world.state.boss = null;
  world.state.beaconPickups = [];
  world.state.beacon = { active: false, x: 0, y: 0, ms: 0 };
  return { level: world.level, state: world.state };
}

/** Scrive i campi di una particella direttamente nel pool, bypassando
 *  gli emettitori: qui serve il controllo esatto su posizione e
 *  taglia, non la varietà casuale che emit() produce — quella ha già
 *  il suo test in particles.test.ts. `all` è tipizzato `readonly
 *  Particle[]` sull'array (niente push/pop da fuori), ma i campi di
 *  ogni particella restano gli stessi che update() muta ad ogni
 *  fotogramma, quindi scriverli qui è lecito quanto farlo da dentro
 *  la classe. */
function forceParticle(ps: ParticleSystem, index: number, over: Partial<Particle>): void {
  const p = ps.all[index]!;
  Object.assign(p, {
    active: true,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    maxLife: 1,
    size: 3,
    r: 255,
    g: 255,
    b: 255,
    gravity: 0,
    drag: 1,
    glow: false,
    ...over,
  });
}

function render(
  ps: ParticleSystem,
  cam: { x: number; y: number; angle: number },
  depth: Float32Array,
  vp: Viewport,
): Recorder {
  const { ctx, rec } = makeCtx();
  const { level, state } = bareScene();
  const fx = new CameraFx();
  renderCampaignScenery(ctx, vp, fx, cam, depth, level, state, true, true, 500, ps);
  return rec;
}

describe('drawParticles — proiezione e occlusione', () => {
  it('una particella davanti alla camera, senza muri in mezzo, viene disegnata', () => {
    const vp = computeViewport(960, 540, 1);
    const ps = new ParticleSystem();
    forceParticle(ps, 0, { x: TILE * 3, y: 0, z: TILE * 0.3 });
    const cam = { x: 0, y: 0, angle: 0 };
    const depth = new Float32Array(vp.numRays).fill(1e6); // nessun muro

    const rec = render(ps, cam, depth, vp);
    expect(rec.bad).toHaveLength(0);
    expect(rec.enormi).toHaveLength(0);
    expect(rec.arcs).toHaveLength(1);
  });

  it('la stessa particella, con un muro più vicino di lei su tutta la sua colonna, non viene disegnata', () => {
    const vp = computeViewport(960, 540, 1);
    const ps = new ParticleSystem();
    forceParticle(ps, 0, { x: TILE * 3, y: 0, z: TILE * 0.3 });
    const cam = { x: 0, y: 0, angle: 0 };
    // Un muro a metà strada su ogni colonna: più vicino della
    // particella ovunque, quindi la copre indipendentemente da quale
    // colonna esatta finisca per occupare.
    const depth = new Float32Array(vp.numRays).fill(TILE * 1.5);

    const rec = render(ps, cam, depth, vp);
    expect(rec.bad).toHaveLength(0);
    expect(rec.arcs).toHaveLength(0);
  });

  it('un muro più lontano della particella la lascia visibile: non è "un muro qualunque" a nasconderla', () => {
    const vp = computeViewport(960, 540, 1);
    const ps = new ParticleSystem();
    forceParticle(ps, 0, { x: TILE * 3, y: 0, z: TILE * 0.3 });
    const cam = { x: 0, y: 0, angle: 0 };
    const depth = new Float32Array(vp.numRays).fill(TILE * 10); // ben oltre i 3 tile della particella

    const rec = render(ps, cam, depth, vp);
    expect(rec.bad).toHaveLength(0);
    expect(rec.arcs).toHaveLength(1);
  });

  it('una particella dietro la camera non produce coordinate enormi, e non si disegna', () => {
    const vp = computeViewport(960, 540, 1);
    const ps = new ParticleSystem();
    // Camera rivolta verso +x, particella dietro di lei: esattamente il
    // caso che projectPoint scarta per costruzione (vedi il commento su
    // "un quarto di giro" in camera.ts) — qui si prova che drawParticles
    // rispetta quello scarto invece di provare comunque a disegnare con
    // `perp` sul suo pavimento di 0,0001.
    forceParticle(ps, 0, { x: -TILE * 3, y: 0, z: TILE * 0.3 });
    const cam = { x: 0, y: 0, angle: 0 };
    const depth = new Float32Array(vp.numRays).fill(1e6);

    const rec = render(ps, cam, depth, vp);
    expect(rec.bad).toHaveLength(0);
    expect(rec.enormi, rec.enormi.slice(0, 2).join(' | ')).toHaveLength(0);
    expect(rec.arcs).toHaveLength(0);
  });

  it('particelle a ogni angolo intorno alla camera non esplodono mai in coordinate fuori misura', () => {
    // Lo stesso giro completo di "girandosi, un nucleo non diventa una
    // tinta piatta" in campaignRender.test.ts, applicato alle
    // particelle: un grado alla volta, 360 volte, con la particella
    // sempre alla stessa distanza fissa dalla camera.
    const vp = computeViewport(1920, 1080, 1);
    const depth = new Float32Array(vp.numRays).fill(1e6);
    let visti = 0;
    for (let g = 0; g < 360; g++) {
      const ps = new ParticleSystem();
      const ang = (g * Math.PI) / 180;
      forceParticle(ps, 0, {
        x: Math.cos(ang) * TILE * 4,
        y: Math.sin(ang) * TILE * 4,
        z: TILE * 0.3,
      });
      const cam = { x: 0, y: 0, angle: 0 };
      const rec = render(ps, cam, depth, vp);
      expect(rec.bad, `${g} gradi: ${rec.bad.slice(0, 1).join('')}`).toHaveLength(0);
      expect(rec.enormi, `${g} gradi: ${rec.enormi.slice(0, 1).join('')}`).toHaveLength(0);
      if (rec.arcs.length > 0) visti++;
    }
    // Deve essere visibile per un arco di gradi reale, non né sempre né
    // mai: altrimenti il giro non ha provato niente.
    expect(visti).toBeGreaterThan(30);
    expect(visti).toBeLessThan(360);
  });

  it("sotto lo zoom dell'ottica, una particella vicinissima resta entro un raggio a schermo limitato", () => {
    // Il lampo alla canna nasce a una manciata di unità dall'occhio
    // (render/particles.ts, muzzle()), ed è esattamente lì che lo zoom
    // dell'ottica (vp.projDist moltiplicato, vedi computeViewport)
    // farebbe esplodere un billboard proiettato senza tetto: la
    // richiesta del compito è che non arrivi ad accecare guardando
    // dentro il mirino. Zoom 2.6 è ADS_ZOOM (sim/constants.ts).
    const vp = computeViewport(960, 540, 1, 2.6);
    const ps = new ParticleSystem();
    forceParticle(ps, 0, { x: 6, y: 0, z: TILE * 0.3, size: 4.5 });
    const cam = { x: 0, y: 0, angle: 0 };
    const depth = new Float32Array(vp.numRays).fill(1e6);

    const rec = render(ps, cam, depth, vp);
    expect(rec.bad).toHaveLength(0);
    expect(rec.arcs).toHaveLength(1);
    // Il tetto che drawParticles applica è vp.height * 0.18 — qui il
    // valore non è ridichiarato in duro: si prova solo che resti una
    // frazione contenuta dello schermo, non un cerchio che lo riempie.
    expect(rec.arcs[0]!.r).toBeLessThanOrEqual(vp.height * 0.2);
    expect(rec.arcs[0]!.r).toBeGreaterThan(0);
  });

  it('controprova: lo stesso muro occlude sia una particella sia un billboard vero, senza confondere i due depth check', () => {
    const vp = computeViewport(960, 540, 1);
    const cam = { x: 0, y: 0, angle: 0 };
    const world = new CampaignWorld(levelById('attracco'));
    world.state.cores = [];
    world.state.shields = [];
    world.state.turrets = [];
    world.state.enemies = [];
    world.state.boss = null;
    world.state.beaconPickups = [];
    world.state.beacon = { active: true, x: TILE * 3, y: 0, ms: 999 };

    const ps = new ParticleSystem();
    forceParticle(ps, 0, { x: TILE * 3, y: 0, z: TILE * 0.3 });

    const fx = new CameraFx();

    // Nessun muro: entrambi visibili. drawBeacon disegna un `arc` solo
    // per la punta dell'antenna (il resto è fillRect/ellipse), quindi
    // due billboard visibili — la particella e l'esca — fanno due
    // `arc` in tutto.
    {
      const { ctx, rec } = makeCtx();
      const depth = new Float32Array(vp.numRays).fill(1e6);
      renderCampaignScenery(ctx, vp, fx, cam, depth, world.level, world.state, true, true, 500, ps);
      expect(rec.bad).toHaveLength(0);
      expect(rec.arcs).toHaveLength(2);
    }

    // Muro più vicino di entrambi: nessuno dei due si disegna.
    {
      const { ctx, rec } = makeCtx();
      const depth = new Float32Array(vp.numRays).fill(TILE * 1.5);
      renderCampaignScenery(ctx, vp, fx, cam, depth, world.level, world.state, true, true, 500, ps);
      expect(rec.bad).toHaveLength(0);
      expect(rec.arcs).toHaveLength(0);
    }
  });
});
