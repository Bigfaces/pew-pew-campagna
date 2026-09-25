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

/** Segna una stanza come già vista in questo mondo, senza dover
 *  inscenare il cammino che ce la porta: aggiunge `room` a
 *  `visitedRooms` se non c'è già.
 *
 *  Serve a chi teletrasporta il giocatore per saltare un pezzo di
 *  livello (come `enterBossRoom` qui sotto) e vuole dichiarare "sono
 *  già stato qui", non "ci sto entrando ora": senza, il prossimo
 *  `step()` conterebbe quella stanza come prima visita e le
 *  pagherebbe una battuta, un'XP di stanza e una ricarica scudo che un
 *  giocatore vero — arrivatoci camminando — avrebbe già incassato
 *  prima (vedi CampaignWorld.updateCheckpoint). */
export function markRoomVisited(world: CampaignWorld, room: string): void {
  if (!world.state.visitedRooms.includes(room)) {
    world.state.visitedRooms.push(room);
  }
}

/** Come `markRoomVisited`, ma segna anche `reachedRoom` — il campo che
 *  sveglia i boss (CampaignWorld.updateBoss) e di cui `visitedRooms` è
 *  il completamento sui livelli ad anello (vedi CampaignState). Un
 *  test che salta a una stanza vuole quasi sempre dire entrambe le
 *  cose insieme: scriverne una sola lascerebbe l'altra a raccontare
 *  una bugia che una partita vera non produce mai. */
export function markRoomReached(world: CampaignWorld, room: string): void {
  world.state.reachedRoom = room;
  markRoomVisited(world, room);
}

/** Toglie di mezzo i nemici mobili e la finestra di grazia iniziale.
 *
 *  Serve ai test che parlano di *un'altra cosa*: una porta stagna, il
 *  pavimento che cede, il gas. Quando la campagna aveva solo turret,
 *  una stanza era uno sfondo fermo e questi test potevano ignorarla;
 *  con un Ronzino nel corridoio dell'Attracco, il test della porta
 *  misurava anche quanto sopravvive chi resta fermo a metà corridoio,
 *  e falliva per la ragione sbagliata.
 *
 *  Non è nascondere la polvere sotto il tappeto: che i nemici
 *  uccidano, inseguano e rinascano è provato altrove, in
 *  enemies.test.ts e dal bot di attraversabilità su tutte e nove le
 *  mappe. Qui si isola la variabile, che è il motivo per cui i test
 *  esistono. */
export function quiet(world: CampaignWorld): CampaignWorld {
  world.state.enemies = [];
  world.state.player.respawnInvulnerableMs = 0;
  // Anche le piastre, per la stessa ragione per cui sparisce la
  // grazia: isolare la variabile. Da quando si comincia coperti
  // (SHIELD_CHARGES_BASE) un test che non le togliesse misurerebbe la
  // prima piastra che si rompe e crederebbe di aver visto morire
  // qualcuno. Chi vuole *le piastre* le rimette a mano.
  world.state.player.shieldCharges = 0;
  return world;
}

/** Toglie le piastre. Da quando si comincia coperti
 *  (SHIELD_CHARGES_BASE), un test che vuole misurare *la morte* deve
 *  dire di volerla: altrimenti misura la prima piastra che si rompe e
 *  crede di aver visto morire qualcuno. Dichiararlo qui, per nome, è
 *  meglio che azzerare un campo di nascosto in venti setup diversi. */
export function nudo(world: CampaignWorld): CampaignWorld {
  world.state.player.shieldCharges = 0;
  return world;
}

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
  // Dire "il giocatore è arrivato" richiede tre campi, non più uno.
  // Il checkpoint è *dove si rinasce* e da quando pretende un posto
  // sicuro (vedi CampaignWorld.updateCheckpoint) può restare indietro
  // rispetto al giocatore; `reachedRoom` è *fin dove si è arrivati*, ed
  // è ciò che sveglia il boss; `visitedRooms` è *dove si è già stati*,
  // ed è ciò che spegne la battuta, l'XP di stanza e la ricarica delle
  // piastre alla prossima soglia (vedi CampaignState). Scriverne solo
  // uno o due mette il mondo in uno stato che una partita vera non
  // produce mai: un boss addormentato con il giocatore in sala, una
  // sala pagata due volte in XP, o le piastre ricaricate di sorpresa
  // al primo tick di un test che le aveva appena tolte.
  markRoomReached(world, def.room);
  world.state.player.x = home.x - 200;
  world.state.player.y = home.y;
}
