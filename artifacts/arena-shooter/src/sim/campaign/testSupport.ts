// ================================================================
// TEST SUPPORT — scorciatoie condivise dai test della campagna
// ================================================================
// Quando il livello era il modulo, un test scriveva `new
// CampaignWorld()` e leggeva `world.state.drone`. Ora il livello è un
// dato e le entità sono liste, il che è giusto per il gioco ma
// verboso in un test che vuole solo "il drone dell'Attracco".
//
// Queste funzioni ridanno quella brevità senza rimettere le costanti
// globali: guardano dentro la definizione del livello, quindi se una
// entità si sposta i test seguono da soli invece di puntare a
// coordinate scritte due volte.
//
// Vive in src/ e non in un file .test.ts perché più file di test lo
// importano; è escluso dal bundle perché niente in src/ lo importa
// fuori dai test (tree-shaking), e tenerlo qui evita a tsconfig un
// percorso speciale.
// ================================================================

import { TILE } from '../constants';
import { LEVEL_ATTRACCO, LEVEL_CONDOTTI, LEVEL_MOLO } from './levels';
import type { LevelDef } from './levelTypes';
import type { CampaignProfile } from './types';
import { CampaignWorld } from './world';

export function centre(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}

export function attracco(profile?: CampaignProfile): CampaignWorld {
  return new CampaignWorld(LEVEL_ATTRACCO, profile);
}

export function condotti(profile?: CampaignProfile): CampaignWorld {
  return new CampaignWorld(LEVEL_CONDOTTI, profile);
}

export function molo(profile?: CampaignProfile): CampaignWorld {
  return new CampaignWorld(LEVEL_MOLO, profile);
}

/** La prima (e unica) porta del livello, con la sua definizione. */
export function doorOf(world: CampaignWorld) {
  const def = world.level.doors[0]!;
  return { def, state: world.state.doors.find((d) => d.id === def.id)! };
}

/** Una turret per id, o la prima del livello. */
export function turretOf(world: CampaignWorld, id?: string) {
  const def = id ? world.level.turrets.find((t) => t.id === id)! : world.level.turrets[0]!;
  return {
    def,
    state: world.state.turrets.find((t) => t.id === def.id)!,
    ...centre(def.tx, def.ty),
  };
}

export function shieldOf(world: CampaignWorld, index = 0) {
  return world.state.shields[index]!;
}

export function bossHome(level: LevelDef): { x: number; y: number } {
  return centre(level.boss!.tx, level.boss!.ty);
}

/** Porta il giocatore nella stanza del boss senza doverci camminare:
 *  updateBoss non parte finché il checkpoint non è quello giusto. */
export function enterBossRoom(world: CampaignWorld): void {
  const def = world.level.boss!;
  const home = bossHome(world.level);
  world.state.checkpoint = {
    room: def.room,
    x: home.x - 200,
    y: home.y,
    angle: 0,
  };
  world.state.player.x = home.x - 200;
  world.state.player.y = home.y;
}
