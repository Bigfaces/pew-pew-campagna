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

import { BULLET_COOLDOWN, TICK_MS } from '../src/sim/constants';
import {
  ALL_SKILL_NODES,
  BEACON_LIFETIME_MS,
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
  SKILL_TREE,
  XP_BOSS_DEFEAT,
  XP_BOSS_HIT_SOLID,
  XP_CORE,
  XP_ROOM_ENTER,
  XP_ENEMY_WEAK_HIT,
  XP_TURRET_DOWN,
  levelForXp,
} from '../src/sim/campaign/constants';
import {
  ALL_ENEMY_KINDS,
  VULNERABILITY_MULT,
  WEAK_SPOT_MULT,
  archetypeOf,
} from '../src/sim/campaign/enemies';
import { ACTS, ALL_LEVELS } from '../src/sim/campaign/levels';
import { roomAt } from '../src/sim/campaign/levelTypes';

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
