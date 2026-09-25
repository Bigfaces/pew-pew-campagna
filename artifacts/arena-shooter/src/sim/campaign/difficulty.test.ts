// ================================================================
// CAMPAIGN DIFFICULTY TESTS — Tutorial / Medio / Roguelike
// ================================================================
// GDD.md sezione 9 descrive tre fasi che condividono lo stesso mondo
// e differiscono solo in cosa succede a killPlayer. Questi test
// pinnano esattamente quella differenza, non l'una o l'altra regola
// di gioco durante il run — quelle le coprono già campaign.test.ts e
// gli altri file della suite.
//
// Il drone del Magazzino (già usato da campaign.test.ts per uccidere
// il giocatore in pochi tick) è il modo più corto per arrivare a una
// morte vera senza dover camminare un livello intero.
// ================================================================

import { describe, expect, it } from 'vitest';

import { TICK_MS, TILE } from '../constants';
import { LEVEL_XP_THRESHOLDS, TURRET_REACTION_MS, levelForXp } from './constants';
import { LEVEL_ATTRACCO } from './levels';
import { centre, markRoomReached } from './testSupport';
import { CAMPAIGN_PROFILE_VERSION, type CampaignEvent, type CampaignProfile } from './types';
import { CampaignWorld } from './world';

/** Posiziona il giocatore davanti al drone del Magazzino e lo lascia
 *  sparare finché non muore, come in campaign.test.ts. Il checkpoint
 *  viene spostato lì apposta — è il modo più corto per essere "in un
 *  punto avanzato del livello" senza dover camminare fin lì — e
 *  proprio per questo è lo scenario giusto per distinguere "torna al
 *  checkpoint" (Tutorial) da "torna allo spawn" (Medio). */
function killViaDrone(world: CampaignWorld): CampaignEvent[] {
  world.state.checkpoint = {
    room: 'magazzino',
    x: 13.5 * TILE,
    y: 7 * TILE,
    angle: -Math.PI / 2,
  };
  markRoomReached(world, world.state.checkpoint.room);
  world.state.player.x = 13.5 * TILE;
  world.state.player.y = 7 * TILE;
  // Come quiet(): la finestra di grazia dell'ingresso livello non è
  // quello che questo test vuole misurare. Stessa ragione per le
  // piastre — qui si misura cosa costa *morire* in ogni modalità, e
  // con la dotazione di base addosso non morirebbe nessuno.
  world.state.player.respawnInvulnerableMs = 0;
  world.state.player.shieldCharges = 0;

  const ticksToFire = Math.ceil(TURRET_REACTION_MS / TICK_MS) + 2;
  const events: CampaignEvent[] = [];
  for (let i = 0; i < ticksToFire; i++) {
    events.push(...world.step());
  }
  return events;
}

function profileWith(difficulty: CampaignProfile['difficulty']): CampaignProfile {
  return {
    version: CAMPAIGN_PROFILE_VERSION,
    xp: LEVEL_XP_THRESHOLDS[2]!,
    unlockedNodes: [],
    levelId: 'attracco',
    completedLevels: [],
    collectedCoreIds: [],
    roomsAwarded: [],
    killsAwarded: [],
    difficulty,
  };
}

describe('CampaignWorld — difficoltà Tutorial (default)', () => {
  it('non tocca i nemici di una stanza diversa da quella del checkpoint', () => {
    const world = new CampaignWorld(LEVEL_ATTRACCO);
    const ronzino = world.state.enemies.find((e) => e.id === 'ronzino-corridoio')!;
    // Un Ronzino "morto altrove": se Tutorial resettasse tutto il
    // livello invece che la sola stanza del checkpoint, tornerebbe
    // vivo e al suo posto come nel test 'medio' qui sotto.
    ronzino.alive = false;
    ronzino.x = -999;

    const events = killViaDrone(world);
    expect(events.some((e) => e.type === 'playerDied')).toBe(true);

    expect(ronzino.alive).toBe(false);
    expect(ronzino.x).toBe(-999);
    // La regola che esisteva già: si torna al checkpoint, non allo spawn.
    expect(world.state.player.x).toBe(13.5 * TILE);
    expect(world.state.checkpoint.room).toBe('magazzino');
  });
});

describe('CampaignWorld — difficoltà Medio', () => {
  it("riporta allo spawn del livello e resetta anche i nemici di un'altra stanza", () => {
    const world = new CampaignWorld(LEVEL_ATTRACCO, undefined, 'medio');
    const ronzino = world.state.enemies.find((e) => e.id === 'ronzino-corridoio')!;
    ronzino.alive = false;
    ronzino.x = -999;

    const events = killViaDrone(world);
    expect(events.some((e) => e.type === 'playerDied')).toBe(true);

    const spawn = centre(LEVEL_ATTRACCO.spawn.tx, LEVEL_ATTRACCO.spawn.ty);
    expect(world.state.player.x).toBe(spawn.x);
    expect(world.state.player.y).toBe(spawn.y);
    // "Il checkpoint torna alla stanza di spawn" — non resta sul
    // Magazzino dove si era arrivati prima di morire.
    expect(world.state.checkpoint.room).toBe('attracco');

    // Il Ronzino del corridoio non è mai stato visitato in questo
    // tentativo, eppure è tornato in vita al suo posto: tutto il
    // livello si resetta, non solo la stanza della morte.
    expect(ronzino.alive).toBe(true);
    expect(ronzino.x).not.toBe(-999);
  });

  it('lascia intatti i core già raccolti, come Tutorial', () => {
    // Stessa logica del "non farmabile" di Roguelike (vedi sotto),
    // solo che qui non c'è nemmeno bisogno di dirlo esplicitamente nel
    // GDD: un core raccolto sparisce dal mondo, non dallo stato — e lo
    // stato non è nella stanza del checkpoint né in quella di spawn.
    const world = new CampaignWorld(LEVEL_ATTRACCO, undefined, 'medio');
    world.state.cores[0]!.collected = true;

    killViaDrone(world);

    expect(world.state.cores[0]!.collected).toBe(true);
  });
});

describe('CampaignWorld — difficoltà Roguelike', () => {
  it("segnala il riavvio dell'atto invece di respawnare sul posto", () => {
    const world = new CampaignWorld(LEVEL_ATTRACCO, undefined, 'roguelike');

    const events = killViaDrone(world);

    expect(events.some((e) => e.type === 'playerDied')).toBe(true);
    expect(events.some((e) => e.type === 'actRestart')).toBe(true);
    expect(world.state.outcome).toBe('actRestart');
    // Nessun respawn: la sim non tocca la posizione, perché questo
    // mondo simula un livello solo e sta per essere buttato via dal
    // controller (vedi CampaignWorld.killPlayer e campaignGame.ts
    // restartAct). Ricostruire dal primo livello dell'atto è compito
    // del controller, non suo.
    expect(world.state.player.x).toBe(13.5 * TILE);
    expect(world.state.player.y).toBe(7 * TILE);
  });
});

describe('CampaignWorld — la progressione sopravvive alla morte in ogni modalità', () => {
  it.each(['tutorial', 'medio', 'roguelike'] as const)(
    '%s: xp e nodi restano dopo la morte',
    (difficulty) => {
      const world = new CampaignWorld(LEVEL_ATTRACCO, profileWith(difficulty));
      expect(world.tryUnlockNode('otturatore-rapido')).toBe(true);
      const xpBefore = world.state.xp;

      killViaDrone(world);

      // toProfile() è quello che sopravvive a un cambio di livello (o,
      // in Roguelike, a un cambio di mondo intero): se la progressione
      // regge lì, regge dove conta davvero.
      const after = world.toProfile();
      expect(after.xp).toBe(xpBefore);
      expect(after.unlockedNodes).toContain('otturatore-rapido');
      expect(after.difficulty).toBe(difficulty);
    },
  );
});
