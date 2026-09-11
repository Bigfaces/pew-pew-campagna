// ================================================================
// PARTICLES
// ================================================================
// The prototype ran full particle physics every frame — integrating
// position, velocity and gravity for every particle of every effect
// — and then drew a single flat circle per effect, sampling only
// `particles[0].color`. Every particle position computed was thrown
// away. It was leftover top-down code that the first-person renderer
// never consumed.
//
// Here particles are real: they carry a world position plus a height
// above the floor, and are billboard-projected with the same camera
// maths as entities, so they occlude behind walls correctly and sit
// in the scene rather than on top of it.
//
// Storage is a fixed-size pool. Particles are spawned in bursts on
// every shot and hit, and allocating objects at that rate is exactly
// what produces visible GC stutter in a 60 Hz loop.
// ================================================================

import { TILE } from '../sim/constants';

const MAX_PARTICLES = 900;

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  /** Height above the floor, world units. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  /** Downward acceleration; 0 for sparks that should hang. */
  gravity: number;
  /** Fraction of velocity retained per second. */
  drag: number;
  /** When true the particle brightens toward white as it dies. */
  glow: boolean;
}

function blank(): Particle {
  return {
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    maxLife: 1,
    size: 1,
    r: 255,
    g: 255,
    b: 255,
    gravity: 0,
    drag: 1,
    glow: false,
  };
}

export class ParticleSystem {
  private pool: Particle[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) this.pool.push(blank());
  }

  get all(): readonly Particle[] {
    return this.pool;
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
  }

  /** Claim a slot. When the pool is full the oldest cursor position
   *  is recycled — dropping one particle is always preferable to
   *  growing the array mid-frame. */
  private take(): Particle {
    const p = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    return p;
  }

  private emit(
    x: number,
    y: number,
    z: number,
    opts: {
      count: number;
      speed: [number, number];
      spread: number;
      angle: number;
      life: [number, number];
      size: [number, number];
      colors: [number, number, number][];
      gravity?: number;
      drag?: number;
      glow?: boolean;
      upBias?: number;
    },
  ): void {
    for (let i = 0; i < opts.count; i++) {
      const p = this.take();
      const a = opts.angle + (Math.random() - 0.5) * opts.spread;
      const spd = opts.speed[0] + Math.random() * (opts.speed[1] - opts.speed[0]);
      const col = opts.colors[Math.floor(Math.random() * opts.colors.length)]!;
      const life = opts.life[0] + Math.random() * (opts.life[1] - opts.life[0]);

      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
      p.vz = (opts.upBias ?? 0) + (Math.random() - 0.35) * spd * 0.8;
      p.life = life;
      p.maxLife = life;
      p.size = opts.size[0] + Math.random() * (opts.size[1] - opts.size[0]);
      p.r = col[0];
      p.g = col[1];
      p.b = col[2];
      p.gravity = opts.gravity ?? 0;
      p.drag = opts.drag ?? 0.6;
      p.glow = opts.glow ?? false;
    }
  }

  /** Sparks and smoke where a bullet meets a wall. */
  bulletImpact(x: number, y: number, angle: number): void {
    // Sprayed back toward the shooter, as a real ricochet would be.
    this.emit(x, y, TILE * 0.5, {
      count: 12,
      speed: [30, 110],
      spread: Math.PI * 0.9,
      angle: angle + Math.PI,
      life: [0.18, 0.42],
      size: [1.2, 2.6],
      colors: [
        [255, 214, 128],
        [255, 160, 60],
        [255, 255, 220],
      ],
      gravity: 260,
      drag: 0.25,
      glow: true,
    });
    this.emit(x, y, TILE * 0.5, {
      count: 5,
      speed: [8, 26],
      spread: Math.PI * 2,
      angle: 0,
      life: [0.4, 0.8],
      size: [3, 6],
      colors: [
        [90, 88, 84],
        [64, 62, 60],
      ],
      gravity: -12,
      drag: 0.5,
    });
  }

  /** Muzzle discharge at the shooter's barrel. */
  muzzle(x: number, y: number, angle: number): void {
    this.emit(x + Math.cos(angle) * 12, y + Math.sin(angle) * 12, TILE * 0.55, {
      count: 8,
      speed: [40, 130],
      spread: 0.7,
      angle,
      life: [0.06, 0.16],
      size: [2, 4.5],
      colors: [
        [255, 246, 190],
        [255, 208, 96],
        [255, 255, 255],
      ],
      drag: 0.2,
      glow: true,
    });
  }

  blood(x: number, y: number): void {
    this.emit(x, y, TILE * 0.55, {
      count: 22,
      speed: [20, 95],
      spread: Math.PI * 2,
      angle: 0,
      life: [0.4, 1.0],
      size: [2, 4.5],
      colors: [
        [172, 26, 26],
        [126, 18, 18],
        [206, 52, 44],
      ],
      gravity: 340,
      drag: 0.35,
      upBias: 30,
    });
  }

  shieldShatter(x: number, y: number): void {
    this.emit(x, y, TILE * 0.55, {
      count: 20,
      speed: [40, 130],
      spread: Math.PI * 2,
      angle: 0,
      life: [0.3, 0.7],
      size: [1.5, 3.5],
      colors: [
        [96, 214, 255],
        [180, 240, 255],
        [255, 255, 255],
      ],
      gravity: 120,
      drag: 0.4,
      glow: true,
      upBias: 20,
    });
  }

  pickup(x: number, y: number, rgbColor: [number, number, number]): void {
    this.emit(x, y, TILE * 0.4, {
      count: 16,
      speed: [15, 55],
      spread: Math.PI * 2,
      angle: 0,
      life: [0.3, 0.7],
      size: [2, 4],
      colors: [rgbColor, [255, 255, 255]],
      gravity: -40,
      drag: 0.5,
      upBias: 40,
    });
  }

  spawnBurst(x: number, y: number): void {
    this.emit(x, y, TILE * 0.3, {
      count: 18,
      speed: [30, 90],
      spread: Math.PI * 2,
      angle: 0,
      life: [0.25, 0.55],
      size: [2, 4],
      colors: [
        [120, 200, 255],
        [255, 255, 255],
      ],
      gravity: -60,
      drag: 0.45,
      upBias: 30,
    });
  }

  /** Integrate every live particle. Runs on real frame time, not
   *  simulation ticks — particles are cosmetic and never feed back
   *  into the world. */
  update(dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    for (const p of this.pool) {
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      // Exponential drag, frame-rate independent.
      const k = Math.pow(p.drag, dt);
      p.vx *= k;
      p.vy *= k;
      p.vz = (p.vz - p.gravity * dt) * k;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Settle on the floor rather than sinking through it.
      if (p.z < 0) {
        p.z = 0;
        p.vz = 0;
        p.vx *= 0.5;
        p.vy *= 0.5;
      }
    }
  }
}
