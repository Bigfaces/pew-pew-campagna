// ================================================================
// BALANCE HARNESS — Campagna
// ================================================================
// Il gemello di balance.mts per la verticale slice (GDD.md sezione
// 10, task 5). Stesso principio: le affermazioni sul bilanciamento si
// controllano invece di discuterle.
//
//   pnpm --filter @workspace/arena-shooter run balance:campaign
//
// Riporta due cose che non si vedono leggendo le costanti:
//
//   1. QUANDO arrivano i punti abilità lungo un run, confrontati con
//      quanti nodi ci sono da sbloccare. La prima taratura concedeva
//      il terzo punto solo insieme al bonus di vittoria — cioè su un
//      nodo che non si poteva più usare. Si vede solo sommando la
//      progressione nell'ordine in cui il giocatore la incontra.
//   2. Il ritmo del boss: quanto dura un ciclo e quanta della sua
//      durata è finestra vulnerabile.
// ================================================================

import { TICK_MS } from '../src/sim/constants';
import {
  BOSS_CHARGE_MS,
  BOSS_ENRAGED_CHARGES,
  BOSS_ENRAGE_AT,
  BOSS_GUARD_ENRAGED_MS,
  BOSS_GUARD_MS,
  BOSS_HITS_TO_DEFEAT,
  BOSS_RECOVER_ENRAGED_MS,
  BOSS_RECOVER_MS,
  BOSS_TELEGRAPH_ENRAGED_MS,
  BOSS_TELEGRAPH_MS,
  BOSS_VOLLEY_RECOVER_MS,
  ALL_SKILL_NODES,
  LEVEL_XP_THRESHOLDS,
  SKILL_TREE,
  XP_BOSS_DEFEAT,
  XP_BOSS_HIT_SOLID,
  XP_CORE,
  XP_DRONE_DOWN,
  XP_ROOM_ENTER,
  levelForXp,
} from '../src/sim/campaign/constants';

const NODES = ALL_SKILL_NODES.length;
const BIGGEST_BRANCH = Math.max(...SKILL_TREE.map((b) => b.nodes.length));

function pointsAt(xp: number): number {
  return levelForXp(xp) - 1;
}

/** Un run nell'ordine in cui il giocatore incontra le ricompense. */
interface Step {
  label: string;
  xp: number;
  /** false dal colpo che uccide il boss in poi: la slice finisce lì,
   *  e un punto guadagnato in quell'istante non si può più spendere
   *  su niente. È la distinzione che nascondeva il bug della prima
   *  taratura. */
  spendable: boolean;
}

function run(label: string, steps: Step[], startXp = 0): { xp: number; useful: number } {
  console.log(`\n── ${label} ──`);
  let xp = startXp;
  let pointsWhileUseful = pointsAt(xp);
  for (const s of steps) {
    xp += s.xp;
    const pts = pointsAt(xp);
    if (s.spendable) pointsWhileUseful = pts;
    console.log(
      `  ${s.label.padEnd(30)} ${String(xp).padStart(4)} XP   lv${levelForXp(xp)}   ${pts} punti${
        s.spendable ? '' : '   (troppo tardi per spenderli)'
      }`,
    );
  }
  console.log(`  → punti spendibili mentre servono ancora: ${pointsWhileUseful}/${NODES}`);
  return { xp, useful: pointsWhileUseful };
}

console.log('CAMPAGNA — BILANCIAMENTO');
console.log(`\nSoglie di livello: ${LEVEL_XP_THRESHOLDS.join(', ')}`);
console.log(`Nodi sbloccabili: ${NODES}`);
for (const b of SKILL_TREE) {
  console.log(`  ${b.name.padEnd(16)} ${b.nodes.length} nodi`);
}

const explorer = run('Esplora tutto (primo run)', [
  { label: 'entra in corridoio', xp: XP_ROOM_ENTER, spendable: true },
  { label: 'core del corridoio', xp: XP_CORE, spendable: true },
  { label: 'entra in magazzino', xp: XP_ROOM_ENTER, spendable: true },
  { label: 'core del magazzino', xp: XP_CORE, spendable: true },
  { label: 'drone abbattuto', xp: XP_DRONE_DOWN, spendable: true },
  { label: 'entra nel molo', xp: XP_ROOM_ENTER, spendable: true },
  { label: 'colpo al boss 1', xp: XP_BOSS_HIT_SOLID, spendable: true },
  { label: 'colpo al boss 2', xp: XP_BOSS_HIT_SOLID, spendable: true },
  { label: 'colpo al boss 3 (uccide)', xp: XP_BOSS_HIT_SOLID, spendable: false },
  { label: 'bonus di vittoria', xp: XP_BOSS_DEFEAT, spendable: false },
]);

run('Tira dritto (niente core, niente drone)', [
  { label: 'entra in corridoio', xp: XP_ROOM_ENTER, spendable: true },
  { label: 'entra in magazzino', xp: XP_ROOM_ENTER, spendable: true },
  { label: 'entra nel molo', xp: XP_ROOM_ENTER, spendable: true },
  { label: 'colpo al boss 1', xp: XP_BOSS_HIT_SOLID, spendable: true },
  { label: 'colpo al boss 2', xp: XP_BOSS_HIT_SOLID, spendable: true },
  { label: 'colpo al boss 3 (uccide)', xp: XP_BOSS_HIT_SOLID, spendable: false },
  { label: 'bonus di vittoria', xp: XP_BOSS_DEFEAT, spendable: false },
]);

// Un secondo run non ripaga stanze e core: sono once-per-profilo,
// altrimenti uscire al menu e rientrare sarebbe un loop di XP stabile.
// Quello che resta è il drone e il boss — ed è su questo residuo che
// si misura quanto ci mette l'albero a riempirsi.
const REPEAT_RUN_XP = XP_DRONE_DOWN + 3 * XP_BOSS_HIT_SOLID + XP_BOSS_DEFEAT;
console.log(`\nUn run ripetuto vale ${REPEAT_RUN_XP} XP (stanze e core sono già pagati).`);

let xp = explorer.xp;
let runs = 1;
console.log(`  dopo il run 1: ${xp} XP → ${pointsAt(xp)}/${NODES} punti`);
while (pointsAt(xp) < NODES && runs < 20) {
  xp += REPEAT_RUN_XP;
  runs++;
  console.log(`  dopo il run ${runs}: ${xp} XP → ${pointsAt(xp)}/${NODES} punti`);
}

// ---- Invarianti ----
// Le tre cose che possono rompersi ritarando XP o aggiungendo nodi, e
// che leggendo le costanti non si vedono.

const maxPoints = LEVEL_XP_THRESHOLDS.length - 1;
console.log('\nInvarianti');
console.log(
  `  1. Nessun punto senza un nodo su cui finire: ${maxPoints} punti / ${NODES} nodi — ` +
    `${maxPoints === NODES ? 'SÌ' : 'NO'}`,
);
console.log(
  `  2. Al primo run ci si può specializzare (un ramo intero prima del boss): ` +
    `${explorer.useful} punti / ramo più grande ${BIGGEST_BRANCH} — ` +
    `${explorer.useful >= BIGGEST_BRANCH ? 'SÌ' : 'NO'}`,
);
console.log(
  `  3. L'albero completo NON arriva al primo run, ma arriva: run ${runs} — ` +
    `${runs > 1 && pointsAt(xp) >= NODES ? 'SÌ' : 'NO'}`,
);
console.log(
  '\n  La 2 e la 3 tirano in direzioni opposte di proposito: un albero\n' +
    '  comprabile tutto subito non è un albero, e uno che non lascia\n' +
    '  scegliere niente al primo run non è una progressione.',
);

function bossCycle(label: string, guard: number, telegraph: number, charges: number, volleyPause: number, recover: number): void {
  // Una raffica: guardia, poi per ogni carica un telegrafo e la carica
  // stessa, separate da una pausa breve; l'ultima pausa è quella lunga.
  const cycleMs =
    guard + charges * (telegraph + BOSS_CHARGE_MS) + (charges - 1) * volleyPause + recover;
  // Vulnerabile durante ogni carica e ogni pausa, breve o lunga.
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

console.log('\n── Sentinella del Molo ──');
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
