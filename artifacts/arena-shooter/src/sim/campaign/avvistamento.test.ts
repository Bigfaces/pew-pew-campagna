// ================================================================
// AVVISTAMENTO — l'innesco della legenda del punto debole
// ================================================================
// GDD.md sezione 22. `enemySighted` è l'evento che dice al
// controller "è il momento di fermare tutto e spiegare il punto
// debole": deve nascere qui, nella simulazione, e non nel renderer,
// perché è tutta la ragione per cui è testabile senza un canvas. Vedi
// world.ts, updateEnemySighting.
//
// Ogni test isola una sola condizione delle quattro richieste
// (nemico vivo, giocatore vivo, linea di vista, cono in avanti),
// tenendo tutte le altre nella configurazione in cui l'evento
// dovrebbe scattare — stessa disciplina di quiet()/nudo() in
// testSupport.ts.
// ================================================================

import { describe, expect, it } from 'vitest';

import { attracco, centre, doorOf, quiet } from './testSupport';
import { emptyCampaignInput, type CampaignInput } from './types';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

describe('CampaignWorld — avvistamento del primo nemico', () => {
  it('arriva una sola volta, quando il primo nemico entra in vista', () => {
    // Spawn di ATTRACCO (2,5) e ronzino-corridoio (10,5) stanno sulla
    // stessa riga, quella "di passaggio" — completamente aperta (vedi
    // levels.ts). Guardare dritto a destra (aimAngle 0) li mette in
    // linea di vista e dentro al cono al primo tick.
    const world = attracco();

    const first = world.step(input({ aimAngle: 0 }));
    const sighted = first.filter((e) => e.type === 'enemySighted');
    expect(sighted).toHaveLength(1);
    expect(sighted[0]).toMatchObject({ id: 'ronzino-corridoio', kind: 'ronzino' });
    expect(world.state.enemySightedFired).toBe(true);

    // Stessa geometria, tick dopo tick: se l'evento nascesse da un
    // controllo "è visibile ora" invece che da un fronte di salita
    // con memoria, si ripeterebbe qui. Non deve.
    const second = world.step(input({ aimAngle: 0 }));
    const third = world.step(input({ aimAngle: 0 }));
    expect(second.some((e) => e.type === 'enemySighted')).toBe(false);
    expect(third.some((e) => e.type === 'enemySighted')).toBe(false);
  });

  it('non arriva se il nemico è dietro il giocatore', () => {
    // Stesso posto di partenza del test sopra — cambia solo dove si
    // guarda. Se scattasse comunque, il difetto sarebbe nel cono, non
    // nella geometria della stanza.
    const world = attracco();

    for (let i = 0; i < 5; i++) {
      const events = world.step(input({ aimAngle: Math.PI }));
      expect(events.some((e) => e.type === 'enemySighted')).toBe(false);
    }
    expect(world.state.enemySightedFired).toBe(false);
  });

  it('non arriva se la linea di vista è bloccata', () => {
    // La paratia sei chiude proprio i tile (9,4)-(9,5)-(9,6): con la
    // porta sigillata a mano, la riga di passaggio smette di essere
    // passante fra lo spawn e ronzino-corridoio, senza toccare
    // nient'altro della scena.
    const world = attracco();
    const { state: door } = doorOf(world);
    door.closed = true;

    for (let i = 0; i < 5; i++) {
      const events = world.step(input({ aimAngle: 0 }));
      expect(events.some((e) => e.type === 'enemySighted')).toBe(false);
    }
    expect(world.state.enemySightedFired).toBe(false);
  });

  it('non arriva per una torretta o un drone, anche in vista e in cono', () => {
    // quiet() toglie i nemici mobili: resta solo il drone del
    // Magazzino (state.turrets), sulla colonna 13 — completamente
    // aperta fra le righe 3 e 5 — quindi in vista e dritto davanti se
    // il giocatore guarda "in su". Se l'implementazione considerasse
    // anche le torrette, questo è lo scenario che lo scoprirebbe.
    const world = quiet(attracco());
    const p = centre(13, 5);
    world.state.player.x = p.x;
    world.state.player.y = p.y;

    for (let i = 0; i < 5; i++) {
      const events = world.step(input({ aimAngle: -Math.PI / 2 }));
      expect(events.some((e) => e.type === 'enemySighted')).toBe(false);
    }
    expect(world.state.enemySightedFired).toBe(false);
  });

  it('non arriva se il giocatore è morto', () => {
    // Isola la sola variabile in gioco, come quiet()/nudo(): orchestrare
    // una morte vera in più tick aggiungerebbe una seconda variabile
    // (quale nemico colpisce, quando) a una domanda che riguarda solo
    // il gate su `outcome`. In Roguelike, la morte vera (killPlayer)
    // produce esattamente 'actRestart' nello stesso tick in cui muore
    // — è lo stesso stato che il giocatore osserverebbe se potesse
    // guardarsi intorno da morto.
    const world = attracco();
    world.state.outcome = 'actRestart';

    const events = world.step(input({ aimAngle: 0 }));
    expect(events.some((e) => e.type === 'enemySighted')).toBe(false);
    expect(world.state.enemySightedFired).toBe(false);
  });
});
