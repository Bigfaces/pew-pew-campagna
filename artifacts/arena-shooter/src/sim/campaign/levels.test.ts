// ================================================================
// LIVELLI — validazione strutturale e trabocchetti nuovi
// ================================================================
// Due famiglie di test, con scopi diversi.
//
// La prima non prova meccaniche: prova le *mappe*. Una griglia
// scritta a mano è un blocco di 300 cifre, e un 1 di troppo in una
// riga è invisibile finché non ci si sbatte contro — che qui vuol
// dire scoprirlo giocando, cosa che nessuno può fare al posto mio.
// Quindi: ogni entità su un tile calpestabile, le stanze coprono la
// mappa senza buchi, e soprattutto una visita in ampiezza che dimostri
// che dallo spawn si arriva davvero all'uscita o al boss.
//
// La seconda prova i tre trabocchetti aggiunti con l'Atto I, più il
// passaggio da un livello all'altro.
// ================================================================

import { describe, expect, it } from 'vitest';

import { TICK_MS, TILE } from '../constants';
import { ARBITER_CORE_HITS, ARBITER_HITS_TO_DEFEAT } from './constants';
import { COLLAPSE_HOLD_MS, GAS_LINGER_MS, TURRET_COOLDOWN_MS } from './constants';
import {
  CLOSE_RANGE_TILES,
  CORE_BAND_CENTRE,
  HEAD_BAND_LOW,
  LONG_RANGE_TILES,
  VULNERABILITY_MULT,
  WEAK_SPOT_MULT,
  archetypeOf,
  type EnemyArchetype,
} from './enemies';
import { ACT_ONE, ACT_TWO, ALL_LEVELS, LEVEL_CONDOTTI, levelById } from './levels';
import { roomAt, tileAt, type LevelDef, type TilePos } from './levelTypes';
import { campHasLOS } from './raycast';
import { centre, condotti, quiet } from './testSupport';
import { emptyCampaignInput, type CampaignInput } from './types';
import { CampaignWorld } from './world';

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return { ...emptyCampaignInput(), ...over };
}

/** Tutti i tile raggiungibili a piedi dallo spawn, in ampiezza. È la
 *  domanda che conta su una mappa: non "è scritta bene" ma "ci si
 *  cammina". */
function reachable(level: LevelDef, blocked?: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const queue: TilePos[] = [level.spawn];
  seen.add(`${level.spawn.tx},${level.spawn.ty}`);

  while (queue.length > 0) {
    const { tx, ty } = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      if (tileAt(level, nx, ny) !== 0) continue;
      if (blocked?.has(key)) continue;
      seen.add(key);
      queue.push({ tx: nx, ty: ny });
    }
  }
  return seen;
}

describe('campagna — struttura delle mappe', () => {
  it('ogni atto ha tre livelli numerati in ordine, e la catena non si spezza', () => {
    for (const act of [ACT_ONE, ACT_TWO]) {
      expect(act.map((l) => l.ordinal)).toEqual([1, 2, 3]);
      expect(new Set(act.map((l) => l.act)).size).toBe(1);
      // L'ultimo livello di un atto chiude con un boss invece che con
      // un'uscita, ma non chiude la campagna finché c'è un atto dopo.
      expect(act[2]!.exit).toBeNull();
      expect(act[2]!.boss).not.toBeNull();
    }

    // La catena attraversa gli atti: ogni livello punta al successivo,
    // e solo l'ultimo in assoluto non punta a niente.
    for (let i = 0; i < ALL_LEVELS.length - 1; i++) {
      expect(ALL_LEVELS[i]!.next, ALL_LEVELS[i]!.id).toBe(ALL_LEVELS[i + 1]!.id);
    }
    expect(ALL_LEVELS[ALL_LEVELS.length - 1]!.next).toBeNull();
  });

  it('ogni voragine ha una strada alternativa a piedi', () => {
    // Le passerelle sono l'unico punto in cui un nodo dell'albero
    // cambia la geometria di un livello. Un nodo facoltativo non può
    // diventare un requisito di sblocco, quindi la fine del livello
    // deve restare raggiungibile anche trattando ogni voragine come
    // invalicabile.
    for (const level of ALL_LEVELS) {
      if (level.chasms.length === 0) continue;
      const blocked = new Set<string>();
      for (const c of level.chasms) {
        for (const t of c.tiles) blocked.add(`${t.tx},${t.ty}`);
      }
      const seen = reachable(level, blocked);
      const target = level.exit ?? level.boss!;
      expect(
        seen.has(`${target.tx},${target.ty}`),
        `${level.name}: senza lo Scatto non si arriva alla fine`,
      ).toBe(true);
    }
  });

  it('un livello senza boss ha sempre un’uscita, e viceversa', () => {
    for (const level of ACT_ONE) {
      const ends = (level.boss === null ? 0 : 1) + (level.exit === null ? 0 : 1);
      // Esattamente un modo di finire: senza, il livello è un vicolo
      // cieco; con due, il giocatore può saltare il boss.
      expect(ends, level.id).toBe(1);
    }
  });

  for (const level of ALL_LEVELS) {
    describe(`${level.act}.${level.ordinal} — ${level.name}`, () => {
      it('la griglia ha le dimensioni dichiarate ed è chiusa dai muri', () => {
        expect(level.tiles.length).toBe(level.height);
        for (const row of level.tiles) expect(row.length).toBe(level.width);
        for (let tx = 0; tx < level.width; tx++) {
          expect(tileAt(level, tx, 0)).toBe(1);
          expect(tileAt(level, tx, level.height - 1)).toBe(1);
        }
        for (let ty = 0; ty < level.height; ty++) {
          expect(tileAt(level, 0, ty)).toBe(1);
          expect(tileAt(level, level.width - 1, ty)).toBe(1);
        }
      });

      it('ogni tile calpestabile appartiene a una stanza dichiarata', () => {
        // Con le stanze a intervalli di colonne bastava controllare che
        // gli intervalli coprissero la larghezza. Coi rettangoli quella
        // verifica non dice più niente — due stanze possono affiancarsi
        // in verticale — mentre la proprietà che conta è sempre stata
        // questa: nessun pezzo di pavimento fuori da ogni stanza, o il
        // checkpoint ci passerebbe sopra senza sapere dove si trova.
        for (let ty = 0; ty < level.height; ty++) {
          for (let tx = 0; tx < level.width; tx++) {
            if (tileAt(level, tx, ty) !== 0) continue;
            const id = roomAt(level, tx, ty);
            expect(
              level.rooms.some((r) => r.id === id),
              `tile (${tx},${ty})`,
            ).toBe(true);
          }
        }
      });

      it('nessuna stanza dichiarata è vuota', () => {
        // Una stanza senza pavimento è un'etichetta che il giocatore non
        // vedrà mai, e più probabilmente un rettangolo sbagliato.
        for (const room of level.rooms) {
          let floors = 0;
          for (let ty = room.fromTy ?? 0; ty <= (room.toTy ?? level.height - 1); ty++) {
            for (let tx = room.fromTx; tx <= room.toTx; tx++) {
              if (tileAt(level, tx, ty) === 0) floors++;
            }
          }
          expect(floors, `stanza ${room.id}`).toBeGreaterThan(0);
        }
      });

      it('ogni entità sta su un tile calpestabile', () => {
        const onFloor = (t: TilePos, what: string): void => {
          expect(tileAt(level, t.tx, t.ty), `${what} a (${t.tx},${t.ty})`).toBe(0);
        };

        onFloor(level.spawn, 'spawn');
        for (const t of level.turrets) onFloor(t, `turret ${t.id}`);
        for (const c of level.cores) onFloor(c, `core ${c.id}`);
        for (const s of level.shields) onFloor(s, `scudo ${s.id}`);
        for (const f of level.collapsingFloors) {
          for (const t of f.tiles) onFloor(t, `pavimento ${f.id}`);
          onFloor(f.landing, `atterraggio ${f.id}`);
        }
        for (const z of level.gasZones) {
          for (const t of z.tiles) onFloor(t, `gas ${z.id}`);
        }
        if (level.exit) onFloor(level.exit, 'uscita');
        if (level.boss) onFloor(level.boss, 'boss');
      });

      it('ogni id è unico, e ogni stanza citata esiste', () => {
        const ids = [
          ...level.doors.map((d) => d.id),
          ...level.turrets.map((t) => t.id),
          ...level.collapsingFloors.map((f) => f.id),
          ...level.gasZones.map((z) => z.id),
        ];
        expect(new Set(ids).size).toBe(ids.length);

        const rooms = new Set(level.rooms.map((r) => r.id));
        const cited = [
          ...level.doors.map((d) => d.room),
          ...level.turrets.map((t) => t.room),
          ...level.collapsingFloors.map((f) => f.room),
          ...level.gasZones.map((z) => z.room),
          ...(level.boss ? [level.boss.room] : []),
        ];
        for (const r of cited) expect(rooms.has(r), `stanza "${r}"`).toBe(true);
      });

      it('dallo spawn si raggiunge a piedi la fine del livello', () => {
        const seen = reachable(level);
        const target = level.exit ?? level.boss!;
        expect(seen.has(`${target.tx},${target.ty}`)).toBe(true);
      });

      it('ogni raccoglibile e ogni trabocchetto è raggiungibile', () => {
        const seen = reachable(level);
        const at = (t: TilePos, what: string): void => {
          expect(seen.has(`${t.tx},${t.ty}`), `${what} a (${t.tx},${t.ty})`).toBe(true);
        };
        for (const c of level.cores) at(c, `core ${c.id}`);
        for (const s of level.shields) at(s, `scudo ${s.id}`);
        for (const f of level.collapsingFloors) {
          at(f.landing, `atterraggio ${f.id}`);
          for (const t of f.tiles) at(t, `pavimento ${f.id}`);
        }
      });

    });
  }

  it('se una turret ti vede, tu vedi lei', () => {
    // La linea di vista deve essere simmetrica, o esistono punti in cui
    // si viene colpiti da qualcosa a cui non si può rispondere. Il DDA
    // che rade uno spigolo può decidere diversamente a seconda di dove
    // parte: su queste sei mappe c'erano nove coppie così, quattro
    // delle quali a sfavore del giocatore. Il controllo è esaustivo —
    // ogni turret contro ogni tile calpestabile — perché una manciata
    // di casi su tremila non si trova giocando.
    for (const level of ALL_LEVELS) {
      const get = (tx: number, ty: number): number => tileAt(level, tx, ty);
      for (let ty = 0; ty < level.height; ty++) {
        for (let tx = 0; tx < level.width; tx++) {
          if (get(tx, ty) !== 0) continue;
          const px = (tx + 0.5) * TILE;
          const py = (ty + 0.5) * TILE;
          for (const t of level.turrets) {
            const sx = (t.tx + 0.5) * TILE;
            const sy = (t.ty + 0.5) * TILE;
            expect(
              campHasLOS(get, sx, sy, px, py, level.width, level.height),
              `${level.id} ${t.id} → (${tx},${ty})`,
            ).toBe(campHasLOS(get, px, py, sx, sy, level.width, level.height));
          }
        }
      }
    }
  });

  it('un id di livello sconosciuto ricade sul primo invece di esplodere', () => {
    // Un profilo salvato può nominare un livello che non esiste più.
    // Ricominciare l'atto è meglio che non poter più entrare.
    expect(levelById('livello-che-non-esiste').id).toBe(ACT_ONE[0]!.id);
  });
});

// ================================================================
// Trabocchetti dell'Atto I
// ================================================================

describe('pavimento che cede', () => {
  const FLOOR = LEVEL_CONDOTTI.collapsingFloors[0]!;
  const ON = centre(FLOOR.tiles[1]!.tx, FLOOR.tiles[1]!.ty);
  const LANDING = centre(FLOOR.landing.tx, FLOOR.landing.ty);

  function standing(): CampaignWorld {
    const world = condotti();
    world.state.player.x = ON.x;
    world.state.player.y = ON.y;
    return world;
  }

  /** La regola che il trabocchetto deve incarnare, misurata invece che
   *  dichiarata: si passa camminando, non si passa fermandosi.
   *
   *  La prima taratura metteva COLLAPSE_HOLD_MS esattamente alla
   *  durata della traversata, e il pavimento cedeva a chiunque —
   *  anche a chi lo attraversava di corsa senza mai fermarsi. Un
   *  trabocchetto impossibile da superare non è una scelta, è un muro,
   *  e dal codice non si vedeva: bisognava attraversarlo. */
  it('si attraversa camminando dritti, senza fermarsi', () => {
    const world = condotti();
    for (const t of world.state.turrets) t.alive = false;
    const firstTx = Math.min(...FLOOR.tiles.map((t) => t.tx));
    const lastTx = Math.max(...FLOOR.tiles.map((t) => t.tx));
    const start = centre(firstTx - 1, FLOOR.tiles[0]!.ty);
    world.state.player.x = start.x;
    world.state.player.y = start.y;

    let collapsed = false;
    for (let i = 0; i < 600; i++) {
      if (world.step(input({ forward: 1 })).some((e) => e.type === 'floorCollapsed')) {
        collapsed = true;
      }
      if (Math.floor(world.state.player.x / TILE) > lastTx) break;
    }

    expect(collapsed).toBe(false);
    expect(Math.floor(world.state.player.x / TILE)).toBeGreaterThan(lastTx);
  });

  it('cede a chi si ferma in mezzo per mirare', () => {
    const world = condotti();
    for (const t of world.state.turrets) t.alive = false;
    const firstTx = Math.min(...FLOOR.tiles.map((t) => t.tx));
    const start = centre(firstTx - 1, FLOOR.tiles[0]!.ty);
    world.state.player.x = start.x;
    world.state.player.y = start.y;

    // Due tile dentro, poi fermo: è il gesto — incamminarsi e poi
    // piantarsi a prendere la mira — che la trappola deve punire.
    let collapsed = false;
    for (let i = 0; i < 600 && !collapsed; i++) {
      const moving = Math.floor(world.state.player.x / TILE) < firstTx + 2;
      const ev = world.step(moving ? input({ forward: 1 }) : input());
      if (ev.some((e) => e.type === 'floorCollapsed')) collapsed = true;
    }
    expect(collapsed).toBe(true);
  });

  it('non cede finché non ci si resta sopra abbastanza', () => {
    const world = standing();
    const ticks = Math.floor(COLLAPSE_HOLD_MS / TICK_MS) - 2;
    for (let i = 0; i < ticks; i++) world.step();
    expect(world.state.collapsingFloors[0]!.collapsed).toBe(false);
    expect(world.state.player.x).toBe(ON.x);
  });

  it('cede e riporta al punto di atterraggio', () => {
    const world = standing();
    let collapsed = false;
    const ticks = Math.ceil(COLLAPSE_HOLD_MS / TICK_MS) + 2;
    for (let i = 0; i < ticks; i++) {
      if (world.step().some((e) => e.type === 'floorCollapsed')) collapsed = true;
    }
    expect(collapsed).toBe(true);
    expect(world.state.player.x).toBe(LANDING.x);
    expect(world.state.player.y).toBe(LANDING.y);
  });

  it('non uccide: è un costo di tempo, non una morte', () => {
    const world = standing();
    const ticks = Math.ceil(COLLAPSE_HOLD_MS / TICK_MS) + 2;
    let died = false;
    for (let i = 0; i < ticks; i++) {
      if (world.step().some((e) => e.type === 'playerDied')) died = true;
    }
    expect(died).toBe(false);
  });

  it('il contatore si azzera uscendo: si attraversa, non si attraversa a rate', () => {
    const world = standing();
    const half = Math.floor(COLLAPSE_HOLD_MS / TICK_MS / 2);
    for (let i = 0; i < half; i++) world.step();
    expect(world.state.collapsingFloors[0]!.standingMs).toBeGreaterThan(0);

    // Un passo fuori, e il conto riparte da zero.
    world.state.player.x = LANDING.x;
    world.state.player.y = LANDING.y;
    world.step();
    expect(world.state.collapsingFloors[0]!.standingMs).toBe(0);
  });

  it('resta attraversabile anche da ceduto: murarlo bloccherebbe il pozzo', () => {
    const world = standing();
    const ticks = Math.ceil(COLLAPSE_HOLD_MS / TICK_MS) + 2;
    for (let i = 0; i < ticks; i++) world.step();
    expect(world.state.collapsingFloors[0]!.collapsed).toBe(true);
    for (const t of FLOOR.tiles) expect(world.getTile(t.tx, t.ty)).toBe(0);
  });
});

describe('gas / EMP', () => {
  const ZONE = LEVEL_CONDOTTI.gasZones[0]!;
  const INSIDE = centre(ZONE.tiles[0]!.tx, ZONE.tiles[0]!.ty);

  /** La nube sta nella stessa stanza di una turret — di proposito, è
   *  ciò che rende il trabocchetto una minaccia e non un filtro
   *  colorato. Ma un test sul gas deve misurare il gas: con la turret
   *  viva misurerebbe la turret. */
  function gasOnly(): CampaignWorld {
    const world = condotti();
    for (const t of world.state.turrets) t.alive = false;
    return world;
  }

  it('acceca entrando e lascia una coda uscendo', () => {
    const world = gasOnly();
    world.state.player.x = INSIDE.x;
    world.state.player.y = INSIDE.y;

    const events = world.step();
    expect(events.some((e) => e.type === 'gasEntered')).toBe(true);
    expect(world.blinded).toBe(true);
    expect(world.state.player.empMs).toBe(GAS_LINGER_MS);

    // Fuori dalla nube l'accecamento scende, ma non si spegne subito:
    // uscire e riavere tutto renderebbe la nube un fastidio da
    // attraversare invece che una zona da cui si esce disorientati.
    world.state.player.x = 15.5 * TILE;
    world.state.player.y = 6.5 * TILE;
    world.step();
    expect(world.blinded).toBe(true);
    expect(world.state.player.empMs).toBeLessThan(GAS_LINGER_MS);

    let cleared = false;
    const ticks = Math.ceil(GAS_LINGER_MS / TICK_MS) + 2;
    for (let i = 0; i < ticks; i++) {
      if (world.step().some((e) => e.type === 'gasCleared')) cleared = true;
    }
    expect(cleared).toBe(true);
    expect(world.blinded).toBe(false);
  });

  it('non fa danno: toglie informazione, non vita', () => {
    const world = quiet(gasOnly());
    world.state.player.x = INSIDE.x;
    world.state.player.y = INSIDE.y;
    let died = false;
    for (let i = 0; i < 200; i++) {
      if (world.step().some((e) => e.type === 'playerDied')) died = true;
      // Ferma il giocatore dentro la nube: stare nel gas non deve
      // costare niente oltre alla cecità.
      world.state.player.x = INSIDE.x;
      world.state.player.y = INSIDE.y;
    }
    expect(died).toBe(false);
    expect(world.blinded).toBe(true);
  });
});

describe('corridoio a fuoco incrociato', () => {
  const GALLERIA = levelById('molo').turrets;

  it('sono tre turret identiche, sfasate di un terzo di ciclo', () => {
    expect(GALLERIA.length).toBe(3);
    for (const t of GALLERIA) expect(t.cooldownMs).toBe(TURRET_COOLDOWN_MS);

    const phases = GALLERIA.map((t) => Math.round(t.phaseMs));
    expect(phases).toEqual([
      0,
      Math.round(TURRET_COOLDOWN_MS / 3),
      Math.round((TURRET_COOLDOWN_MS * 2) / 3),
    ]);
  });

  it('lo sfasamento è davvero uno stato iniziale, non solo una costante', () => {
    const world = new CampaignWorld(levelById('molo'));
    const cooldowns = world.state.turrets.map((t) => t.fireCooldown);
    expect(cooldowns).toEqual(GALLERIA.map((t) => t.phaseMs));
    // Tre turret che sparano sullo stesso battito sarebbero più
    // facili, non più difficili: si aspetta la salva e si passa.
    expect(new Set(cooldowns).size).toBe(3);
  });
});

describe('passaggio di livello', () => {
  it('raggiungere l’uscita chiude il livello e nomina il successivo', () => {
    const world = condotti();
    const exit = centre(LEVEL_CONDOTTI.exit!.tx, LEVEL_CONDOTTI.exit!.ty);
    world.state.player.x = exit.x;
    world.state.player.y = exit.y;

    const events = world.step();
    const done = events.find((e) => e.type === 'levelCompleted');
    expect(done).toBeDefined();
    expect(done).toMatchObject({ levelId: 'condotti', next: 'molo' });
    expect(world.state.outcome).toBe('levelComplete');
    expect(world.finished).toBe(true);
  });

  it('il profilo porta al livello successivo ciò che va portato, e niente altro', () => {
    const world = condotti();
    world.state.xp = 200;
    world.state.unlockedNodes = ['scatto'];
    world.state.cores[0]!.collected = true;
    const exit = centre(LEVEL_CONDOTTI.exit!.tx, LEVEL_CONDOTTI.exit!.ty);
    world.state.player.x = exit.x;
    world.state.player.y = exit.y;
    world.step();

    const profile = world.toProfile();
    expect(profile.completedLevels).toContain('condotti');
    expect(profile.collectedCoreIds).toContain(world.state.cores[0]!.id);

    // L'XP al momento dell'uscita, non 200: entrare nel sas è esso
    // stesso una stanza nuova, e paga il suo bonus.
    const xpAtExit = world.state.xp;
    expect(xpAtExit).toBeGreaterThanOrEqual(200);

    const next = new CampaignWorld(levelById('molo'), { ...profile, levelId: 'molo' });
    expect(next.state.xp).toBe(xpAtExit);
    expect(next.state.unlockedNodes).toEqual(['scatto']);
    // Il livello nuovo parte dal suo spawn, con i suoi trabocchetti
    // intatti: niente del run precedente lo attraversa.
    expect(next.state.checkpoint.room).toBe('ingresso');
    expect(next.state.turrets.every((t) => t.alive)).toBe(true);
    expect(next.state.player.shieldCharges).toBe(0);
  });

  it('chiudere l’ultimo livello della campagna è una vittoria, non un passaggio', () => {
    const world = new CampaignWorld(levelById('nido'));
    const boss = world.state.boss!;
    world.state.checkpoint = { room: 'nido', x: boss.x - 90, y: boss.y, angle: 0 };
    world.state.player.x = boss.x - 90;
    world.state.player.y = boss.y;

    // ARBITER si finisce nella terza fase, col nucleo aperto: un colpo
    // dal davanti mentre è sigillato non lo scalfisce.
    boss.stage = 3;
    boss.phase = 'coreOpen';
    boss.phaseTimer = 5000;
    boss.stageDamage = ARBITER_CORE_HITS - 1;
    boss.damageTaken = ARBITER_HITS_TO_DEFEAT - 1;

    const events = world.step(input({ aimAngle: 0, fire: true }));
    expect(events.some((e) => e.type === 'bossDefeated')).toBe(true);
    const done = events.find((e) => e.type === 'levelCompleted');
    expect(done).toMatchObject({ levelId: 'nido', next: null });
    expect(world.state.outcome).toBe('victory');
  });
});

// ================================================================
// Attraversabilità
// ================================================================
// La domanda che nessun test sulle singole meccaniche pone: il livello
// si può *finire*?
//
// Una mappa può essere valida, connessa e piena di trabocchetti
// corretti, e restare impossibile — è successo con la prima stesura
// della galleria, un tubo dritto dove tutte e tre le turret vedevano
// il giocatore contemporaneamente: nessuna copertura, un colpo ogni
// 600 ms, e l'attraversamento moriva a metà ogni volta. Dal codice non
// si vedeva, e il giocatore non può provare le build al posto mio.
//
// Quindi un bot: cammina verso l'uscita, e quando vede una turret si
// ferma e le spara. È un giocatore mediocre — non usa scatto, non usa
// copertura, non raccoglie niente — e proprio per questo è la soglia
// giusta: se ce la fa lui, il livello è attraversabile.

interface BotRun {
  completed: boolean;
  deaths: number;
  ticks: number;
}

/** Direzione del prossimo passo verso `goal`, calcolata in ampiezza
 *  sulla mappa viva (porte sigillate comprese). Serve al bot per
 *  girare gli angoli: la chicane della galleria è fatta apposta per
 *  spezzare la linea retta.
 *
 *  Le voragini contano come invalicabili, perché il bot non usa lo
 *  Scatto. Non è una semplificazione: è *il punto*. Se il bot arriva
 *  in fondo aggirandole, allora la strada alternativa a piedi esiste
 *  davvero e il nodo Scatto è rimasto una scorciatoia invece di
 *  diventare un requisito. Senza questo, il bot cadeva nel vuoto e ci
 *  ricadeva in eterno — zero morti e zero progressi. */
function stepToward(
  world: CampaignWorld,
  level: LevelDef,
  goal: TilePos,
): number | null {
  const voids = new Set<string>();
  for (const c of level.chasms) {
    for (const t of c.tiles) voids.add(`${t.tx},${t.ty}`);
  }
  const from = {
    tx: Math.floor(world.state.player.x / TILE),
    ty: Math.floor(world.state.player.y / TILE),
  };
  if (from.tx === goal.tx && from.ty === goal.ty) return null;

  // Visita all'indietro, dalla meta: la prima casella adiacente alla
  // posizione attuale che risulta visitata è il passo giusto.
  const dist = new Map<string, number>();
  const queue: TilePos[] = [goal];
  dist.set(`${goal.tx},${goal.ty}`, 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(`${cur.tx},${cur.ty}`)!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cur.tx + dx;
      const ny = cur.ty + dy;
      const key = `${nx},${ny}`;
      if (dist.has(key)) continue;
      if (world.getTile(nx, ny) !== 0) continue;
      if (voids.has(key)) continue;
      dist.set(key, d + 1);
      queue.push({ tx: nx, ty: ny });
    }
  }

  let best: { tx: number; ty: number; d: number } | null = null;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = from.tx + dx;
    const ny = from.ty + dy;
    const d = dist.get(`${nx},${ny}`);
    if (d === undefined) continue;
    if (!best || d < best.d) best = { tx: nx, ty: ny, d };
  }
  if (!best) return null;
  return Math.atan2(
    (best.ty + 0.5) * TILE - world.state.player.y,
    (best.tx + 0.5) * TILE - world.state.player.x,
  );
}

function botCross(
  level: LevelDef,
  maxSeconds = 90,
  /** Condizione di arrivo alternativa alla fine del livello. */
  reached?: (w: CampaignWorld) => boolean,
): BotRun {
  const world = new CampaignWorld(level);
  const goal: TilePos = level.exit ?? level.boss!;
  let deaths = 0;
  const maxTicks = Math.ceil((maxSeconds * 1000) / TICK_MS);
  /** Bersagli a cui sparare non ha prodotto niente, e fino a quando
   *  lasciarli perdere.
   *
   *  Serve perché la linea di vista e il raggio del colpo non sono
   *  *obbligati* a concordare: campHasLOS è stata resa simmetrica di
   *  proposito (era una scorrettezza: nove coppie turret/tile su 2939
   *  si vedevano solo da un lato), e la simmetria si ottiene fissando
   *  un ordine canonico degli estremi — quindi da un pelo di sbieco
   *  la linea può passare mentre il colpo sfiora lo spigolo. Il bot
   *  non deve indovinare perché: gli basta accorgersi che quel
   *  bersaglio non risponde e passare al successivo. */
  const wasted = new Map<string, number>();
  const WASTE_MS = 3000;

  for (let t = 0; t < maxTicks; t++) {
    const p = world.state.player;

    // La turret viva più vicina che ci vede. Se c'è, si spara a quella
    // e basta: muoversi sotto tiro senza copertura è il modo di morire
    // che il bot non deve confondere con un livello impossibile.
    // Le minacce che ci vedono, e soprattutto quali di esse possono
    // *già* sparare: una turret in linea può sempre, un nemico solo
    // dentro la sua portata. Il bot prende la più vicina fra quelle
    // calde, e solo se non ce ne sono guarda le altre.
    //
    // Le due stesure precedenti sbagliavano qui, in modi diversi e
    // istruttivi: la prima ignorava i nemici, la seconda dava loro la
    // precedenza assoluta e il bot passava le partite a sparare a un
    // Falco fuori portata in fondo alla stanza mentre la turret
    // accanto lo abbatteva al checkpoint una volta ogni ricarica.
    // Novantatré morti che non dicevano niente sul livello.
    type Threat = {
      x: number;
      y: number;
      d: number;
      hot: boolean;
      mobile: boolean;
      angle: number;
      arch?: EnemyArchetype;
    };
    const threats: Threat[] = [];
    for (const state of world.state.turrets) {
      if (!state.alive) continue;
      const def = level.turrets.find((d) => d.id === state.id)!;
      const { x, y } = centre(def.tx, def.ty);
      if (!campHasLOS(world.getTile, p.x, p.y, x, y, level.width, level.height)) continue;
      threats.push({ x, y, d: Math.hypot(x - p.x, y - p.y), hot: true, mobile: false, angle: 0 });
    }
    for (const e of world.state.enemies) {
      if (!e.alive) continue;
      if (!campHasLOS(world.getTile, p.x, p.y, e.x, e.y, level.width, level.height)) continue;
      const a = archetypeOf(e.kind);
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      threats.push({
        x: e.x,
        y: e.y,
        d,
        hot: a.attack !== 'none' && d <= Math.max(a.rangeTiles, 1) * TILE,
        mobile: true,
        angle: e.angle,
        arch: a,
      });
    }
    // Fra le minacce calde si sceglie quella che costa meno colpi
    // togliere, non la più vicina. Una turret se ne va con un colpo e
    // resta andata; un nemico ne chiede uno o due — e se sta nella
    // stanza del checkpoint, morire lo riporta in piedi intero.
    //
    // È la differenza fra un bot che risolve la stanza e uno che
    // rimane in un anello: con la sola distanza, il bot uccideva lo
    // stesso nemico a 1.8 tile ogni 816 ms, cioè una volta per
    // respawn, mentre la turret a 4.5 tile lo abbatteva indisturbata.
    // Centouno morti e la stanza mai finita.
    const shotsToClear = (c: Threat): number => {
      if (!c.arch) return 1;
      const best = WEAK_SPOT_MULT * (c.arch.vulnerability === 'nessuna' ? 1 : VULNERABILITY_MULT);
      return Math.max(1, Math.ceil(c.arch.hp / best));
    };
    const key = (c: Threat): string => `${Math.round(c.x)},${Math.round(c.y)}`;
    const live = threats.filter((c) => (wasted.get(key(c)) ?? -Infinity) < t * TICK_MS);
    const hot = live.filter((x) => x.hot);
    const pool = hot.length > 0 ? hot : live;
    let target: Threat | null = null;
    for (const c of pool) {
      if (!target) {
        target = c;
        continue;
      }
      // A parità di colpi vince la turret, anche se è più lontana:
      // una turret abbattuta resta abbattuta, mentre un nemico nella
      // stanza del checkpoint torna intero a ogni morte. Con la sola
      // distanza il bot spendeva l'unico colpo per vita sul nemico a
      // 1.8 tile e la turret a 4.7 lo abbatteva indisturbata, in
      // eterno: centouno morti e la stanza mai finita.
      const rank = (x: Threat): [number, number, number] => [
        shotsToClear(x),
        x.mobile ? 1 : 0,
        x.d,
      ];
      const [ca, cb, cc] = rank(c);
      const [ta, tb, tc] = rank(target);
      if (ca < ta || (ca === ta && (cb < tb || (cb === tb && cc < tc)))) target = c;
    }

    // E non si spara *attraverso* qualcuno. La simulazione assegna il
    // colpo al bersaglio più vicino lungo il raggio (vedi fireWeapon),
    // quindi mirare alla turret dietro il nemico che hai in faccia
    // vuol dire colpire il nemico. Il bot lo scopriva sprecando ogni
    // colpo — un colpo ogni 1400 ms — e la stanza non finiva mai.
    if (target) {
      const bearing = Math.atan2(target.y - p.y, target.x - p.x);
      for (const c of threats) {
        if (c === target || c.d >= target.d) continue;
        let diff = Math.abs(Math.atan2(c.y - p.y, c.x - p.x) - bearing) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        // Tolleranza angolare pari al raggio della sagoma alla sua
        // distanza: è quanto occupa davvero sulla linea di tiro.
        if (diff < Math.atan2(TILE * 0.4, Math.max(c.d, 1))) target = c;
      }
    }

    let ev;
    if (target) {
      const aim = Math.atan2(target.y - p.y, target.x - p.x);
      let aimSlope = 0;
      let ads = false;
      let forward = 0;
      let strafe = 0;
      let fire = p.weaponCooldown <= 0;

      if (target.arch) {
        const a = target.arch;
        const h = a.height * TILE;
        const base = (a.floatZ ?? 0) * TILE;
        if (a.weakSpot === 'core') {
          aimSlope = (base + h * CORE_BAND_CENTRE - TILE / 2) / Math.max(target.d, 1);
        } else if (a.weakSpot === 'head') {
          aimSlope = (base + h * (HEAD_BAND_LOW + 0.08) - TILE / 2) / Math.max(target.d, 1);
        }
        ads = a.vulnerability === 'mirato';

        // Traversata perpendicolare, lato alternato lentamente.
        strafe = Math.floor(t / 45) % 2 === 0 ? 1 : -1;

        if (a.weakSpot === 'rear') {
          // Girando attorno si tiene un verso solo. Alternare, che
          // contro tutti gli altri va benissimo, qui annulla il
          // vantaggio: si guadagnano 0.009 rad per tick sul rateo di
          // rotazione del nemico, e invertire ogni 45 tick li
          // restituisce tutti. Il bot girava per novanta secondi senza
          // mai arrivare dietro.
          strafe = 1;
          // Dorso: si gira attorno. Non è una furbizia del bot, è
          // *la* risposta che il gioco chiede — e funziona solo da
          // vicino, perché la velocità angolare di chi traversa cresce
          // mentre la distanza cala, e il nemico ruota a rateo fisso.
          // Il punto in cui il conto si inverte (~1.7 tile) è dove
          // ENEMY_TURN_RATE è stato messo apposta.
          if (target.d > TILE * 1.6) forward = 1;
          else if (target.d < TILE * 1.1) forward = -1;
          // Contro una piastra frontale sparare davanti è sprecare un
          // colpo da 1400 ms: si aspetta di esserci dietro.
          if (a.frontImmune) {
            const toShooter = Math.atan2(p.y - target.y, p.x - target.x);
            let diff = Math.abs(toShooter - target.angle) % (Math.PI * 2);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;
            if (diff < Math.PI * 0.62) fire = false;
          }
        } else {
          // La distanza di ingaggio la detta la vulnerabilità del
          // bersaglio, che è esattamente ciò che il gioco chiede di
          // fare a un giocatore: al Crogiolo si spara da lontano, al
          // Ronzino da vicino. Un bot che ingaggia tutti alla stessa
          // distanza misurerebbe un gioco diverso da quello scritto.
          const wantMin =
            a.vulnerability === 'distante' ? LONG_RANGE_TILES + 0.5 : 2.5;
          const wantMax =
            a.vulnerability === 'ravvicinato' ? CLOSE_RANGE_TILES - 0.5 : Infinity;
          if (target.d < wantMin * TILE) forward = -1;
          else if (target.d > wantMax * TILE) forward = 1;
        }
      }

      ev = world.step(input({ aimAngle: aim, aimSlope, ads, fire, forward, strafe }));
      if (fire && !ev.some((x) => x.type === 'enemyHit' || x.type === 'turretDown')) {
        wasted.set(key(target), t * TICK_MS + WASTE_MS);
      }
    } else {
      // Niente minacce: un passo lungo il percorso verso l'uscita.
      // Camminare "verso est" bastava finché i livelli erano tubi
      // dritti, e si piantava contro la prima chicane — cioè proprio
      // contro il pezzo di level design che serviva verificare.
      const aim = stepToward(world, level, goal);
      ev = aim === null ? world.step(input()) : world.step(input({ aimAngle: aim, forward: 1 }));
    }

    for (const e of ev) {
      if (e.type === 'playerDied') deaths++;
      if (e.type === 'levelCompleted') return { completed: true, deaths, ticks: t };
    }
    if (reached?.(world)) return { completed: true, deaths, ticks: t };
  }
  return { completed: false, deaths, ticks: maxTicks };
}

describe('attraversabilità', () => {
  for (const level of ALL_LEVELS.filter((l) => l.exit !== null)) {
    it(`${level.name} si attraversa sparando alle turret e camminando`, () => {
      const run = botCross(level);
      expect(run.completed, `morti: ${run.deaths}`).toBe(true);
      // Qualche morte è accettabile — il bot non si ripara e non
      // schiva — ma una decina vuol dire che il livello non insegna
      // niente, punisce e basta.
      expect(run.deaths).toBeLessThan(6);
    });
  }

  // I livelli con boss non hanno uscita: finiscono col boss, che il bot
  // non sa combattere (l'uno chiede di girargli dietro durante la
  // carica, l'altro di aspettare la finestra). Quello che si verifica è
  // che si arrivi alla sua stanza — cioè che il level design nuovo,
  // galleria e anticamera, si superi.
  for (const [levelId, room] of [
    ['molo', 'molo'],
    ['nucleo', 'nucleo'],
    ['nido', 'nido'],
  ] as const) {
    it(`si arriva alla stanza del boss di ${levelId}`, () => {
      const level = levelById(levelId);
      const run = botCross(level, 90, (w) => w.state.checkpoint.room === room);
      expect(run.completed, `morti: ${run.deaths}`).toBe(true);
      expect(run.deaths).toBeLessThan(6);
    });
  }
});
