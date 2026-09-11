// ================================================================
// PROCEDURAL TEXTURES
// ================================================================
// Everything here is drawn in code at startup — the game ships no
// image assets and makes no network requests for art.
//
// The prototype filled wall columns with a flat colour, so walking
// alongside a long wall produced no visual motion at all: the screen
// simply did not change. Texture detail is what makes movement and
// distance legible in a raycaster.
//
// Each texture is pre-rendered at SHADE_LEVELS brightness steps. The
// wall loop then picks the nearest step and issues a single drawImage
// per column, instead of drawing the slice and then compositing a
// darkening rectangle over it (two operations per column, ~670 per
// frame at this resolution).
// ================================================================

import { T_COVER } from '../sim/constants';

export const TEX_SIZE = 64;
export const SHADE_LEVELS = 24;
/** Darkest step retains a little detail rather than going pure black. */
const MAX_DARKEN = 0.88;

/** Small deterministic PRNG so textures are identical every run —
 *  a texture that reshuffles on reload reads as a rendering bug. */
function makeNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// ----------------------------------------------------------------
// Base textures
// ----------------------------------------------------------------

/** Mortared stone blockwork, offset every other course. */
function drawStone(ctx: CanvasRenderingContext2D): void {
  const rnd = makeNoise(0x5eed);
  const BRICK_H = 16;
  const BRICK_W = 32;

  ctx.fillStyle = '#20222b';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  for (let row = 0; row < TEX_SIZE / BRICK_H; row++) {
    const offset = row % 2 === 0 ? 0 : -BRICK_W / 2;
    for (let col = -1; col < TEX_SIZE / BRICK_W + 1; col++) {
      const x = col * BRICK_W + offset;
      const y = row * BRICK_H;
      // Per-brick tonal variation keeps the pattern from reading as
      // a repeating stamp.
      const v = 78 + rnd() * 26;
      ctx.fillStyle = rgb(v * 0.95, v * 0.96, v * 1.06);
      ctx.fillRect(x + 1, y + 1, BRICK_W - 2, BRICK_H - 2);

      // Top and left highlight, bottom and right shadow — a cheap
      // bevel that survives being squashed into a 2px column.
      ctx.fillStyle = rgb(v * 1.25, v * 1.26, v * 1.36);
      ctx.fillRect(x + 1, y + 1, BRICK_W - 2, 1);
      ctx.fillRect(x + 1, y + 1, 1, BRICK_H - 2);
      ctx.fillStyle = rgb(v * 0.6, v * 0.61, v * 0.7);
      ctx.fillRect(x + 1, y + BRICK_H - 2, BRICK_W - 2, 1);
      ctx.fillRect(x + BRICK_W - 2, y + 1, 1, BRICK_H - 2);
    }
  }

  // Speckle for surface grain.
  for (let i = 0; i < 340; i++) {
    const x = Math.floor(rnd() * TEX_SIZE);
    const y = Math.floor(rnd() * TEX_SIZE);
    const d = rnd() > 0.5 ? 1.14 : 0.86;
    const px = ctx.getImageData(x, y, 1, 1).data;
    ctx.fillStyle = rgb(px[0]! * d, px[1]! * d, px[2]! * d);
    ctx.fillRect(x, y, 1, 1);
  }
}

/** Banded wooden crate — visually distinct from stone at a glance,
 *  which matters because cover behaves differently in play. */
function drawCrate(ctx: CanvasRenderingContext2D): void {
  const rnd = makeNoise(0xc4a7e);

  ctx.fillStyle = '#6b4a22';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Vertical planks.
  const PLANK_W = 16;
  for (let i = 0; i < TEX_SIZE / PLANK_W; i++) {
    const x = i * PLANK_W;
    const v = 104 + rnd() * 30;
    ctx.fillStyle = rgb(v, v * 0.68, v * 0.32);
    ctx.fillRect(x + 1, 0, PLANK_W - 2, TEX_SIZE);
    // Grain lines.
    for (let g = 0; g < 5; g++) {
      const gy = Math.floor(rnd() * TEX_SIZE);
      ctx.fillStyle = rgb(v * 0.76, v * 0.5, v * 0.22);
      ctx.fillRect(x + 2, gy, PLANK_W - 4, 1);
    }
    // Seam between planks.
    ctx.fillStyle = '#3a2712';
    ctx.fillRect(x, 0, 1, TEX_SIZE);
  }

  // Iron bands top and bottom.
  for (const by of [4, TEX_SIZE - 10]) {
    ctx.fillStyle = '#4a4a52';
    ctx.fillRect(0, by, TEX_SIZE, 6);
    ctx.fillStyle = '#66666f';
    ctx.fillRect(0, by, TEX_SIZE, 1);
    ctx.fillStyle = '#33333a';
    ctx.fillRect(0, by + 5, TEX_SIZE, 1);
    // Rivets.
    for (let x = 6; x < TEX_SIZE; x += 16) {
      ctx.fillStyle = '#8a8a94';
      ctx.fillRect(x, by + 2, 2, 2);
    }
  }

  // Outer edge shading so crates read as solid boxes.
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fillRect(0, 0, 2, TEX_SIZE);
  ctx.fillRect(TEX_SIZE - 2, 0, 2, TEX_SIZE);
}

// ----------------------------------------------------------------

/** Produce SHADE_LEVELS progressively darker copies of a texture. */
function shadeVariants(base: HTMLCanvasElement): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < SHADE_LEVELS; i++) {
    const c = createCanvas(TEX_SIZE, TEX_SIZE);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    const darken = (i / (SHADE_LEVELS - 1)) * MAX_DARKEN;
    if (darken > 0) {
      ctx.fillStyle = `rgba(6,7,12,${darken})`;
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    }
    out.push(c);
  }
  return out;
}

export interface TextureSet {
  /** Indexed [tileType][shadeLevel]. */
  wall: HTMLCanvasElement[];
  crate: HTMLCanvasElement[];
  /** Full-viewport ceiling and floor gradients, rebuilt on resize. */
  sky: HTMLCanvasElement | null;
  ground: HTMLCanvasElement | null;
}

let cached: TextureSet | null = null;

export function getTextures(): TextureSet {
  if (cached) return cached;

  const wallBase = createCanvas(TEX_SIZE, TEX_SIZE);
  drawStone(wallBase.getContext('2d', { willReadFrequently: true })!);

  const crateBase = createCanvas(TEX_SIZE, TEX_SIZE);
  drawCrate(crateBase.getContext('2d')!);

  cached = {
    wall: shadeVariants(wallBase),
    crate: shadeVariants(crateBase),
    sky: null,
    ground: null,
  };
  return cached;
}

/** Pick the shaded variant for a tile type at a given darkness 0..1. */
export function shadedTile(
  tex: TextureSet,
  tile: number,
  darkness: number,
): HTMLCanvasElement {
  const set = tile === T_COVER ? tex.crate : tex.wall;
  const idx = Math.max(
    0,
    Math.min(SHADE_LEVELS - 1, Math.round(darkness * (SHADE_LEVELS - 1))),
  );
  return set[idx]!;
}

/** Rebuild the ceiling and floor gradients for a viewport size.
 *
 *  True floor-casting costs one inverse-projection per pixel, which
 *  is far too slow in JS at full resolution. A cached vertical
 *  gradient plus horizon banding gives the same depth read for two
 *  drawImage calls per frame. */
export function buildBackdrops(
  tex: TextureSet,
  width: number,
  height: number,
): void {
  const halfH = Math.max(1, Math.ceil(height));

  const sky = createCanvas(1, halfH);
  const sctx = sky.getContext('2d')!;
  const sg = sctx.createLinearGradient(0, 0, 0, halfH);
  sg.addColorStop(0, '#0b0c14');
  sg.addColorStop(0.72, '#171a26');
  sg.addColorStop(1, '#232838');
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 1, halfH);

  const ground = createCanvas(1, halfH);
  const gctx = ground.getContext('2d')!;
  const gg = gctx.createLinearGradient(0, 0, 0, halfH);
  gg.addColorStop(0, '#1b1710');
  gg.addColorStop(0.35, '#241f16');
  gg.addColorStop(1, '#332a1c');
  gctx.fillStyle = gg;
  gctx.fillRect(0, 0, 1, halfH);
  // Faint banding reads as receding floor tiles without the cost of
  // projecting each one.
  gctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let i = 1; i < 14; i++) {
    // Spacing tightens toward the horizon, matching perspective.
    const t = (i / 14) ** 2.1;
    gctx.fillRect(0, Math.round(t * halfH), 1, 1);
  }

  tex.sky = sky;
  tex.ground = ground;
  void width;
}
