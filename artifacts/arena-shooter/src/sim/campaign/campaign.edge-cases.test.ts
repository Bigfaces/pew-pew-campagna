// ================================================================
// CAMPAIGN SIMULATION TESTS — edge cases and structural invariants
// ================================================================
// Companion to campaign.test.ts. Deliberately steers away from
// asserting exact numbers on the core/node economy (another thread is
// actively reworking it) and instead pins down *mechanisms* that must
// hold regardless of how that economy ends up shaped: checkpoints
// never regress, per-room death resets only touch that room's hazard,
// the drone respects real line-of-sight, the boss's rear-only hitbox
// has a precise edge, wasted shots are inert, and collision never lets
// the player clip through geometry.
// ================================================================

import { describe, expect, it } from 'vitest';

import { ENTITY_RADIUS, TICK_MS, TILE } from '../constants';
import { BOSS_CHARGE_MS, TURRET_REACTION_MS } from './constants';
import { campCircleHitsTile } from './physics';
import { weaponStatsFor } from './skills';
import {
  attracco,
  bossHome,
  doorOf,
  enterBossRoom,
  molo,
  shieldOf,
  turretOf,
  quiet,
} from './testSupport';
import { emptyCampaignInput, type CampaignInput } from './types';
import { CampaignWorld } from './world';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

function idleTicks(world: CampaignWorld, n: number): void {
  for (let i = 0; i < n; i++) world.step();
}

// --------------------------------------------------------------------
// Checkpoint: forward-only
// --------------------------------------------------------------------

describe('CampaignWorld — checkpoint mai regressivo', () => {
  it('non torna a una stanza precedente se il giocatore ci rientra', () => {
    const world = attracco();

    // Entra nel corridoio: il checkpoint avanza.
    world.state.player.x = 8 * TILE;
    world.state.player.y = 5.5 * TILE;
    world.step();
    expect(world.state.checkpoint.room).toBe('corridoio');
    const advanced = { ...world.state.checkpoint };

    // Torna indietro nell'Attracco: il checkpoint non deve arretrare.
    world.state.player.x = 2 * TILE;
    world.state.player.y = 5.5 * TILE;
    world.step();

    expect(world.state.checkpoint.room).toBe('corridoio');
    expect(world.state.checkpoint).toEqual(advanced);
  });
});

// --------------------------------------------------------------------
// Morte e reset: solo il pericolo della stanza del checkpoint cambia
// --------------------------------------------------------------------

describe('CampaignWorld — morte resetta solo il pericolo della propria stanza', () => {
  // Nota: con l'Atto I diviso in tre livelli, porta e boss non stanno
  // più nello stesso livello, quindi la regola si verifica dove
  // ciascuna coppia esiste davvero. È la stessa regola, guardata da
  // due livelli diversi.

  it('morire per il drone nel Magazzino non riarma la porta già sigillata', () => {
    const world = quiet(attracco());

    // La porta è già stata superata e sigillata prima di arrivare qui.
    doorOf(world).state.armed = false;
    doorOf(world).state.closed = true;
    doorOf(world).state.closeTimer = 0;

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
    // La porta resta sigillata: non è il pericolo di questa stanza.
    expect(doorOf(world).state.closed).toBe(true);
    expect(doorOf(world).state.armed).toBe(false);
    // Il drone invece sì: è di casa qui.
    expect(turretOf(world).state.alive).toBe(true);
  });

  it('morire nel Molo resetta il boss, non le turret della galleria né i progressi', () => {
    const world = molo();
    const home = bossHome(world.level);
    enterBossRoom(world);
    world.state.player.x = home.x - 60;
    world.state.player.y = home.y;
    world.state.checkpoint.x = home.x - 60;

    // Una turret della galleria, cioè di una stanza precedente, già
    // abbattuta: morire nel Molo non deve rimetterla in piedi.
    const galleria = turretOf(world, 'galleria-a');
    galleria.state.alive = false;

    // Progressi che non appartengono al Molo e non devono sparire.
    world.state.coresCollected = 2;
    world.state.unlockedNodes = ['otturatore-rapido'];

    // Il boss è già a mezza carica, a un soffio dal giocatore.
    const boss = world.state.boss!;
    boss.phase = 'charge';
    boss.phaseTimer = BOSS_CHARGE_MS;
    boss.damageTaken = 1;
    boss.chargeDirX = -1;
    boss.chargeDirY = 0;
    boss.x = world.state.player.x + 10;
    boss.y = world.state.player.y;
    world.state.player.respawnInvulnerableMs = 0;

    const events = world.step(input());
    expect(events.some((e) => e.type === 'playerDied' && e.cause === 'boss')).toBe(true);

    expect(world.state.boss!.phase).toBe('guard');
    expect(world.state.boss!.damageTaken).toBe(0);
    expect(world.state.boss!.x).toBe(home.x);
    expect(world.state.boss!.y).toBe(home.y);
    expect(world.state.player.x).toBe(home.x - 60);

    // Non toccati dal reset del Molo.
    expect(turretOf(world, 'galleria-a').state.alive).toBe(false);
    expect(world.state.coresCollected).toBe(2);
    expect(world.state.unlockedNodes).toEqual(['otturatore-rapido']);
  });
});

// --------------------------------------------------------------------
// Drone: rispetta la linea di vista reale, non solo il timer
// --------------------------------------------------------------------

describe('CampaignWorld — drone rispetta la linea di vista', () => {
  it('non spara mai se un muro reale blocca la vista, anche aspettando a lungo', () => {
    const world = attracco();
    // La nicchia del core (8,3) è sulla stessa riga del drone (13,3),
    // ma i tile (9,3)-(11,3) sono muro pieno: nessuna linea retta è
    // possibile, indipendentemente da quanto si aspetta.
    world.state.player.x = (8 + 0.5) * TILE;
    world.state.player.y = (3 + 0.5) * TILE;

    let died = false;
    for (let i = 0; i < 80; i++) {
      const events = world.step();
      if (events.some((e) => e.type === 'playerDied')) died = true;
    }

    expect(died).toBe(false);
    expect(turretOf(world).state.alive).toBe(true);
    // Il timer di reazione non è mai potuto scendere: la vista non è
    // mai stata libera nemmeno per un tick.
    expect(turretOf(world).state.reactionTimer).toBe(TURRET_REACTION_MS);
  });
});

// --------------------------------------------------------------------
// Boss: confine esatto dell'arco vulnerabile
// --------------------------------------------------------------------

/** A fresh world with the boss mid-charge, facing east (angle 0), so
 *  "rear" is due west — a known, fixed reference for angle-boundary
 *  tests. checkpoint.room is left at the level's first room, so
 *  updateBoss's own phase/timer logic never runs and cannot rotate or
 *  advance the boss out from under the test. */
function bossChargeWorld(): CampaignWorld {
  const world = molo();
  const boss = world.state.boss!;
  const home = bossHome(world.level);
  boss.phase = 'charge';
  boss.angle = 0;
  boss.damageTaken = 0;
  boss.x = home.x;
  boss.y = home.y;
  return world;
}

/** Fires one shot from `offsetDeg` degrees off dead-rear (0 = directly
 *  behind the boss, 180 = directly in front), and returns the damage
 *  dealt (0 if no bossHit event fired). Places the shooter well inside
 *  the Molo room regardless of angle, at a distance that keeps the
 *  shot's line of sight clear of the Magazzino wall. */
function fireAtBossAngle(
  world: CampaignWorld,
  offsetDeg: number,
  unlockedNodes: string[] = [],
): number {
  world.state.unlockedNodes = unlockedNodes;
  const boss = world.state.boss;
  const rearDir = boss.angle + Math.PI;
  const a = rearDir + (offsetDeg * Math.PI) / 180;
  const dist = 40;
  const shooterX = boss.x + Math.cos(a) * dist;
  const shooterY = boss.y + Math.sin(a) * dist;

  world.state.player.x = shooterX;
  world.state.player.y = shooterY;
  world.state.player.weaponCooldown = 0;
  const aimAngle = Math.atan2(boss.y - shooterY, boss.x - shooterX);

  const events = world.step(input({ aimAngle, fire: true }));
  const hit = events.find((e) => e.type === 'bossHit');
  return hit && hit.type === 'bossHit' ? hit.damage : 0;
}

describe('Sentinella del Molo — confine esatto dell\'arco vulnerabile', () => {
  it('appena dentro i 60° dal retro: danno pieno, anche senza il nodo', () => {
    expect(fireAtBossAngle(bossChargeWorld(), 59)).toBe(1);
  });

  it('appena oltre i 60° dal retro: nessun danno pieno — striscio solo con il nodo', () => {
    expect(fireAtBossAngle(bossChargeWorld(), 61, [])).toBe(0);
    expect(fireAtBossAngle(bossChargeWorld(), 61, ['danno-di-striscio'])).toBe(0.5);
  });

  it('appena dentro i 100° dal retro: lo striscio conta ancora con il nodo', () => {
    expect(fireAtBossAngle(bossChargeWorld(), 99, [])).toBe(0);
    expect(fireAtBossAngle(bossChargeWorld(), 99, ['danno-di-striscio'])).toBe(0.5);
  });

  it('appena oltre i 100° dal retro: nessun danno, nemmeno con il nodo', () => {
    expect(fireAtBossAngle(bossChargeWorld(), 101, ['danno-di-striscio'])).toBe(0);
  });

  it('un colpo dritto in faccia non infligge mai danno, nemmeno con il nodo', () => {
    expect(fireAtBossAngle(bossChargeWorld(), 180, [])).toBe(0);
    expect(fireAtBossAngle(bossChargeWorld(), 180, ['danno-di-striscio'])).toBe(0);
  });

  it('nessun danno se la fase non è charge/recover, indipendentemente dall\'angolo', () => {
    const world = bossChargeWorld();
    world.state.boss!.phase = 'guard';
    world.state.boss!.phaseTimer = 10_000; // non far scadere la fase durante il tick
    // Anche allineati al retro esatto, in guard non c'è finestra di danno.
    expect(fireAtBossAngle(world, 0, ['danno-di-striscio'])).toBe(0);
  });
});

// --------------------------------------------------------------------
// fireWeapon: uno sparo a vuoto non deve produrre eventi
// --------------------------------------------------------------------

describe('CampaignWorld — sparare a vuoto', () => {
  it('non genera eventi in una stanza senza nemici, ma consuma comunque il cooldown', () => {
    const world = quiet(attracco());
    const stats = weaponStatsFor([]);
    // Attracco: né drone né boss.
    world.state.player.x = 3 * TILE;
    world.state.player.y = 5.5 * TILE;
    world.state.player.weaponCooldown = 0;

    const events = world.step(input({ aimAngle: 0, fire: true }));

    expect(events).toEqual([]);
    expect(world.state.player.weaponCooldown).toBe(stats.cooldownMs);
  });
});

// --------------------------------------------------------------------
// Collisione: niente attraversamenti diagonali agli spigoli
// --------------------------------------------------------------------

describe('CampaignWorld — collisione contro uno spigolo', () => {
  it('non attraversa il muro spingendo in diagonale contro un angolo convesso', () => {
    const world = attracco();
    // Tile (1,1) è pavimento aperto; i muri di bordo mappa (tx=0 e
    // ty=0) formano uno spigolo retto proprio nel punto (TILE, TILE).
    world.state.player.x = 1.5 * TILE;
    world.state.player.y = 1.5 * TILE;
    const aimAngle = (-3 * Math.PI) / 4; // verso l'angolo in alto a sinistra

    for (let i = 0; i < 60; i++) {
      world.step(input({ aimAngle, forward: 1 }));
    }

    const p = world.state.player;
    const isSolid = (tx: number, ty: number) => world.getTile(tx, ty) !== 0;
    expect(campCircleHitsTile(isSolid, p.x, p.y, ENTITY_RADIUS - 1)).toBe(false);
    // Il giocatore si è comunque mosso verso l'angolo, non è rimasto fermo.
    expect(Math.hypot(p.x - 1.5 * TILE, p.y - 1.5 * TILE)).toBeGreaterThan(0);
  });
});
