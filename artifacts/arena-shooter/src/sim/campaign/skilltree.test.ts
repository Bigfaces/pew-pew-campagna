// ================================================================
// SKILL TREE TESTS — i tre rami aggiunti dopo lo Sprint 1
// ================================================================
// Precisione era già coperta da campaign.test.ts. Qui stanno Mobilità,
// Sopravvivenza e Percezione, più le regole dell'albero in sé
// (prerequisiti, punti, profili illeggibili).
//
// Il taglio è lo stesso di campaign.edge-cases.test.ts: si fissano i
// *meccanismi* — lo scatto congela la direzione, l'invulnerabilità non
// blocca la carica, la ricarica dello scudo non è sfruttabile in loop
// — e non le cifre, che restano libere di essere ritarate.
// ================================================================

import { describe, expect, it } from 'vitest';

import { PLAYER_SPEED, TICK_MS, TILE } from '../constants';
import {
  ALL_SKILL_NODES,
  BOSS_RADIUS,
  TURRET_COOLDOWN_MS,
  TURRET_REACTION_MS,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  NODE_PASSO_LUNGO_MULT,
  SKILL_TREE,
} from './constants';
import {
  hasContacts,
  hasMinimap,
  movementStatsFor,
  pointsSpent,
  prereqMet,
  shieldCapacity,
} from './skills';
import { LEVEL_ATTRACCO } from './levels';
import { attracco, bossHome, centre, molo, shieldOf } from './testSupport';
import { emptyCampaignInput, type CampaignInput } from './types';
import { CampaignWorld } from './world';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

/** Un mondo con i nodi già sbloccati e il giocatore piazzato in un
 *  punto libero dell'Attracco, lontano dai muri, così che uno scatto
 *  abbia spazio per svolgersi senza collidere. */
function worldWith(nodes: string[], x = 2.5 * TILE, y = 5.5 * TILE): CampaignWorld {
  const world = attracco();
  world.state.unlockedNodes = nodes;
  world.state.player.x = x;
  world.state.player.y = y;
  world.state.player.angle = 0;
  return world;
}

/** Dove sta lo scudo dell'Attracco, letto dal livello invece che
 *  scritto a mano: se si sposta, i test lo seguono. */
const SHIELD = (() => {
  const d = LEVEL_ATTRACCO.shields[0]!;
  return centre(d.tx, d.ty);
})();

/** Un mondo del Molo con i nodi dati e il giocatore già nella stanza
 *  del boss: i test sulla schivata hanno bisogno di un boss, e il boss
 *  vive nel terzo livello. */
function bossWorldWith(nodes: string[]): CampaignWorld {
  const world = molo();
  world.state.unlockedNodes = nodes;
  const home = bossHome(world.level);
  world.state.checkpoint = { room: 'molo', x: home.x - 200, y: home.y, angle: 0 };
  world.state.player.x = home.x - 200;
  world.state.player.y = home.y;
  world.state.player.angle = 0;
  return world;
}

describe('albero — regole comuni', () => {
  it('ogni id compare una volta sola in tutto l’albero', () => {
    const ids = ALL_SKILL_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ogni prerequisito punta a un nodo che esiste davvero', () => {
    for (const node of ALL_SKILL_NODES) {
      if (!node.requires) continue;
      expect(ALL_SKILL_NODES.some((n) => n.id === node.requires)).toBe(true);
    }
  });

  it('un prerequisito sta sempre nello stesso ramo del nodo che lo richiede', () => {
    // Non è una regola arbitraria: il menu mostra un ramo per volta,
    // e un prerequisito fuori ramo manderebbe il giocatore a cercare
    // un nodo che la schermata non gli sta facendo vedere.
    for (const branch of SKILL_TREE) {
      const here = new Set(branch.nodes.map((n) => n.id));
      for (const node of branch.nodes) {
        if (node.requires) expect(here.has(node.requires)).toBe(true);
      }
    }
  });

  it('un nodo dietro un prerequisito non si sblocca senza di esso', () => {
    const world = attracco();
    world.state.skillPoints = 5;

    expect(world.tryUnlockNode('scatto-evasivo')).toBe(false);
    expect(world.state.unlockedNodes).toEqual([]);

    expect(world.tryUnlockNode('scatto')).toBe(true);
    expect(world.tryUnlockNode('scatto-evasivo')).toBe(true);
    expect(world.state.unlockedNodes).toEqual(['scatto', 'scatto-evasivo']);
  });

  it('prereqMet è vero per i nodi senza prerequisito', () => {
    expect(prereqMet([], 'scatto')).toBe(true);
    expect(prereqMet([], 'scatto-evasivo')).toBe(false);
  });

  /** Un profilo salvato da una versione precedente può contenere un
   *  nodo che non esiste più. Deve costare 0, non infinito: altrimenti
   *  availableSkillPoints andrebbe a -Infinity e quel giocatore non
   *  potrebbe più sbloccare niente, per sempre. */
  it('un nodo sconosciuto nel profilo non blocca l’albero', () => {
    expect(pointsSpent(['nodo-che-non-esiste-piu'])).toBe(0);

    const world = attracco();
    world.state.skillPoints = 1;
    world.state.unlockedNodes = ['nodo-che-non-esiste-piu'];
    expect(world.availableSkillPoints).toBe(1);
    expect(world.tryUnlockNode('scatto')).toBe(true);
  });
});

describe('Mobilità — Scatto', () => {
  it('senza il nodo, premere scatto non fa niente', () => {
    const world = worldWith([]);
    const before = world.state.player.x;
    const events = world.step(input({ dash: true }));

    expect(events.some((e) => e.type === 'dashStarted')).toBe(false);
    expect(world.state.player.dashTimer).toBe(0);
    expect(world.state.player.x).toBe(before);
  });

  it('copre più strada di una camminata normale, nella stessa direzione', () => {
    const walk = worldWith([]);
    const dash = worldWith(['scatto']);
    const ticks = Math.ceil(DASH_DURATION_MS / TICK_MS);

    for (let i = 0; i < ticks; i++) walk.step(input({ forward: 1 }));
    dash.step(input({ forward: 1, dash: true }));
    for (let i = 1; i < ticks; i++) dash.step(input({ forward: 1 }));

    const walked = walk.state.player.x - 2.5 * TILE;
    const dashed = dash.state.player.x - 2.5 * TILE;
    expect(dashed).toBeGreaterThan(walked);
    // Dritto davanti: nessuna deriva laterale.
    expect(Math.abs(dash.state.player.y - 5.5 * TILE)).toBeLessThan(0.001);
  });

  it('tiene la direzione fissata alla partenza anche se l’input cambia', () => {
    const world = worldWith(['scatto']);
    world.step(input({ forward: 1, dash: true }));
    const dirX = world.state.player.dashDirX;

    // Da qui in poi il giocatore chiede l'opposto: lo scatto deve
    // ignorarlo. Uno scatto sterzabile sarebbe una corsa veloce, non
    // un gesto da puntare prima.
    const startX = world.state.player.x;
    for (let i = 0; i < 3; i++) world.step(input({ forward: -1 }));

    expect(world.state.player.dashDirX).toBe(dirX);
    expect(world.state.player.x).toBeGreaterThan(startX);
  });

  it('da fermo parte nella direzione in cui si guarda', () => {
    const world = worldWith(['scatto']);
    world.state.player.angle = Math.PI / 2;
    world.step(input({ aimAngle: Math.PI / 2, dash: true }));

    expect(world.state.player.dashTimer).toBeGreaterThan(0);
    expect(world.state.player.dashDirY).toBeCloseTo(1, 5);
    expect(world.state.player.dashDirX).toBeCloseTo(0, 5);
  });

  it('non riparte finché il cooldown non è finito', () => {
    const world = worldWith(['scatto']);
    world.step(input({ forward: 1, dash: true }));
    expect(world.state.player.dashCooldown).toBeCloseTo(DASH_COOLDOWN_MS, 5);

    // Lascia finire lo scatto, poi richiedine subito un altro.
    for (let i = 0; i < Math.ceil(DASH_DURATION_MS / TICK_MS) + 1; i++) world.step();
    expect(world.state.player.dashTimer).toBe(0);

    const events = world.step(input({ forward: 1, dash: true }));
    expect(events.some((e) => e.type === 'dashStarted')).toBe(false);

    // Dopo il cooldown invece sì.
    const remaining = Math.ceil(world.state.player.dashCooldown / TICK_MS) + 1;
    for (let i = 0; i < remaining; i++) world.step();
    expect(world.step(input({ forward: 1, dash: true })).some((e) => e.type === 'dashStarted')).toBe(
      true,
    );
  });

  it('non attraversa i muri', () => {
    // Faccia al muro ovest dell'Attracco, a un passo da esso.
    const world = worldWith(['scatto'], 1.6 * TILE, 5.5 * TILE);
    world.state.player.angle = Math.PI;
    world.step(input({ aimAngle: Math.PI, forward: 1, dash: true }));
    for (let i = 0; i < Math.ceil(DASH_DURATION_MS / TICK_MS); i++) {
      world.step(input({ aimAngle: Math.PI }));
    }
    // Il muro è la colonna 0: restare oltre il suo bordo interno è
    // l'unica cosa che conta, qualunque sia l'attrito della collisione.
    expect(world.state.player.x).toBeGreaterThan(TILE);
  });

  it('la morte annulla uno scatto in corso', () => {
    const world = bossWorldWith(['scatto']);
    world.step(input({ forward: 1, dash: true }));
    expect(world.state.player.dashTimer).toBeGreaterThan(0);

    // killPlayer è privato: lo si raggiunge dal boss, che è la via per
    // cui il caso si presenta davvero.
    const boss = world.state.boss!;
    boss.phase = 'charge';
    boss.phaseTimer = 500;
    boss.x = world.state.player.x;
    boss.y = world.state.player.y;
    world.state.player.respawnInvulnerableMs = 0;
    world.step();

    expect(world.state.player.dashTimer).toBe(0);
    expect(world.state.player.dashCooldown).toBe(0);
  });
});

describe('Mobilità — Passo Lungo e Scatto Evasivo', () => {
  it('Passo Lungo alza la velocità base', () => {
    const slow = worldWith([]);
    const fast = worldWith(['passo-lungo']);
    for (let i = 0; i < 10; i++) {
      slow.step(input({ forward: 1 }));
      fast.step(input({ forward: 1 }));
    }
    const slowD = slow.state.player.x - 2.5 * TILE;
    const fastD = fast.state.player.x - 2.5 * TILE;
    expect(fastD).toBeCloseTo(slowD * NODE_PASSO_LUNGO_MULT, 3);
  });

  it('resta più lento della carica del boss', () => {
    // Il vincolo di progetto dietro NODE_PASSO_LUNGO_MULT: la
    // Sentinella deve restare una minaccia da schivare, non da
    // superare camminando.
    expect(PLAYER_SPEED * NODE_PASSO_LUNGO_MULT).toBeLessThan(3.4);
  });

  it('movementStatsFor non concede l’invulnerabilità senza lo Scatto', () => {
    expect(movementStatsFor(['scatto-evasivo']).dashInvulnerable).toBe(false);
    expect(movementStatsFor(['scatto', 'scatto-evasivo']).dashInvulnerable).toBe(true);
  });

  /** Il caso che il nodo promette: "la carica si attraversa". */
  it('senza Scatto Evasivo la carica uccide, con il nodo no', () => {
    function run(nodes: string[]): { died: boolean; chargeAdvanced: boolean } {
      const world = bossWorldWith(nodes);
      const boss = world.state.boss!;
      boss.phase = 'charge';
      boss.phaseTimer = 400;
      boss.angle = 0;
      boss.chargeDirX = 1;
      boss.chargeDirY = 0;
      boss.x = world.state.player.x;
      boss.y = world.state.player.y;
      // Il giocatore è addosso al boss e scatta *dentro* la carica,
      // non via da essa: scappare funziona anche senza il nodo (lo
      // scatto è più veloce della carica), quindi non direbbe niente
      // sull'invulnerabilità. Attraversare è esattamente ciò che il
      // nodo promette.
      world.state.player.x = boss.x + BOSS_RADIUS;
      world.state.player.y = boss.y;
      world.state.player.angle = Math.PI;
      world.state.player.respawnInvulnerableMs = 0;

      const timerBefore = boss.phaseTimer;
      let died = false;
      // Il tick dello scatto va contato come gli altri: senza il nodo
      // è proprio lì che il giocatore muore.
      const first = world.step(input({ aimAngle: Math.PI, forward: 1, dash: true }));
      if (first.some((e) => e.type === 'playerDied')) died = true;
      for (let i = 0; i < 4; i++) {
        if (world.step(input({ aimAngle: Math.PI })).some((e) => e.type === 'playerDied')) {
          died = true;
        }
      }
      return { died, chargeAdvanced: world.state.boss!.phaseTimer < timerBefore };
    }

    expect(run(['scatto']).died).toBe(true);

    const evasive = run(['scatto', 'scatto-evasivo']);
    expect(evasive.died).toBe(false);
    // E la carica deve comunque scorrere: un giocatore intoccabile che
    // fermasse il tick lascerebbe il boss piantato addosso a lui.
    expect(evasive.chargeAdvanced).toBe(true);
  });
});

describe('Sopravvivenza', () => {
  function shieldWorld(nodes: string[]): CampaignWorld {
    const world = worldWith(nodes, SHIELD.x, SHIELD.y);
    world.state.checkpoint = { room: 'magazzino', x: SHIELD.x, y: SHIELD.y, angle: 0 };
    return world;
  }

  it('senza Piastra Aggiuntiva lo scudo vale una carica', () => {
    const world = shieldWorld([]);
    const events = world.step();
    expect(world.state.player.shieldCharges).toBe(1);
    expect(events.some((e) => e.type === 'shieldPickup' && e.charges === 1)).toBe(true);
  });

  it('Piastra Aggiuntiva raddoppia le cariche, e si consumano una alla volta', () => {
    expect(shieldCapacity(['piastra-aggiuntiva'])).toBe(2);

    const world = shieldWorld(['piastra-aggiuntiva']);
    world.step();
    expect(world.state.player.shieldCharges).toBe(2);

    // Il drone del Magazzino come sorgente di colpi ripetuti: spara a
    // cadenza fissa, quindi bastano i tick. Prima il boss, che però
    // adesso vive in un altro livello — e lo scudo sta in questo.
    world.state.player.x = 13.5 * TILE;
    world.state.player.y = 7 * TILE;
    world.state.checkpoint = { room: 'magazzino', x: 13.5 * TILE, y: 7 * TILE, angle: 0 };

    let breaks = 0;
    let deaths = 0;
    const ticks = Math.ceil((TURRET_REACTION_MS + 3 * TURRET_COOLDOWN_MS) / TICK_MS);
    for (let i = 0; i < ticks && deaths === 0; i++) {
      for (const e of world.step()) {
        if (e.type === 'shieldBreak') breaks++;
        if (e.type === 'playerDied') deaths++;
      }
    }

    // Due colpi assorbiti, il terzo uccide. Il ciclo si ferma alla
    // morte: il checkpoint è sotto il tiro del drone, quindi
    // continuare conterebbe morti ripetute invece dello scudo.
    expect(breaks).toBe(2);
    expect(deaths).toBe(1);
  });

  it('Riserva di Bordo ricarica lo scudo entrando in una stanza nuova', () => {
    const world = worldWith(['riserva-di-bordo'], SHIELD.x, SHIELD.y);
    world.state.checkpoint = { room: 'magazzino', x: SHIELD.x, y: SHIELD.y, angle: 0 };
    world.step();
    expect(world.state.player.shieldCharges).toBe(1);

    world.state.player.shieldCharges = 0;
    world.state.player.x = 18.5 * TILE; // Molo
    const events = world.step();

    expect(events.some((e) => e.type === 'shieldRefilled')).toBe(true);
    expect(world.state.player.shieldCharges).toBe(1);
  });

  it('non regala uno scudo mai raccolto', () => {
    // Il nodo ricarica una riserva, non ne crea una: senza la
    // deviazione al Magazzino non c'è niente da ricaricare.
    const world = worldWith(['riserva-di-bordo']);
    world.state.player.x = 8.5 * TILE; // corridoio
    const events = world.step();
    expect(events.some((e) => e.type === 'shieldRefilled')).toBe(false);
    expect(world.state.player.shieldCharges).toBe(0);
  });

  it('senza il nodo entrare in una stanza non ricarica niente', () => {
    const world = worldWith([], SHIELD.x, SHIELD.y);
    world.state.checkpoint = { room: 'magazzino', x: SHIELD.x, y: SHIELD.y, angle: 0 };
    world.step();
    world.state.player.shieldCharges = 0;
    world.state.player.x = 18.5 * TILE;
    world.step();
    expect(world.state.player.shieldCharges).toBe(0);
  });

  it('tornare indietro e rientrare non ricarica una seconda volta', () => {
    // I checkpoint avanzano soltanto, quindi la ricarica non è un
    // loop: è la stessa proprietà che protegge l'XP delle stanze.
    const world = worldWith(['riserva-di-bordo'], SHIELD.x, SHIELD.y);
    world.state.checkpoint = { room: 'magazzino', x: SHIELD.x, y: SHIELD.y, angle: 0 };
    world.step();

    world.state.player.x = 18.5 * TILE; // Molo
    world.step();
    world.state.player.shieldCharges = 0;

    world.state.player.x = 13.5 * TILE; // indietro nel Magazzino
    world.step();
    world.state.player.x = 18.5 * TILE; // di nuovo nel Molo
    const events = world.step();

    expect(events.some((e) => e.type === 'shieldRefilled')).toBe(false);
    expect(world.state.player.shieldCharges).toBe(0);
  });
});

describe('Percezione', () => {
  it('i contatti richiedono lo scanner, non solo la lettura termica', () => {
    expect(hasMinimap([])).toBe(false);
    expect(hasMinimap(['scanner-di-settore'])).toBe(true);
    expect(hasContacts(['lettura-termica'])).toBe(false);
    expect(hasContacts(['scanner-di-settore', 'lettura-termica'])).toBe(true);
  });

  it('non toccano la simulazione', () => {
    // Sono nodi di sola informazione: due mondi identici, uno con
    // entrambi sbloccati, devono muoversi esattamente allo stesso modo.
    const plain = worldWith([]);
    const seeing = worldWith(['scanner-di-settore', 'lettura-termica']);
    for (let i = 0; i < 30; i++) {
      plain.step(input({ forward: 1 }));
      seeing.step(input({ forward: 1 }));
    }
    expect(seeing.state.player.x).toBe(plain.state.player.x);
    expect(seeing.state.player.y).toBe(plain.state.player.y);
  });
});
