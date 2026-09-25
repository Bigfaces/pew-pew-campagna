// ================================================================
// AUDIO — fully synthesized, no asset files
// ================================================================
// The prototype was silent, which in a shooter removes most of the
// feedback loop: you cannot tell a hit from a miss, or hear an enemy
// firing behind you.
//
// Every sound here is generated from oscillators and noise buffers at
// runtime, so the game still ships as pure code with no downloads and
// no licensing questions. Sounds are positioned in 2D with a
// PannerNode so a shot to your left arrives on your left.
// ================================================================

import { TILE } from '../sim/constants';

/** Beyond this distance a world sound is inaudible and skipped. */
const MAX_AUDIBLE = TILE * 30;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Shared noise source data for impacts and gunfire. */
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.7;

  /** Browsers refuse to start audio before a user gesture, so this is
   *  called from the first click rather than at construction. */
  init(): void {
    if (this.ctx) {
      // A context created before a gesture can still be suspended.
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // No Web Audio: the game stays fully playable.

    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);

    // One second of white noise, reused by every noise-based voice.
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // Listener faces -Z by default; we map the 2D world onto X/Z.
    const l = this.ctx.listener;
    if (l.upX) {
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  get enabled(): boolean {
    return !!this.ctx && !!this.master;
  }

  /** Point the listener at the player each frame. */
  updateListener(x: number, y: number, angle: number): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    // World X maps to audio X, world Y to audio Z (the horizontal
    // plane), which keeps left/right and front/back correct.
    if (l.positionX) {
      l.positionX.value = x / TILE;
      l.positionY.value = 0;
      l.positionZ.value = y / TILE;
      l.forwardX.value = Math.cos(angle);
      l.forwardY.value = 0;
      l.forwardZ.value = Math.sin(angle);
    } else {
      // Older Safari signature.
      const legacy = l as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(
          fx: number,
          fy: number,
          fz: number,
          ux: number,
          uy: number,
          uz: number,
        ): void;
      };
      legacy.setPosition?.(x / TILE, 0, y / TILE);
      legacy.setOrientation?.(Math.cos(angle), 0, Math.sin(angle), 0, 1, 0);
    }
  }

  /** Build the output node for a sound, panned at a world position.
   *  Returns null when the sound is too far away to matter. */
  private sink(x?: number, y?: number): AudioNode | null {
    if (!this.ctx || !this.master) return null;
    if (x === undefined || y === undefined) return this.master;

    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = MAX_AUDIBLE / TILE;
    panner.rolloffFactor = 1.1;
    panner.positionX.value = x / TILE;
    panner.positionY.value = 0;
    panner.positionZ.value = y / TILE;
    panner.connect(this.master);
    return panner;
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private noise(
    dest: AudioNode,
    start: number,
    duration: number,
    gain: number,
    filter: { type: BiquadFilterType; freq: number; q?: number },
    sweepTo?: number,
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const bq = this.ctx.createBiquadFilter();
    bq.type = filter.type;
    bq.frequency.setValueAtTime(filter.freq, start);
    if (sweepTo !== undefined) {
      bq.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), start + duration);
    }
    if (filter.q !== undefined) bq.Q.value = filter.q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(bq).connect(g).connect(dest);
    src.start(start);
    src.stop(start + duration + 0.05);
  }

  private tone(
    dest: AudioNode,
    type: OscillatorType,
    from: number,
    to: number,
    start: number,
    duration: number,
    gain: number,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    if (to !== from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  // ---- Voices --------------------------------------------------------

  /** Rifle report: a sharp crack, a body thump, and a tail of decay. */
  rifle(x?: number, y?: number): void {
    const dest = this.sink(x, y);
    if (!dest || !this.ctx) return;
    const t = this.now();
    this.noise(dest, t, 0.09, 0.9, { type: 'highpass', freq: 1800 }, 600);
    this.noise(dest, t, 0.34, 0.42, { type: 'lowpass', freq: 900 }, 140);
    this.tone(dest, 'square', 220, 60, t, 0.1, 0.28);
  }

  /** Bolt cycling — plays when the weapon becomes ready again. */
  boltCycle(): void {
    const dest = this.sink();
    if (!dest) return;
    const t = this.now();
    this.noise(dest, t, 0.05, 0.16, { type: 'bandpass', freq: 2600, q: 2 });
    this.noise(dest, t + 0.09, 0.05, 0.2, { type: 'bandpass', freq: 1800, q: 2 });
    this.tone(dest, 'square', 900, 500, t + 0.09, 0.05, 0.06);
  }

  impact(x: number, y: number): void {
    const dest = this.sink(x, y);
    if (!dest) return;
    const t = this.now();
    this.noise(dest, t, 0.12, 0.5, { type: 'bandpass', freq: 2400, q: 1.2 }, 800);
  }

  /** Confirmation that your shot connected — deliberately dry and
   *  close, never positioned, so it reads as UI rather than world. */
  hitMarker(): void {
    const dest = this.sink();
    if (!dest) return;
    const t = this.now();
    this.tone(dest, 'triangle', 1400, 1900, t, 0.06, 0.22);
  }

  kill(x: number, y: number): void {
    const dest = this.sink(x, y);
    if (!dest) return;
    const t = this.now();
    this.noise(dest, t, 0.3, 0.5, { type: 'lowpass', freq: 700 }, 120);
    this.tone(dest, 'sawtooth', 180, 45, t, 0.32, 0.18);
  }

  /** Played when the local player dies — a heavier, unpanned version. */
  death(): void {
    const dest = this.sink();
    if (!dest) return;
    const t = this.now();
    this.tone(dest, 'sawtooth', 300, 40, t, 0.7, 0.3);
    this.noise(dest, t, 0.5, 0.4, { type: 'lowpass', freq: 500 }, 80);
  }

  pickup(x: number, y: number): void {
    const dest = this.sink(x, y);
    if (!dest) return;
    const t = this.now();
    this.tone(dest, 'triangle', 660, 990, t, 0.1, 0.2);
    this.tone(dest, 'triangle', 990, 1480, t + 0.08, 0.12, 0.16);
  }

  shieldBreak(x: number, y: number): void {
    const dest = this.sink(x, y);
    if (!dest) return;
    const t = this.now();
    this.noise(dest, t, 0.28, 0.45, { type: 'highpass', freq: 2600 }, 5000);
    this.tone(dest, 'triangle', 1800, 700, t, 0.22, 0.16);
  }

  respawn(): void {
    const dest = this.sink();
    if (!dest) return;
    const t = this.now();
    this.tone(dest, 'sine', 320, 760, t, 0.26, 0.2);
  }

  /** Scope raised / lowered: a short mechanical shift, never panned —
   *  it happens at the player's own shoulder. */
  scope(inward: boolean): void {
    const dest = this.sink();
    if (!dest) return;
    const t = this.now();
    this.noise(dest, t, 0.06, 0.11, { type: 'bandpass', freq: 1100, q: 3 });
    this.tone(dest, 'sine', inward ? 420 : 620, inward ? 620 : 420, t, 0.08, 0.05);
  }

  /** Rising callout for a multi-kill or a streak milestone. `level`
   *  climbs from 1, and so does the interval, so a bigger callout is
   *  audibly bigger rather than just longer. */
  callout(level: number): void {
    const dest = this.sink();
    if (!dest) return;
    const t = this.now();
    const root = 440 * Math.pow(2, Math.min(level, 5) / 12);
    const notes = [root, root * 1.25, root * 1.5];
    notes.forEach((f, i) => {
      this.tone(dest, 'triangle', f, f, t + i * 0.075, 0.22, 0.13);
    });
  }

  /** One tick of the pre-match countdown; `final` is the "go". */
  countdownBeep(final: boolean): void {
    const dest = this.sink();
    if (!dest) return;
    const t = this.now();
    if (final) {
      this.tone(dest, 'triangle', 880, 1320, t, 0.3, 0.2);
      this.tone(dest, 'sine', 440, 660, t, 0.34, 0.14);
    } else {
      this.tone(dest, 'triangle', 620, 620, t, 0.12, 0.14);
    }
  }

  /** A footfall. Positioned when it belongs to somebody else, so an
   *  opponent moving nearby is audible and locatable — the counterpart
   *  to the minimap no longer simply showing where everyone is.
   *  Quieter and duller than your own: it has crossed a room. */
  footstep(x?: number, y?: number): void {
    const dest = this.sink(x, y);
    if (!dest) return;
    const t = this.now();
    const mine = x === undefined;
    this.noise(dest, t, 0.07, mine ? 0.09 : 0.13, { type: 'lowpass', freq: mine ? 620 : 460 }, 220);
  }

  /** Victory / defeat stings for the end of a match. */
  matchEnd(won: boolean): void {
    const dest = this.sink();
    if (!dest) return;
    const t = this.now();
    const notes = won ? [523, 659, 784, 1047] : [523, 415, 349, 262];
    notes.forEach((f, i) => {
      this.tone(dest, 'triangle', f, f, t + i * 0.13, 0.3, 0.18);
    });
  }

  uiClick(): void {
    const dest = this.sink();
    if (!dest) return;
    this.tone(dest, 'square', 700, 900, this.now(), 0.04, 0.1);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }
}
