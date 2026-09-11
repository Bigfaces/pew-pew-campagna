// ================================================================
// BOT AI
// ================================================================
// The AI's only output is an InputState — exactly the shape a
// keyboard or a network packet produces. It never moves an entity
// and never fires a weapon itself.
//
// The prototype claimed this design in its comments but called
// moveEntity() straight from the AI, which meant a bot slot was not
// in fact swappable for a player slot. Now it genuinely is: World
// applies movement identically for every controller type, so
// replacing `updateBot` with a network reader is a one-line change.
// ================================================================

import {
  BOT_PICKUP_INTEREST,
  BOT_TUNING,
  MAP_H,
  MAP_W,
  TILE,
  type BotTuning,
} from './constants';
import { isSolid } from './map';
import { castRay, angleDelta, hasLOS } from './raycast';
import type { Rng } from './rng';
import type { Entity, InputState, PowerUp } from './types';

/** Can `bot` actually see `target`? Requires both an unobstructed
 *  line and the target being inside the bot's forward view cone.
 *
 *  The cone is the fix for the prototype's most-felt unfairness:
 *  bots there used line-of-sight alone, giving them 360° awareness
 *  and letting them shoot you in the back without ever turning. */
function canSee(bot: Entity, target: Entity, halfFov: number): boolean {
  if (!target.alive) return false;
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const bearing = Math.atan2(dy, dx);
  if (Math.abs(angleDelta(bot.angle, bearing)) > halfFov) return false;
  return hasLOS(bot.x, bot.y, target.x, target.y);
}

/** Nearest visible opponent, or null. */
function findTarget(
  bot: Entity,
  entities: readonly Entity[],
  halfFov: number,
): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of entities) {
    if (e.id === bot.id || !e.alive) continue;
    if (!canSee(bot, e, halfFov)) continue;
    const d = Math.hypot(e.x - bot.x, e.y - bot.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** A power-up worth detouring for: active, close, and granting
 *  something the bot doesn't already have. */
function findWorthwhilePickup(
  bot: Entity,
  powerups: readonly PowerUp[],
): PowerUp | null {
  let best: PowerUp | null = null;
  let bestD = BOT_PICKUP_INTEREST;

  for (const pu of powerups) {
    if (!pu.active) continue;
    if (pu.kind === 'shield' && bot.shieldActive) continue;
    if (pu.kind === 'rapidfire' && bot.rapidFireTimer > 0) continue;
    if (pu.kind === 'speed' && bot.speedBoostTimer > 0) continue;

    const d = Math.hypot(pu.x - bot.x, pu.y - bot.y);
    if (d < bestD && hasLOS(bot.x, bot.y, pu.x, pu.y)) {
      bestD = d;
      best = pu;
    }
  }
  return best;
}

function randomFloorPoint(rng: Rng): { x: number; y: number } {
  for (let i = 0; i < 30; i++) {
    const tx = 1 + rng.int(MAP_W - 2);
    const ty = 1 + rng.int(MAP_H - 2);
    if (!isSolid(tx, ty)) {
      return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
  }
  return { x: MAP_W * TILE * 0.5, y: MAP_H * TILE * 0.5 };
}

/** Steer around obstacles with two forward "whiskers".
 *
 *  Returns an angular correction to add to the desired heading. A
 *  blocked left whisker pushes right and vice versa; both blocked
 *  means a dead end, so we commit to one side rather than freezing. */
function avoidObstacles(bot: Entity, desired: number): number {
  const PROBE = TILE * 1.8;
  const SPLAY = 0.5;

  const left = castRay(bot.x, bot.y, desired - SPLAY, PROBE);
  const right = castRay(bot.x, bot.y, desired + SPLAY, PROBE);

  if (left.hit && right.hit) {
    // Both blocked — turn toward whichever side is more open.
    return left.dist > right.dist ? -0.9 : 0.9;
  }
  if (left.hit) return 0.6;
  if (right.hit) return -0.6;
  return 0;
}

/** Convert a world-space movement direction into the forward/strafe
 *  pair an entity facing `angle` would have to press to go there. */
function worldToLocalMove(
  angle: number,
  wx: number,
  wy: number,
): { forward: number; strafe: number } {
  const len = Math.hypot(wx, wy);
  if (len < 1e-6) return { forward: 0, strafe: 0 };
  const nx = wx / len;
  const ny = wy / len;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  // Right vector is the facing vector rotated +90°.
  const rx = -Math.sin(angle);
  const ry = Math.cos(angle);
  return { forward: nx * fx + ny * fy, strafe: nx * rx + ny * ry };
}

/** Produce this tick's input for one bot.
 *
 *  Returns the input rather than storing it on the entity: inputs are
 *  transient per-tick intent, whereas Entity is snapshot state, and
 *  mixing the two would ship every bot's keypresses to every peer.
 *
 *  `tuning` is the entire difficulty system: reaction, accuracy, turn
 *  rate and vision all come from it, so no branch anywhere else in the
 *  simulation has to know which level is selected. */
export function updateBot(
  bot: Entity,
  entities: readonly Entity[],
  powerups: readonly PowerUp[],
  rng: Rng,
  dtMs: number,
  tuning: BotTuning = BOT_TUNING.normale,
): InputState {
  const input: InputState = {
    forward: 0,
    strafe: 0,
    aimAngle: bot.angle,
    fire: false,
    seq: 0,
  };

  if (!bot.alive) return input;

  const target = findTarget(bot, entities, tuning.halfFov);

  // Any sighting immediately overrides whatever we were doing.
  if (target) {
    // Re-acquiring the same target we were just tracking does not
    // restart the reaction delay. Behind cover a target flickers out of
    // line of sight constantly, and resetting on every flicker meant a
    // bot in an arena with any cover at all never finished reacting and
    // so never fired — invisible on the old, nearly empty map, where
    // contact held for seconds at a time.
    const reacquiring = bot.botState === 'seek' && bot.botTargetId === target.id;
    if (bot.botState !== 'aim' && !reacquiring) {
      bot.botReactionTimer = tuning.reactionMs + rng.range(0, 200);
    }
    bot.botState = 'aim';
    bot.botTargetId = target.id;
    bot.botLastSeenX = target.x;
    bot.botLastSeenY = target.y;
  } else if (bot.botState === 'aim') {
    // Lost them — go look where they were.
    bot.botState = 'seek';
  }

  // Desired heading and world-space movement for this tick.
  let wantAngle = bot.angle;
  let moveX = 0;
  let moveY = 0;
  /** Aim error for a shot taken this tick, applied once at the moment
   *  the trigger goes. */
  let fireSpread = 0;

  switch (bot.botState) {
    case 'aim': {
      if (!target) break;
      // Steer at where the target actually is. The aim error used to be
      // mixed in here and re-rolled every tick, so the bot was chasing a
      // heading that jumped underneath it; it could only ever settle on
      // a target far enough away for the bearing to barely move. At
      // arena range it stared instead of shooting.
      wantAngle = Math.atan2(target.y - bot.y, target.x - bot.x);

      // Strafe perpendicular to the target to present a moving
      // profile. Direction is stable per bot (derived from id) so it
      // doesn't jitter left-right every tick.
      const side = bot.id % 2 === 0 ? 1 : -1;
      const perp = wantAngle + (Math.PI / 2) * side;
      moveX = Math.cos(perp) * 0.55;
      moveY = Math.sin(perp) * 0.55;

      // Floored at zero: a bot that keeps a target in view banks no
      // credit beyond "ready". Without the floor the timer runs
      // arbitrarily negative and stops gating anything, and the bot
      // fires on cooldown cadence at whatever it happens to face.
      bot.botReactionTimer = Math.max(0, bot.botReactionTimer - dtMs);

      const off = angleDelta(bot.angle, wantAngle);
      if (
        bot.botReactionTimer <= 0 &&
        bot.weaponCooldown <= 0 &&
        // Only commit to the shot once actually pointed at the target;
        // otherwise the reaction delay is wasted on a wild miss.
        Math.abs(off) < tuning.fireTolerance
      ) {
        const step = Math.max(-tuning.turnRate, Math.min(tuning.turnRate, off));
        const spread = rng.spread(tuning.aimSpread / 2);
        const range = Math.hypot(target.x - bot.x, target.y - bot.y);
        // Check the line the bullet will actually travel, not just that
        // the target is visible from our centre. A bot hugging cover
        // has a clear centre-to-centre line past the corner while the
        // firing angle clips it — which is how bots ended up spending
        // most of their ammunition on the crate they were hiding
        // behind, hitting a wall half a tile away.
        if (!castRay(bot.x, bot.y, bot.angle + step + spread, range).hit) {
          fireSpread = spread;
          input.fire = true;
          bot.botReactionTimer = tuning.reactionMs + rng.range(0, 400);
        }
      }
      break;
    }

    case 'seek': {
      if (bot.botLastSeenX === null || bot.botLastSeenY === null) {
        bot.botState = 'patrol';
        break;
      }
      const dx = bot.botLastSeenX - bot.x;
      const dy = bot.botLastSeenY - bot.y;
      if (Math.hypot(dx, dy) < 14) {
        bot.botLastSeenX = null;
        bot.botLastSeenY = null;
        bot.botTargetId = null;
        bot.botState = 'patrol';
        break;
      }
      wantAngle = Math.atan2(dy, dx);
      moveX = Math.cos(wantAngle);
      moveY = Math.sin(wantAngle);
      break;
    }

    // 'patrol' and 'collect' differ only in how the goal is chosen —
    // both then walk to botGoal — so they share one block. Handling
    // them separately meant the tick that switched patrol -> collect
    // returned no movement at all, stalling the bot for a frame on
    // every single transition.
    case 'collect':
    case 'patrol':
    default: {
      if (bot.botState === 'patrol') {
        const pickup = findWorthwhilePickup(bot, powerups);
        if (pickup) {
          bot.botState = 'collect';
          bot.botGoalX = pickup.x;
          bot.botGoalY = pickup.y;
        }
      }

      const goalReached =
        bot.botGoalX !== null &&
        bot.botGoalY !== null &&
        Math.hypot(bot.botGoalX - bot.x, bot.botGoalY - bot.y) < 14;

      if (bot.botState === 'collect' && goalReached) {
        // Arrived; World handles the actual pickup radius.
        bot.botGoalX = null;
        bot.botGoalY = null;
        bot.botState = 'patrol';
      }

      if (bot.botState === 'patrol') {
        bot.botTimer -= dtMs;
        if (bot.botGoalX === null || bot.botTimer <= 0 || goalReached) {
          const p = randomFloorPoint(rng);
          bot.botGoalX = p.x;
          bot.botGoalY = p.y;
          bot.botTimer = 3500 + rng.range(0, 2500);
        }
      }

      if (bot.botGoalX !== null && bot.botGoalY !== null) {
        const dx = bot.botGoalX - bot.x;
        const dy = bot.botGoalY - bot.y;
        wantAngle = Math.atan2(dy, dx);
        moveX = Math.cos(wantAngle);
        moveY = Math.sin(wantAngle);
      }
      break;
    }
  }

  // Plant the feet for the shot. The firing line is checked above from
  // where the bot stands now, but movement is resolved before any shot
  // is traced — so a bot that strafes after validating fires from a
  // position it never checked, which past a corner or a gap edge is a
  // different line entirely. Standing still makes the two agree, and
  // it reads better too: bots visibly set themselves before firing,
  // and are briefly vulnerable for it.
  if (input.fire) {
    moveX = 0;
    moveY = 0;
  }

  // While navigating (not while lining up a shot) steer around walls.
  if (bot.botState !== 'aim' && (moveX !== 0 || moveY !== 0)) {
    const correction = avoidObstacles(bot, wantAngle);
    if (correction !== 0) {
      wantAngle += correction;
      moveX = Math.cos(wantAngle);
      moveY = Math.sin(wantAngle);
    }
  }

  // Rate-limit the turn so bots swing onto target visibly rather
  // than snapping, which is what made the prototype's bots feel
  // robotic and unbeatable at close range.
  const delta = angleDelta(bot.angle, wantAngle);
  const step = Math.max(-tuning.turnRate, Math.min(tuning.turnRate, delta));
  // The aim error is added to the heading only on the tick the shot is
  // taken, so it deflects the bullet — and reads as a flinch — instead
  // of permanently wobbling the bot's facing.
  input.aimAngle = bot.angle + step + fireSpread;

  // Movement is expressed against the angle the bot will actually be
  // facing this tick, so it walks where it looks.
  const local = worldToLocalMove(input.aimAngle, moveX, moveY);
  input.forward = local.forward;
  input.strafe = local.strafe;

  return input;
}
