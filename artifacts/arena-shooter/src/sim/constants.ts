// ================================================================
// SIMULATION CONSTANTS
// ================================================================
// Every tunable that affects gameplay lives here. Nothing in this
// file may reference the DOM — the simulation runs unchanged inside
// a headless test or (later) on a remote host peer.
//
// UNITS: the simulation advances in fixed ticks (see TICK_MS), so
// per-tick quantities are frame-rate independent by construction.
// Anything expressed "per second" is converted at the call site.
// ================================================================

/** Simulation ticks per second. The renderer runs free (rAF) and
 *  interpolates between the two most recent ticks. */
export const TICK_HZ = 60;
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

// ---- Match rules ----
/** Kill target, as a multiple of the number of players.
 *
 *  A fixed target made the match length swing wildly with the roster.
 *  Total kills in an FFA rise roughly with the square of the player
 *  count — more players means more encounters *and* more people having
 *  them — while reaching a target of K takes about K*N kills in total,
 *  so time-to-win goes as K/N. Scaling K with N is what holds the
 *  match length steady. Measured, not assumed: at a fixed target of 10
 *  a 1v1 ran the full five minutes and ended on the clock every single
 *  time, while a full lobby was over in under a minute. */
export const KILLS_PER_PLAYER = 2.5;

/** Kills needed to win, for a roster of `players`. */
export function killTarget(players: number): number {
  return Math.max(3, Math.round(KILLS_PER_PLAYER * players));
}

/** The four-player target, which is the shape of a default match.
 *  Menus that have no roster yet quote this. */
export const WIN_KILLS = killTarget(4);
export const RESPAWN_DELAY = 1500; // ms
export const SPAWN_PROTECTION = 300; // ms of weapon lockout after respawn

/** Hard time limit. A match that nobody is winning still has to end,
 *  and a visible clock gives the round an arc instead of dragging.
 *  Measured in simulated time (ticks), not wall clock, so a stall
 *  cannot rob anyone of playing time. */
export const MATCH_TIME_MS = 5 * 60 * 1000;
export const MATCH_TIME_TICKS = Math.round(MATCH_TIME_MS / TICK_MS);

// ---- Movement (px per tick) ----
// At 60 Hz these equal the old per-frame values, so the game feels
// identical to the prototype on a 60 Hz display — but now identical
// on 144 Hz too, which was the bug.
export const PLAYER_SPEED = 2.2;
export const BOT_SPEED = 1.35;
export const ENTITY_RADIUS = 9;

/** Backpedalling is slower than advancing — standard shooter feel,
 *  and it makes peeking a real commitment. */
export const BACKWARD_MULT = 0.72;
export const STRAFE_MULT = 0.85;

// ---- Weapon ----
export const BULLET_COOLDOWN = 1400; // ms between shots (bolt-action)
export const RAPIDFIRE_CD = 380; // ms while the rapid-fire pickup is active

// ---- Bots ----
export const BOT_REACTION_MS = 480; // delay between spotting and firing
/** Radians of aim error, applied once to each shot as it is taken.
 *
 *  This is now the whole accuracy story. A bot only pulls the trigger
 *  when it is lined up and its firing line is verifiably clear, so it
 *  would otherwise never miss — and a bot that never misses turns every
 *  sighting into a death and leaves the player nothing to react to.
 *  Calibrated against `pnpm run balance`: at the ranges this arena
 *  actually produces, a target subtends roughly 0.05 rad. */
export const BOT_AIM_SPREAD = 0.16;
/** How far off target a bot will still pull the trigger, in radians.
 *  Small means patient and precise; large means it fires while still
 *  swinging onto the target. This used to be a fixed 0.12 buried in
 *  the AI, which at long range was five times the aim error and so
 *  drowned out the accuracy setting entirely. */
export const BOT_FIRE_TOLERANCE = 0.09;
/** Bots only see within this half-angle of their facing direction.
 *  The prototype omitted this check entirely, giving bots 360° vision
 *  — they could shoot you in the back without ever turning around. */
export const BOT_FOV = (Math.PI / 3) * 1.35; // full angle (~81°)
export const BOT_HALF_FOV = BOT_FOV / 2;
/** Turning is rate-limited so bots visibly swing onto target instead
 *  of snapping instantly. Radians per tick. */
export const BOT_TURN_RATE = 0.055;
/** Bots detour to grab a power-up when one is this close and useful. */
export const BOT_PICKUP_INTEREST = TILE * 7;

// ---- Difficulty ----
// The constants above are the *baseline* bot: they define 'normale'
// exactly, so selecting the default difficulty reproduces the tuning
// the game shipped with. The other two levels are expressed relative
// to it rather than as independent magic numbers.

export type Difficulty = 'facile' | 'normale' | 'difficile';

export const DIFFICULTIES: readonly Difficulty[] = [
  'facile',
  'normale',
  'difficile',
];

/** Everything a difficulty level changes about a bot. Nothing else in
 *  the simulation reads difficulty, so one table is the whole feature. */
export interface BotTuning {
  /** Delay between spotting a target and pulling the trigger. */
  reactionMs: number;
  /** Radians of aim error applied to every shot. */
  aimSpread: number;
  /** Radians of misalignment a bot tolerates before firing. Patient
   *  bots wait to be lined up; sloppy ones shoot mid-swing. */
  fireTolerance: number;
  /** Radians per tick the bot can swing its aim. */
  turnRate: number;
  /** Half-angle of the forward view cone. */
  halfFov: number;
  /** Movement speed, px per tick. Always below PLAYER_SPEED: a bot
   *  that outruns the player reads as cheating, not as difficulty. */
  speed: number;
}

export const BOT_TUNING: Record<Difficulty, BotTuning> = {
  facile: {
    reactionMs: 820,
    aimSpread: 0.26,
    fireTolerance: 0.15,
    turnRate: 0.036,
    halfFov: BOT_HALF_FOV * 0.78,
    speed: 1.1,
  },
  normale: {
    reactionMs: BOT_REACTION_MS,
    aimSpread: BOT_AIM_SPREAD,
    fireTolerance: BOT_FIRE_TOLERANCE,
    turnRate: BOT_TURN_RATE,
    halfFov: BOT_HALF_FOV,
    speed: BOT_SPEED,
  },
  difficile: {
    reactionMs: 290,
    aimSpread: 0.10,
    fireTolerance: 0.05,
    turnRate: 0.082,
    halfFov: Math.min(Math.PI * 0.98, BOT_HALF_FOV * 1.18),
    speed: 1.62,
  },
};

// ---- Power-ups ----
export const PU_PICKUP_RADIUS = 18;
export const PU_RESPAWN_MS = 14000;
export const PU_SPEED_DUR = 5000;
export const PU_RAPID_DUR = 6000;
export const SPEED_MULT = 1.8;

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
 *  working out which way they are facing. Three whole seconds of
 *  digits plus the tail spent on "VIA!". */
export const COUNTDOWN_GO_MS = 400;
export const START_COUNTDOWN_MS = 3000 + COUNTDOWN_GO_MS;
/** Two kills inside this window count as a multi-kill. */
export const MULTIKILL_WINDOW_MS = 3200;

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

/** World units an opponent covers between footstep sounds.
 *
 *  Measured in distance rather than time, so speed is audible: a bot
 *  with the speed pickup is heard coming, one edging round a corner
 *  barely at all, and one standing still not at all. Opponents used to
 *  move in total silence, which left the minimap as the only way to
 *  know anything — the reason it had to show everyone. */
export const FOOTSTEP_STRIDE = TILE * 1.4;

/** Half-angle within which an opponent's scope catches the light and
 *  gives them away.
 *
 *  Opponents are drawn as symmetric billboards with no way to read
 *  which way they face, so "is that one about to shoot me" — the only
 *  question that matters when a single bullet kills — was unanswerable.
 *  The glint is deliberately gated on the weapon being ready as well as
 *  aimed: it means "now", not "eventually", and its absence right after
 *  someone fires is the cue to push. */
export const GLINT_CONE = 0.14;
/** Remaining time at which the match calls out its own endgame. */
export const TIME_WARNING_MS = 30000;
