// ================================================================
// CAMPAIGN SIMULATION TESTS — Sprint 1 vertical slice
// ================================================================
// Same headless discipline as the Arena's sim.test.ts: the campaign
// sim has no DOM dependency, so every mechanic in GDD.md section 10
// is pinned down here without a browser.
// ================================================================

import { describe, expect, it } from 'vitest';

import { TICK_MS, TILE } from '../constants';
import {
  BOSS_HITS_TO_DEFEAT,
  DOOR_CLOSE_DELAY_MS,
  DRONE_REACTION_MS,
  LEVEL_XP_THRESHOLDS,
  NODE_OTTURATORE_COOLDOWN_MS,
  PRECISION_NODES,
  SHIELD_X,
  SHIELD_Y,
  XP_BOSS_DEFEAT,
  XP_BOSS_HIT_SOLID,
  XP_CORE,
  XP_DRONE_DOWN,
  XP_ROOM_ENTER,
  levelForXp,
} from './constants';
import { emptyCampaignInput, type CampaignInput } from './types';
import {
  hasGrazeDamage,
  pointsSpent,
  weaponStatsFor,
} from './skills';
import { CampaignWorld } from './world';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

/** Step with empty input `n` times — used to let timers run down
 *  without moving or firing. */
function idleTicks(world: CampaignWorld, n: number): void {
  for (let i = 0; i < n; i++) world.step();
}

describe('skills — ramo Precisione', () => {
  it('base stats match the Arena weapon untouched', () => {
    const stats = weaponStatsFor([]);
    expect(stats.cooldownMs).toBe(1400);
  });

  it('Otturatore Rapido shortens the cooldown to the GDD value', () => {
    const stats = weaponStatsFor(['otturatore-rapido']);
    expect(stats.cooldownMs).toBe(NODE_OTTURATORE_COOLDOWN_MS);
  });

  it('Danno di Striscio only applies when unlocked', () => {
    expect(hasGrazeDamage([])).toBe(false);
    expect(hasGrazeDamage(['danno-di-striscio'])).toBe(true);
  });

  it('pointsSpent sums the cost of every unlocked node', () => {
    expect(pointsSpent(['otturatore-rapido', 'aggancio-ottico'])).toBe(2);
  });
});

describe('esperienza e livelli', () => {
  it('levelForXp follows the threshold table', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(LEVEL_XP_THRESHOLDS[1]! - 1)).toBe(1);
    expect(levelForXp(LEVEL_XP_THRESHOLDS[1]!)).toBe(2);
    expect(levelForXp(LEVEL_XP_THRESHOLDS[2]!)).toBe(3);
  });

  it('gaining XP past a threshold raises the level and grants a skill point', () => {
    const world = new CampaignWorld();
    expect(world.state.level).toBe(1);
    expect(world.state.skillPoints).toBe(0);

    // Force xp to just below the level-2 threshold, then push it over
    // with a single core pickup — the level-up must land on this tick.
    world.state.xp = LEVEL_XP_THRESHOLDS[1]! - XP_CORE;
    const core = world.state.cores.find((c) => c.id === 'magazzino')!;
    world.state.player.x = core.x;
    world.state.player.y = core.y;

    const events = world.step();
    expect(world.state.level).toBe(2);
    expect(world.state.skillPoints).toBe(1);
    expect(events.some((e) => e.type === 'levelUp' && e.level === 2)).toBe(true);
  });

  /** La curva deve restare spendibile *durante* la partita: la prima
   *  versione concedeva il terzo punto solo insieme al bonus di
   *  vittoria, cioè su un nodo ormai inutilizzabile. */
  it('grants a point for every node before the boss dies, exploring everything', () => {
    const preBossXp = 3 * XP_ROOM_ENTER + 2 * XP_CORE + XP_DRONE_DOWN;
    const pointsBeforeBoss = levelForXp(preBossXp) - 1;
    expect(pointsBeforeBoss).toBe(PRECISION_NODES.length);
  });

  it('reaches max level mid-fight even skipping cores and drone', () => {
    const roomsOnly = 3 * XP_ROOM_ENTER;
    const afterThreeHits = roomsOnly + BOSS_HITS_TO_DEFEAT * XP_BOSS_HIT_SOLID;
    expect(levelForXp(afterThreeHits) - 1).toBe(PRECISION_NODES.length);
  });
});

describe('CampaignWorld — porta stagna a tempo', () => {
  it('seals after the delay and blocks the corridor', () => {
    const world = new CampaignWorld();
    // Walk straight into the corridor sensor without touching the door.
    world.state.player.x = 7.2 * TILE;
    world.state.player.y = 5.5 * TILE;

    world.step(); // arms the door on this tick
    expect(world.state.door.armed).toBe(true);
    expect(world.state.door.closed).toBe(false);

    // Stay put (empty input = no movement) until the timer runs out.
    idleTicks(world, Math.ceil(DOOR_CLOSE_DELAY_MS / TICK_MS) + 1);
    expect(world.state.door.closed).toBe(true);

    // Now try to push straight through where the door sits.
    world.state.player.x = 8.5 * TILE;
    world.state.player.y = 5.5 * TILE;
    for (let i = 0; i < 30; i++) {
      world.step(input({ forward: 1, aimAngle: 0 }));
    }
    expect(world.state.player.x).toBeLessThan(9 * TILE);
  });

  it('never arms if the player has not reached the sensor tile', () => {
    const world = new CampaignWorld();
    idleTicks(world, 50);
    expect(world.state.door.armed).toBe(false);
  });
});

describe('CampaignWorld — core e skill tree', () => {
  it('unlocks a node only when enough skill points are available', () => {
    const world = new CampaignWorld();
    expect(world.tryUnlockNode('otturatore-rapido')).toBe(false);

    world.state.skillPoints = 1;
    expect(world.tryUnlockNode('otturatore-rapido')).toBe(true);
    expect(world.availableSkillPoints).toBe(0);

    // A second node needs a second point.
    expect(world.tryUnlockNode('aggancio-ottico')).toBe(false);
    world.state.skillPoints = 2;
    expect(world.tryUnlockNode('aggancio-ottico')).toBe(true);

    // Cannot unlock the same node twice.
    expect(world.tryUnlockNode('otturatore-rapido')).toBe(false);
  });

  it('picking up a core in the Magazzino increments coresCollected', () => {
    const world = new CampaignWorld();
    const core = world.state.cores.find((c) => c.id === 'magazzino')!;
    world.state.player.x = core.x;
    world.state.player.y = core.y;

    const events = world.step();
    expect(world.state.coresCollected).toBe(1);
    expect(events.some((e) => e.type === 'coreCollected')).toBe(true);
  });
});

describe('CampaignWorld — drone del Magazzino', () => {
  it('kills the player after holding line of sight, then respawns at the checkpoint', () => {
    const world = new CampaignWorld();
    world.state.checkpoint = {
      room: 'magazzino',
      x: 13.5 * TILE,
      y: 7 * TILE,
      angle: -Math.PI / 2,
    };
    world.state.player.x = 13.5 * TILE;
    world.state.player.y = 7 * TILE;

    const ticksToFire = Math.ceil(DRONE_REACTION_MS / TICK_MS) + 2;
    let died = false;
    for (let i = 0; i < ticksToFire; i++) {
      const events = world.step();
      if (events.some((e) => e.type === 'playerDied')) died = true;
    }

    expect(died).toBe(true);
    expect(world.state.player.x).toBe(13.5 * TILE);
    expect(world.state.player.y).toBe(7 * TILE);
    expect(world.state.drone.alive).toBe(true);
  });
});

describe('CampaignWorld — scudo tattico', () => {
  it('absorbs a drone hit instead of killing the player, then is spent', () => {
    const world = new CampaignWorld();
    world.state.checkpoint = {
      room: 'magazzino',
      x: 13.5 * TILE,
      y: 7 * TILE,
      angle: -Math.PI / 2,
    };
    world.state.player.x = SHIELD_X;
    world.state.player.y = SHIELD_Y;

    // Walk over the pickup first.
    const pickupEvents = world.step();
    expect(world.state.shield.collected).toBe(true);
    expect(world.state.player.shieldActive).toBe(true);
    expect(pickupEvents.some((e) => e.type === 'shieldPickup')).toBe(true);

    // Now stand where the drone can see us and let it fire.
    world.state.player.x = 13.5 * TILE;
    world.state.player.y = 7 * TILE;
    const ticksToFire = Math.ceil(DRONE_REACTION_MS / TICK_MS) + 2;
    let sawBreak = false;
    let sawDeath = false;
    for (let i = 0; i < ticksToFire; i++) {
      const events = world.step();
      if (events.some((e) => e.type === 'shieldBreak')) sawBreak = true;
      if (events.some((e) => e.type === 'playerDied')) sawDeath = true;
    }

    expect(sawBreak).toBe(true);
    expect(sawDeath).toBe(false);
    expect(world.state.player.shieldActive).toBe(false);
    // The player never actually died, so they should still be standing
    // in front of the drone, not back at the checkpoint.
    expect(world.state.player.x).toBe(13.5 * TILE);

    // A second sustained volley, with no shield left, does kill.
    for (let i = 0; i < ticksToFire; i++) world.step();
    expect(world.state.player.x).toBe(13.5 * TILE);
    expect(world.state.player.y).toBe(7 * TILE);
  });

  it('is collectable again after a death resets its room', () => {
    const world = new CampaignWorld();
    world.state.checkpoint = {
      room: 'magazzino',
      x: 13.5 * TILE,
      y: 7 * TILE,
      angle: -Math.PI / 2,
    };
    // Already spent (or never picked up) before this attempt.
    world.state.shield.collected = true;
    world.state.player.x = 13.5 * TILE;
    world.state.player.y = 7 * TILE;

    const ticksToFire = Math.ceil(DRONE_REACTION_MS / TICK_MS) + 2;
    for (let i = 0; i < ticksToFire; i++) world.step();

    expect(world.state.shield.collected).toBe(false);
  });
});

describe('CampaignWorld — Sentinella del Molo', () => {
  it('blocks a hit taken from the front while guarding', () => {
    const world = new CampaignWorld();
    world.state.checkpoint = { room: 'molo', x: 0, y: 0, angle: 0 };
    const boss = world.state.boss;

    // Stand directly in front of the boss's starting facing (west)
    // and fire while it is still in 'guard'.
    world.state.player.x = boss.x - 40;
    world.state.player.y = boss.y;
    const aimAngle = Math.atan2(boss.y - world.state.player.y, boss.x - world.state.player.x);

    const events = world.step(input({ aimAngle, fire: true }));
    expect(events.some((e) => e.type === 'bossHit')).toBe(false);
    expect(world.state.boss.damageTaken).toBe(0);
  });

  it('takes three rear hits during a charge to defeat, granting the XP bonus', () => {
    const world = new CampaignWorld();
    world.state.checkpoint = { room: 'molo', x: 17.5 * TILE, y: 5.5 * TILE, angle: 0 };

    for (let hit = 1; hit <= BOSS_HITS_TO_DEFEAT; hit++) {
      // Force a fresh telegraph -> charge transition aimed at a known
      // spot, so the charge direction (and therefore the rear arc) is
      // deterministic for this test.
      world.state.player.x = 17.5 * TILE;
      world.state.player.y = 5.5 * TILE;
      world.state.boss.phase = 'telegraph';
      world.state.boss.phaseTimer = 1;
      world.step(); // telegraph ends: chargeDir locks onto the player above

      const boss = world.state.boss;
      expect(boss.phase).toBe('charge');

      // Reposition behind the boss (opposite its charge direction) and
      // shoot the exposed core.
      const dodgeX = boss.x - boss.chargeDirX * 40;
      const dodgeY = boss.y - boss.chargeDirY * 40;
      world.state.player.x = dodgeX;
      world.state.player.y = dodgeY;
      world.state.player.weaponCooldown = 0;
      const aimAngle = Math.atan2(boss.y - dodgeY, boss.x - dodgeX);

      const events = world.step(input({ aimAngle, fire: true }));
      const hitEvent = events.find((e) => e.type === 'bossHit');
      expect(hitEvent).toBeTruthy();
      if (hitEvent && hitEvent.type === 'bossHit') expect(hitEvent.damage).toBe(1);
    }

    expect(world.state.boss.phase).toBe('defeated');
    expect(world.state.outcome).toBe('victory');
    // Three solid rear hits plus the defeat bonus, no other XP source
    // touched since the checkpoint was set directly rather than walked.
    expect(world.state.xp).toBe(BOSS_HITS_TO_DEFEAT * XP_BOSS_HIT_SOLID + XP_BOSS_DEFEAT);
  });

  /** Un tempo il bersaglio veniva scelto in base alla stanza del
   *  giocatore, e la soglia del Molo (colonna 16) appartiene al
   *  Magazzino: sporgersi dalla porta e sparare non faceva nulla,
   *  senza alcun segnale. Ora decidono solo distanza e muri. */
  it('registers a hit taken while peeking from the Molo doorway', () => {
    const world = new CampaignWorld();
    world.state.checkpoint = { room: 'molo', x: 17.5 * TILE, y: 5.5 * TILE, angle: 0 };
    const boss = world.state.boss;
    // Vulnerabile, e rivolto a est: chi arriva da ovest è alle spalle.
    boss.phase = 'recover';
    boss.phaseTimer = 5000;
    boss.angle = 0;

    // Colonna 16 = la soglia stessa, classificata come "magazzino".
    world.state.player.x = 16.5 * TILE;
    world.state.player.y = 5.5 * TILE;
    world.state.player.weaponCooldown = 0;
    const aimAngle = Math.atan2(
      boss.y - world.state.player.y,
      boss.x - world.state.player.x,
    );

    const events = world.step(input({ aimAngle, fire: true }));
    expect(events.some((e) => e.type === 'bossHit')).toBe(true);
  });

  it('scores only a graze from the wider arc, and only with Danno di Striscio', () => {
    const world = new CampaignWorld();
    world.state.checkpoint = { room: 'molo', x: 17.5 * TILE, y: 5.5 * TILE, angle: 0 };
    world.state.player.x = 17.5 * TILE;
    world.state.player.y = 5.5 * TILE;
    world.state.boss.phase = 'telegraph';
    world.state.boss.phaseTimer = 1;
    world.step();

    const boss = world.state.boss;
    // Offset 80 degrees from dead-rear: outside the solid arc (60deg)
    // but inside the graze arc (100deg).
    const rearDir = boss.angle + Math.PI;
    const offsetAngle = rearDir + (80 * Math.PI) / 180;
    const dist = 40;
    const shooterX = boss.x + Math.cos(offsetAngle) * dist;
    const shooterY = boss.y + Math.sin(offsetAngle) * dist;
    world.state.player.x = shooterX;
    world.state.player.y = shooterY;
    world.state.player.weaponCooldown = 0;
    const aimAngle = Math.atan2(boss.y - shooterY, boss.x - shooterX);

    const withoutNode = world.step(input({ aimAngle, fire: true }));
    expect(withoutNode.some((e) => e.type === 'bossHit')).toBe(false);

    world.state.unlockedNodes.push('danno-di-striscio');
    world.state.player.weaponCooldown = 0;
    const withNode = world.step(input({ aimAngle, fire: true }));
    const graze = withNode.find((e) => e.type === 'bossHit');
    expect(graze).toBeTruthy();
    if (graze && graze.type === 'bossHit') expect(graze.damage).toBe(0.5);
  });
});
