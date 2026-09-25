// ================================================================
// TRASPONDITORE — lancio, esca, richiamo
// ================================================================
// Tre bersagli, nello stesso ordine del brief che ha aperto questo
// file: quanto costa lanciare (world.ts, sezione "lancio"), cosa fa
// l'esca mentre è viva (world.ts, "vita dell'esca"), e come i nemici
// le rispondono (enemyAi.ts, "il richiamo"). L'ultimo blocco è quello
// che conta di più: è l'aritmetica che impedisce al Trasponditore di
// essere un interruttore (vedi BEACON_LIFETIME_MS in constants.ts).
// ================================================================

import { describe, expect, it } from 'vitest';

import { BULLET_COOLDOWN, TICK_MS, TILE } from '../constants';
import { angleDelta } from '../raycast';
import {
  BEACON_CHARGES_MAX,
  BEACON_CHARGES_START,
  BEACON_LIFETIME_MS,
  BEACON_LURE_TILES,
  BEACON_RANGE_TILES,
  BEACON_WALL_MARGIN,
  TURRET_REACTION_MS,
} from './constants';
import { ALL_ENEMY_KINDS, ENEMY_REAR_ARC_HALF, archetypeOf } from './enemies';
import { SHOP_ITEMS } from './constants';
import { beaconStatsFor } from './skills';
import { updateEnemyAi, type EnemyAiCtx } from './enemyAi';
import { ALL_LEVELS } from './levels';
import { campCastRay } from './raycast';
import { weaponStatsFor } from './skills';
import { attracco, centre, quiet } from './testSupport';
import { emptyCampaignInput, type CampaignInput, type EnemyState } from './types';
import { CampaignWorld } from './world';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

// ================================================================
// LANCIO — quanto costa, quando non parte
// ================================================================

describe('Trasponditore — lancio', () => {
  it('lanciare costa una carica e il tempo di un colpo', () => {
    const w = quiet(attracco());
    const p = w.state.player;
    expect(p.beaconCharges).toBe(BEACON_CHARGES_START);

    const events = w.step(input({ beacon: true, aimAngle: 0 }));

    expect(p.beaconCharges).toBe(BEACON_CHARGES_START - 1);
    expect(p.weaponCooldown).toBe(weaponStatsFor(w.state.unlockedNodes).cooldownMs);
    expect(w.state.beacon.active).toBe(true);
    expect(events.some((ev) => ev.type === 'beaconThrown')).toBe(true);
  });

  it('lancio e fuoco nello stesso tick: il lancio vince, il colpo cade sul cooldown', () => {
    // Un Guardiano in linea di tiro: se il colpo fosse partito lo
    // avremmo visto in un evento enemyHit.
    const refrigerante = ALL_LEVELS.find((lv) => lv.id === 'refrigerante')!;
    const w = new CampaignWorld(refrigerante);
    const e = w.state.enemies.find((x) => x.kind === 'guardiano')!;
    const p = w.state.player;
    p.respawnInvulnerableMs = 0;
    p.x = e.x - 2 * TILE;
    p.y = e.y;
    p.weaponCooldown = 0;

    const events = w.step(input({ beacon: true, fire: true, aimAngle: 0 }));

    expect(events.some((ev) => ev.type === 'beaconThrown')).toBe(true);
    expect(events.some((ev) => ev.type === 'enemyHit')).toBe(false);
    expect(p.beaconCharges).toBe(BEACON_CHARGES_START - 1);
  });

  it('senza cariche non succede niente', () => {
    const w = quiet(attracco());
    w.state.player.beaconCharges = 0;

    const events = w.step(input({ beacon: true, aimAngle: 0 }));

    expect(events.some((ev) => ev.type === 'beaconThrown')).toBe(false);
    expect(w.state.beacon.active).toBe(false);
    expect(w.state.player.weaponCooldown).toBe(0);
  });

  it('mentre il fucile ricarica non succede niente — due mani sole', () => {
    const w = quiet(attracco());
    const p = w.state.player;
    p.weaponCooldown = 500;
    const before = p.beaconCharges;

    const events = w.step(input({ beacon: true, aimAngle: 0 }));

    expect(events.some((ev) => ev.type === 'beaconThrown')).toBe(false);
    expect(p.beaconCharges).toBe(before);
    expect(w.state.beacon.active).toBe(false);
  });

  it("l'esca si pianta prima del muro, mai dentro", () => {
    const w = quiet(attracco());
    const p = w.state.player;
    // Dallo spawno verso ovest: il muro di confine è vicino (spawn a
    // tx=2), ben dentro la portata massima.
    const aimAngle = Math.PI;
    const wall = campCastRay(
      w.getTile,
      p.x,
      p.y,
      aimAngle,
      BEACON_RANGE_TILES * TILE,
      w.level.width,
      w.level.height,
    );
    expect(wall.dist).toBeLessThan(BEACON_RANGE_TILES * TILE);

    w.step(input({ beacon: true, aimAngle }));

    const dist = Math.hypot(w.state.beacon.x - p.x, w.state.beacon.y - p.y);
    expect(dist).toBeCloseTo(wall.dist - BEACON_WALL_MARGIN, 3);
    expect(dist).toBeLessThan(wall.dist);
  });

  it('senza un muro nel raggio si pianta alla portata piena', () => {
    const w = quiet(attracco());
    const p = w.state.player;
    // Lungo la riga di passaggio (ty=5), verso est: corridoio aperto
    // per più di sei tile.
    const aimAngle = 0;
    const wall = campCastRay(
      w.getTile,
      p.x,
      p.y,
      aimAngle,
      BEACON_RANGE_TILES * TILE,
      w.level.width,
      w.level.height,
    );
    // Nessun muro: campCastRay torna comunque dist = maxDist. È il
    // motivo per cui il margine dev'essere condizionato a `wall.hit`.
    expect(wall.hit).toBe(false);

    w.step(input({ beacon: true, aimAngle }));

    // La prima versione di questa riga si aspettava
    // `portata - BEACON_WALL_MARGIN` anche qui, perché la formula
    // sottraeva il margine sempre. Era un difetto invisibile giocando
    // e visibile solo confrontando il codice con la costante: il
    // margine esiste per non finire *dentro un muro*, e in campo
    // aperto non c'è nessun muro da cui tenersi indietro. Sei pixel
    // non cambiano una partita, ma una costante che dice sei tile e
    // ne consegna meno rende bugiarda ogni misura fatta a partire da
    // lei.
    const dist = Math.hypot(w.state.beacon.x - p.x, w.state.beacon.y - p.y);
    expect(dist).toBeCloseTo(BEACON_RANGE_TILES * TILE, 3);
  });
});

// ================================================================
// L'ARITMETICA DELLA FINESTRA
// ================================================================
// Il test più importante del file. BEACON_LIFETIME_MS non è un numero
// a sentimento: è tarato contro il cooldown del fucile, che lanciare
// consuma come un colpo. Qui si simulano i tick veri — nessuna scorciatoia
// sui millisecondi — e si conta quante volte il fucile torna pronto
// (e quindi spara, tenendo il grilletto premuto) prima che l'esca si
// spenga.
// ================================================================

describe("Trasponditore — l'aritmetica della finestra", () => {
  /** Lancia l'esca, poi tiene il grilletto premuto tick per tick finché
   *  resta viva. Conta uno "sparo" ogni volta che il cooldown torna
   *  esattamente al suo valore pieno — cioè ogni volta che fireWeapon
   *  ha davvero agito quel tick, bersaglio o meno. */
  function shotsWithinBeaconWindow(unlockedNode?: string): number {
    const w = quiet(attracco());
    if (unlockedNode) w.state.unlockedNodes.push(unlockedNode);
    const cooldownMs = weaponStatsFor(w.state.unlockedNodes).cooldownMs;

    w.step(input({ beacon: true, aimAngle: 0 }));
    expect(w.state.beacon.active).toBe(true);

    let shots = 0;
    let guard = 0;
    while (w.state.beacon.active && guard < 1000) {
      w.step(input({ fire: true, aimAngle: 0 }));
      if (w.state.player.weaponCooldown === cooldownMs) shots++;
      guard++;
    }
    return shots;
  }

  it('con il fucile base (1400 ms) entra esattamente un colpo', () => {
    expect(shotsWithinBeaconWindow()).toBe(1);
  });

  it('con Otturatore Rapido (1150 ms) ne entrano due', () => {
    expect(shotsWithinBeaconWindow('otturatore-rapido')).toBe(2);
  });
});

// ================================================================
// VITA DELL'ESCA E MORTE DEL GIOCATORE
// ================================================================

describe("Trasponditore — vita dell'esca", () => {
  it('si spegne da sola dopo BEACON_LIFETIME_MS', () => {
    const w = quiet(attracco());
    w.step(input({ beacon: true, aimAngle: 0 }));
    expect(w.state.beacon.active).toBe(true);

    let expired = false;
    const ticks = Math.ceil(BEACON_LIFETIME_MS / (1000 / 60)) + 2;
    for (let i = 0; i < ticks && !expired; i++) {
      const events = w.step(input());
      if (events.some((ev) => ev.type === 'beaconExpired')) expired = true;
    }
    expect(expired).toBe(true);
    expect(w.state.beacon.active).toBe(false);
  });

  it('la morte del giocatore la spegne subito, senza toccare le cariche', () => {
    const refrigerante = ALL_LEVELS.find((lv) => lv.id === 'refrigerante')!;
    const w = new CampaignWorld(refrigerante);
    const p = w.state.player;
    p.respawnInvulnerableMs = 0;
    p.shieldCharges = 0;
    w.state.beacon = { active: true, x: p.x + TILE, y: p.y, ms: BEACON_LIFETIME_MS };
    const chargesBefore = p.beaconCharges;

    // damagePlayer è privato: la morte si ottiene nel modo vero, un
    // Guardiano che colpisce davvero (niente scudo a fermarlo).
    const e = w.state.enemies.find((x) => x.kind === 'guardiano')!;
    e.x = p.x - 2 * TILE;
    e.y = p.y;
    e.angle = 0;

    let died = false;
    for (let i = 0; i < 400 && !died; i++) {
      died = w.step(input()).some((ev) => ev.type === 'playerDied');
    }
    expect(died).toBe(true);
    expect(w.state.beacon.active).toBe(false);
    expect(p.beaconCharges).toBe(chargesBefore);
  });
});

// ================================================================
// IL RICHIAMO — logica pura dell'IA
// ================================================================
// Come "IA dei nemici" in enemies.test.ts: si prova updateEnemyAi
// senza costruire un mondo, perché non muove né spara niente da solo.
// ================================================================

describe('IA — il richiamo del Trasponditore', () => {
  function enemy(over: Partial<EnemyState> = {}): EnemyState {
    return {
      id: 'prova',
      kind: 'guardiano',
      alive: true,
      x: 5 * TILE,
      y: 5 * TILE,
      angle: 0,
      hp: 4,
      ai: 'patrol',
      reactionTimer: 0,
      attackCooldown: 0,
      ventMs: 0,
      revealMs: 0,
      chargeMs: 0,
      chargeDirX: 0,
      chargeDirY: 0,
      postX: 5 * TILE,
      postY: 5 * TILE,
      patrolX: null,
      patrolY: null,
      goalX: null,
      goalY: null,
      patrolTimer: 0,
      lastSeenX: null,
      lastSeenY: null,
      still: true,
      closing: false,
      lured: false,
      hardened: false,
      ...over,
    };
  }

  /** Una stanza aperta: solo il bordo è muro. Il giocatore parte fuori
   *  portata e fuori vista apposta — se un nemico si volta, deve
   *  essere per l'esca, non per lui. */
  const openCtx = (over: Partial<EnemyAiCtx> = {}): EnemyAiCtx => ({
    getTile: (tx, ty) => (tx <= 0 || ty <= 0 || tx >= 20 || ty >= 20 ? 1 : 0),
    mapW: 20,
    mapH: 20,
    playerX: 18 * TILE,
    playerY: 18 * TILE,
    playerTargetable: true,
    lure: null,
    leash: null,
    dtMs: 16.666,
    ...over,
  });

  it('entro il raggio e in linea di vista, un Guardiano si volta verso l’esca', () => {
    // Guarda a sinistra; l'esca sta a destra, entro BEACON_LURE_TILES.
    let e = enemy({ angle: Math.PI });
    const ctx = openCtx({ lure: { x: e.x + 3 * TILE, y: e.y } });

    const first = updateEnemyAi(e, ctx);
    expect(first.lured).toBe(true);

    // Ci mette qualche tick a girarsi (ENEMY_TURN_RATE), ma converge.
    let last = first;
    for (let i = 0; i < 100; i++) {
      e = { ...e, angle: last.angle };
      last = updateEnemyAi(e, ctx);
    }
    expect(last.lured).toBe(true);
    expect(Math.abs(angleDelta(last.angle, 0))).toBeLessThan(0.05);
  });

  it('il richiamo vince anche su un nemico già impegnato col giocatore', () => {
    const e = enemy({ angle: 0 });
    // Prima ingaggia il giocatore, in vista e a tiro.
    const engaging = openCtx({ playerX: 9 * TILE, playerY: 5 * TILE });
    updateEnemyAi(e, engaging);
    expect(e.ai).toBe('engage');
    expect(e.lured).toBe(false);

    // Poi arriva l'esca, più vicina: il bersaglio cambia comunque.
    const withLure = openCtx({
      playerX: 9 * TILE,
      playerY: 5 * TILE,
      lure: { x: e.x, y: e.y + 3 * TILE },
    });
    const intent = updateEnemyAi(e, withLure);
    expect(intent.lured).toBe(true);
  });

  it('oltre BEACON_LURE_TILES non si volta', () => {
    const e = enemy({ angle: Math.PI });
    const far = (BEACON_LURE_TILES + 2) * TILE;
    const ctx = openCtx({ lure: { x: e.x + far, y: e.y } });

    const intent = updateEnemyAi(e, ctx);

    expect(intent.lured).toBe(false);
    expect(e.ai).toBe('patrol');
  });

  it('senza linea di vista verso l’esca non si volta', () => {
    const e = enemy({ angle: 0, x: 5 * TILE, y: 5 * TILE });
    // Un muro fra il nemico e l'esca, ma entro il raggio.
    const blocked = openCtx({
      getTile: (tx, ty) => (tx === 8 ? 1 : tx <= 0 || ty <= 0 || tx >= 20 || ty >= 20 ? 1 : 0),
      lure: { x: 12 * TILE, y: 5 * TILE },
    });

    const intent = updateEnemyAi(e, blocked);

    expect(intent.lured).toBe(false);
  });

  it('la carica del Martello in corso non ricalcola il richiamo', () => {
    const a = archetypeOf('martello');
    const e = enemy({
      kind: 'martello',
      hp: a.hp,
      angle: 0,
      chargeMs: 400,
      chargeDirX: 1,
      chargeDirY: 0,
      lured: true,
    });
    // L'esca è altrove, ma la carica è già partita: deve restare
    // dritta e riferire il `lured` con cui era partita, non quello
    // ricalcolato adesso.
    const ctx = openCtx({ lure: null });
    const intent = updateEnemyAi(e, ctx);
    expect(intent.moveX).toBe(1);
    expect(intent.moveY).toBe(0);
    expect(intent.lured).toBe(true);
  });
});

// ================================================================
// IL RICHIAMO NEL MONDO — danno sospeso, sfiato aperto comunque
// ================================================================

describe('Trasponditore — il richiamo nel mondo', () => {
  it('un nemico richiamato che attacca non uccide il giocatore, ma apre comunque lo sfiato', () => {
    const w = attracco();
    // La Vedetta del magazzino: si pianta per sparare (vulnerabilità
    // immobile), quindi niente sbandamento laterale a disturbare la
    // mira mentre aspettiamo la reazione.
    const e = w.state.enemies.find((x) => x.id === 'vedetta-magazzino')!;
    const p = w.state.player;
    p.respawnInvulnerableMs = 0;
    p.shieldCharges = 0;
    // Fuori portata e fuori vista: se la Vedetta attacca, è l'esca il
    // motivo, non lui.
    p.x = e.x + 60 * TILE;
    p.y = e.y + 60 * TILE;
    // L'esca, in linea con l'angolo di partenza della Vedetta (guarda
    // a sinistra, facing = PI), a due tile — dentro la sua stessa
    // stanza, corsia aperta.
    w.state.beacon = { active: true, x: e.x - 2 * TILE, y: e.y, ms: BEACON_LIFETIME_MS };

    let attacked = false;
    let died = false;
    for (let i = 0; i < 300 && !attacked; i++) {
      const events = w.step(input());
      if (events.some((ev) => ev.type === 'enemyAttack')) attacked = true;
      if (events.some((ev) => ev.type === 'playerDied')) died = true;
    }

    expect(e.lured).toBe(true);
    expect(attacked).toBe(true);
    expect(died).toBe(false);
    expect(e.ventMs).toBeGreaterThan(0);
  });
});

// ================================================================
// SCATTO ANGOLARE
// ================================================================

describe('Scatto Angolare', () => {
  function startDash(w: CampaignWorld, aimAngle: number): void {
    w.state.unlockedNodes.push('scatto');
    w.step(input({ dash: true, aimAngle }));
  }

  it('con il nodo la direzione dello scatto cambia sotto input', () => {
    const w = quiet(attracco());
    // Riga di passaggio (ty=5): aperta per tutta la lunghezza.
    w.state.player.x = 10 * TILE;
    w.state.player.y = 5 * TILE;
    startDash(w, 0);
    w.state.unlockedNodes.push('scatto-angolare');
    const before = Math.atan2(w.state.player.dashDirY, w.state.player.dashDirX);

    w.step(input({ aimAngle: Math.PI / 2, forward: 1 }));

    const after = Math.atan2(w.state.player.dashDirY, w.state.player.dashDirX);
    expect(after).not.toBeCloseTo(before, 3);
  });

  it('senza il nodo lo scatto resta la linea retta di sempre', () => {
    const w = quiet(attracco());
    w.state.player.x = 10 * TILE;
    w.state.player.y = 5 * TILE;
    startDash(w, 0);
    const before = { x: w.state.player.dashDirX, y: w.state.player.dashDirY };

    w.step(input({ aimAngle: Math.PI / 2, forward: 1 }));

    expect(w.state.player.dashDirX).toBeCloseTo(before.x, 6);
    expect(w.state.player.dashDirY).toBeCloseTo(before.y, 6);
  });
});

// ================================================================
// PIASTRA REATTIVA
// ================================================================

describe('Piastra Reattiva', () => {
  function setupDroneFire(w: CampaignWorld): void {
    // Stessa posizione usata in campaign.test.ts per il drone del
    // magazzino dell'Attracco: in linea di vista, a distanza di tiro.
    w.state.checkpoint = { room: 'magazzino', x: 13.5 * TILE, y: 7 * TILE, angle: -Math.PI / 2 };
    w.state.player.x = 13.5 * TILE;
    w.state.player.y = 7 * TILE;
    w.state.player.shieldCharges = 1;
  }

  const ticksToFire = Math.ceil(TURRET_REACTION_MS / (1000 / 60)) + 2;

  it('assorbire un colpo azzera il cooldown col nodo', () => {
    const w = quiet(attracco());
    setupDroneFire(w);
    w.state.unlockedNodes.push('piastra-aggiuntiva', 'piastra-reattiva');
    w.state.player.weaponCooldown = 900;

    let sawReactive = false;
    let sawBreak = false;
    for (let i = 0; i < ticksToFire; i++) {
      const events = w.step();
      if (events.some((ev) => ev.type === 'shieldReactive')) sawReactive = true;
      if (events.some((ev) => ev.type === 'shieldBreak')) sawBreak = true;
    }

    expect(sawBreak).toBe(true);
    expect(sawReactive).toBe(true);
    expect(w.state.player.weaponCooldown).toBe(0);
  });

  it('senza il nodo lo scudo assorbe ma non restituisce il colpo', () => {
    const w = quiet(attracco());
    setupDroneFire(w);
    w.state.player.weaponCooldown = 900;

    let sawReactive = false;
    let sawBreak = false;
    for (let i = 0; i < ticksToFire; i++) {
      const events = w.step();
      if (events.some((ev) => ev.type === 'shieldReactive')) sawReactive = true;
      if (events.some((ev) => ev.type === 'shieldBreak')) sawBreak = true;
    }

    expect(sawBreak).toBe(true);
    expect(sawReactive).toBe(false);
    expect(w.state.player.weaponCooldown).toBeGreaterThan(0);
  });
});

// ================================================================
// ECO
// ================================================================

describe('Eco', () => {
  it("l'Araldo occultato viene svelato solo col nodo", () => {
    const nido = ALL_LEVELS.find((lv) => lv.id === 'nido')!;

    function revealAfterOneTick(withNode: boolean): number {
      const w = new CampaignWorld(nido);
      const e = w.state.enemies.find((x) => x.kind === 'araldo')!;
      if (withNode) w.state.unlockedNodes.push('sensori-inerziali', 'eco');
      w.state.beacon = { active: true, x: e.x + TILE, y: e.y, ms: BEACON_LIFETIME_MS };
      w.step(input());
      return e.revealMs;
    }

    expect(revealAfterOneTick(true)).toBeGreaterThan(0);
    expect(revealAfterOneTick(false)).toBe(0);
  });
});

// ================================================================
// RACCOGLIBILI
// ================================================================

describe('Trasponditore — raccoglibile', () => {
  const condottiLevel = ALL_LEVELS.find((lv) => lv.id === 'condotti')!;

  it('raccoglierlo aggiunge una carica quando non si è al tetto', () => {
    const w = new CampaignWorld(condottiLevel);
    w.state.player.beaconCharges = 1;
    const def = condottiLevel.beacons[0]!;
    const { x, y } = centre(def.tx, def.ty);
    w.state.player.x = x;
    w.state.player.y = y;

    const events = w.step(input());

    expect(events.some((ev) => ev.type === 'beaconPickup')).toBe(true);
    expect(w.state.player.beaconCharges).toBe(2);
  });

  it('non supera BEACON_CHARGES_MAX', () => {
    const w = new CampaignWorld(condottiLevel);
    w.state.player.beaconCharges = BEACON_CHARGES_MAX;
    const def = condottiLevel.beacons[0]!;
    const { x, y } = centre(def.tx, def.ty);
    w.state.player.x = x;
    w.state.player.y = y;

    const events = w.step(input());

    expect(events.some((ev) => ev.type === 'beaconPickup')).toBe(true);
    expect(w.state.player.beaconCharges).toBe(BEACON_CHARGES_MAX);
  });
});

// ================================================================
// IL SOFFITTO — l'esca apre, non spegne
// ================================================================
// L'aritmetica in cima al file dice quanti colpi stanno nella
// *finestra dell'esca*. Questo blocco misura una cosa più stretta e
// più vera: quanti ne stanno nell'ARCO POSTERIORE, che è il solo
// punto in cui il colpo vale tre volte.
//
// Le due cose divergono per via di ENEMY_TURN_RATE. Un nemico può
// restare richiamato per tutti i 2600 ms e mostrarmi la schiena per
// molti meno: girarsi costa tempo, e chi cammina verso l'esca si
// porta dietro il rilevamento mentre si sposta.
//
// L'invariante da tenere è un soffitto, non un valore: nessun
// archetipo deve arrivare a contenere DUE ricariche intere nel suo
// arco posteriore. Il giorno in cui ci arrivasse, un'esca da sola
// basterebbe a chiudere un nemico — e il Trasponditore avrebbe
// smesso di essere un'apertura per diventare un interruttore, che è
// esattamente ciò che BEACON_LIFETIME_MS esiste per impedire.
//
// Un soffitto e non un'uguaglianza di proposito: le cifre esatte le
// stampa `balance:campaign`, che le ricalcola. Un test che le
// fissasse diventerebbe rosso a ogni ritocco di taratura senza che
// niente si sia rotto davvero.

/** Un nemico appena nato, fermo al suo posto e girato verso il
 *  giocatore: il caso peggiore per chi lancia, perché parte da zero
 *  gradi di rotazione da guadagnare. */
function freshEnemy(kind: EnemyState['kind'], x: number, y: number): EnemyState {
  const a = archetypeOf(kind);
  return {
    id: 'soffitto',
    kind,
    alive: true,
    x,
    y,
    angle: Math.PI,
    hp: a.hp,
    ai: 'patrol',
    reactionTimer: a.reactionMs,
    attackCooldown: 0,
    ventMs: 0,
    revealMs: 0,
    chargeMs: 0,
    chargeDirX: 0,
    chargeDirY: 0,
    postX: x,
    postY: y,
    patrolX: null,
    patrolY: null,
    goalX: null,
    goalY: null,
    patrolTimer: 0,
    lastSeenX: null,
    lastSeenY: null,
    still: false,
    closing: false,
    lured: false,
    hardened: false,
  } as EnemyState;
}

/** Millisecondi in cui il giocatore sta nell'arco posteriore, con
 *  l'esca lanciata a `thetaDeg` dalla congiungente. Stanza aperta: la
 *  geometria di un livello cambierebbe il numero senza dire niente
 *  sull'arma. */
function rearArcMs(
  kind: EnemyState['kind'],
  thetaDeg: number,
  enemyTiles = 4,
  purchased: readonly string[] = [],
): number {
  // La geometria dell'esca non è più una costante: il Banco la cambia
  // (Eco Ampio allarga il richiamo e accorcia la vita, Doppio Innesco
  // accorcia la gittata). Chiederla a beaconStatsFor invece di leggere
  // le costanti è ciò che rende questo soffitto vero anche per chi ha
  // comprato — e misurarlo con la geometria base sarebbe stata una
  // garanzia che il gioco vero non rispetta.
  const beacon = beaconStatsFor([], purchased);
  const px = 0;
  const py = 0;
  const e = freshEnemy(kind, px + enemyTiles * TILE, py);
  const th = (thetaDeg * Math.PI) / 180;
  const lure = {
    x: px + Math.cos(th) * beacon.rangeTiles * TILE,
    y: py + Math.sin(th) * beacon.rangeTiles * TILE,
    tiles: beacon.lureTiles,
  };
  // Un'esca caduta oltre il raggio di richiamo non aggancia: non è
  // una finestra corta, è nessuna finestra.
  if (Math.hypot(lure.x - e.x, lure.y - e.y) > beacon.lureTiles * TILE) return 0;

  const ctx: EnemyAiCtx = {
    getTile: () => 0,
    mapW: 64,
    mapH: 64,
    playerX: px,
    playerY: py,
    playerTargetable: true,
    lure,
    leash: null,
    dtMs: TICK_MS,
  };
  let ticks = 0;
  for (let t = 0; t < Math.round(beacon.lifetimeMs / TICK_MS); t++) {
    const intent = updateEnemyAi(e, ctx);
    e.angle = intent.angle;
    e.lured = intent.lured;
    e.x += intent.moveX * intent.speed;
    e.y += intent.moveY * intent.speed;
    // La stessa disuguaglianza di resolveEnemyHit, non una parafrasi.
    const off = Math.abs(angleDelta(Math.atan2(py - e.y, px - e.x), e.angle));
    if (Math.PI - off <= ENEMY_REAR_ARC_HALF) ticks++;
  }
  return ticks * TICK_MS;
}

/** La finestra migliore di un archetipo su tutti gli angoli di lancio
 *  praticabili — cioè il meglio che un giocatore perfetto può fare. */
function bestRearArcMs(kind: EnemyState['kind']): number {
  // Si spazzolano anche le distanze, non solo gli angoli: misurando a
  // quattro tile soltanto, il Martello dava 1383 ms e il Guardiano
  // 283. Allargando a tre e cinque salgono a 1567 e 450 — cioè il
  // soffitto stava guardando una finestra più corta di quella vera.
  // Si spazzolano anche le combinazioni di innesti che toccano l'esca,
  // ricavate interrogando beaconStatsFor invece di elencarle: il
  // giorno in cui il Banco ne offre un altro che cambia la geometria,
  // questo soffitto lo misura da solo.
  let best = 0;
  for (const purchased of beaconVariants()) {
    for (let theta = 0; theta <= 60; theta += 5) {
      for (const tiles of [3, 4, 5]) {
        const ms = rearArcMs(kind, theta, tiles, purchased);
        if (ms > best) best = ms;
      }
    }
  }
  return best;
}

/** Tutte le combinazioni di innesti che cambiano davvero l'esca, più
 *  quella vuota. Gli altri innesti non toccano beaconStatsFor, quindi
 *  moltiplicarli qui raddoppierebbe il lavoro senza cambiare un
 *  numero. */
function beaconVariants(): readonly (readonly string[])[] {
  const base = beaconStatsFor([], []);
  const rilevanti = SHOP_ITEMS.map((i) => i.id).filter((id) => {
    const s = beaconStatsFor([], [id]);
    return (
      s.rangeTiles !== base.rangeTiles ||
      s.lureTiles !== base.lureTiles ||
      s.lifetimeMs !== base.lifetimeMs
    );
  });
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << rilevanti.length; mask++) {
    const set: string[] = [];
    for (let i = 0; i < rilevanti.length; i++) if (mask & (1 << i)) set.push(rilevanti[i]!);
    out.push(set);
  }
  return out;
}

/** La ricarica più corta che un giocatore possa davvero avere: quella
 *  del nodo Otturatore Rapido, più tutti i delta negativi che il Banco
 *  sa applicare. È questa e non BULLET_COOLDOWN a decidere il
 *  soffitto — un'arma più rapida fa stare più colpi nella stessa
 *  finestra, quindi misurare sulla costante base darebbe una garanzia
 *  che il gioco vero non rispetta.
 *
 *  Calcolata invece che scritta: il giorno in cui si aggiunge un
 *  innesto che accorcia la ricarica, questo numero scende da solo e il
 *  soffitto si stringe senza che nessuno se ne debba ricordare. */
function ricaricaMinima(): number {
  const tuttiGliInnesti = SHOP_ITEMS.map((i) => i.id);
  let min = weaponStatsFor(['otturatore-rapido']).cooldownMs;
  // Ogni sottoinsieme sarebbe 2^n; basta provare ciascun innesto da
  // solo e poi tutti insieme, perché i delta sulla ricarica si sommano
  // (vedi weaponStatsFor) e il minimo sta in uno dei due estremi.
  for (const id of tuttiGliInnesti) {
    const cd = weaponStatsFor(['otturatore-rapido'], [id]).cooldownMs;
    if (cd < min) min = cd;
  }
  const soloNegativi = tuttiGliInnesti.filter(
    (id) => weaponStatsFor([], [id]).cooldownMs < weaponStatsFor([]).cooldownMs,
  );
  const tuttoInsieme = weaponStatsFor(['otturatore-rapido'], soloNegativi).cooldownMs;
  return Math.min(min, tuttoInsieme);
}

describe("Trasponditore — il soffitto dell'arco posteriore", () => {
  const REAR_KINDS = ALL_ENEMY_KINDS.filter((k) => archetypeOf(k).weakSpot === 'rear');

  it('riguarda solo gli archetipi col punto debole dietro', () => {
    // Se un giorno fossero tutti, il blocco qui sotto misurerebbe
    // dieci volte la stessa cosa e questo test lo direbbe.
    expect(REAR_KINDS.length).toBeGreaterThan(0);
    expect(REAR_KINDS.length).toBeLessThan(ALL_ENEMY_KINDS.length);
  });

  it.each(ALL_ENEMY_KINDS.filter((k) => archetypeOf(k).weakSpot === 'rear'))(
    "%s: l'arco posteriore non contiene due ricariche intere",
    (kind) => {
      const best = bestRearArcMs(kind);
      expect(best).toBeLessThan(ricaricaMinima() * 2);
    },
  );

  it("almeno un archetipo ha una finestra usabile: altrimenti l'arma non apre niente", () => {
    // Il gemello del soffitto. Senza questo, azzerare BEACON_LURE_TILES
    // renderebbe verdi tutti i test qui sopra.
    const usable = REAR_KINDS.filter((k) => bestRearArcMs(k) >= BULLET_COOLDOWN);
    expect(usable.length).toBeGreaterThan(0);
  });
});
