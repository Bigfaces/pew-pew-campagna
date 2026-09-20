// ================================================================
// SIMULATION CONSTANTS
// ================================================================
// Every tunable that affects gameplay lives here. Nothing in this
// file may reference the DOM — the simulation runs unchanged inside
// a headless test.
//
// UNITS: the simulation advances in fixed ticks (see TICK_MS), so
// per-tick quantities are frame-rate independent by construction.
// Anything expressed "per second" is converted at the call site.
//
// Con la rimozione dell'Arena molte delle costanti che stavano qui —
// bersaglio uccisioni, tempo di partita, tuning dei bot, difficoltà,
// power-up — sono sparite perché non le legge più nessuno: erano sue
// e basta. Quel che resta è quanto la campagna importa ancora da
// qui (vedi sim/campaign/constants.ts, che parte da questi numeri
// invece di riscriverli) più le poche costanti di presentazione che
// anche render/overlay.ts usa ancora.
// ================================================================

/** Simulation ticks per second. The renderer runs free (rAF) and
 *  interpolates between the two most recent ticks. */
const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

/** Hard cap on ticks simulated in a single frame. Prevents the
 *  "spiral of death" after a tab has been backgrounded: we drop
 *  simulation time rather than trying to catch up indefinitely. */
export const MAX_TICKS_PER_FRAME = 5;

// ---- World geometry ----
export const TILE = 32;
export const MAP_W = 38;
export const MAP_H = 28;

// Tile types
export const T_FLOOR = 0;
export const T_WALL = 1;
export const T_COVER = 2;

// ---- Movement (px per tick) ----
// At 60 Hz these equal the old per-frame values, so the game feels
// identical to the prototype on a 60 Hz display — but now identical
// on 144 Hz too, which was the bug.
export const PLAYER_SPEED = 2.2;
export const ENTITY_RADIUS = 9;

/** Backpedalling is slower than advancing — standard shooter feel,
 *  and it makes peeking a real commitment. */
export const BACKWARD_MULT = 0.72;
export const STRAFE_MULT = 0.85;

// ---- Weapon ----
export const BULLET_COOLDOWN = 1400; // ms between shots (bolt-action)
export const RAPIDFIRE_CD = 380; // ms while the rapid-fire pickup is active

// ---- Player look ----
export const MOUSE_SENSITIVITY = 0.0022; // radians per raw mouse pixel
export const TURN_SPEED = 2.6; // radians/sec for keyboard turning

/** The player's sensitivity setting is a *multiplier* on the constant
 *  above, not a replacement for it: 0.0022 radians per pixel is a
 *  figure nobody can form an opinion about, while "1.4x" is one
 *  everybody can. 1 is the tuning everything else was balanced at.
 *
 *  The range is deliberately narrow at the bottom and generous at the
 *  top. Below a quarter the arena stops being turnable in a fight; the
 *  ceiling only has to cover a high-DPI mouse, and someone who wants
 *  3x is not going to be saved from themselves by 2.5x. */
export const SENS_MIN = 0.25;
export const SENS_MAX = 3;
export const SENS_STEP = 0.05;

/** Kept next to the limits and used by everything that can receive a
 *  sensitivity from outside — the slider, the saved setting, the
 *  live setter. A value read back from local storage is arbitrary text
 *  from the user's disk, so `NaN` has to land somewhere sane rather
 *  than silently freezing the view. */
export function clampSensitivity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(SENS_MAX, Math.max(SENS_MIN, v));
}
/** Vertical look is clamped well short of straight up/down: a
 *  raycaster fakes pitch by shifting the horizon, which visibly
 *  shears the projection at extreme angles. */
export const MAX_PITCH = 0.42; // as a fraction of the viewport height

// ---- Scoped aiming (ADS) ----
// The rifle has always had a scope drawn on it; this is what makes it
// do something. The zoom is a camera property, never a simulation one:
// magnifying the view must not change where a bullet goes.

/** Magnification while scoped. Applied to the projection distance,
 *  which narrows the field of view by the same factor. */
export const ADS_ZOOM = 2.6;
/** Mouse sensitivity multiplier while scoped. Without it the zoom
 *  amplifies hand movement and aiming gets *harder*, not easier. */
export const ADS_SENS_MULT = 0.38;
/** Movement input multiplier while scoped — the cost of the zoom.
 *  Applied to the local input, exactly as a partly-deflected analog
 *  stick would be, so the simulation needs no notion of "scoped". */
export const ADS_MOVE_MULT = 0.45;
/** Seconds-ish easing time in and out of the scope. */
export const ADS_TRANSITION_MS = 130;

// ---- Match presentation ----
/** Freeze before the first tick so nobody is shot while still
 *  working out which way they are facing. */
export const COUNTDOWN_GO_MS = 400;

// ---- Minimap information ----
/** How long a gunshot stays marked on the minimap.
 *
 *  The minimap used to draw every living opponent at all times, which
 *  handed the player perfect information in a game whose whole tactical
 *  layer is not having it — and made the positional audio, the incoming
 *  arc and the bots' view cones all decorative. Now it shows only what
 *  the player could genuinely know: whoever is in line of sight, and
 *  where a shot was fired from. The ping marks the *origin of the
 *  shot*, not the shooter, so it goes stale exactly as real information
 *  does — they have moved by the time you get there. */
export const MINIMAP_PING_MS = 1600;
