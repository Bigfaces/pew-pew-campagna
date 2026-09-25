// ================================================================
// NEMICI — listino, piazzamenti, modello dei danni, IA
// ================================================================
// Quattro famiglie, e la prima è la più importante perché è quella
// che non posso verificare giocando.
//
//   1. **I piazzamenti.** Un nemico dichiarato su un tile murato, o
//      in una stanza che non lo contiene, non si vede leggendo: si
//      vede quando resta immobile dentro un muro per tutta la
//      partita. Stessa ragione per cui le mappe hanno un test
//      strutturale (levels.test.ts).
//   2. **Il tetto di tre tipi per livello.** È una decisione di
//      design, quindi va scritta dove si rompe da sola invece che in
//      un commento che nessuno rilegge.
//   3. **Il modello dei danni**, cioè che i due assi moltiplichino
//      davvero e che l'immunità del Guardiano sia un'immunità.
//   4. **L'IA**, provata senza un mondo: è possibile solo perché
//      updateEnemyAi restituisce un'intenzione invece di muovere.
// ================================================================

import { describe, expect, it } from 'vitest';

import { EYE_HEIGHT } from '../../render/camera';
import { TILE } from '../constants';
import { ENEMY_SPAWN_CLEARANCE_TILES, LEVEL_START_GRACE_MS, PLAYER_EYE_Z } from './constants';
import {
  ALL_ENEMY_KINDS,
  ENEMY_ARCHETYPES,
  HARDENED_MULT,
  VULNERABILITY_MULT,
  WEAK_SPOT_MULT,
  archetypeOf,
} from './enemies';
import { updateEnemyAi, type EnemyAiCtx } from './enemyAi';
import { ACTS, ALL_LEVELS } from './levels';
import { roomAt, tileAt } from './levelTypes';
import { campHasLOS } from './raycast';
import { markRoomReached } from './testSupport';
import { emptyCampaignInput, type CampaignInput, type EnemyState } from './types';
import { CampaignWorld, resolveEnemyHit, type EnemyShot } from './world';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

describe('nemici — piazzamenti', () => {
  for (const level of ALL_LEVELS) {
    describe(level.id, () => {
      it('ogni nemico sta su un tile calpestabile', () => {
        for (const e of level.enemies) {
          expect(
            tileAt(level, e.tx, e.ty),
            `${e.id} su un tile murato (${e.tx},${e.ty})`,
          ).toBe(0);
        }
      });

      it('ogni nemico sta nella stanza che dichiara', () => {
        // Se divergessero, il guinzaglio sarebbe attorno a una stanza
        // in cui il nemico non è: passerebbe la partita a "rientrare"
        // in un posto da cui non è mai uscito.
        for (const e of level.enemies) {
          expect(roomAt(level, e.tx, e.ty), `${e.id}`).toBe(e.room);
        }
      });

      it('ogni punto di pattuglia è calpestabile e nella stessa stanza', () => {
        for (const e of level.enemies) {
          if (!e.patrol) continue;
          expect(tileAt(level, e.patrol.tx, e.patrol.ty), `${e.id}`).toBe(0);
          expect(roomAt(level, e.patrol.tx, e.patrol.ty), `${e.id}`).toBe(e.room);
        }
      });

      it('gli id sono unici', () => {
        const ids = level.enemies.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('nessuno parte addosso allo spawn', () => {
        // La prima stesura di questa regola chiedeva "nessun nemico
        // nella stanza di partenza", e la seconda "nessuna linea di
        // tiro sullo spawn". Erano sbagliate tutt'e due: le stanze di
        // partenza sono rettangoli aperti, quindi *ogni* punto vede
        // lo spawn, e la regola avrebbe svuotato la stanza da cui si
        // entra — che è proprio dove un nemico in fondo apre bene un
        // livello.
        //
        // Quello che serve davvero sono due cose separate: un po' di
        // spazio (qui) e un momento per accorgersene
        // (LEVEL_START_GRACE_MS, provato sotto).
        const sx = (level.spawn.tx + 0.5) * TILE;
        const sy = (level.spawn.ty + 0.5) * TILE;
        for (const e of level.enemies) {
          const d = Math.hypot((e.tx + 0.5) * TILE - sx, (e.ty + 0.5) * TILE - sy) / TILE;
          expect(d, `${e.id} a ${d.toFixed(1)} tile dallo spawn`).toBeGreaterThanOrEqual(
            ENEMY_SPAWN_CLEARANCE_TILES,
          );
        }
      });

      it('al massimo tre tipi diversi', () => {
        const kinds = new Set(level.enemies.map((e) => e.kind));
        expect([...kinds].join(','), `${kinds.size} tipi`).toBeTruthy();
        expect(kinds.size).toBeLessThanOrEqual(3);
      });

      it('nessun archetipo di fascia superiore al suo atto', () => {
        for (const e of level.enemies) {
          expect(archetypeOf(e.kind).tier, `${e.id}`).toBeLessThanOrEqual(level.act);
        }
      });
    });
  }

  it('ogni atto introduce almeno un archetipo della propria fascia', () => {
    for (const act of ACTS) {
      const tiers = act.flatMap((lv) => lv.enemies.map((e) => archetypeOf(e.kind).tier));
      expect(Math.max(...tiers)).toBe(act[0]!.act);
    }
  });

  it('tutti e dieci gli archetipi compaiono da qualche parte', () => {
    // Un archetipo scritto e mai piazzato è codice morto travestito
    // da contenuto.
    const used = new Set(ALL_LEVELS.flatMap((lv) => lv.enemies.map((e) => e.kind)));
    for (const k of ALL_ENEMY_KINDS) {
      expect(used.has(k), `${k} non compare in nessun livello`).toBe(true);
    }
  });
});

describe('nemici — modello dei danni', () => {
  /** Un nemico di comodo, fermo, guardando a destra. */
  function target(over: Partial<EnemyState> = {}): EnemyState {
    return {
      id: 'bersaglio',
      kind: 'vedetta',
      alive: true,
      x: 10 * TILE,
      y: 10 * TILE,
      angle: 0,
      hp: 2,
      ai: 'patrol',
      reactionTimer: 0,
      attackCooldown: 0,
      ventMs: 0,
      revealMs: 0,
      chargeMs: 0,
      chargeDirX: 0,
      chargeDirY: 0,
      postX: null,
      postY: null,
      patrolX: null,
      patrolY: null,
      goalX: null,
      goalY: null,
      patrolTimer: 0,
      lastSeenX: null,
      lastSeenY: null,
      still: false,
      closing: false,
      hardened: false,
      ...over,
    };
  }

  /** Un colpo da davanti, ad altezza d'occhio, a due tile. */
  function shot(e: EnemyState, over: Partial<EnemyShot> = {}): EnemyShot {
    return {
      shooterX: e.x + 2 * TILE,
      shooterY: e.y,
      aimZ: PLAYER_EYE_Z,
      dist: 2 * TILE,
      ads: false,
      ...over,
    };
  }

  it('un colpo qualunque vale uno', () => {
    const e = target();
    const r = resolveEnemyHit(e, shot(e));
    expect(r.damage).toBe(1);
    expect(r.weakSpot).toBeNull();
    expect(r.vulnerability).toBeNull();
  });

  it('il dorso della Vedetta vale il triplo', () => {
    const e = target({ angle: 0 });
    // Il tiratore arriva da sinistra, la Vedetta guarda a destra.
    const r = resolveEnemyHit(e, shot(e, { shooterX: e.x - 2 * TILE }));
    expect(r.weakSpot).toBe('rear');
    expect(r.damage).toBe(WEAK_SPOT_MULT);
  });

  it('dorso più finestra moltiplicano fra loro', () => {
    // La Vedetta è vulnerabile da ferma, ed è ferma perché si sta
    // piantando per sparare: il tell e la ricompensa coincidono.
    const e = target({ angle: 0, still: true });
    const r = resolveEnemyHit(e, shot(e, { shooterX: e.x - 2 * TILE }));
    expect(r.vulnerability).toBe('immobile');
    expect(r.damage).toBe(WEAK_SPOT_MULT * VULNERABILITY_MULT);
  });

  it("l'ottica conta solo per chi è vulnerabile all'ottica", () => {
    const falco = target({ kind: 'falco' });
    expect(resolveEnemyHit(falco, shot(falco, { ads: true })).vulnerability).toBe('mirato');
    const vedetta = target({ kind: 'vedetta' });
    expect(resolveEnemyHit(vedetta, shot(vedetta, { ads: true })).vulnerability).toBeNull();
  });

  it('corto e lungo raggio sono opposti e non si sovrappongono', () => {
    const ronzino = target({ kind: 'ronzino' });
    expect(resolveEnemyHit(ronzino, shot(ronzino, { dist: 2 * TILE })).vulnerability).toBe(
      'ravvicinato',
    );
    expect(resolveEnemyHit(ronzino, shot(ronzino, { dist: 8 * TILE })).vulnerability).toBeNull();

    const crogiolo = target({ kind: 'crogiolo' });
    expect(resolveEnemyHit(crogiolo, shot(crogiolo, { dist: 8 * TILE })).vulnerability).toBe(
      'distante',
    );
    expect(resolveEnemyHit(crogiolo, shot(crogiolo, { dist: 2 * TILE })).vulnerability).toBeNull();
  });

  it('lo sfiato è una finestra, non uno stato', () => {
    const a = target({ kind: 'ripetitore', ventMs: 100 });
    expect(resolveEnemyHit(a, shot(a)).vulnerability).toBe('sfiatato');
    const b = target({ kind: 'ripetitore', ventMs: 0 });
    expect(resolveEnemyHit(b, shot(b)).vulnerability).toBeNull();
  });

  it('il Guardiano è immune di fronte, non solo resistente', () => {
    const e = target({ kind: 'guardiano', angle: Math.PI });
    // Davanti alla piastra: il tiratore è a sinistra e lui guarda a
    // sinistra.
    const r = resolveEnemyHit(e, shot(e, { shooterX: e.x - 2 * TILE }));
    expect(r.damage).toBe(0);
    // Di lato, appena oltre il bordo della piastra, il colpo passa.
    const side = resolveEnemyHit(e, shot(e, { shooterX: e.x - TILE, shooterY: e.y - 2 * TILE }));
    expect(side.damage).toBeGreaterThan(0);
  });

  it("l'irrobustimento riduce, non azzera", () => {
    const e = target({ hardened: true });
    expect(resolveEnemyHit(e, shot(e)).damage).toBeCloseTo(HARDENED_MULT, 6);
  });

  it('due colpi giusti bastano su chiunque', () => {
    // È il vincolo che tiene in piedi tutto il resto: con
    // BULLET_COOLDOWN a 1400 ms, uno scontro da sei colpi dura otto
    // secondi e mezzo.
    for (const k of ALL_ENEMY_KINDS) {
      const a = archetypeOf(k);
      const best = WEAK_SPOT_MULT * (a.vulnerability === 'nessuna' ? 1 : VULNERABILITY_MULT);
      expect(Math.ceil(a.hp / best), `${k}`).toBeLessThanOrEqual(2);
    }
  });

  it('nessuno cade in un colpo solo sbagliando tutto', () => {
    // L'altro lato: se il colpo qualunque bastasse, i due assi non
    // servirebbero a niente.
    for (const k of ALL_ENEMY_KINDS) {
      expect(archetypeOf(k).hp, `${k}`).toBeGreaterThan(1);
    }
  });
});

describe('nemici — regole particolari, nel mondo', () => {
  const refrigerante = ALL_LEVELS.find((lv) => lv.id === 'refrigerante')!;

  it("un Archivista vivo irrobustisce chi gli sta vicino", () => {
    const nido = ALL_LEVELS.find((lv) => lv.id === 'nido')!;
    const w = new CampaignWorld(nido);
    const arch = w.state.enemies.find((x) => x.kind === 'archivista')!;
    const mart = w.state.enemies.find((x) => x.kind === 'martello')!;
    mart.x = arch.x + TILE;
    mart.y = arch.y;
    w.step(input());
    expect(mart.hardened).toBe(true);

    // E smette appena l'Archivista cade: è la ragione per cui esiste.
    arch.alive = false;
    w.step(input());
    expect(mart.hardened).toBe(false);
  });

  /** Mette i due su una riga libera e nota della camera fredda, a
   *  distanza scelta. Le posizioni di partenza dei nemici cambiano
   *  quando cambia il level design — è successo tre volte mentre si
   *  tarava questo atto — e un test che ci si appoggia si rompe per
   *  la ragione sbagliata. */
  function faceOff(kind: 'crogiolo' | 'guardiano', tiles: number) {
    const w = new CampaignWorld(refrigerante);
    const e = w.state.enemies.find((x) => x.kind === kind)!;
    e.x = 19.5 * TILE;
    e.y = 1.5 * TILE;
    e.angle = Math.PI;
    const p = w.state.player;
    p.x = e.x - tiles * TILE;
    p.y = e.y;
    p.respawnInvulnerableMs = 0;
    p.weaponCooldown = 0;
    return { w, e, p };
  }

  it('morire accanto a un Crogiolo acceca', () => {
    const { w, e, p } = faceOff('crogiolo', 1);
    e.hp = 0.5;
    const events = w.step(input({ fire: true, aimAngle: 0 }));
    expect(events.some((ev) => ev.type === 'enemyDown')).toBe(true);
    expect(p.empMs).toBeGreaterThan(0);
  });

  it('ucciderlo da lontano non acceca — ed è la stessa cosa che lo rende vulnerabile', () => {
    const { w, e, p } = faceOff('crogiolo', 4);
    e.hp = 0.5;
    const events = w.step(input({ fire: true, aimAngle: 0 }));
    expect(events.some((ev) => ev.type === 'enemyDown')).toBe(true);
    expect(p.empMs).toBe(0);
  });

  it('il colpo trova il nemico prima del muro che gli sta dietro', () => {
    // La catena intera: il raggio deve scegliere il bersaglio giusto,
    // non solo il danno essere calcolato bene.
    const w = new CampaignWorld(refrigerante);
    const e = w.state.enemies.find((x) => x.kind === 'crogiolo')!;
    const p = w.state.player;
    p.x = e.x - TILE * 3;
    p.y = e.y;
    p.weaponCooldown = 0;
    const events = w.step(input({ fire: true, aimAngle: 0 }));
    expect(events.some((ev) => ev.type === 'enemyHit')).toBe(true);
  });

  it('morire riporta al posto i nemici della stanza del checkpoint', () => {
    // Il Crogiolo e non il Guardiano: il banco mette i due nella
    // camera fredda, e camminandoci il checkpoint *diventa* quella
    // stanza. Con un nemico di casa altrove la regola non si
    // applicherebbe — giustamente, ed è la regola stessa.
    const { w, e, p } = faceOff('crogiolo', 2);
    const def = refrigerante.enemies.find((d) => d.id === e.id)!;
    const home = { x: (def.tx + 0.5) * TILE, y: (def.ty + 0.5) * TILE };
    expect(def.room).toBe('fredda');
    // Mezzo morto e fuori posto: due cose che il respawn deve
    // annullare.
    e.hp = 0.5;
    p.shieldCharges = 0;
    // Il checkpoint qui è la *premessa*, non l'oggetto della prova: da
    // quando pretende un posto sicuro (CampaignWorld.updateCheckpoint)
    // non si prende più in faccia al nemico che si sta affrontando,
    // quindi va dichiarato invece che aspettato. Che *dove* si prenda
    // sia giusto lo provano le due prove in campaign.edge-cases.
    w.state.checkpoint = { room: def.room, x: p.x, y: p.y, angle: p.angle };
    markRoomReached(w, def.room);

    // Si fa sparare. Prova anche che un nemico *può* uccidere, che è
    // la metà di questa meccanica che nessun altro test copre.
    let died = false;
    for (let i = 0; i < 600 && !died; i++) {
      died = w.step(input()).some((ev) => ev.type === 'playerDied');
    }
    expect(died).toBe(true);
    expect(e.hp).toBe(archetypeOf('crogiolo').hp);
    expect(e.x).toBeCloseTo(home.x, 3);
    expect(e.y).toBeCloseTo(home.y, 3);
  });

  it('la finestra di grazia copre i primi istanti di un livello', () => {
    // Senza, un nemico già girato verso la porta può sparare prima che
    // il giocatore abbia toccato un tasto.
    const w = new CampaignWorld(refrigerante);
    expect(w.state.player.respawnInvulnerableMs).toBe(LEVEL_START_GRACE_MS);
    const ticks = Math.floor(LEVEL_START_GRACE_MS / 16.67) - 2;
    for (let i = 0; i < ticks; i++) {
      expect(w.step(input()).some((ev) => ev.type === 'playerDied')).toBe(false);
    }
  });
});

describe('nemici — mira verticale', () => {
  it("la quota dell'occhio della simulazione è quella del renderer", () => {
    // Copiata a mano di proposito (la simulazione non importa il
    // modulo di rendering), quindi serve un guardiano: se divergono,
    // si mira a una cosa e se ne colpisce un'altra.
    expect(PLAYER_EYE_Z).toBe(EYE_HEIGHT);
  });

  it('alzare il tiro trova la testa del Saldatore', () => {
    const condotti = ALL_LEVELS.find((lv) => lv.id === 'condotti')!;
    const w = new CampaignWorld(condotti);
    const e = w.state.enemies.find((x) => x.kind === 'saldatore')!;
    const p = w.state.player;
    const dist = TILE * 3;
    p.x = e.x - dist;
    p.y = e.y;
    e.angle = Math.PI;
    e.closing = false;
    p.weaponCooldown = 0;

    const a = archetypeOf('saldatore');
    // Pendenza che porta il mirino appena sopra la soglia della banda
    // alta, alla distanza data.
    const targetZ = a.height * TILE * 0.8;
    const slope = (targetZ - PLAYER_EYE_Z) / dist;
    const events = w.step(input({ fire: true, aimAngle: 0, aimSlope: slope }));
    const hit = events.find((ev) => ev.type === 'enemyHit');
    expect(hit?.weakSpot).toBe('head');
  });

  it('il corpo si colpisce comunque, a qualunque alzata', () => {
    // Chiedere di stare dentro la sagoma anche in verticale avrebbe
    // reso ogni colpo un tiro di precisione, in un motore dove
    // l'orizzonte scorre invece di ruotare.
    const condotti = ALL_LEVELS.find((lv) => lv.id === 'condotti')!;
    const w = new CampaignWorld(condotti);
    const e = w.state.enemies.find((x) => x.kind === 'saldatore')!;
    const p = w.state.player;
    p.x = e.x - TILE * 3;
    p.y = e.y;
    e.angle = Math.PI;
    e.closing = false;
    p.weaponCooldown = 0;
    const events = w.step(input({ fire: true, aimAngle: 0, aimSlope: -0.9 }));
    const hit = events.find((ev) => ev.type === 'enemyHit');
    expect(hit?.damage).toBeGreaterThan(0);
    expect(hit?.weakSpot).toBeNull();
  });
});

describe('IA dei nemici', () => {
  function enemy(over: Partial<EnemyState> = {}): EnemyState {
    return {
      id: 'prova',
      kind: 'vedetta',
      alive: true,
      x: 5 * TILE,
      y: 5 * TILE,
      angle: 0,
      hp: 2,
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
      hardened: false,
      ...over,
    };
  }

  /** Una stanza aperta: solo il bordo è muro. */
  const openCtx = (over: Partial<EnemyAiCtx> = {}): EnemyAiCtx => ({
    getTile: (tx, ty) => (tx <= 0 || ty <= 0 || tx >= 20 || ty >= 20 ? 1 : 0),
    mapW: 20,
    mapH: 20,
    playerX: 9 * TILE,
    playerY: 5 * TILE,
    playerTargetable: true,
    leash: null,
    dtMs: 16.666,
    ...over,
  });

  it('non spara nell istante in cui vede: tiene la linea per la reazione', () => {
    const e = enemy({ angle: 0 });
    const ctx = openCtx();
    const first = updateEnemyAi(e, ctx);
    expect(first.attack).toBe(false);
    expect(e.ai).toBe('engage');

    let fired = false;
    for (let i = 0; i < 200 && !fired; i++) {
      fired = updateEnemyAi(e, ctx).attack;
    }
    expect(fired).toBe(true);
  });

  it('perdere la linea di vista azzera la reazione', () => {
    const e = enemy({ angle: 0 });
    const ctx = openCtx();
    for (let i = 0; i < 30; i++) updateEnemyAi(e, ctx);
    const partway = e.reactionTimer;
    expect(partway).toBeLessThan(archetypeOf('vedetta').reactionMs);

    // Un muro fra i due.
    const blocked = openCtx({ getTile: (tx, ty) => (tx === 7 ? 1 : tx <= 0 || ty <= 0 || tx >= 20 || ty >= 20 ? 1 : 0) });
    updateEnemyAi(e, blocked);
    expect(e.ai).toBe('search');
    expect(e.reactionTimer).toBe(archetypeOf('vedetta').reactionMs);
  });

  it('non vede alle spalle, nemmeno in piena luce', () => {
    const e = enemy({ angle: Math.PI });
    const ctx = openCtx();
    updateEnemyAi(e, ctx);
    expect(e.ai).toBe('patrol');
  });

  it('il guinzaglio riporta dentro chi esce dalla stanza', () => {
    const e = enemy({ angle: 0, x: 8 * TILE - 4, y: 5 * TILE });
    // Il giocatore fuori dal guinzaglio, in vista.
    const ctx = openCtx({
      leash: { minX: 3 * TILE, minY: 3 * TILE, maxX: 8 * TILE, maxY: 8 * TILE },
      playerX: 18 * TILE,
      playerY: 5 * TILE,
    });
    // Senza guinzaglio inseguirebbe: avvicinarsi è ciò che farebbe.
    // Il giocatore va messo *oltre* la portata utile, o la Vedetta si
    // pianta a sparare invece di avanzare — che è il suo tell.
    const free = updateEnemyAi(
      enemy({ angle: 0, x: 7.5 * TILE, y: 5 * TILE }),
      openCtx({ playerX: 18 * TILE, playerY: 5 * TILE }),
    );
    expect(free.moveX).toBeGreaterThan(0);

    const held = updateEnemyAi(e, ctx);
    expect(held.moveX).toBeLessThanOrEqual(0);
  });

  it('la carica del Martello non corregge la rotta una volta partita', () => {
    const a = archetypeOf('martello');
    const e = enemy({
      kind: 'martello',
      hp: a.hp,
      angle: 0,
      chargeMs: 400,
      chargeDirX: 1,
      chargeDirY: 0,
    });
    // Il giocatore si sposta di lato: la carica deve restare dritta,
    // perché è tutto ciò che la rende schivabile.
    const moved = updateEnemyAi(e, openCtx({ playerX: 9 * TILE, playerY: 12 * TILE }));
    expect(moved.moveX).toBe(1);
    expect(moved.moveY).toBe(0);
  });

  it('un giocatore intoccabile non è un bersaglio', () => {
    // Sparare dentro la finestra di invulnerabilità da checkpoint
    // sarebbe un colpo che non può fare danno, cioè rumore.
    const e = enemy({ angle: 0 });
    updateEnemyAi(e, openCtx({ playerTargetable: false }));
    expect(e.ai).toBe('patrol');
  });
});
