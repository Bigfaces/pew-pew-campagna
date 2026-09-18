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
import { BOSS_CHARGE_MS, RESPAWN_GRACE_MS, TURRET_REACTION_MS } from './constants';
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


// --------------------------------------------------------------------
// Checkpoint: mai dentro una linea di tiro
// --------------------------------------------------------------------
// Queste due prove nascono dalla prima partita giocata da qualcuno che
// non aveva scritto il gioco. Il suo verdetto è stato "non giocabile", e
// aveva ragione con un margine che nessun test copriva: il checkpoint si
// prendeva nell'istante in cui si varcava la soglia di una stanza, cioè
// nel punto da cui la stanza ti vede per primo. Nel MAGAZZINO
// dell'ATTRACCO quella soglia sta nel tiro di un drone che reagisce in
// 500 ms e non ha cono visivo: si rinasceva, si restava intoccabili per
// la grazia, e si moriva nel tick esatto in cui finiva. Sempre.
//
// La conseguenza non era "difficile". Con 0,82 s di vita e
// BULLET_COOLDOWN a 1400 ms si sparava **un colpo per vita**, e il
// respawn ricurava i nemici della stanza: un Ronzino da due punti vita
// diventava immortale. Misurato prima della correzione, con un bot a
// mira perfetta: 49 morti in 40 secondi e zero progressi.

describe('CampaignWorld — un checkpoint è un posto sicuro', () => {
  it('non si prende nella linea di tiro di una torretta, e si prende appena la torretta tace', () => {
    const world = quiet(attracco());
    const drone = turretOf(world, 'drone-otto-quattro');

    // Sulla soglia del magazzino, scoperti davanti al drone.
    world.state.player.x = 12.5 * TILE;
    world.state.player.y = 3.5 * TILE;
    world.step();
    expect(world.state.checkpoint.room).not.toBe('magazzino');
    // Ma esserci arrivati resta vero: è ciò che paga l'XP di stanza e
    // sveglia i boss, e non dipende dal poterci rinascere.
    expect(world.state.reachedRoom).toBe('magazzino');

    // Spento il drone, lo stesso metro quadro diventa buono.
    drone.state.alive = false;
    world.step();
    expect(world.state.checkpoint.room).toBe('magazzino');
  });

  it('rinascere non rimette dentro la morte da cui si viene', () => {
    const world = attracco();
    const vite: number[] = [];
    let ultima = 0;

    // Un giocatore che non ha ancora capito niente: avanza e basta.
    for (let t = 0; t < 30_000 / TICK_MS; t++) {
      const morto = world
        .step({ ...emptyCampaignInput(), forward: 1, aimAngle: 0 })
        .some((e) => e.type === 'playerDied');
      if (morto) {
        vite.push((t - ultima) * TICK_MS);
        ultima = t;
      }
    }

    // Il livello deve ancora uccidere chi cammina a testa bassa: se
    // smettesse, questa prova starebbe misurando un gioco disinnescato.
    expect(vite.length).toBeGreaterThan(1);

    // E nessuna vita può finire nell'istante in cui la grazia scade.
    // Il margine è piccolo apposta: col difetto la morte arrivava *un
    // tick* dopo la fine dell'invulnerabilità, perché il drone aveva
    // già finito di prendere la mira mentre il giocatore era
    // intoccabile. Alzare la grazia da sola avrebbe spostato l'ora
    // della morte di un tick e nient'altro — ed è esattamente ciò che
    // questa soglia rifiuta di accettare come correzione.
    const piuBreve = Math.min(...vite.slice(1));
    expect(piuBreve, `vite in secondi: ${vite.map((v) => (v / 1000).toFixed(2)).join(' ')}`)
      .toBeGreaterThan(RESPAWN_GRACE_MS.tutorial + 300);
  });

  it('una morte riapre la paratia anche se il checkpoint e rimasto indietro', () => {
    // Questo difetto l'ha creato la correzione qui sopra, ed e' il
    // motivo per cui la prova esiste.
    //
    // Il reset dopo una morte valeva per "la stanza del checkpoint".
    // Finche' il checkpoint si prendeva sulla soglia di ogni stanza
    // quella frase diceva anche "il tratto che rigiochero'". Da quando
    // pretende un posto sicuro puo' restare due stanze indietro, e il
    // tratto in mezzo smetteva di essere toccato da qualsiasi reset.
    //
    // Sull'ATTRACCO: la paratia del CORRIDOIO si chiude alle spalle del
    // giocatore, il checkpoint e' rimasto nell'ATTRACCO, e la porta non
    // rientrava piu' in niente. Restava sigillata per sempre su tre tile
    // che sono l'intero passaggio — misurato, dodici morti di fila senza
    // mai superare la colonna 9. Un vicolo cieco nuovo al posto di
    // quello vecchio.
    const world = attracco();
    const porta = () => world.state.doors[0]!;
    let morti = 0;
    let sigillataDopoUnaMorte = 0;

    for (let t = 0; t < 40_000 / TICK_MS; t++) {
      const morto = world
        .step({ ...emptyCampaignInput(), forward: 1, aimAngle: 0 })
        .some((e) => e.type === 'playerDied');
      if (!morto) continue;
      morti++;
      // Il caso che conta e' proprio questo: checkpoint indietro
      // rispetto alla stanza della porta.
      if (world.state.checkpoint.room !== 'corridoio' && porta().closed) sigillataDopoUnaMorte++;
    }

    // La premessa: il bot deve davvero morire, e il checkpoint deve
    // davvero restare indietro, o la prova non starebbe guardando niente.
    expect(morti).toBeGreaterThan(2);
    expect(world.state.checkpoint.room).not.toBe('corridoio');
    expect(sigillataDopoUnaMorte, 'la paratia e rimasta chiusa dopo una morte').toBe(0);
  });

  it('chi sa mirare gioca il livello invece di subirlo', () => {
    // La prova che il difetto rendeva impossibile superare. Non è una
    // questione di bravura: col checkpoint nel tiro del drone, un bot a
    // mira perfetta moriva 49 volte in 40 secondi e riusciva a premere
    // il grilletto **una volta per vita**, contro nemici da due punti
    // vita che il respawn ricurava ogni volta. Nessuna abilità poteva
    // uscirne, ed è la differenza fra severo e bloccato.
    const world = attracco();
    const p = world.state.player;
    let morti = 0;
    let colpi = 0;

    for (let t = 0; t < 30_000 / TICK_MS; t++) {
      const input = { ...emptyCampaignInput(), aimAngle: 0, ads: true };
      let vicino: { x: number; y: number } | null = null;
      let minima = Infinity;
      for (const e of world.state.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < minima) {
          minima = d;
          vicino = e;
        }
      }
      if (vicino) input.aimAngle = Math.atan2(vicino.y - p.y, vicino.x - p.x);
      else input.forward = 1;
      input.fire = p.weaponCooldown <= 0;
      if (input.fire) colpi++;
      if (world.step(input).some((e) => e.type === 'playerDied')) morti++;
    }

    // La soglia è larga di proposito: serve a separare "il gioco si
    // gioca" da "il gioco è un tornello", non a fissare un
    // bilanciamento. La misura del difetto (49 morti in 40 s, un colpo
    // per vita) è stata presa fuori da qui, guidando il mondo a mano;
    // la guardia che *cattura* quel difetto è la prova qui sopra sulla
    // linea di tiro, non questa, che resta un'invariante di comodo.
    expect(morti, `morti: ${morti}, colpi: ${colpi}`).toBeLessThan(8);
    // E i colpi devono essere molti più delle vite: un colpo per vita
    // era la forma esatta del vicolo cieco.
    expect(colpi).toBeGreaterThan(morti * 2 + 1);
  });
});

describe('CampaignWorld — checkpoint mai regressivo', () => {
  it('non torna a una stanza precedente se il giocatore ci rientra', () => {
    // `quiet` toglie di mezzo i nemici perché qui si misura *solo* la
    // direzione del checkpoint. Da quando il checkpoint pretende un
    // posto sicuro (vedi CampaignWorld.updateCheckpoint) un Ronzino a
    // metà corridoio basta a impedirne l'avanzamento, e il test
    // fallirebbe per una ragione che non è la sua.
    const world = quiet(attracco());

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
