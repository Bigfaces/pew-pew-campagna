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
import { BOSS_CHARGE_MS, RESPAWN_GRACE_MS, TURRET_REACTION_MS, XP_ROOM_ENTER } from './constants';
import { archetypeOf } from './enemies';
import { campCircleHitsTile } from './physics';
import { weaponStatsFor } from './skills';
import {
  attracco,
  nudo,
  bossHome,
  doorOf,
  enterBossRoom,
  markRoomReached,
  markRoomVisited,
  molo,
  shieldOf,
  turretOf,
  quiet,
} from './testSupport';
import { ALL_LEVELS, levelById } from './levels';
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

  it('nessuna vita finisce nell istante in cui scade la grazia', () => {
    // La proprieta' e' una sola e vale per tutto il gioco, non per un
    // livello: dopo una morte, la vita che comincia deve durare piu'
    // della grazia. Se finisse dentro, vorrebbe dire che si rinasce in
    // un posto gia' perduto — il difetto di partenza.
    //
    // Prima questa prova girava sul solo ATTRACCO e si appoggiava a un
    // bot che moriva tante volte. Adesso su ATTRACCO muore una volta
    // sola, perche' la rinascita lo mette al riparo: la premessa se
    // n'e' andata proprio perche' la correzione funziona. Quindi si
    // guardano tutti e nove i livelli insieme — quelli dell'Atto III
    // di morti ne offrono a sufficienza — e si misurano tutti gli
    // intervalli fra una morte e la successiva.
    const vite: { livello: string; ms: number }[] = [];
    for (const level of ALL_LEVELS) {
      const world = new CampaignWorld(level);
      let ultima = -1;
      for (let t = 0; t < 40_000 / TICK_MS; t++) {
        const morto = world
          .step({ ...emptyCampaignInput(), forward: 1, aimAngle: 0 })
          .some((e) => e.type === 'playerDied');
        if (!morto) continue;
        if (ultima >= 0) vite.push({ livello: level.id, ms: (t - ultima) * TICK_MS });
        ultima = t;
      }
    }

    // Il gioco deve ancora uccidere chi cammina a testa bassa: se
    // smettesse, questa prova starebbe misurando un gioco disinnescato.
    expect(vite.length, 'nessuno muore piu: la prova non guarda niente').toBeGreaterThan(5);

    // Il margine e' piccolo apposta: col difetto la morte arrivava *un
    // tick* dopo la fine dell'invulnerabilita', perche' il drone aveva
    // gia' finito di prendere la mira mentre il giocatore era
    // intoccabile. Alzare la grazia da sola avrebbe spostato l'ora
    // della morte di un tick e nient'altro — ed e' esattamente cio' che
    // questa soglia rifiuta di accettare come correzione.
    const piuBreve = vite.reduce((a, b) => (b.ms < a.ms ? b : a));
    expect(
      piuBreve.ms,
      `vita piu breve: ${(piuBreve.ms / 1000).toFixed(2)}s su ${piuBreve.livello}`,
    ).toBeGreaterThan(RESPAWN_GRACE_MS.tutorial + 300);
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
    // La scena si costruisce invece di sperare che un bot ci finisca
    // dentro: da quando la rinascita arretra al riparo, quel bot sul
    // solo ATTRACCO muore una volta e si ferma li'.
    // Senza nemici: qui si misura la paratia, non il corridoio. Con
    // loro il bot resta bloccato contro il Ronzino che non spara mai —
    // vero, ma un'altra prova.
    const world = quiet(attracco());
    const porta = () => world.state.doors[0]!;

    // Oltre la paratia, cosi' si chiude alle spalle. Il checkpoint
    // resta indietro, nell'ATTRACCO: e' il caso che creava il vicolo
    // cieco.
    // Il sensore sta su una colonna precisa: va attraversato a piedi,
    // non scavalcato con un teletrasporto, o la paratia non si accorge
    // di niente.
    const p = world.state.player;
    p.x = 6.5 * TILE;
    p.y = 5.5 * TILE;
    for (let t = 0; t < 12_000 / TICK_MS && !porta().closed; t++) {
      // Basta oltrepassare il sensore: proseguire dritti fino in fondo
      // al livello supererebbe l'uscita prima che la paratia finisca di
      // chiudersi (il tempo di attraversare CORRIDOIO e MAGAZZINO è
      // inferiore a DOOR_CLOSE_DELAY_MS), e step() ferma giustamente la
      // simulazione lì — un livello finito non deve più muoversi. Fermo
      // dopo il sensore, il timer della paratia scorre lo stesso.
      const forward = porta().armed ? 0 : 1;
      world.step({ ...emptyCampaignInput(), forward, aimAngle: 0 });
    }

    expect(porta().closed, 'premessa: la paratia deve essersi chiusa').toBe(true);

    // Il checkpoint torna dov'era: e' il caso del difetto, cioe' il
    // checkpoint *dietro* la paratia. Senza nemici avanzerebbe da solo
    // — proprio perche' la regola del posto sicuro funziona — e il
    // corridoio non sarebbe piu' un tratto da rigiocare.
    world.state.checkpoint = {
      room: 'attracco',
      x: 2.5 * TILE,
      y: 5.5 * TILE,
      angle: 0,
    };

    // E ora si muore per davvero, nel MAGAZZINO, sotto il drone: una
    // morte vera e non un metodo di comodo, perche' e' il percorso
    // vero a dover rimettere le cose a posto. Il tratto fra il
    // checkpoint e il punto in cui si e' morti — paratia compresa — o
    // quelle tre tile restano sigillate per sempre.
    p.x = 12.5 * TILE;
    p.y = 3.5 * TILE;
    p.respawnInvulnerableMs = 0;
    let morto = false;
    for (let t = 0; t < 12_000 / TICK_MS && !morto; t++) {
      morto = world.step().some((e) => e.type === 'playerDied');
    }
    expect(morto, 'premessa: il drone deve aver ucciso il giocatore').toBe(true);
    expect(porta().closed, 'la paratia e rimasta chiusa dopo una morte').toBe(false);
  });

  it('si rinasce un passo indietro, non dentro la linea di tiro', () => {
    // Pretendere che un checkpoint si prenda al sicuro non basta: il
    // checkpoint si prende una volta e i nemici camminano. E il
    // checkpoint di partenza — quello che ogni giocatore ha addosso
    // per tutto il primo minuto di ogni livello, e quello a cui torna
    // finché non ne conquista un altro — non passava per quella regola
    // affatto, perché è lo spawn scritto nel livello e basta.
    //
    // Sull'ATTRACCO si vede col livello così com'è: si muore, e il
    // punto di partenza è nel tiro del Ronzino che nel frattempo è
    // arrivato. Misurato: 21 morti al minuto stando fermi, ridotte a 2.
    // Senza piastre: qui si misura *dove si rinasce*, quindi serve
    // una morte. Con la dotazione di base il Ronzino verrebbe
    // assorbito e non si morirebbe affatto.
    const world = nudo(attracco());
    const cp = { ...world.state.checkpoint };
    const p = world.state.player;

    let morto = false;
    for (let t = 0; t < 20_000 / TICK_MS && !morto; t++) {
      morto = world.step().some((e) => e.type === 'playerDied');
    }
    expect(morto, 'premessa: il livello deve aver ucciso chi sta fermo').toBe(true);

    // La premessa che conta: il checkpoint, in quel momento, è un
    // brutto posto. Senza questo la prova passerebbe per caso.
    const sicuro = (x: number, y: number): boolean =>
      (world as unknown as { isSafeToRespawn: (x: number, y: number) => boolean }).isSafeToRespawn(
        x,
        y,
      );
    expect(sicuro(cp.x, cp.y), 'premessa: il checkpoint doveva essere sotto tiro').toBe(false);

    // Quindi non ci si rinasce dentro, e il posto nuovo è al riparo.
    expect(Math.hypot(p.x - cp.x, p.y - cp.y), 'rinato nel punto sotto tiro').toBeGreaterThan(0);
    expect(sicuro(p.x, p.y), 'rinato di nuovo sotto tiro').toBe(true);
    // Un passo, non un teletrasporto: se arretrasse mezza mappa
    // sarebbe una correzione peggiore del difetto.
    expect(Math.hypot(p.x - cp.x, p.y - cp.y) / TILE).toBeLessThanOrEqual(6);
  });

  it('quando non c e un passo indietro, la grazia aspetta invece di scorrere', () => {
    // ARCHIVIO e NIDO non hanno una sola casella libera dal tiro: due
    // e quattro torrette spazzano la stanza di partenza. Lì arretrare
    // non è un'opzione, e la grazia scorreva lo stesso — misurato, la
    // vita dopo una morte durava esattamente RESPAWN_GRACE_MS, al
    // tick. Cioè il ciclo del primo tester, con un numero diverso.
    for (const id of ['archivio', 'nido'] as const) {
      const world = new CampaignWorld(levelById(id));
      const vite: number[] = [];
      let ultima = -1;
      for (let t = 0; t < 40_000 / TICK_MS; t++) {
        if (!world.step().some((e) => e.type === 'playerDied')) continue;
        if (ultima >= 0) vite.push((t - ultima) * TICK_MS);
        ultima = t;
      }
      expect(vite.length, `${id}: nessuna morte, la prova non guarda niente`).toBeGreaterThan(2);
      // Il punto non è che si sopravviva: è che nessuna vita finisca
      // nell'istante esatto in cui si torna toccabili, perché quella è
      // la firma del ciclo — non una morte, un metronomo.
      const piuBreve = Math.min(...vite);
      expect(piuBreve, `${id}: vita più breve ${(piuBreve / 1000).toFixed(2)}s`).toBeGreaterThan(
        RESPAWN_GRACE_MS.tutorial + 300,
      );
    }
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
// Su un anello di stanze, la prima visita non dipende
// dall'ordine
// --------------------------------------------------------------------
// updateCheckpoint pagava la battuta, l'XP di stanza e la ricarica
// delle piastre solo se roomOrder(stanza) superava il massimo mai
// raggiunto. Su un livello lineare coincide con "prima volta qui", ma
// ARCHIVIO è un anello attorno a un blocco pieno (nord=0, ovest=1,
// camera=2, est=3, sud=4, vedi levels.ts): chi gira nord -> est -> sud
// e poi rientra da OVEST per la prima volta ci arriva con un ordine (1)
// più basso del massimo già toccato (4). Con la sola guardia
// sull'ordine quella prima visita non contava niente — zero battuta,
// zero XP, piastre scariche in un livello che GDD.md sezione 18
// promette di ricaricare "entrando in una stanza nuova", non "entrando
// in una stanza più avanti".

describe('CampaignWorld — un anello di stanze paga la prima visita in ogni direzione', () => {
  it('tornare indietro verso OVEST (mai vista) in ARCHIVIO paga XP, evento e piastre', () => {
    const world = quiet(new CampaignWorld(levelById('archivio')));
    // Isola la sola variabile in gioco: l'ordine di visita delle
    // stanze, non il tiro delle torrette.
    for (const t of world.state.turrets) t.alive = false;

    // NORD (spawn) -> EST -> SUD: in avanti nell'ordine delle stanze,
    // esattamente come su un livello lineare.
    world.state.player.x = 19.5 * TILE;
    world.state.player.y = 7.5 * TILE;
    world.step();
    expect(world.state.reachedRoom).toBe('est');

    // (17,14) e non (10,14): quel tile e' l'uscita del livello, e
    // finirlo per sbaglio fermerebbe la simulazione prima di
    // arrivare al punto che questa prova vuole misurare.
    world.state.player.x = 17.5 * TILE;
    world.state.player.y = 14.5 * TILE;
    world.step();
    expect(world.state.reachedRoom).toBe('sud');

    // Si torna indietro: OVEST (ordine 1) non è mai stata vista, anche
    // se il massimo raggiunto (SUD, ordine 4) è più avanti di lei.
    world.state.player.shieldCharges = 0;
    const xpBefore = world.state.xp;
    world.state.player.x = 1.5 * TILE;
    world.state.player.y = 7.5 * TILE;
    const events = world.step();

    expect(events.some((e) => e.type === 'roomEntered' && e.room === 'ovest')).toBe(true);
    expect(world.state.xp).toBe(xpBefore + XP_ROOM_ENTER);
    expect(events.some((e) => e.type === 'shieldRefilled')).toBe(true);
    expect(world.state.player.shieldCharges).toBeGreaterThan(0);
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
    // Ci si e' gia' arrivati: la porta alle spalle lo dice. Senza
    // questo, il primo tick conterebbe il MAGAZZINO come stanza nuova
    // e ricaricherebbe le piastre che quiet() ha appena tolto.
    markRoomReached(world, 'magazzino');
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
    // Si misura cosa rimette a posto *la morte*, quindi serve morire:
    // con la dotazione di base la carica del boss verrebbe assorbita.
    const world = nudo(molo());
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

  // Lo scope del reset presumeva che il checkpoint venisse
  // sempre prima, in ordine, della stanza della morte — vero quasi
  // sempre, falso su un anello. In ARCHIVIO ci si può prendere il
  // checkpoint in SUD (ordine 4) e poi tornare indietro in EST (ordine
  // 3): morire lì aveva `da = roomOrder(checkpoint)` fisso a 4, quindi
  // il range restava [4, max(4,3)] = [4,4] e la stanza della morte —
  // quella che si sta per rigiocare — restava fuori da ogni reset.
  it('morire tornando in EST con checkpoint più avanti in SUD resetta anche EST (ARCHIVIO)', () => {
    const world = new CampaignWorld(levelById('archivio'));
    for (const t of world.state.turrets) t.alive = false;
    // Isola la sola minaccia che deve uccidere: le altre non devono
    // intervenire sul timing dell'attacco.
    for (const e of world.state.enemies) {
      if (e.id !== 'martello-est') e.alive = false;
    }
    const martello = world.state.enemies.find((e) => e.id === 'martello-est')!;
    // Già colpito una volta, prima di questo tentativo: è il segno che
    // il reset deve cancellare se EST rientra davvero nello scope.
    martello.hp = 1;

    // Checkpoint già preso in SUD (ordine 4) — ci si è già arrivati.
    world.state.checkpoint = { room: 'sud', x: 10.5 * TILE, y: 14.5 * TILE, angle: 0 };
    markRoomReached(world, 'sud');
    // EST è già stata vista (ci si è passati per arrivare a SUD): senza
    // questo il primo step qui sotto la conterebbe come stanza nuova e
    // ricaricherebbe le piastre appena azzerate, impedendo la morte.
    markRoomVisited(world, 'est');

    // Si torna indietro in EST e ci si fa uccidere dal Martello che
    // vive lì.
    world.state.player.x = martello.x - TILE;
    world.state.player.y = martello.y;
    world.state.player.angle = 0;
    world.state.player.respawnInvulnerableMs = 0;
    world.state.player.shieldCharges = 0;

    let died = false;
    for (let i = 0; i < 600 && !died; i++) {
      died = world.step(input()).some((e) => e.type === 'playerDied');
    }
    expect(died).toBe(true);

    // Il Martello, che vive in EST, deve essere tornato come nuovo: hp
    // piena e a casa. Con la formula sbagliata restava a hp:1.
    expect(martello.hp).toBe(archetypeOf('martello').hp);
    expect(martello.x).toBeCloseTo(17.5 * TILE, 3);
    expect(martello.y).toBeCloseTo(5.5 * TILE, 3);
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

describe("Sentinella del Molo — confine esatto dell'arco vulnerabile", () => {
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

  it("nessun danno se la fase non è charge/recover, indipendentemente dall'angolo", () => {
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

// --------------------------------------------------------------------
// Un mondo finito non deve più muoversi
// --------------------------------------------------------------------
// game/campaignGame.ts continua a chiamare step() a ogni frame finché
// la sua `phase` resta 'playing', e quel campo cambia solo quando la
// coda di ARBITER (le ultime parole, poi l'outro) si svuota — anche
// diversi secondi *dopo* che completeLevel()/killPlayer hanno già
// portato `outcome` fuori da 'playing' in un tick precedente. Senza una
// guardia in testa a step(), il giocatore continuava a muoversi,
// sparare e morire su un livello già chiuso mentre ascoltava il
// commento di chi lo aveva appena finito.

describe('CampaignWorld — step() dopo la fine non simula più niente', () => {
  it('un mondo con outcome diverso da "playing" ignora ogni step successivo', () => {
    const world = quiet(attracco());
    world.state.outcome = 'levelComplete';
    const tickBefore = world.state.tick;
    const xBefore = world.state.player.x;

    const events = world.step(input({ forward: 1, aimAngle: 0 }));

    expect(events).toEqual([]);
    expect(world.state.tick).toBe(tickBefore);
    expect(world.state.player.x).toBe(xBefore);
  });
});
