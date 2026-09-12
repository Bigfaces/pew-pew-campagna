// ================================================================
// RENDER SMOKE TESTS
// ================================================================
// A passing typecheck proves the render path compiles, not that it
// runs — a mistyped context method or a NaN fed into drawImage only
// surfaces at execution time.
//
// These tests drive the real render functions against a recording
// stub of CanvasRenderingContext2D. They assert that the pipeline
// executes, produces draw calls, and never emits a non-finite
// coordinate, which is the failure mode that silently blanks a
// canvas rather than throwing.
// ================================================================

import { beforeEach, describe, expect, it } from 'vitest';

import { ADS_ZOOM, BULLET_COOLDOWN, MAP_H, MAP_W, TILE } from '../sim/constants';
import { isSolid } from '../sim/map';
import { World, type SlotConfig } from '../sim/world';
import { emptyInput, type Entity } from '../sim/types';
import { CameraFx, computeViewport, projectPoint } from './camera';
import {
  renderBanner,
  renderCountdown,
  renderCrosshair,
  renderDamageOverlay,
  renderDeathNotice,
  renderHitDirection,
  renderKillFeed,
  renderMinimap,
  renderScope,
  renderViewmodel,
} from './overlay';
import { ParticleSystem } from './particles';
import { renderBackdrop, renderBillboards, renderWalls } from './scene';
import { buildBackdrops, getTextures } from './textures';

interface Recorder {
  calls: string[];
  bad: string[];
}

/** Minimal canvas 2D stub. Every numeric argument is checked for
 *  finiteness as it goes past — NaN reaching the real API produces no
 *  error, just nothing drawn. */
function makeCtx(rec: Recorder): CanvasRenderingContext2D {
  const check = (name: string, args: unknown[]): void => {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) {
        rec.bad.push(`${name}(${args.join(', ')})`);
        return;
      }
    }
  };

  const noop =
    (name: string) =>
    (...args: unknown[]): void => {
      rec.calls.push(name);
      check(name, args);
    };

  const gradient = {
    addColorStop: () => {},
  };

  const ctx: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
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
    setTransform: noop('setTransform'),
    setLineDash: noop('setLineDash'),
    fillText: noop('fillText'),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: (t: string) => ({ width: t.length * 7 }),
    getImageData: () => ({ data: [120, 120, 130, 255] }),
    putImageData: noop('putImageData'),
  };

  return ctx as unknown as CanvasRenderingContext2D;
}

/** Install just enough of the DOM for texture generation to work. */
function installDom(): void {
  const g = globalThis as Record<string, unknown>;
  const rec: Recorder = { calls: [], bad: [] };

  g.document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {};
      return {
        width: 0,
        height: 0,
        getContext: () => makeCtx(rec),
      };
    },
  };
  g.window = { devicePixelRatio: 1 };
}

const SLOTS: SlotConfig[] = [
  { name: 'YOU', skin: 0, controller: 'local' },
  { name: 'B1', skin: 1, controller: 'bot' },
  { name: 'B2', skin: 2, controller: 'bot' },
];

describe('render pipeline', () => {
  let rec: Recorder;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    installDom();
    rec = { calls: [], bad: [] };
    ctx = makeCtx(rec);
  });

  it('draws a full frame without producing non-finite coordinates', () => {
    const world = new World(SLOTS, 2024);
    // Advance far enough that bots have moved and fought.
    for (let i = 0; i < 240; i++) {
      world.step({ 0: { ...emptyInput(), forward: 1, aimAngle: i * 0.02 } });
    }

    const vp = computeViewport(960, 540, 1);
    const fx = new CameraFx();
    fx.pitch = 0.4;
    fx.shake(14);
    fx.update(16, true, 1);

    const tex = getTextures();
    buildBackdrops(tex, vp.width, vp.height);

    const particles = new ParticleSystem();
    particles.bulletImpact(200, 200, 0.5);
    particles.blood(240, 220);
    particles.muzzle(180, 190, 1.2);
    particles.update(16);

    const depth = new Float32Array(vp.numRays);
    const player = world.byId(0)!;
    const cam = { x: player.x, y: player.y, angle: player.angle };

    renderBackdrop(ctx, vp, fx);
    renderWalls(ctx, vp, fx, cam, depth);
    renderBillboards(
      ctx,
      vp,
      fx,
      cam,
      0,
      world.entities,
      world.state.powerups,
      particles.all,
      depth,
      1000,
    );
    renderViewmodel(ctx, vp, fx, player, 1000);
    renderCrosshair(ctx, vp, fx, player);
    renderDamageOverlay(ctx, vp, fx);
    renderMinimap(
      ctx,
      vp,
      player,
      world.entities,
      world.state.powerups,
      // One live ping and one already expired, so both branches draw.
      new Map([
        [1, { x: 300, y: 300, at: 600 }],
        [2, { x: 120, y: 480, at: -9000 }],
      ]),
      1000,
    );
    renderKillFeed(
      ctx,
      vp,
      [
        {
          killer: 'YOU',
          killerSkin: 0,
          victim: 'B1',
          victimSkin: 1,
          at: 900,
          mine: true,
        },
      ],
      1000,
    );

    expect(rec.bad).toEqual([]);
    expect(rec.calls.length).toBeGreaterThan(100);
    // One textured strip per column.
    expect(rec.calls.filter((c) => c === 'drawImage').length).toBeGreaterThanOrEqual(
      vp.numRays,
    );
  });

  /** A floor tile with `pad` clear tiles either side along X, derived
   *  from the map so editing the arena cannot quietly invalidate this.
   *  Mirrors the helper the simulation tests use. */
  function openSpot(pad = 4): { x: number; y: number } {
    for (let ty = 2; ty < MAP_H - 2; ty++) {
      for (let tx = 2 + pad; tx < MAP_W - 2 - pad; tx++) {
        let clear = true;
        for (let d = -pad; d <= pad && clear; d++) {
          if (isSolid(tx + d, ty)) clear = false;
        }
        if (clear) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      }
    }
    throw new Error('no open spot in map');
  }

  /** Draw one opponent and report how much work it took. The glint adds
   *  strokes, so a bigger number means it was drawn. */
  function drawOpponent(over: Partial<Entity>): number {
    const spot = openSpot();
    const world = new World(SLOTS, 5);
    const viewer = world.byId(0)!;
    const foe = world.byId(1)!;

    viewer.x = spot.x;
    viewer.y = spot.y;
    viewer.angle = 0;
    foe.x = spot.x + TILE * 3;
    foe.y = spot.y;
    foe.alive = true;
    // Facing back down the line at the viewer.
    foe.angle = Math.PI;
    foe.weaponCooldown = 0;
    Object.assign(foe, over);

    const vp = computeViewport(640, 400, 1);
    const depth = new Float32Array(vp.numRays).fill(1e6);
    const before = rec.calls.length;
    renderBillboards(
      ctx,
      vp,
      new CameraFx(),
      { x: viewer.x, y: viewer.y, angle: viewer.angle },
      0,
      [viewer, foe],
      [],
      [],
      depth,
      1000,
    );
    return rec.calls.length - before;
  }

  it('flags an opponent that has you lined up with a round chambered', () => {
    // Opponents are symmetric billboards, so "is that one about to
    // shoot me" is otherwise unanswerable — and with one-shot kills it
    // is the only question that matters.
    const aimedAndReady = drawOpponent({});
    const aimedButCycling = drawOpponent({ weaponCooldown: BULLET_COOLDOWN });
    const lookingAway = drawOpponent({ angle: 0 });

    expect(aimedAndReady).toBeGreaterThan(aimedButCycling);
    expect(aimedAndReady).toBeGreaterThan(lookingAway);
    // The absence of the glint right after someone fires is the cue to
    // push, so those two cases must look the same.
    expect(aimedButCycling).toBe(lookingAway);
  });

  it('puts only opponents in line of sight on the minimap', () => {
    // The minimap used to draw everyone alive, always, which handed the
    // player perfect information in a game built on not having it.
    const spot = openSpot();
    const world = new World(SLOTS, 9);
    const viewer = world.byId(0)!;
    const foe = world.byId(1)!;
    viewer.x = spot.x;
    viewer.y = spot.y;
    foe.alive = true;

    const vp = computeViewport(640, 400, 1);
    const draw = (): number => {
      const before = rec.calls.length;
      renderMinimap(ctx, vp, viewer, [viewer, foe], [], new Map(), 1000);
      return rec.calls.length - before;
    };

    foe.x = spot.x + TILE * 2;
    foe.y = spot.y;
    const visible = draw();

    // Park it inside geometry: nothing can see through a solid tile.
    let hidden = visible;
    for (let ty = 1; ty < MAP_H - 1 && hidden === visible; ty++) {
      for (let tx = 1; tx < MAP_W - 1; tx++) {
        if (!isSolid(tx, ty)) continue;
        foe.x = (tx + 0.5) * TILE;
        foe.y = (ty + 0.5) * TILE;
        hidden = draw();
        break;
      }
    }

    expect(visible).toBeGreaterThan(hidden);
  });

  it('fills the depth buffer with positive finite distances', () => {
    const world = new World(SLOTS, 77);
    const vp = computeViewport(640, 400, 1);
    const fx = new CameraFx();
    buildBackdrops(getTextures(), vp.width, vp.height);

    const depth = new Float32Array(vp.numRays);
    const p = world.byId(0)!;
    renderWalls(ctx, vp, fx, { x: p.x, y: p.y, angle: p.angle }, depth);

    for (let i = 0; i < depth.length; i++) {
      expect(Number.isFinite(depth[i]!)).toBe(true);
      expect(depth[i]!).toBeGreaterThan(0);
    }
  });

  it('survives every camera pitch and a dead player', () => {
    const world = new World(SLOTS, 5);
    const vp = computeViewport(800, 600, 2);
    const fx = new CameraFx();
    buildBackdrops(getTextures(), vp.width, vp.height);
    const depth = new Float32Array(vp.numRays);
    const p = world.byId(0)!;
    p.alive = false;
    p.respawnTimer = 900;

    for (let pitch = -1; pitch <= 1; pitch += 0.25) {
      fx.pitch = pitch;
      renderBackdrop(ctx, vp, fx);
      renderWalls(ctx, vp, fx, { x: p.x, y: p.y, angle: pitch }, depth);
      renderBillboards(
        ctx, vp, fx,
        { x: p.x, y: p.y, angle: pitch },
        0,
        world.entities,
        world.state.powerups,
        [],
        depth,
        500,
      );
      renderDeathNotice(ctx, vp, p);
    }

    expect(rec.bad).toEqual([]);
  });

  it('draws the scope, callouts and countdown at every stage', () => {
    // The scope, the banner and the countdown are all time- or
    // transition-driven, which is exactly where a divide by zero or an
    // un-eased 0 slips in and silently blanks the frame.
    const world = new World(SLOTS, 91);
    const vp = computeViewport(1024, 640, 1);
    const fx = new CameraFx();
    fx.markIncoming(1.2);
    fx.shake(11);
    fx.update(16, true, 1);
    buildBackdrops(getTextures(), vp.width, vp.height);
    const player = world.byId(0)!;

    for (const cooldown of [0, BULLET_COOLDOWN * 0.5, BULLET_COOLDOWN]) {
      player.weaponCooldown = cooldown;
      // Includes both ends: at 0 the scope must draw nothing at all,
      // at 1 it must be fully formed.
      for (const ads of [0, 0.2, 0.45, 0.5, 0.8, 1]) {
        renderViewmodel(ctx, vp, fx, player, 1000, ads);
        renderScope(
          ctx,
          vp,
          fx,
          { cooldownMs: player.weaponCooldown, maxCooldownMs: BULLET_COOLDOWN },
          ads,
        );
        renderCrosshair(ctx, vp, fx, player, ads);
      }
    }

    for (const bearing of [0, 1.2, Math.PI, -2.4]) {
      renderHitDirection(ctx, vp, fx, bearing);
    }

    renderBanner(
      ctx,
      vp,
      { text: 'DOPPIA UCCISIONE', sub: '2 in 3s', at: 900, color: '#ffd23c' },
      1000,
    );
    // Already expired, and not yet started: both must be no-ops.
    renderBanner(ctx, vp, { text: 'X', sub: '', at: 0, color: '#fff' }, 99999);

    for (const ms of [3400, 3000, 2000, 900, 401, 400, 200, 1]) {
      renderCountdown(ctx, vp, ms);
    }

    player.alive = false;
    player.respawnTimer = 1200;
    renderDeathNotice(
      ctx,
      vp,
      player,
      { killer: 'CREMISI', killerSkin: 1, fromAngle: 2.1 },
      0.5,
    );
    // No killer known (a guest that missed the event) must still draw.
    renderDeathNotice(ctx, vp, player, null, 0);

    expect(rec.bad).toEqual([]);
    expect(rec.calls.length).toBeGreaterThan(100);
  });

  it('narrows the field of view when scoped, at the same ray count', () => {
    const hip = computeViewport(960, 540, 1);
    const scoped = computeViewport(960, 540, 1, ADS_ZOOM);

    expect(scoped.projDist).toBeCloseTo(hip.projDist * ADS_ZOOM, 6);
    expect(scoped.halfFovH).toBeLessThan(hip.halfFovH);
    // Zooming must not resize the depth buffer: the wall pass casts one
    // ray per column either way.
    expect(scoped.numRays).toBe(hip.numRays);
  });

  it('handles a viewport of extreme aspect ratio', () => {
    // Ultrawide and very tall windows both used to be impossible: the
    // canvas was a fixed 672x668 regardless of the display.
    for (const [w, h] of [
      [2560, 400],
      [400, 1200],
      [320, 240],
    ] as const) {
      const vp = computeViewport(w, h, 1);
      const fx = new CameraFx();
      buildBackdrops(getTextures(), w, h);
      const depth = new Float32Array(vp.numRays);
      const world = new World(SLOTS, 3);
      const p = world.byId(0)!;

      renderBackdrop(ctx, vp, fx);
      renderWalls(ctx, vp, fx, { x: p.x, y: p.y, angle: 0.7 }, depth);

      expect(vp.numRays).toBeGreaterThan(0);
      expect(Number.isFinite(vp.projDist)).toBe(true);
      expect(vp.halfFovH).toBeGreaterThan(0);
      expect(vp.halfFovH).toBeLessThan(Math.PI / 2);
    }
    expect(rec.bad).toEqual([]);
  });
});

describe('projection', () => {
  beforeEach(installDom);

  it('places a point dead ahead at the centre of the screen', () => {
    const vp = computeViewport(800, 600, 1);
    const fx = new CameraFx();
    const p = projectPoint(vp, fx, 100, 100, 0, 100 + TILE * 4, 100);
    expect(p.visible).toBe(true);
    expect(p.screenX).toBeCloseTo(400, 3);
    expect(p.perp).toBeCloseTo(TILE * 4, 3);
  });

  it('rejects points behind the camera', () => {
    const vp = computeViewport(800, 600, 1);
    const fx = new CameraFx();
    const p = projectPoint(vp, fx, 100, 100, 0, 100 - TILE * 4, 100);
    expect(p.visible).toBe(false);
  });

  it('puts nearer objects lower on screen than distant ones', () => {
    // Floor contact points converge on the horizon with distance —
    // if this inverts, sprites appear to float.
    const vp = computeViewport(800, 600, 1);
    const fx = new CameraFx();
    const near = projectPoint(vp, fx, 0, 0, 0, TILE * 2, 0);
    const far = projectPoint(vp, fx, 0, 0, 0, TILE * 10, 0);
    expect(near.floorY).toBeGreaterThan(far.floorY);
    expect(near.tileH).toBeGreaterThan(far.tileH);
  });
});

describe('particles', () => {
  beforeEach(installDom);

  it('expires and never exceeds the pool', () => {
    const ps = new ParticleSystem();
    for (let i = 0; i < 200; i++) ps.blood(100, 100);
    expect(ps.all.length).toBe(900);

    // Long enough for every emitted lifetime to elapse.
    for (let i = 0; i < 200; i++) ps.update(16);
    expect(ps.all.filter((p) => p.active).length).toBe(0);
  });

  it('keeps particles above the floor', () => {
    const ps = new ParticleSystem();
    ps.blood(100, 100);
    for (let i = 0; i < 120; i++) {
      ps.update(16);
      for (const p of ps.all) {
        if (p.active) expect(p.z).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
