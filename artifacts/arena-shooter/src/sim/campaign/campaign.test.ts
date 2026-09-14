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
  BOSS_ENRAGED_CHARGES,
  BOSS_ENRAGE_AT,
  BOSS_HITS_TO_DEFEAT,
  DOOR_CLOSE_DELAY_MS,
  TURRET_COOLDOWN_MS,
  TURRET_REACTION_MS,
  LEVEL_XP_THRESHOLDS,
  NODE_OTTURATORE_COOLDOWN_MS,
  ALL_SKILL_NODES,
  SKILL_TREE,
  XP_BOSS_DEFEAT,
  XP_BOSS_HIT_SOLID,
  XP_CORE,
  XP_TURRET_DOWN,
  XP_ROOM_ENTER,
  levelForXp,
} from './constants';
import {
  CAMPAIGN_PROFILE_VERSION,
  emptyCampaignInput,
  type CampaignInput,
} from './types';
import {
  hasGrazeDamage,
  pointsSpent,
  weaponStatsFor,
} from './skills';
import {
  attracco,
  bossHome,
  centre,
  doorOf,
  enterBossRoom,
  molo,
  shieldOf,
  turretOf,
} from './testSupport';
import { ACT_ONE, LEVEL_ATTRACCO } from './levels';
import { roomAtTx } from './levelTypes';
import { CampaignWorld } from './world';

/** Lo scudo dell'Attracco, letto dal livello: se si sposta, i test
 *  lo seguono invece di puntare a coordinate scritte due volte. */
const SHIELD = (() => {
  const d = LEVEL_ATTRACCO.shields[0]!;
  return centre(d.tx, d.ty);
})();

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
    const world = attracco();
    expect(world.state.level).toBe(1);
    expect(world.state.skillPoints).toBe(0);

    // Force xp to just below the level-2 threshold, then push it over
    // with a single core pickup — the level-up must land on this tick.
    world.state.xp = LEVEL_XP_THRESHOLDS[1]! - XP_CORE;
    const core = world.state.cores.find((c) => c.id === 'attracco/magazzino')!;
    world.state.player.x = core.x;
    world.state.player.y = core.y;

    const events = world.step();
    expect(world.state.level).toBe(2);
    expect(world.state.skillPoints).toBe(1);
    expect(events.some((e) => e.type === 'levelUp' && e.level === 2)).toBe(true);
  });

  /** XP raccoglibile in un livello, esplorandolo tutto. Calcolata
   *  dalla definizione invece che scritta a mano: una lista di tappe
   *  copiata racconta l'atto che c'era quando è stata scritta, e mente
   *  in silenzio dal primo livello che cambia. */
  function levelXp(level: (typeof ACT_ONE)[number], thorough: boolean): number {
    const spawnRoom = roomAtTx(level, level.spawn.tx);
    let xp = level.rooms.filter((r) => r.id !== spawnRoom).length * XP_ROOM_ENTER;
    if (thorough) {
      xp += level.cores.length * XP_CORE + level.turrets.length * XP_TURRET_DOWN;
    }
    return xp;
  }

  /** La curva deve restare spendibile *durante* la partita: la prima
   *  versione concedeva l'ultimo punto solo insieme al bonus di
   *  vittoria, cioè su un nodo ormai inutilizzabile.
   *
   *  Con un solo ramo l'asticella era "tutti i nodi prima del boss".
   *  Con quattro rami e tre livelli quella soglia sarebbe sbagliata al
   *  contrario: un albero comprabile per intero prima dello scontro
   *  finale non fa scegliere niente. Quello che deve restare vero è
   *  che chi esplora possa *specializzarsi* — riempire almeno un ramo
   *  completo prima di entrare nel Molo. */
  it('affords a full branch before the final fight, exploring everything', () => {
    const preBoss = ACT_ONE.filter((l) => l.boss === null).reduce(
      (sum, l) => sum + levelXp(l, true),
      0,
    );
    const points = levelForXp(preBoss) - 1;
    const biggestBranch = Math.max(...SKILL_TREE.map((b) => b.nodes.length));
    expect(points).toBeGreaterThanOrEqual(biggestBranch);
  });

  /** L'albero deve aprirsi lungo tutto l'atto, non tutto in fondo:
   *  ogni livello porta almeno un punto nuovo anche a chi tira dritto
   *  senza raccogliere né ripulire niente. */
  it('grants at least one new point in every level of the act, even rushing', () => {
    let xp = 0;
    let previous = 0;
    for (const level of ACT_ONE) {
      xp += levelXp(level, false);
      const points = levelForXp(xp) - 1;
      expect(points, `dopo ${level.name}`).toBeGreaterThan(previous);
      previous = points;
    }
  });

  /** L'altro lato dello stesso vincolo: chi tira dritto deve comunque
   *  guadagnare punti *mentre* combatte, non soltanto a partita
   *  finita. */
  it('still earns spendable points mid-fight when skipping cores and turrets', () => {
    const roomsOnly = ACT_ONE.reduce((sum, l) => sum + levelXp(l, false), 0);
    // Due colpi, non tre: il terzo uccide il boss e chiude l'atto,
    // quindi un punto che arrivasse lì non sarebbe più spendibile.
    const beforeKillingBlow = roomsOnly + (BOSS_HITS_TO_DEFEAT - 1) * XP_BOSS_HIT_SOLID;
    expect(levelForXp(beforeKillingBlow) - 1).toBeGreaterThan(levelForXp(roomsOnly) - 1);
  });

  /** Nessun punto deve restare senza un nodo su cui finire: la tabella
   *  dei livelli e l'albero devono avere la stessa misura. */
  it('tops out at exactly one point per node in the tree', () => {
    const maxPoints = LEVEL_XP_THRESHOLDS.length - 1;
    expect(maxPoints).toBe(ALL_SKILL_NODES.length);
  });
});

describe('CampaignWorld — profilo salvato', () => {
  it('round-trips the character without carrying the run', () => {
    const world = attracco();
    world.state.skillPoints = 1;
    world.tryUnlockNode('otturatore-rapido');
    world.state.xp = 90;
    world.state.cores[0]!.collected = true;
    world.state.roomsAwarded.push('attracco/corridoio');
    doorOf(world).state.closed = true;

    const resumed = attracco(world.toProfile());
    expect(resumed.state.xp).toBe(90);
    expect(resumed.state.unlockedNodes).toEqual(['otturatore-rapido']);
    expect(resumed.state.cores[0]!.collected).toBe(true);
    expect(resumed.state.coresCollected).toBe(1);
    expect(resumed.state.roomsAwarded).toContain('attracco/corridoio');
    expect(resumed.state.levelId).toBe('attracco');

    // Il run non si porta dietro: si ricomincia dall'inizio del livello.
    expect(resumed.state.checkpoint.room).toBe('attracco');
    expect(doorOf(resumed).state.closed).toBe(false);
  });

  it('derives level and skill points from xp instead of storing them', () => {
    const world = attracco({
      version: CAMPAIGN_PROFILE_VERSION,
      xp: LEVEL_XP_THRESHOLDS[2]!,
      unlockedNodes: [],
      levelId: 'attracco',
      completedLevels: [],
      collectedCoreIds: [],
      roomsAwarded: [],
    });
    expect(world.state.level).toBe(3);
    expect(world.state.skillPoints).toBe(2);
    expect(world.availableSkillPoints).toBe(2);
  });

  /** Senza questo, uscire al menu e rientrare sarebbe un ciclo di XP
   *  stabile: le stesse stanze pagate all'infinito. */
  it('does not pay room XP twice for a room already awarded', () => {
    const first = attracco();
    first.state.player.x = 7.2 * TILE;
    first.state.player.y = 5.5 * TILE;
    first.step();
    const earned = first.state.xp;
    expect(earned).toBeGreaterThan(0);

    const second = attracco(first.toProfile());
    second.state.player.x = 7.2 * TILE;
    second.state.player.y = 5.5 * TILE;
    second.step();
    expect(second.state.xp).toBe(earned);
  });
});

describe('CampaignWorld — porta stagna a tempo', () => {
  it('seals after the delay and blocks the corridor', () => {
    const world = attracco();
    // Walk straight into the corridor sensor without touching the door.
    world.state.player.x = 7.2 * TILE;
    world.state.player.y = 5.5 * TILE;

    world.step(); // arms the door on this tick
    expect(doorOf(world).state.armed).toBe(true);
    expect(doorOf(world).state.closed).toBe(false);

    // Stay put (empty input = no movement) until the timer runs out.
    idleTicks(world, Math.ceil(DOOR_CLOSE_DELAY_MS / TICK_MS) + 1);
    expect(doorOf(world).state.closed).toBe(true);

    // Now try to push straight through where the door sits.
    world.state.player.x = 8.5 * TILE;
    world.state.player.y = 5.5 * TILE;
    for (let i = 0; i < 30; i++) {
      world.step(input({ forward: 1, aimAngle: 0 }));
    }
    expect(world.state.player.x).toBeLessThan(9 * TILE);
  });

  it('never arms if the player has not reached the sensor tile', () => {
    const world = attracco();
    idleTicks(world, 50);
    expect(doorOf(world).state.armed).toBe(false);
  });
});

describe('CampaignWorld — core e skill tree', () => {
  it('unlocks a node only when enough skill points are available', () => {
    const world = attracco();
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
    const world = attracco();
    const core = world.state.cores.find((c) => c.id === 'attracco/magazzino')!;
    world.state.player.x = core.x;
    world.state.player.y = core.y;

    const events = world.step();
    expect(world.state.coresCollected).toBe(1);
    expect(events.some((e) => e.type === 'coreCollected')).toBe(true);
  });
});

describe('CampaignWorld — drone del Magazzino', () => {
  it('kills the player after holding line of sight, then respawns at the checkpoint', () => {
    const world = attracco();
    world.state.checkpoint = {
      room: 'magazzino',
      x: 13.5 * TILE,
      y: 7 * TILE,
      angle: -Math.PI / 2,
    };
    world.state.player.x = 13.5 * TILE;
    world.state.player.y = 7 * TILE;

    const ticksToFire = Math.ceil(TURRET_REACTION_MS / TICK_MS) + 2;
    let died = false;
    for (let i = 0; i < ticksToFire; i++) {
      const events = world.step();
      if (events.some((e) => e.type === 'playerDied')) died = true;
    }

    expect(died).toBe(true);
    expect(world.state.player.x).toBe(13.5 * TILE);
    expect(world.state.player.y).toBe(7 * TILE);
    expect(turretOf(world).state.alive).toBe(true);
  });
});

describe('CampaignWorld — scudo tattico', () => {
  it('absorbs a drone hit instead of killing the player, then is spent', () => {
    const world = attracco();
    world.state.checkpoint = {
      room: 'magazzino',
      x: 13.5 * TILE,
      y: 7 * TILE,
      angle: -Math.PI / 2,
    };
    world.state.player.x = SHIELD.x;
    world.state.player.y = SHIELD.y;

    // Walk over the pickup first.
    const pickupEvents = world.step();
    expect(shieldOf(world).collected).toBe(true);
    expect(world.state.player.shieldCharges).toBe(1);
    expect(pickupEvents.some((e) => e.type === 'shieldPickup')).toBe(true);

    // Now stand where the drone can see us and let it fire.
    world.state.player.x = 13.5 * TILE;
    world.state.player.y = 7 * TILE;
    const ticksToFire = Math.ceil(TURRET_REACTION_MS / TICK_MS) + 2;
    let sawBreak = false;
    let sawDeath = false;
    for (let i = 0; i < ticksToFire; i++) {
      const events = world.step();
      if (events.some((e) => e.type === 'shieldBreak')) sawBreak = true;
      if (events.some((e) => e.type === 'playerDied')) sawDeath = true;
    }

    expect(sawBreak).toBe(true);
    expect(sawDeath).toBe(false);
    expect(world.state.player.shieldCharges).toBe(0);
    // The player never actually died, so they should still be standing
    // in front of the drone, not back at the checkpoint.
    expect(world.state.player.x).toBe(13.5 * TILE);

    // A second sustained volley, with no shield left, does kill.
    for (let i = 0; i < ticksToFire; i++) world.step();
    expect(world.state.player.x).toBe(13.5 * TILE);
    expect(world.state.player.y).toBe(7 * TILE);
  });

  it('is collectable again after a death resets its room', () => {
    const world = attracco();
    world.state.checkpoint = {
      room: 'magazzino',
      x: 13.5 * TILE,
      y: 7 * TILE,
      angle: -Math.PI / 2,
    };
    // Already spent (or never picked up) before this attempt.
    shieldOf(world).collected = true;
    world.state.player.x = 13.5 * TILE;
    world.state.player.y = 7 * TILE;

    const ticksToFire = Math.ceil(TURRET_REACTION_MS / TICK_MS) + 2;
    for (let i = 0; i < ticksToFire; i++) world.step();

    expect(shieldOf(world).collected).toBe(false);
  });
});

describe('CampaignWorld — Sentinella del Molo', () => {
  it('blocks a hit taken from the front while guarding', () => {
    const world = molo();
    enterBossRoom(world);
    const boss = world.state.boss!;

    // Stand directly in front of the boss's starting facing (west)
    // and fire while it is still in 'guard'.
    world.state.player.x = boss.x - 40;
    world.state.player.y = boss.y;
    const aimAngle = Math.atan2(boss.y - world.state.player.y, boss.x - world.state.player.x);

    const events = world.step(input({ aimAngle, fire: true }));
    expect(events.some((e) => e.type === 'bossHit')).toBe(false);
    expect(world.state.boss!.damageTaken).toBe(0);
  });

  it('takes three rear hits during a charge to defeat, granting the XP bonus', () => {
    const world = molo();
    enterBossRoom(world);

    for (let hit = 1; hit <= BOSS_HITS_TO_DEFEAT; hit++) {
      // Force a fresh telegraph -> charge transition aimed at a known
      // spot, so the charge direction (and therefore the rear arc) is
      // deterministic for this test.
      world.state.player.x = 17.5 * TILE;
      world.state.player.y = 5.5 * TILE;
      world.state.boss!.phase = 'telegraph';
      world.state.boss!.phaseTimer = 1;
      world.step(); // telegraph ends: chargeDir locks onto the player above

      const boss = world.state.boss!;
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

    expect(world.state.boss!.phase).toBe('defeated');
    // Il Molo chiude l'Atto I ma apre il II: è un passaggio, non la
    // fine della campagna.
    expect(world.state.outcome).toBe('levelComplete');
    // Three solid rear hits plus the defeat bonus, no other XP source
    // touched since the checkpoint was set directly rather than walked.
    expect(world.state.xp).toBe(BOSS_HITS_TO_DEFEAT * XP_BOSS_HIT_SOLID + XP_BOSS_DEFEAT);
  });

  /** Un tempo il bersaglio veniva scelto in base alla stanza del
   *  giocatore, e la soglia del Molo (colonna 16) appartiene al
   *  Magazzino: sporgersi dalla porta e sparare non faceva nulla,
   *  senza alcun segnale. Ora decidono solo distanza e muri. */
  it('registers a hit taken while peeking from the Molo doorway', () => {
    const world = molo();
    enterBossRoom(world);
    const boss = world.state.boss!;
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

  it('charges twice in a row once enraged, and only once before', () => {
    const world = molo();
    enterBossRoom(world);
    world.state.player.x = 17.5 * TILE;
    world.state.player.y = 5.5 * TILE;

    /** Conta le cariche fino al ritorno in guardia.
     *
     *  Il giocatore resta invulnerabile per tutta la misura: il Molo è
     *  stretto e una carica lo travolgerebbe, e la morte resetta il
     *  boss (killPlayer) — falsando proprio la cosa che stiamo
     *  contando. Qui interessa la macchina a stati, non la schivata. */
    const chargesInOneVolley = (): number => {
      const boss = world.state.boss!;
      boss.phase = 'guard';
      boss.phaseTimer = 1;
      let charges = 0;
      let prev = boss.phase;
      for (let i = 0; i < 1200; i++) {
        world.state.player.respawnInvulnerableMs = 1000;
        world.step();
        if (boss.phase === 'charge' && prev !== 'charge') charges++;
        // La raffica è finita quando torna in guardia.
        if (boss.phase === 'guard' && prev === 'recover') break;
        prev = boss.phase;
      }
      return charges;
    };

    expect(world.enraged).toBe(false);
    expect(chargesInOneVolley()).toBe(1);

    // Portala oltre la soglia di alterazione.
    world.state.boss!.damageTaken = BOSS_ENRAGE_AT;
    expect(world.enraged).toBe(true);
    expect(chargesInOneVolley()).toBe(BOSS_ENRAGED_CHARGES);
  });

  it('announces the switch to the second phase exactly once', () => {
    const world = molo();
    enterBossRoom(world);
    const boss = world.state.boss!;
    boss.phase = 'recover';
    boss.phaseTimer = 9000;
    boss.angle = 0;

    const shootFromBehind = (): ReturnType<CampaignWorld['step']> => {
      world.state.player.x = boss.x - 40;
      world.state.player.y = boss.y;
      world.state.player.weaponCooldown = 0;
      const aimAngle = Math.atan2(
        boss.y - world.state.player.y,
        boss.x - world.state.player.x,
      );
      return world.step(input({ aimAngle, fire: true }));
    };

    // Il primo colpo pieno porta il danno a 1, oltre la soglia di 1.5? No:
    // serve il secondo. L'annuncio deve arrivare con quello, una volta sola.
    const first = shootFromBehind();
    expect(first.some((e) => e.type === 'bossEnraged')).toBe(false);

    const second = shootFromBehind();
    expect(second.some((e) => e.type === 'bossEnraged')).toBe(true);

    boss.phase = 'recover';
    boss.phaseTimer = 9000;
    const third = shootFromBehind();
    expect(third.some((e) => e.type === 'bossEnraged')).toBe(false);
  });

  it('scores only a graze from the wider arc, and only with Danno di Striscio', () => {
    const world = molo();
    enterBossRoom(world);
    world.state.player.x = 17.5 * TILE;
    world.state.player.y = 5.5 * TILE;
    world.state.boss!.phase = 'telegraph';
    world.state.boss!.phaseTimer = 1;
    world.step();

    const boss = world.state.boss!;
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
