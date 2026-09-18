// ================================================================
// BALANCE HARNESS — Campagna
// ================================================================
// Il gemello di balance.mts per la campagna. Stesso principio: le
// affermazioni sul bilanciamento si controllano invece di discuterle.
//
//   pnpm --filter @workspace/arena-shooter run balance:campaign
//
// La differenza rispetto alla prima versione è che il percorso non è
// più scritto a mano: viene camminato sulle definizioni dei livelli.
// Una lista di tappe copiata a mano racconta l'atto che c'era quando
// è stata scritta, e mente in silenzio dal primo livello che cambia.
// ================================================================

import { BULLET_COOLDOWN, TICK_MS, TILE } from '../src/sim/constants';
import {
  ALL_SKILL_NODES,
  BEACON_LIFETIME_MS,
  BEACON_LURE_TILES,
  BEACON_RANGE_TILES,
  NODE_OTTURATORE_COOLDOWN_MS,
  BOSS_CHARGE_MS,
  BOSS_ENRAGED_CHARGES,
  BOSS_ENRAGE_AT,
  BOSS_GUARD_ENRAGED_MS,
  BOSS_GUARD_MS,
  ARBITER_HITS_TO_DEFEAT,
  BOSS_HITS_TO_DEFEAT,
  BOSS_RECOVER_ENRAGED_MS,
  CUSTODE_EXPOSED_ENRAGED_MS,
  CUSTODE_EXPOSED_MS,
  CUSTODE_HITS_TO_DEFEAT,
  CUSTODE_MANIPULATION_ENRAGED_MS,
  CUSTODE_MANIPULATION_MS,
  CUSTODE_TELL_MS,
  BOSS_RECOVER_MS,
  BOSS_TELEGRAPH_ENRAGED_MS,
  BOSS_TELEGRAPH_MS,
  BOSS_VOLLEY_RECOVER_MS,
  LEVEL_XP_THRESHOLDS,
  SHOP_ITEMS,
  SKILL_TREE,
  XP_BOSS_DEFEAT,
  XP_BOSS_HIT_SOLID,
  XP_CORE,
  XP_ROOM_ENTER,
  XP_ENEMY_WEAK_HIT,
  XP_TURRET_DOWN,
  levelForXp,
  shopItemsForAct,
  type ShopItemDef,
} from '../src/sim/campaign/constants';
import {
  ALL_ENEMY_KINDS,
  ENEMY_REAR_ARC_HALF,
  VULNERABILITY_MULT,
  WEAK_SPOT_MULT,
  archetypeOf,
} from '../src/sim/campaign/enemies';
import { updateEnemyAi } from '../src/sim/campaign/enemyAi';
import type { EnemyState } from '../src/sim/campaign/types';
import { ACTS, ALL_LEVELS } from '../src/sim/campaign/levels';
import { roomAt } from '../src/sim/campaign/levelTypes';
import {
  beaconStatsFor,
  movementStatsFor,
  shieldCapacity,
  shopItemById,
  weaponStatsFor,
} from '../src/sim/campaign/skills';

const NODES = ALL_SKILL_NODES.length;
const BIGGEST_BRANCH = Math.max(...SKILL_TREE.map((b) => b.nodes.length));

function pointsAt(xp: number): number {
  return levelForXp(xp) - 1;
}

interface Stop {
  label: string;
  xp: number;
  /** false dal colpo che uccide il boss in poi: l'atto finisce lì, e
   *  un punto guadagnato in quell'istante si potrà spendere solo
   *  rigiocando. È la distinzione che nascondeva il bug della prima
   *  taratura, quando i nodi erano tre e l'atto un livello solo. */
  spendable: boolean;
}

/** Le tappe di un livello, lette dalla sua definizione.
 *  `thorough` = raccoglie tutto e abbatte tutto; altrimenti attraversa
 *  soltanto. */
function stopsFor(level: (typeof ALL_LEVELS)[number], thorough: boolean): Stop[] {
  const stops: Stop[] = [];
  const spawnRoom = roomAt(level, level.spawn.tx, level.spawn.ty);

  // Le stanze pagano il bonus d'ingresso, tranne quella di partenza:
  // in quella non si "entra".
  for (const room of level.rooms) {
    if (room.id === spawnRoom) continue;
    stops.push({ label: `entra in ${room.name}`, xp: XP_ROOM_ENTER, spendable: true });
  }
  if (thorough) {
    for (const c of level.cores) {
      stops.push({ label: `core ${c.id}`, xp: XP_CORE, spendable: true });
    }
    for (const t of level.turrets) {
      stops.push({ label: `${t.kind} ${t.id}`, xp: XP_TURRET_DOWN, spendable: true });
    }
  }

  // I nemici contano per *entrambi* i profili, e non è una svista.
  //
  // Una turret in una nicchia si può ignorare: sta ferma, e tirare
  // dritto è una scelta legittima che costa solo l'esperienza. Un
  // nemico no — ti segue dentro la stanza, e "passare oltre" non è
  // sul tavolo. Farlo pagare solo a chi esplora avrebbe modellato un
  // gioco che non esiste.
  //
  // La differenza fra i due profili sta nel *come*: chi esplora
  // colpisce il punto debole e incassa anche quel bonus, chi corre
  // spara al corpo e prende solo la taglia.
  for (const e of level.enemies) {
    const a = archetypeOf(e.kind);
    stops.push({ label: `${a.name.toLowerCase()} ${e.id}`, xp: a.xp, spendable: true });
    if (thorough) {
      stops.push({ label: `  └ punto debole`, xp: XP_ENEMY_WEAK_HIT, spendable: true });
    }
  }
  if (level.boss) {
    const hits =
      level.boss.kind === 'custode'
        ? CUSTODE_HITS_TO_DEFEAT
        : level.boss.kind === 'arbiter'
          ? ARBITER_HITS_TO_DEFEAT
          : BOSS_HITS_TO_DEFEAT;
    for (let i = 1; i <= hits; i++) {
      const kills = i === hits;
      stops.push({
        label: `colpo al boss ${i}${kills ? ' (uccide)' : ''}`,
        xp: XP_BOSS_HIT_SOLID,
        spendable: !kills,
      });
    }
    stops.push({ label: 'bonus di vittoria', xp: XP_BOSS_DEFEAT, spendable: false });
  }
  return stops;
}

interface Walk {
  xp: number;
  /** Punti disponibili all'ultima tappa in cui si potevano ancora
   *  spendere. */
  useful: number;
  /** Punti totali alla fine di ciascun livello. */
  perLevel: number[];
}

function walkAct(label: string, thorough: boolean, verbose: boolean): Walk {
  console.log(`\n══ ${label} ══`);
  let xp = 0;
  let useful = 0;
  const perLevel: number[] = [];

  for (const level of ALL_LEVELS) {
    console.log(`\n  ── ${level.act}.${level.ordinal} ${level.name} ──`);
    for (const stop of stopsFor(level, thorough)) {
      xp += stop.xp;
      const pts = pointsAt(xp);
      if (stop.spendable) useful = pts;
      if (verbose) {
        console.log(
          `    ${stop.label.padEnd(32)} ${String(xp).padStart(4)} XP  lv${String(
            levelForXp(xp),
          ).padStart(2)}  ${pts} punti${stop.spendable ? '' : '   (troppo tardi per spenderli)'}`,
        );
      }
    }
    perLevel.push(pointsAt(xp));
    console.log(`    → fine livello: ${xp} XP, ${pointsAt(xp)}/${NODES} punti`);
  }

  console.log(`\n  Punti spendibili mentre servono ancora: ${useful}/${NODES}`);
  return { xp, useful, perLevel };
}

console.log('CAMPAGNA — BILANCIAMENTO');
console.log(`\nAtti: ${ACTS.map((a) => a.length).join(' + ')} livelli`);
console.log(`\nSoglie di livello: ${LEVEL_XP_THRESHOLDS.join(', ')}`);
console.log(`Nodi sbloccabili: ${NODES}`);
for (const b of SKILL_TREE) console.log(`  ${b.name.padEnd(16)} ${b.nodes.length} nodi`);

const thorough = walkAct('Esplora e ripulisce tutto', true, true);
const rushed = walkAct('Tira dritto (niente core, niente turret)', false, false);

/** I punti a fine di ciascun atto: serve a vedere che il secondo
 *  anello dell'albero non si compri già nel primo atto. */
function pointsPerAct(w: Walk): number[] {
  const out: number[] = [];
  let seen = 0;
  for (const act of ACTS) {
    seen += act.length;
    out.push(w.perLevel[seen - 1]!);
  }
  return out;
}

// ---- Invarianti ----
// Le cose che possono rompersi ritarando l'XP o aggiungendo un
// livello, e che leggendo le costanti non si vedono.

const maxPoints = LEVEL_XP_THRESHOLDS.length - 1;
const gainsEveryLevel = (w: Walk): boolean =>
  w.perLevel.every((p, i) => (i === 0 ? p > 0 : p > w.perLevel[i - 1]!));

console.log('\n\nINVARIANTI');

console.log(
  `\n  1. Nessun punto senza un nodo su cui finire\n` +
    `     ${maxPoints} punti massimi / ${NODES} nodi → ${maxPoints === NODES ? 'SÌ' : 'NO'}`,
);

console.log(
  `\n  1b. L'albero si riempie lungo tutta la campagna, non dentro un atto\n` +
    `     punti a fine atto, esplorando: ${pointsPerAct(thorough).join(' → ')} su ${NODES}`,
);

// Due invarianti, non una. La prima stesura chiedeva a *entrambi* i
// profili di guadagnare un punto in ogni livello, e con tre atti non
// si può: una tabella sola non può essere fitta in basso per chi tira
// dritto e larga in alto per chi esplora. La domanda giusta non è se
// paghino tutti e due allo stesso ritmo — è se esplorare paghi.
console.log(
  `\n  2a. Chi esplora guadagna qualcosa in ogni livello\n` +
    `     ${thorough.perLevel.join(' → ')} → ${gainsEveryLevel(thorough) ? 'SÌ' : 'NO'}`,
);

console.log(
  `\n  2b. Chi tira dritto arriva in fondo con molto meno albero\n` +
    `     ${rushed.perLevel.join(' → ')}\n` +
    `     ${pointsAt(rushed.xp)} nodi contro ${pointsAt(thorough.xp)} → ${
      pointsAt(rushed.xp) < pointsAt(thorough.xp) ? 'SÌ' : 'NO'
    }`,
);

console.log(
  `\n  3. Ci si può specializzare prima dello scontro finale\n` +
    `     ${thorough.useful} punti spendibili / ramo più grande ${BIGGEST_BRANCH} → ${
      thorough.useful >= BIGGEST_BRANCH ? 'SÌ' : 'NO'
    }`,
);

console.log(
  `\n  4. L'albero NON si riempie tutto prima del boss, ma si riempie\n` +
    `     spendibili prima del colpo decisivo: ${thorough.useful}/${NODES}\n` +
    `     totali a fine atto: ${pointsAt(thorough.xp)}/${NODES} → ${
      thorough.useful < NODES && pointsAt(thorough.xp) >= NODES ? 'SÌ' : 'NO'
    }`,
);

console.log(
  '\n  La 3 e la 4 tirano in direzioni opposte di proposito: un albero\n' +
    '  comprabile tutto prima del boss non fa scegliere niente, e uno che\n' +
    "  non si riempie mai non premia l'atto finito. Gli ultimi punti\n" +
    '  arrivano con la vittoria e si spendono rigiocando.',
);

// ---- Ritmo del boss ----

function bossCycle(
  label: string,
  guard: number,
  telegraph: number,
  charges: number,
  volleyPause: number,
  recover: number,
): void {
  const cycleMs =
    guard + charges * (telegraph + BOSS_CHARGE_MS) + (charges - 1) * volleyPause + recover;
  const vulnerableMs = charges * BOSS_CHARGE_MS + (charges - 1) * volleyPause + recover;
  console.log(`\n  ${label}`);
  console.log(`    cariche per raffica     ${charges}`);
  console.log(`    ciclo completo          ${(cycleMs / 1000).toFixed(1)} s`);
  console.log(
    `    finestra vulnerabile    ${(vulnerableMs / 1000).toFixed(1)} s  (${Math.round(
      (vulnerableMs / cycleMs) * 100,
    )}% del ciclo)`,
  );
}

console.log('\n\n══ Sentinella del Molo ══');
console.log(`  colpi per abbatterla      ${BOSS_HITS_TO_DEFEAT}`);
console.log(`  si altera a               ${BOSS_ENRAGE_AT} danni`);
console.log(`  tick della simulazione    ${TICK_MS.toFixed(2)} ms`);
bossCycle('Prima fase', BOSS_GUARD_MS, BOSS_TELEGRAPH_MS, 1, 0, BOSS_RECOVER_MS);
bossCycle(
  'Seconda fase (alterata)',
  BOSS_GUARD_ENRAGED_MS,
  BOSS_TELEGRAPH_ENRAGED_MS,
  BOSS_ENRAGED_CHARGES,
  BOSS_VOLLEY_RECOVER_MS,
  BOSS_RECOVER_ENRAGED_MS,
);
console.log(
  '\n  La seconda fase deve stringere il ritmo *e* aprire di più: se la\n' +
    '  percentuale vulnerabile scendesse, sarebbe solo più lunga da subire.',
);

// ---- Ritmo del Custode ----
// L'altro boss non si misura in cariche ma in finestre: quanta parte
// del ciclo si passa a poter colpire.

function custodeCycle(label: string, manipulation: number, exposed: number): void {
  const cycleMs = manipulation + CUSTODE_TELL_MS + exposed;
  console.log(`\n  ${label}`);
  console.log(`    manipolazione           ${(manipulation / 1000).toFixed(1)} s`);
  console.log(`    preavviso               ${(CUSTODE_TELL_MS / 1000).toFixed(1)} s`);
  console.log(`    ciclo completo          ${(cycleMs / 1000).toFixed(1)} s`);
  console.log(
    `    finestra vulnerabile    ${(exposed / 1000).toFixed(1)} s  (${Math.round(
      (exposed / cycleMs) * 100,
    )}% del ciclo)`,
  );
}

console.log('\n\n══ Custode del Reattore ══');
console.log(`  colpi per abbatterlo      ${CUSTODE_HITS_TO_DEFEAT}`);
custodeCycle('Prima fase', CUSTODE_MANIPULATION_MS, CUSTODE_EXPOSED_MS);
custodeCycle(
  'Seconda fase (alterato)',
  CUSTODE_MANIPULATION_ENRAGED_MS,
  CUSTODE_EXPOSED_ENRAGED_MS,
);
console.log(
  "\n  Qui la seconda fase deve fare il *contrario* di quella della\n" +
    '  Sentinella: non stringere il ritmo aprendo di più, ma stringere la\n' +
    "  finestra. La Sentinella alterata diventa più aggressiva, il Custode\n" +
    '  più avaro — due idee diverse di seconda fase, non la stessa due volte.',
);

// ================================================================
// Banco del Trasponditore
// ================================================================
// L'arma secondaria non fa danno: apre una finestra in cui il nemico
// mostra la schiena. Quindi la domanda giusta non è "quanto danno
// fa", è **quanti colpi buoni servono per abbattere ciascun
// archetipo, e quanti ne entrano in una finestra**.
//
// Il conto è tutto qui, e vale la pena vederlo scritto: lanciare
// costa anche il tempo di un colpo, quindi da BEACON_LIFETIME_MS e
// dal cooldown dell'arma discende quante volte si può premere il
// grilletto prima che la finestra si chiuda. Se quel numero coprisse
// gli HP di un nemico, il Trasponditore smetterebbe di essere
// un'apertura e diventerebbe un interruttore.

function shotsInWindow(cooldownMs: number): number {
  // Il lancio mette l'arma in cooldown; il primo colpo cade a
  // `cooldownMs`, il secondo a `2 * cooldownMs`, e così via — finché
  // stanno dentro la finestra.
  let n = 0;
  for (let t = cooldownMs; t <= BEACON_LIFETIME_MS; t += cooldownMs) n++;
  return n;
}

console.log('\n\n══ Trasponditore ══');
console.log(`  finestra                  ${(BEACON_LIFETIME_MS / 1000).toFixed(1)} s`);
console.log(`  colpi in finestra         ${shotsInWindow(BULLET_COOLDOWN)} (arma base, ${BULLET_COOLDOWN} ms)`);
console.log(
  `                            ${shotsInWindow(NODE_OTTURATORE_COOLDOWN_MS)} con Otturatore Rapido (${NODE_OTTURATORE_COOLDOWN_MS} ms)`,
);

console.log('\n  Colpi per abbattere, per archetipo:');
console.log('    nemico       hp   corpo  debole  debole+vuln   esche (base / otturatore)');
for (const kind of ALL_ENEMY_KINDS) {
  const a = archetypeOf(kind);
  const body = a.frontImmune ? Infinity : Math.ceil(a.hp / 1);
  const weak = Math.ceil(a.hp / WEAK_SPOT_MULT);
  const both = Math.ceil(a.hp / (WEAK_SPOT_MULT * VULNERABILITY_MULT));
  // Un'esca serve solo a chi ha il punto debole dietro: sugli altri
  // il colpo giusto si prende comunque, girando la mira e non il
  // giocatore.
  const needsBeacon = a.weakSpot === 'rear';
  const esche = needsBeacon
    ? `${Math.ceil(weak / shotsInWindow(BULLET_COOLDOWN))} / ${Math.ceil(weak / shotsInWindow(NODE_OTTURATORE_COOLDOWN_MS))}`
    : '—';
  console.log(
    `    ${a.name.padEnd(12)} ${String(a.hp).padStart(2)}   ${String(body === Infinity ? 'mai' : body).padStart(5)}  ${String(weak).padStart(6)}  ${String(both).padStart(11)}   ${esche}`,
  );
}

console.log(
  "\n  Le due colonne che contano sono l'ultima e la prima: il Guardiano\n" +
    '  non si abbatte affatto sparandogli davanti, e con la sola arma base\n' +
    "  un'esca non basta a chiuderlo. È il conto che tiene il Trasponditore\n" +
    '  dalla parte giusta — apre una possibilità, non spegne un nemico.',
);

// ================================================================
// BANCO DELL'ARCO POSTERIORE
// ================================================================
// La tabella qui sopra fa aritmetica sugli HP: dice quanti colpi
// servono *se* li metti dietro. Non dice se dietro ci si arriva.
//
// Questa sezione non fa conti: fa girare l'IA vera per tutta la vita
// dell'esca e misura per quanti tick il giocatore si trova davvero
// nell'arco posteriore — la stessa disuguaglianza che usa
// resolveEnemyHit, non una sua parafrasi.
//
// Serve perché "il nemico si volta" e "il colpo vale tre volte" sono
// due cose diverse, e fra le due c'è ENEMY_TURN_RATE. Un archetipo
// può voltarsi di centoventi gradi e non restarci abbastanza da
// permettere di premere il grilletto: con 1400 ms di ricarica, una
// finestra da 280 ms è un colpo solo, e solo a chi era già carico e
// già puntato.

/** Un nemico appena nato del tipo dato, fermo al suo posto e girato
 *  verso il giocatore. Non passa da CampaignWorld di proposito: qui
 *  interessa l'IA, non il livello che la ospita. */
function benchEnemy(kind: (typeof ALL_ENEMY_KINDS)[number], x: number, y: number): EnemyState {
  const a = archetypeOf(kind);
  return {
    id: 'banco', kind, alive: true, x, y, angle: Math.PI, hp: a.hp,
    ai: 'patrol', reactionTimer: a.reactionMs, attackCooldown: 0,
    ventMs: 0, revealMs: 0, chargeMs: 0, chargeDirX: 0, chargeDirY: 0,
    postX: x, postY: y, patrolX: null, patrolY: null, goalX: null, goalY: null,
    patrolTimer: 0, lastSeenX: null, lastSeenY: null,
    still: false, closing: false, lured: false, hardened: false,
  } as EnemyState;
}

const norm = (r: number): number => Math.atan2(Math.sin(r), Math.cos(r));

/** Stanza aperta: niente muri. Isola il richiamo dalla geometria di
 *  un livello, che cambierebbe il risultato senza dire niente
 *  sull'arma. */
const openRoom = (): number => 0;

interface RearWindow {
  /** Tick in cui il giocatore è nell'arco posteriore. */
  rear: number;
  /** Di quelli, i tick in cui vale anche una vulnerabilità (×6). */
  rearAndVuln: number;
  /** Distanza fra l'esca e il nemico, in tile: sopra
   *  BEACON_LURE_TILES il richiamo non aggancia affatto. */
  gapTiles: number;
}

/** I tre numeri dell'esca che il Banco può cambiare (Eco Ampio,
 *  Doppio Innesco). Di default quelli base — così le chiamate scritte
 *  prima che il Banco esistesse continuano a misurare quello che
 *  misuravano. */
interface BeaconGeometry {
  rangeTiles: number;
  lureTiles: number;
  lifetimeMs: number;
}
const BASE_BEACON_GEOMETRY: BeaconGeometry = {
  rangeTiles: BEACON_RANGE_TILES,
  lureTiles: BEACON_LURE_TILES,
  lifetimeMs: BEACON_LIFETIME_MS,
};

/** Lancia l'esca a `thetaDeg` dalla congiungente giocatore–nemico e
 *  misura la finestra che si apre. Il giocatore resta fermo: chi si
 *  muove può fare di meglio, quindi questi numeri sono il pavimento,
 *  non il soffitto. */
function rearWindow(
  kind: (typeof ALL_ENEMY_KINDS)[number],
  thetaDeg: number,
  enemyTiles = 4,
  beacon: BeaconGeometry = BASE_BEACON_GEOMETRY,
): RearWindow {
  const px = 0;
  const py = 0;
  const ex = px + enemyTiles * TILE;
  const ey = py;
  const th = (thetaDeg * Math.PI) / 180;
  const bx = px + Math.cos(th) * beacon.rangeTiles * TILE;
  const by = py + Math.sin(th) * beacon.rangeTiles * TILE;

  const e = benchEnemy(kind, ex, ey);
  const ticks = Math.round(beacon.lifetimeMs / TICK_MS);
  let rear = 0;
  let rearAndVuln = 0;
  for (let t = 0; t < ticks; t++) {
    const intent = updateEnemyAi(e, {
      getTile: openRoom, mapW: 64, mapH: 64,
      playerX: px, playerY: py, playerTargetable: true,
      // `tiles` sovrascrive il raggio di richiamo di default: è il
      // canale che l'IA offre apposta per Eco Ampio (vedi
      // EnemyAiCtx['lure'] in enemyAi.ts). Senza, misurerei l'esca
      // allargata con il raggio di quella base.
      lure: { x: bx, y: by, tiles: beacon.lureTiles }, leash: null, dtMs: TICK_MS,
    });
    e.angle = intent.angle;
    e.lured = intent.lured;
    e.x += intent.moveX * intent.speed;
    e.y += intent.moveY * intent.speed;
    // La stessa forma di resolveEnemyHit: `weak = 'rear'` quando
    // PI meno lo scarto sta dentro il mezzo-arco.
    const off = Math.abs(norm(Math.atan2(py - e.y, px - e.x) - e.angle));
    if (Math.PI - off <= ENEMY_REAR_ARC_HALF) {
      rear++;
      if (intent.closing || intent.still) rearAndVuln++;
    }
  }
  return { rear, rearAndVuln, gapTiles: Math.hypot(bx - ex, by - ey) / TILE };
}

console.log('\n\n══ Arco posteriore: quanto dura davvero ══');
console.log(
  `  L'esca vola ${BEACON_RANGE_TILES} tile dritta davanti e richiama entro ${BEACON_LURE_TILES}.\n` +
    '  θ è di quanto si sposta la mira di lato al momento del lancio.\n',
);

const REAR_KINDS = ALL_ENEMY_KINDS.filter((k) => archetypeOf(k).weakSpot === 'rear');
console.log(
  `  Archetipi con il punto debole dietro: ${REAR_KINDS.length} su ${ALL_ENEMY_KINDS.length}` +
    ` (${REAR_KINDS.map((k) => archetypeOf(k).name).join(', ')}).\n` +
    "  Sugli altri il Trasponditore non apre un moltiplicatore: toglie\n" +
    '  un nemico dal fuoco, che è un altro mestiere.\n',
);

for (const kind of REAR_KINDS) {
  const a = archetypeOf(kind);
  let best = { theta: 0, ms: 0, msVuln: 0 };
  const row: string[] = [];
  for (let theta = 0; theta <= 60; theta += 10) {
    const w = rearWindow(kind, theta);
    const ms = w.rear * TICK_MS;
    const agganciato = w.gapTiles <= BEACON_LURE_TILES;
    if (agganciato && ms > best.ms) {
      best = { theta, ms, msVuln: w.rearAndVuln * TICK_MS };
    }
    row.push(
      `    ${String(theta).padStart(2)}°  ${w.gapTiles.toFixed(2)} tile  ` +
        `${String(Math.round(ms)).padStart(4)} ms` +
        `${agganciato ? '' : '  (esca fuori raggio: non aggancia)'}`,
    );
  }
  console.log(`  ── ${a.name} ──`);
  console.log(row.join('\n'));
  // Se la finestra è più corta di una ricarica non ci sta un ciclo
  // intero: chi arriva scarico non spara affatto. Il margine è la
  // cifra che dice *quanto* manca, ed è quella da riguardare se un
  // giorno si tocca BULLET_COOLDOWN.
  const shots = best.ms >= BULLET_COOLDOWN ? Math.floor(best.ms / BULLET_COOLDOWN) : 0;
  const margine = Math.round(best.ms - BULLET_COOLDOWN);
  console.log(
    `    migliore: ${Math.round(best.ms)} ms a ${best.theta}°` +
      `, di cui ${Math.round(best.msVuln)} ms anche in vulnerabilità (×6).` +
      `\n    Contro ${BULLET_COOLDOWN} ms di ricarica: ${margine >= 0 ? `+${margine}` : margine} ms` +
      ` → ${shots} colp${shots === 1 ? 'o' : 'i'} a ciclo pieno` +
      (shots === 0 ? ', quindi vale solo per chi arriva già carico e già puntato.' : '.'),
  );
  console.log('');
}

console.log(
  '  Il numero da guardare è il "migliore" di ciascuno, e sono tre numeri\n' +
    '  diversi per tre archetipi: chi sta fermo va superato, chi carica va\n' +
    "  preso di lato. Se un giorno diventassero tutti uguali, l'esca sarebbe\n" +
    '  diventata un interruttore.',
);

// ================================================================
// IL BANCO DI RICONFIGURAZIONE
// ================================================================
// Sei innesti, tre per atto: comprati con gli stessi punti abilità che
// pagano i nodi dell'albero. La descrizione (`gives`/`takes` in
// constants.ts) è prosa — spiega l'intenzione, non la garantisce.
// Qui sotto non si legge quella prosa: si chiamano le stesse quattro
// funzioni pure di skills.ts che chiama il gioco vero, prima e dopo
// l'acquisto, e si stampa la differenza.

// ---- Il vocabolario dei numeri toccati ----
// Un'unica funzione che interroga i quattro banchi di skills.ts e li
// appiattisce in un dizionario: è quello che rende il resto della
// sezione un confronto automatico invece di quattro `if` per innesto.
function bancoSnapshot(
  unlocked: readonly string[],
  purchased: readonly string[],
): Record<string, number> {
  const weapon = weaponStatsFor(unlocked, purchased);
  const movement = movementStatsFor(unlocked, purchased);
  const shield = shieldCapacity(unlocked, purchased);
  const beacon = beaconStatsFor(unlocked, purchased);
  return {
    'arma.ricarica': weapon.cooldownMs,
    'arma.aperturaOttica': weapon.adsTransitionMs,
    'arma.moltMovimentoInMira': weapon.adsMoveMult,
    'movimento.moltVelocita': movement.speedMult,
    'movimento.scattoRicarica': movement.dashCooldownMs,
    'movimento.scattoVelocita': movement.dashSpeed,
    'scudo.cariche': shield,
    'esca.gittata': beacon.rangeTiles,
    'esca.raggioRichiamo': beacon.lureTiles,
    'esca.durata': beacon.lifetimeMs,
    'esca.carichePartenza': beacon.chargesStart,
  };
}

/** Unità e cifre decimali per stampare ciascun campo — l'unica cosa
 *  che *non* si può ricavare interrogando skills.ts, perché è
 *  presentazione, non bilanciamento. */
const CAMPO_LABEL: Record<string, string> = {
  'arma.ricarica': 'ricarica arma',
  'arma.aperturaOttica': 'apertura ottica',
  'arma.moltMovimentoInMira': 'passo in mira (×base)',
  'movimento.moltVelocita': 'velocità (×base)',
  'movimento.scattoRicarica': 'ricarica scatto',
  'movimento.scattoVelocita': 'velocità scatto',
  'scudo.cariche': 'cariche scudo',
  'esca.gittata': 'gittata esca',
  'esca.raggioRichiamo': 'raggio richiamo',
  'esca.durata': 'durata esca',
  'esca.carichePartenza': 'cariche esca a inizio livello',
};
const CAMPO_UNITA: Record<string, string> = {
  'arma.ricarica': 'ms',
  'arma.aperturaOttica': 'ms',
  'movimento.scattoRicarica': 'ms',
  'esca.durata': 'ms',
  'esca.gittata': 'tile',
  'esca.raggioRichiamo': 'tile',
};
/** true = un numero più alto è meglio. Serve solo a leggere il segno
 *  di un delta già misurato — il delta stesso viene da skills.ts. */
const CAMPO_MEGLIO_SE_ALTO: Record<string, boolean> = {
  'arma.ricarica': false,
  'arma.aperturaOttica': false,
  'arma.moltMovimentoInMira': true,
  'movimento.moltVelocita': true,
  'movimento.scattoRicarica': false,
  'movimento.scattoVelocita': true,
  'scudo.cariche': true,
  'esca.gittata': true,
  'esca.raggioRichiamo': true,
  'esca.durata': true,
  'esca.carichePartenza': true,
};

function fmtCampo(campo: string, v: number): string {
  const cifra = Number.isInteger(v) ? String(v) : v.toFixed(2);
  const unita = CAMPO_UNITA[campo];
  return unita ? `${cifra} ${unita}` : cifra;
}

/** Nodi dell'albero da avere già sbloccati per misurare un innesto nel
 *  suo contesto più leggibile — es. l'apertura ottica di Otturatore
 *  Spinto si legge meglio avendo già Aggancio Ottico, perché è proprio
 *  quel numero (70 ms) che l'innesto sovrascrive. Dove il contesto non
 *  cambia il risultato (la maggioranza dei casi: i delta del Banco si
 *  sommano o si applicano a prescindere dai nodi) le due misure
 *  coincidono e sotto ne esce una riga sola, non due. */
const CONTESTO_INNESTO: Record<string, readonly string[]> = {
  'otturatore-spinto': ['otturatore-rapido', 'aggancio-ottico'],
  'eco-ampio': [],
  'zavorra-alleggerita': ['scatto'],
  'doppio-innesco': [],
  'scatto-teso': ['scatto'],
  'piastra-fusa': ['piastra-aggiuntiva'],
};

interface RigaInnesto {
  campo: string;
  variante: 'unica' | 'senza nodo' | 'con nodo';
  prima: number;
  dopo: number;
  migliora: boolean;
}

/** Le righe di un innesto: quali numeri cambia, con e senza il nodo di
 *  contesto quando la differenza fra le due misure lo rende
 *  interessante. Tutto qui dentro sono chiamate a skills.ts — niente
 *  di quello che segue è scritto a mano. */
function righeInnesto(item: ShopItemDef): RigaInnesto[] {
  const ctx = CONTESTO_INNESTO[item.id] ?? [];
  const primaSenza = bancoSnapshot([], []);
  const dopoSenza = bancoSnapshot([], [item.id]);
  const primaCon = bancoSnapshot(ctx, []);
  const dopoCon = bancoSnapshot(ctx, [item.id]);

  const campi = new Set<string>();
  for (const campo of Object.keys(primaSenza)) {
    if (primaSenza[campo] !== dopoSenza[campo] || primaCon[campo] !== dopoCon[campo]) {
      campi.add(campo);
    }
  }

  const righe: RigaInnesto[] = [];
  const segna = (
    campo: string,
    variante: RigaInnesto['variante'],
    prima: number,
    dopo: number,
  ): void => {
    const meglioSeAlto = CAMPO_MEGLIO_SE_ALTO[campo] ?? true;
    righe.push({
      campo,
      variante,
      prima,
      dopo,
      migliora: meglioSeAlto ? dopo > prima : dopo < prima,
    });
  };
  for (const campo of campi) {
    const stessaMisura = primaSenza[campo] === primaCon[campo] && dopoSenza[campo] === dopoCon[campo];
    if (stessaMisura) {
      segna(campo, 'unica', primaSenza[campo]!, dopoSenza[campo]!);
    } else {
      segna(campo, 'senza nodo', primaSenza[campo]!, dopoSenza[campo]!);
      segna(campo, 'con nodo', primaCon[campo]!, dopoCon[campo]!);
    }
  }
  return righe;
}

// ---- 1. La tabella degli innesti ----

console.log('\n\n══ Banco di Riconfigurazione ══');
console.log(
  '  Fra un atto e l\'altro, sei innesti da comprare con i punti abilità\n' +
    "  — la stessa valuta dell'albero. Non c'è una moneta propria: l'XP è\n" +
    '  già impegnata (vedi la nota nel commento di LEVEL_XP_THRESHOLDS), e\n' +
    "  il punto abilità è l'unica cosa scarsa di questo gioco.\n",
);

console.log('── 1. La tabella degli innesti ──');
for (const act of [1, 2] as const) {
  console.log(`\n  Atto ${act}:`);
  for (const item of shopItemsForAct(act)) {
    console.log(`\n    ${item.name}  (costo ${item.cost} punto abilità)`);
    for (const riga of righeInnesto(item)) {
      const etichetta = CAMPO_LABEL[riga.campo] ?? riga.campo;
      const suffisso = riga.variante === 'unica' ? '' : ` [${riga.variante}]`;
      const freccia = `${fmtCampo(riga.campo, riga.prima)} → ${fmtCampo(riga.campo, riga.dopo)}`;
      console.log(`      ${(etichetta + suffisso).padEnd(34)} ${freccia}`);
    }
  }
}

// ---- 2. Nessuno è guadagno puro ----

console.log('\n\n── 2. Nessuno è guadagno puro ──');
console.log(
  '  Invariante del Banco, verificata misurando — non leggendo `takes` —\n' +
    '  che ogni innesto sposti almeno un numero in meglio e almeno uno in\n' +
    '  peggio. Se anche uno solo fallisse, sarebbe un nodo travestito da\n' +
    "  innesto, e il Banco non avrebbe più ragione d'esistere.\n",
);

let banchiOk = true;
for (const item of SHOP_ITEMS) {
  const righe = righeInnesto(item);
  const migliora = [...new Set(righe.filter((r) => r.migliora).map((r) => CAMPO_LABEL[r.campo] ?? r.campo))];
  const peggiora = [...new Set(righe.filter((r) => !r.migliora).map((r) => CAMPO_LABEL[r.campo] ?? r.campo))];
  const ok = migliora.length > 0 && peggiora.length > 0;
  banchiOk &&= ok;
  console.log(`\n  ${item.name}: ${ok ? 'OK — non è guadagno puro' : 'ROTTO — è guadagno puro'}`);
  console.log(`    migliora   ${migliora.join(', ') || '(niente)'}`);
  console.log(`    peggiora   ${peggiora.join(', ') || '(niente)'}`);
}
console.log(`\n  Invariante su tutti e sei: ${banchiOk ? 'SÌ' : 'NO'}`);

// ---- 3. Lo spazio delle build ----
// Prima del Banco l'albero aveva diciassette nodi e quattordici punti:
// una lista che, con qualche prerequisito, si riempie quasi da sola.
// Il Banco aggiunge sei scelte in più senza aggiungere punti — è
// questo, non il numero sei in sé, a spostare lo spazio delle build.
// Il conto qui sotto non stima: enumera davvero, su bitmask, le
// combinazioni legali dei nodi veri letti da ALL_SKILL_NODES.

console.log('\n\n── 3. Lo spazio delle build ──');

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** Coefficiente binomiale, calcolato e non cercato in tabella: serve
 *  a comporre i conteggi dell'albero con quelli del Banco senza dover
 *  enumerare 2^23 combinazioni (fattibile, ma non c'è motivo). */
function combinazioni(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let num = 1;
  for (let i = 0; i < k; i++) num = (num * (n - i)) / (i + 1);
  return Math.round(num);
}

const ID_NODI = ALL_SKILL_NODES.map((n) => n.id);
const N_NODI = ID_NODI.length;
// Indice del prerequisito di ciascun nodo, o -1 se non ne ha: precalcolato
// una volta sola invece che dentro il ciclo su 2^N_NODI maschere.
const REQ_IDX = ALL_SKILL_NODES.map((n) => (n.requires ? ID_NODI.indexOf(n.requires) : -1));

/** Ogni maschera valida dell'albero, raggruppata per quanti bit ha
 *  accesi — cioè per quanti punti costa. Una maschera è valida quando
 *  ogni nodo acceso ha anche il suo prerequisito acceso, esattamente
 *  la regola di `prereqMet` in skills.ts, riletta bit a bit. */
const MASCHERE_ALBERO: number[][] = Array.from({ length: N_NODI + 1 }, () => []);
for (let mask = 0; mask < 1 << N_NODI; mask++) {
  let valida = true;
  for (let i = 0; i < N_NODI; i++) {
    if ((mask & (1 << i)) !== 0 && REQ_IDX[i]! >= 0 && (mask & (1 << REQ_IDX[i]!)) === 0) {
      valida = false;
      break;
    }
  }
  if (valida) MASCHERE_ALBERO[popcount(mask)]!.push(mask);
}

const PUNTI = maxPoints; // 14: gli stessi punti di cui parla l'invariante 1.
const buildSoloAlbero = MASCHERE_ALBERO[PUNTI] ?? [];

console.log(
  `  Punti in palio: ${PUNTI}. Nodi dell'albero: ${N_NODI}. Innesti del Banco: ${SHOP_ITEMS.length}.\n`,
);
console.log(
  `  Solo albero, a ${PUNTI} punti: ${buildSoloAlbero.length} build legali` +
    ` (atteso 157) → ${buildSoloAlbero.length === 157 ? 'SÌ' : 'NO, controllare'}`,
);

// Ogni maschera degli innesti, raggruppata allo stesso modo — nessun
// prerequisito qui, quindi ogni sottoinsieme di dimensione k è legale.
const N_INNESTI = SHOP_ITEMS.length;
const MASCHERE_INNESTI: number[][] = Array.from({ length: N_INNESTI + 1 }, () => []);
for (let mask = 0; mask < 1 << N_INNESTI; mask++) {
  MASCHERE_INNESTI[popcount(mask)]!.push(mask);
}

// Una build con il Banco è una coppia (nodi, innesti) che insieme
// costano PUNTI: i bit degli innesti si mettono sopra quelli
// dell'albero, così una maschera sola identifica la build intera.
const buildConBanco: number[] = [];
for (let kInnesti = 0; kInnesti <= N_INNESTI; kInnesti++) {
  const kAlbero = PUNTI - kInnesti;
  if (kAlbero < 0 || kAlbero > N_NODI) continue;
  for (const maschAlbero of MASCHERE_ALBERO[kAlbero]!) {
    for (const maschInnesti of MASCHERE_INNESTI[kInnesti]!) {
      buildConBanco.push(maschAlbero | (maschInnesti << N_NODI));
    }
  }
}

console.log(
  `  Albero + Banco, a ${PUNTI} punti: ${buildConBanco.length} build legali` +
    ` (atteso 65039) → ${buildConBanco.length === 65039 ? 'SÌ' : 'NO, controllare'}`,
);

console.log('\n  Distribuzione per innesti comprati:');
console.log('    innesti  build (nodi × innesti)         totale');
let sommaDistribuzione = 0;
for (let kInnesti = 0; kInnesti <= N_INNESTI; kInnesti++) {
  const kAlbero = PUNTI - kInnesti;
  const nAlbero = kAlbero >= 0 && kAlbero <= N_NODI ? MASCHERE_ALBERO[kAlbero]!.length : 0;
  const nInnesti = combinazioni(N_INNESTI, kInnesti);
  const totale = nAlbero * nInnesti;
  sommaDistribuzione += totale;
  console.log(
    `    ${String(kInnesti).padStart(7)}  ${String(nAlbero).padStart(4)} × ${String(nInnesti).padStart(2)}` +
      `${' '.repeat(16)}${String(totale).padStart(8)}`,
  );
}
console.log(`    somma: ${sommaDistribuzione}`);

/** Sovrapposizione media fra due build a caso: quota dei punti spesi
 *  che le due condividono. Con |A| = |B| = PUNTI, |A∩B| / PUNTI è
 *  anche |A∩B| / |A|, quindi non serve l'unione per leggerla come una
 *  percentuale di "quanto ho in comune con l'altro". */
function sovrapposizioneMediaEsatta(build: readonly number[]): number {
  let somma = 0;
  let n = 0;
  for (let i = 0; i < build.length; i++) {
    for (let j = i + 1; j < build.length; j++) {
      somma += popcount(build[i]! & build[j]!);
      n++;
    }
  }
  return somma / n / PUNTI;
}

function sovrapposizioneMediaCampionata(build: readonly number[], campioni: number): number {
  let somma = 0;
  let fatti = 0;
  while (fatti < campioni) {
    const i = Math.floor(Math.random() * build.length);
    const j = Math.floor(Math.random() * build.length);
    if (i === j) continue; // due riferimenti alla stessa build non sono "due giocatori".
    somma += popcount(build[i]! & build[j]!);
    fatti++;
  }
  return somma / campioni / PUNTI;
}

// 157 build stanno comode in un doppio ciclo esatto (~12000 coppie);
// 65039 no — lì si campiona, come chiede il compito.
const CAMPIONI = 200_000;
const sovrapAlbero = sovrapposizioneMediaEsatta(buildSoloAlbero);
const sovrapBanco = sovrapposizioneMediaCampionata(buildConBanco, CAMPIONI);

console.log(
  `\n  Sovrapposizione media fra due build a caso:\n` +
    `    solo albero        ${(sovrapAlbero * 100).toFixed(1)}%  (esatta su ${buildSoloAlbero.length} build, atteso ~84%)\n` +
    `    albero + Banco      ${(sovrapBanco * 100).toFixed(1)}%  (campionata su ${CAMPIONI} coppie, atteso ~65%)`,
);
console.log(
  '\n  Questo è il numero che giustifica il Banco. Se un giorno scendesse,\n' +
    "  vorrebbe dire che l'albero è tornato a riempirsi da solo.",
);

// ---- 4. Il soffitto contro la ricarica più corta ----
// L'invariante dell'arco posteriore (sezione sopra) dice: nessuna
// finestra contiene due ricariche intere. Il Banco tocca entrambi i
// lati di quella disuguaglianza — accorcia la ricarica (Otturatore
// Spinto) e allunga o stringe la finestra (Eco Ampio, Doppio
// Innesco) — quindi il soffitto va ricalcolato con il Banco in tavola,
// non solo con l'arma base.

console.log("\n\n── 4. Il soffitto contro la ricarica più corta ──");

/** La ricarica più corta raggiungibile: si prova ogni sottoinsieme dei
 *  sei innesti, con e senza il nodo Otturatore Rapido, e si tiene il
 *  minimo. 2^6 × 2 = 128 chiamate a weaponStatsFor: costa nulla farle
 *  tutte, quindi non si assume dove sta il minimo — si guarda. */
function ricaricaPiuCorta(): { ms: number; combo: string } {
  let migliore = { ms: Infinity, combo: '' };
  for (let conNodo = 0; conNodo < 2; conNodo++) {
    const unlocked = conNodo ? ['otturatore-rapido'] : [];
    for (let mask = 0; mask < 1 << SHOP_ITEMS.length; mask++) {
      const purchased = SHOP_ITEMS.filter((_, i) => (mask & (1 << i)) !== 0).map((i) => i.id);
      const ms = weaponStatsFor(unlocked, purchased).cooldownMs;
      if (ms < migliore.ms) {
        const pezzi = [
          conNodo ? 'Otturatore Rapido' : null,
          ...purchased.map((id) => shopItemById(id)?.name ?? id),
        ].filter((s): s is string => s !== null);
        migliore = { ms, combo: pezzi.length ? pezzi.join(' + ') : '(arma base)' };
      }
    }
  }
  return migliore;
}

const ricarica = ricaricaPiuCorta();
const soffitto = ricarica.ms * 2;

console.log(`  Ricarica più corta raggiungibile: ${ricarica.ms} ms  (${ricarica.combo})`);
console.log(`  Soffitto (due ricariche intere):  ${soffitto} ms`);

/** Le combinazioni di innesti che cambiano l'esca. Le altre quattro
 *  non toccano beaconStatsFor, quindi provarle sarebbe misurare la
 *  stessa geometria una seconda volta. */
const COMBO_ESCA: readonly string[][] = [
  [],
  ['eco-ampio'],
  ['doppio-innesco'],
  ['eco-ampio', 'doppio-innesco'],
];

/** La finestra più lunga misurata su tutti gli archetipi col punto
 *  debole dietro, tutti gli angoli di lancio, tutte le distanze e
 *  tutte le combinazioni dell'esca che il Banco sa comporre. È il
 *  "caso peggiore" da confrontare col soffitto. */
function finestraPiuLunga(): { ms: number; kind: string; combo: string; theta: number } {
  let migliore = { ms: 0, kind: '', combo: '', theta: 0 };
  for (const combo of COMBO_ESCA) {
    const beacon = beaconStatsFor([], combo);
    for (const kind of REAR_KINDS) {
      for (let theta = 0; theta <= 60; theta += 5) {
        for (const tiles of [3, 4, 5]) {
          const w = rearWindow(kind, theta, tiles, beacon);
          const ms = w.rear * TICK_MS;
          if (ms > migliore.ms) {
            migliore = {
              ms,
              kind: archetypeOf(kind).name,
              combo: combo.length ? combo.map((id) => shopItemById(id)?.name ?? id).join(' + ') : '(esca base)',
              theta,
            };
          }
        }
      }
    }
  }
  return migliore;
}

const finestra = finestraPiuLunga();
const margine = Math.round(soffitto - finestra.ms);

console.log(
  `  Finestra più lunga misurata:      ${Math.round(finestra.ms)} ms` +
    `  (${finestra.kind}, ${finestra.combo}, ${finestra.theta}°)`,
);
console.log(
  `  Margine (soffitto − finestra):     ${margine >= 0 ? `+${margine}` : margine} ms` +
    `${margine < 0 ? '  → ROTTO: il soffitto non regge più' : '  → tiene'}`,
);
console.log(
  '\n  Se un giorno questo margine si stringesse fino a passare sotto zero,\n' +
    "  vorrebbe dire che un innesto ha reso possibile chiudere un nemico\n" +
    "  col solo Trasponditore — l'esca sarebbe diventata l'interruttore\n" +
    "  che BEACON_LIFETIME_MS esiste per impedire.",
);
