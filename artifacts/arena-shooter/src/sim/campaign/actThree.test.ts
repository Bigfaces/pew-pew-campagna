// ================================================================
// ATTO III — stanze rettangolari e ARBITER
// ================================================================
// Due cose da fissare.
//
// La prima è che le stanze non siano più intervalli di colonne: senza,
// la Plancia — dove si sale invece di attraversare — sarebbe una
// stanza sola, e l'Atto III non avrebbe la geometria che il GDD gli
// chiede.
//
// La seconda è ARBITER, e qui l'asticella non è "funziona" ma "riusa".
// Le tre fasi devono essere le tre macchine già viste, non tre nuove:
// se la fase di caccia si comportasse diversamente dalla Sentinella,
// il test finale chiederebbe di imparare qualcosa invece di
// riconoscerlo.
// ================================================================

import { describe, expect, it } from 'vitest';

import { TICK_MS } from '../constants';
import {
  ARBITER_CORE_HITS,
  ARBITER_CORE_WINDOW_MS,
  ARBITER_HITS_TO_DEFEAT,
  ARBITER_HUNT_HITS,
  BOSS_CHARGE_MS,
  BOSS_REAR_ARC_HALF,
} from './constants';
import { LEVEL_ARCHIVIO, LEVEL_NIDO, LEVEL_PLANCIA, levelById } from './levels';
import { roomAt } from './levelTypes';
import { centre } from './testSupport';
import { emptyCampaignInput, type CampaignInput } from './types';
import { CampaignWorld } from './world';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

describe('geometria non lineare', () => {
  it('due stanze possono occupare le stesse colonne a altezze diverse', () => {
    // È la cosa che con gli intervalli di colonne non si poteva
    // scrivere, e senza la quale la Plancia sarebbe stata l'ennesimo
    // corridoio da sinistra a destra.
    expect(roomAt(LEVEL_PLANCIA, 3, 14)).toBe('ingresso');
    expect(roomAt(LEVEL_PLANCIA, 3, 5)).toBe('pozzo');
    expect(roomAt(LEVEL_PLANCIA, 12, 5)).toBe('plancia');
  });

  it('una stanza dentro il rettangolo di un’altra vince se dichiarata prima', () => {
    // La camera dei registri sta dentro il blocco centrale
    // dell'Archivio: l'ordine della lista è anche la precedenza.
    expect(roomAt(LEVEL_ARCHIVIO, 10, 8)).toBe('camera');
    expect(roomAt(LEVEL_ARCHIVIO, 3, 8)).toBe('ovest');
    expect(roomAt(LEVEL_ARCHIVIO, 17, 8)).toBe('est');
  });

  it('i livelli lineari non sono cambiati: nessun limite verticale', () => {
    // La prova che il modello nuovo contiene il vecchio invece di
    // sostituirlo: sei livelli su nove non hanno dovuto dichiarare
    // niente.
    for (const id of ['attracco', 'condotti', 'molo', 'anello', 'refrigerante', 'nucleo']) {
      for (const room of levelById(id).rooms) {
        expect(room.fromTy, `${id}/${room.id}`).toBeUndefined();
        expect(room.toTy).toBeUndefined();
      }
    }
  });
});

describe('ARBITER', () => {
  function nest(nodes: string[] = []): CampaignWorld {
    const world = new CampaignWorld(LEVEL_NIDO);
    world.state.unlockedNodes = nodes;
    const boss = world.state.boss!;
    world.state.checkpoint = { room: 'nido', x: boss.x - 120, y: boss.y, angle: 0 };
    world.state.player.x = boss.x - 120;
    world.state.player.y = boss.y;
    return world;
  }

  /** Spara al corpo di ARBITER da `offsetDeg` gradi rispetto al suo
   *  retro, e torna il danno inflitto. */
  function shootBody(world: CampaignWorld, offsetDeg = 0): number {
    const boss = world.state.boss!;
    const a = boss.angle + Math.PI + (offsetDeg * Math.PI) / 180;
    world.state.player.x = boss.x + Math.cos(a) * 70;
    world.state.player.y = boss.y + Math.sin(a) * 70;
    world.state.player.weaponCooldown = 0;
    world.state.player.respawnInvulnerableMs = 1000;
    const aim = Math.atan2(boss.y - world.state.player.y, boss.x - world.state.player.x);
    let dmg = 0;
    for (const e of world.step(input({ aimAngle: aim, fire: true }))) {
      if (e.type === 'bossHit') dmg += e.damage;
    }
    return dmg;
  }

  it('i moduli sono turret vere, e finché ne resta una il corpo è intoccabile', () => {
    const world = nest();
    const boss = world.state.boss!;
    expect(boss.stage).toBe(1);
    expect(boss.phase).toBe('modules');
    expect(LEVEL_NIDO.boss!.moduleTurretIds).toHaveLength(4);
    // I moduli *sono* le turret del livello: nessuna entità nuova.
    for (const id of LEVEL_NIDO.boss!.moduleTurretIds!) {
      expect(world.state.turrets.some((t) => t.id === id)).toBe(true);
    }

    expect(shootBody(world)).toBe(0);

    // Ne restano tre: ancora niente.
    world.state.turrets[0]!.alive = false;
    world.step();
    expect(world.state.boss!.stage).toBe(1);
    expect(shootBody(world)).toBe(0);
  });

  it('spenti tutti i moduli comincia la caccia', () => {
    const world = nest();
    for (const t of world.state.turrets) t.alive = false;
    const ev = world.step();
    expect(ev.some((e) => e.type === 'bossStage' && e.stage === 2)).toBe(true);
    expect(world.state.boss!.stage).toBe(2);
    expect(world.state.boss!.phase).toBe('guard');
  });

  /** Porta il boss in caccia e in una fase in cui è colpibile. */
  function hunting(): CampaignWorld {
    const world = nest();
    for (const t of world.state.turrets) t.alive = false;
    world.step();
    const boss = world.state.boss!;
    boss.phase = 'charge';
    boss.phaseTimer = BOSS_CHARGE_MS;
    boss.angle = 0;
    return world;
  }

  it('in caccia vale il cono posteriore della Sentinella, non la finestra', () => {
    // Stessa regola, stesso confine: è la macchina della Sentinella,
    // non una sua imitazione.
    expect(shootBody(hunting(), 0)).toBe(1);

    const justOutside = (BOSS_REAR_ARC_HALF * 180) / Math.PI + 5;
    expect(shootBody(hunting(), justOutside)).toBe(0);
  });

  it('finita la caccia si apre la terza fase', () => {
    const world = hunting();
    let reached = false;
    for (let i = 0; i < ARBITER_HUNT_HITS; i++) {
      const boss = world.state.boss!;
      boss.phase = 'charge';
      boss.phaseTimer = BOSS_CHARGE_MS;
      boss.angle = 0;
      shootBody(world);
      if (world.state.boss!.stage === 3) reached = true;
    }
    expect(reached).toBe(true);
    expect(world.state.boss!.phase).toBe('coreSealed');
    expect(world.state.boss!.stageDamage).toBe(0);
  });

  /** Porta il boss alla terza fase senza passare dalla caccia. */
  function coreStage(): CampaignWorld {
    const world = nest();
    for (const t of world.state.turrets) t.alive = false;
    world.step();
    const boss = world.state.boss!;
    boss.stage = 3;
    boss.stageDamage = 0;
    boss.damageTaken = ARBITER_HUNT_HITS;
    boss.phase = 'coreSealed';
    boss.phaseTimer = 1;
    return world;
  }

  it('nel finale si colpisce solo col nucleo aperto, e da qualsiasi angolo', () => {
    const world = coreStage();
    const boss = world.state.boss!;

    boss.phase = 'coreSealed';
    boss.phaseTimer = 9999;
    expect(shootBody(world, 180)).toBe(0);

    boss.phase = 'coreOpen';
    boss.phaseTimer = ARBITER_CORE_WINDOW_MS;
    // Di fronte, cioè dove la Sentinella sarebbe invulnerabile: qui
    // conta il *quando*, come per il Custode.
    expect(shootBody(world, 180)).toBe(1);
  });

  it('mancare la finestra riporta alla caccia, non a una pausa', () => {
    const world = coreStage();
    const boss = world.state.boss!;
    boss.phase = 'coreOpen';
    boss.phaseTimer = TICK_MS;

    let sealed = false;
    for (let i = 0; i < 4; i++) {
      if (world.step().some((e) => e.type === 'bossCoreSealed')) sealed = true;
    }
    expect(sealed).toBe(true);
    expect(world.state.boss!.stage).toBe(2);
    expect(world.state.boss!.phase).toBe('guard');
    // È questa la posta di un boss finale: non perdere vita, perdere
    // il terreno guadagnato.
    expect(world.state.boss!.stageDamage).toBe(0);
  });

  it('il totale e il progresso di fase divergono, e va bene così', () => {
    // damageTaken è quanto ARBITER ha incassato in tutto — è ciò che
    // la HUD mostra e non torna mai indietro. stageDamage è quanto
    // manca per chiudere *questa* fase, e si azzera ogni volta che una
    // finestra mancata fa ricominciare.
    const world = coreStage();
    const boss = world.state.boss!;
    boss.phase = 'coreOpen';
    boss.phaseTimer = ARBITER_CORE_WINDOW_MS;
    shootBody(world, 180);

    expect(boss.damageTaken).toBe(ARBITER_HUNT_HITS + 1);
    expect(boss.stageDamage).toBe(1);

    boss.phaseTimer = TICK_MS;
    for (let i = 0; i < 4; i++) world.step();
    expect(world.state.boss!.damageTaken).toBe(ARBITER_HUNT_HITS + 1);
    expect(world.state.boss!.stageDamage).toBe(0);
  });

  it('serve chiudere entrambe le fasi, non accumulare colpi', () => {
    expect(ARBITER_HITS_TO_DEFEAT).toBe(ARBITER_HUNT_HITS + ARBITER_CORE_HITS);

    const world = coreStage();
    const boss = world.state.boss!;
    let defeated = false;
    for (let i = 0; i < ARBITER_CORE_HITS; i++) {
      boss.phase = 'coreOpen';
      boss.phaseTimer = ARBITER_CORE_WINDOW_MS;
      shootBody(world, 180);
      if (world.state.boss!.phase === 'defeated') defeated = true;
    }
    expect(defeated).toBe(true);
    expect(world.state.outcome).toBe('victory');
  });

  it('morire lo riporta dietro i moduli, dalla prima fase', () => {
    const world = coreStage();
    world.state.boss!.stage = 3;
    world.state.boss!.damageTaken = 4;

    // Rimetti in piedi un modulo e fatti uccidere da quello.
    const mod = world.state.turrets[0]!;
    mod.alive = true;
    const def = LEVEL_NIDO.turrets[0]!;
    const spot = centre(def.tx, def.ty + 1);
    world.state.player.x = spot.x;
    world.state.player.y = spot.y;
    world.state.player.respawnInvulnerableMs = 0;

    let died = false;
    for (let i = 0; i < 400 && !died; i++) {
      died = world.step().some((e) => e.type === 'playerDied');
    }
    expect(died).toBe(true);
    expect(world.state.boss!.stage).toBe(1);
    expect(world.state.boss!.phase).toBe('modules');
    expect(world.state.boss!.damageTaken).toBe(0);
    expect(world.state.boss!.stageDamage).toBe(0);
  });
});
