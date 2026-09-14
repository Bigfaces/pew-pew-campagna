// ================================================================
// ATTO II — passerelle, buio, gravità, Custode
// ================================================================
// Le tre minacce nuove dell'atto e il boss che le usa tutte e due.
//
// Il taglio è quello di sempre: si fissano i *meccanismi* e le
// relazioni fra i numeri, non i numeri. "Camminare non basta e
// scattare sì" deve restare vero anche dopo una ritaratura; "180 ms"
// no, e infatti non è scritto da nessuna parte qui.
// ================================================================

import { describe, expect, it } from 'vitest';

import { TICK_MS, TILE } from '../constants';
import {
  BLACKOUT_LINGER_MS,
  CUSTODE_EXPOSED_MS,
  CUSTODE_HITS_TO_DEFEAT,
  CUSTODE_MANIPULATION_MS,
  CUSTODE_TELL_MS,
} from './constants';
import { LEVEL_ANELLO, LEVEL_NUCLEO, LEVEL_REFRIGERANTE, levelById } from './levels';
import { movementStatsFor, resistsGravityFlip } from './skills';
import { centre } from './testSupport';
import { emptyCampaignInput, type CampaignInput } from './types';
import { CampaignWorld } from './world';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

/** Un mondo dell'Anello con i nodi dati, il giocatore appoggiato a
 *  ovest della voragine chiesta e le turret spente — qui si misura il
 *  vuoto, non il fuoco. */
function atChasm(chasmId: string, nodes: string[]): CampaignWorld {
  const world = new CampaignWorld(LEVEL_ANELLO);
  world.state.unlockedNodes = nodes;
  for (const t of world.state.turrets) t.alive = false;

  const def = LEVEL_ANELLO.chasms.find((c) => c.id === chasmId)!;
  const firstTx = Math.min(...def.tiles.map((t) => t.tx));
  const start = centre(firstTx - 1, def.tiles[0]!.ty);
  world.state.player.x = start.x;
  world.state.player.y = start.y;
  world.state.player.angle = 0;
  return world;
}

/** Prova ad attraversare andando a est, scattando al primo tick se
 *  richiesto. Torna se si è caduti. */
function tryCross(world: CampaignWorld, chasmId: string, dash: boolean): boolean {
  const def = LEVEL_ANELLO.chasms.find((c) => c.id === chasmId)!;
  const lastTx = Math.max(...def.tiles.map((t) => t.tx));

  let fell = false;
  for (let i = 0; i < 400; i++) {
    const ev = world.step(input({ forward: 1, dash: dash && i === 0 }));
    if (ev.some((e) => e.type === 'fellIntoChasm')) fell = true;
    if (fell) break;
    if (Math.floor(world.state.player.x / TILE) > lastTx) break;
  }
  return fell;
}

describe('passerelle sospese', () => {
  it('camminando si cade, anche col nodo della velocità', () => {
    // Passo Lungo non deve trasformarsi per sbaglio in un permesso di
    // attraversare: renderebbe lo Scatto facoltativo dove invece è il
    // punto.
    expect(tryCross(atChasm('ponte-stretta', []), 'ponte-stretta', false)).toBe(true);
    expect(
      tryCross(atChasm('ponte-stretta', ['passo-lungo']), 'ponte-stretta', false),
    ).toBe(true);
  });

  it('la passerella stretta si passa in scatto', () => {
    expect(tryCross(atChasm('ponte-stretta', ['scatto']), 'ponte-stretta', true)).toBe(
      false,
    );
  });

  it('quella larga no: serve anche lo Slancio', () => {
    expect(tryCross(atChasm('ponte-larga', ['scatto']), 'ponte-larga', true)).toBe(true);
    expect(
      tryCross(atChasm('ponte-larga', ['scatto', 'slancio']), 'ponte-larga', true),
    ).toBe(false);
  });

  it('Slancio alza la velocità dello scatto, non la durata', () => {
    // Sul vuoto conta quanti millisecondi si resta sospesi: allungare
    // la durata farebbe arrivare più lontano ma non più in fretta, e
    // una passerella larga resterebbe impossibile lo stesso.
    const base = movementStatsFor(['scatto']);
    const boosted = movementStatsFor(['scatto', 'slancio']);
    expect(boosted.dashSpeed).toBeGreaterThan(base.dashSpeed);
  });

  it('cadere non è morire: è un costo di tempo', () => {
    const world = atChasm('ponte-stretta', []);
    const landing = centre(
      LEVEL_ANELLO.chasms[0]!.landing.tx,
      LEVEL_ANELLO.chasms[0]!.landing.ty,
    );
    let died = false;
    let fell = false;
    for (let i = 0; i < 400 && !fell; i++) {
      for (const e of world.step(input({ forward: 1 }))) {
        if (e.type === 'playerDied') died = true;
        if (e.type === 'fellIntoChasm') fell = true;
      }
    }
    expect(fell).toBe(true);
    expect(died).toBe(false);
    expect(world.state.player.x).toBe(landing.x);
    expect(world.state.player.y).toBe(landing.y);
  });
});

describe('blackout', () => {
  const ZONE = LEVEL_REFRIGERANTE.blackouts[0]!;
  const INSIDE = centre(ZONE.tiles[0]!.tx, ZONE.tiles[0]!.ty);

  function dark(): CampaignWorld {
    const world = new CampaignWorld(LEVEL_REFRIGERANTE);
    for (const t of world.state.turrets) t.alive = false;
    world.state.player.x = INSIDE.x;
    world.state.player.y = INSIDE.y;
    return world;
  }

  it('acceca la vista e lascia una coda uscendo', () => {
    const world = dark();
    expect(world.step().some((e) => e.type === 'blackoutEntered')).toBe(true);
    expect(world.darkness).toBe(1);

    world.state.player.x = 15.5 * TILE;
    world.state.player.y = 6.5 * TILE;
    world.step();
    expect(world.darkness).toBeGreaterThan(0);
    expect(world.darkness).toBeLessThan(1);

    let cleared = false;
    for (let i = 0; i < Math.ceil(BLACKOUT_LINGER_MS / TICK_MS) + 2; i++) {
      if (world.step().some((e) => e.type === 'blackoutCleared')) cleared = true;
    }
    expect(cleared).toBe(true);
    expect(world.darkness).toBe(0);
  });

  it('non spegne i sensori — è il contrario del gas', () => {
    // È la differenza che rende le due trappole due trappole e non la
    // stessa due volte: il gas toglie lo scanner, il buio toglie la
    // vista e lascia lo scanner come unica cosa che resta.
    const world = dark();
    world.step();
    expect(world.darkness).toBeGreaterThan(0);
    expect(world.blinded).toBe(false);
  });
});

describe('gravità invertita', () => {
  const ZONE = LEVEL_REFRIGERANTE.gravityZones[0]!;
  const INSIDE = centre(ZONE.tiles[0]!.tx, ZONE.tiles[0]!.ty + 5);

  function flipped(nodes: string[] = []): CampaignWorld {
    const world = new CampaignWorld(LEVEL_REFRIGERANTE);
    world.state.unlockedNodes = nodes;
    for (const t of world.state.turrets) t.alive = false;
    world.state.player.x = INSIDE.x;
    world.state.player.y = INSIDE.y;
    return world;
  }

  it('si capovolge entrando e torna dritta uscendo', () => {
    const world = flipped();
    expect(world.step().some((e) => e.type === 'gravityFlipped' && e.inverted)).toBe(true);
    expect(world.gravityInverted).toBe(true);

    world.state.player.x = 5.5 * TILE;
    const ev = world.step();
    expect(ev.some((e) => e.type === 'gravityFlipped' && !e.inverted)).toBe(true);
    expect(world.gravityInverted).toBe(false);
  });

  it('specchia lo strafe, e Ancoraggio toglie proprio quello', () => {
    function strafeDrift(nodes: string[]): number {
      const world = flipped(nodes);
      world.step();
      const before = world.state.player.y;
      for (let i = 0; i < 6; i++) world.step(input({ strafe: 1 }));
      return world.state.player.y - before;
    }

    const plain = strafeDrift([]);
    const anchored = strafeDrift(['riserva-di-bordo', 'ancoraggio']);
    expect(resistsGravityFlip(['riserva-di-bordo', 'ancoraggio'])).toBe(true);
    // Stessa richiesta, direzioni opposte: è tutto quello che il nodo
    // cambia. Il mondo resta capovolto in entrambi i casi.
    expect(Math.sign(plain)).toBe(-Math.sign(anchored));
    expect(Math.abs(plain)).toBeCloseTo(Math.abs(anchored), 4);
  });

  it('Ancoraggio non raddrizza il mondo, solo i comandi', () => {
    const world = flipped(['riserva-di-bordo', 'ancoraggio']);
    world.step();
    expect(world.gravityInverted).toBe(true);
  });
});

describe('Custode del Reattore', () => {
  function arena(nodes: string[] = []): CampaignWorld {
    const world = new CampaignWorld(LEVEL_NUCLEO);
    world.state.unlockedNodes = nodes;
    for (const t of world.state.turrets) t.alive = false;
    const boss = world.state.boss!;
    world.state.checkpoint = { room: 'nucleo', x: boss.x - 90, y: boss.y, angle: 0 };
    world.state.player.x = boss.x - 90;
    world.state.player.y = boss.y;
    return world;
  }

  /** Fa girare il mondo finché il boss non entra nella fase chiesta. */
  function runTo(world: CampaignWorld, phase: string, maxTicks = 3000): number {
    for (let i = 0; i < maxTicks; i++) {
      world.step();
      if (world.state.boss!.phase === phase) return i;
    }
    throw new Error(`il Custode non è mai entrato in "${phase}"`);
  }

  it('alterna le due manipolazioni, con un preavviso prima di ogni finestra', () => {
    const world = arena();
    const seen: string[] = [];
    let last = world.state.boss!.phase;
    for (let i = 0; i < 4000; i++) {
      world.step();
      const now = world.state.boss!.phase;
      if (now !== last) {
        seen.push(now);
        last = now;
      }
      if (seen.length >= 6) break;
    }
    // Ogni finestra è sempre preceduta dal preavviso, e le due
    // manipolazioni si alternano: senza alternanza sarebbe un solo
    // pattern ripetuto, cioè il difetto che la Sentinella aveva.
    expect(seen.slice(0, 6)).toEqual([
      'tell',
      'exposed',
      'invert',
      'tell',
      'exposed',
      'blackout',
    ]);
  });

  it('spegne le luci mentre manipola e capovolge la stanza nell’altra fase', () => {
    const world = arena();
    expect(world.state.boss!.phase).toBe('blackout');
    expect(world.darkness).toBe(1);

    runTo(world, 'invert');
    expect(world.gravityInverted).toBe(true);
    expect(world.darkness).toBe(0);
  });

  it('si colpisce solo nella finestra, ma da qualsiasi angolo', () => {
    // Il contrario della Sentinella, che si colpisce solo da dietro e
    // solo mentre carica. Due boss che si battono allo stesso modo
    // sarebbero un boss con due skin.
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const world = arena();
      const boss = world.state.boss!;

      // Fuori dalla finestra non si scalfisce.
      world.state.player.x = boss.x + Math.cos(side) * 90;
      world.state.player.y = boss.y + Math.sin(side) * 90;
      const aim = Math.atan2(boss.y - world.state.player.y, boss.x - world.state.player.x);
      expect(
        world.step(input({ aimAngle: aim, fire: true })).some((e) => e.type === 'bossHit'),
      ).toBe(false);

      // Dentro la finestra sì, da dove si vuole.
      boss.phase = 'exposed';
      boss.phaseTimer = CUSTODE_EXPOSED_MS;
      world.state.player.weaponCooldown = 0;
      expect(
        world.step(input({ aimAngle: aim, fire: true })).some((e) => e.type === 'bossHit'),
        `angolo ${Math.round((side * 180) / Math.PI)}°`,
      ).toBe(true);
    }
  });

  it('serve il suo numero di colpi, diverso da quello della Sentinella', () => {
    const world = arena();
    const boss = world.state.boss!;
    expect(world.bossHitsToDefeat).toBe(CUSTODE_HITS_TO_DEFEAT);

    let defeated = false;
    for (let hit = 0; hit < CUSTODE_HITS_TO_DEFEAT; hit++) {
      boss.phase = 'exposed';
      boss.phaseTimer = CUSTODE_EXPOSED_MS;
      world.state.player.weaponCooldown = 0;
      const aim = Math.atan2(boss.y - world.state.player.y, boss.x - world.state.player.x);
      for (const e of world.step(input({ aimAngle: aim, fire: true }))) {
        if (e.type === 'bossDefeated') defeated = true;
      }
    }
    expect(defeated).toBe(true);
    expect(world.state.outcome).toBe('victory');
  });

  it('alterato diventa più avaro, non più veloce', () => {
    // La Sentinella alterata stringe il ritmo e apre di più. Il
    // Custode fa il contrario: la finestra si accorcia e l'attesa si
    // allunga. Due idee diverse di "seconda fase".
    const world = arena();
    const boss = world.state.boss!;

    runTo(world, 'exposed');
    const calmWindow = boss.phaseTimer;

    boss.damageTaken = CUSTODE_HITS_TO_DEFEAT - 1;
    expect(world.enraged).toBe(true);
    runTo(world, 'exposed');
    expect(boss.phaseTimer).toBeLessThan(calmWindow);
  });

  it('morire lo rimette al suo stato iniziale, non a quello della Sentinella', () => {
    const world = arena();
    const boss = world.state.boss!;
    boss.phase = 'exposed';
    boss.damageTaken = 2;

    // Una turret dell'arena riportata in vita per farsi uccidere.
    const arenaTurret = world.state.turrets.find((t) => t.id === 'arena-nord')!;
    arenaTurret.alive = true;
    const def = LEVEL_NUCLEO.turrets.find((t) => t.id === 'arena-nord')!;
    const spot = centre(def.tx, def.ty + 1);
    world.state.player.x = spot.x;
    world.state.player.y = spot.y;
    world.state.player.respawnInvulnerableMs = 0;

    let died = false;
    for (let i = 0; i < 400 && !died; i++) {
      died = world.step().some((e) => e.type === 'playerDied');
    }
    expect(died).toBe(true);
    expect(world.state.boss!.phase).toBe('blackout');
    // Non esattamente il valore pieno: la morte arriva da updateTurrets,
    // che gira prima di updateBoss, quindi il timer appena rimesso
    // perde subito un tick. Quello che conta è che sia ripartito.
    expect(world.state.boss!.phaseTimer).toBeGreaterThan(CUSTODE_MANIPULATION_MS - 50);
    expect(world.state.boss!.damageTaken).toBe(0);
  });

  it('il preavviso dura abbastanza da poterci reagire', () => {
    // Se il tell fosse più corto del tempo di ricarica dell'arma, la
    // finestra sarebbe raggiungibile solo per chi è già carico — cioè
    // sarebbe fortuna, non lettura.
    expect(CUSTODE_TELL_MS).toBeGreaterThan(400);
    expect(levelById('nucleo').boss!.kind).toBe('custode');
  });
});
