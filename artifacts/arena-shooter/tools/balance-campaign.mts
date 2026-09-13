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
  LEVEL_XP_THRESHOLDS,
  PRECISION_NODES,
  XP_BOSS_DEFEAT,
  XP_BOSS_HIT_SOLID,
  XP_CORE,
  XP_DRONE_DOWN,
  XP_ROOM_ENTER,
  levelForXp,
} from '../src/sim/campaign/constants';

const NODES = PRECISION_NODES.length;

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

function run(label: string, steps: Step[]): number {
  console.log(`\n── ${label} ──`);
  let xp = 0;
  let pointsWhileUseful = 0;
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
  return pointsWhileUseful;
}

console.log('CAMPAGNA — BILANCIAMENTO');
console.log(`\nSoglie di livello: ${LEVEL_XP_THRESHOLDS.join(', ')}`);
console.log(`Nodi sbloccabili: ${NODES} (ramo Precisione)`);

const explorer = run('Esplora tutto', [
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

// L'invariante che conta, e che la prima taratura violava: chi cerca
// tutto quello che la slice offre deve poter *usare* tutto quello che
// ha guadagnato. Per chi tira dritto, avere meno nodi non è un bug —
// è il premio dell'esplorazione visto dall'altro lato.
console.log(
  `\nInvariante — chi esplora tutto può spendere ogni nodo prima del colpo decisivo: ` +
    `${explorer >= NODES ? 'SÌ' : `NO (${explorer}/${NODES})`}`,
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
