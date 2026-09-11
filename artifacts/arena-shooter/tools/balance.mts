// ================================================================
// BALANCE HARNESS
// ================================================================
// Runs the simulation headless and reports the numbers that decide
// whether the arena plays the way it is meant to. The point is that
// tuning claims can be checked instead of argued: change a constant
// or the map, re-run, compare.
//
//   pnpm --filter @workspace/arena-shooter run balance
//
// It runs bot-vs-bot. A human is faster (PLAYER_SPEED vs the bot
// speed in BOT_TUNING) and aims better, so these figures describe the
// arena's own dynamics, not a player's experience of it — read them
// as the floor, not the average.
// ================================================================

import {
  BOT_TUNING,
  DIFFICULTIES,
  MAP_H,
  MAP_W,
  MATCH_TIME_TICKS,
  TICK_MS,
  TILE,
  killTarget,
  type Difficulty,
} from '../src/sim/constants';
import { isSolid } from '../src/sim/map';
import { angleDelta, castRay, hasLOS } from '../src/sim/raycast';
import { World, type SlotConfig } from '../src/sim/world';

const MATCHES = 30;

function botSlots(n: number): SlotConfig[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `B${i}`,
    skin: i,
    controller: 'bot' as const,
  }));
}

function pct(a: number, b: number): string {
  return b === 0 ? '   — ' : `${((a / b) * 100).toFixed(1)}%`;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ----------------------------------------------------------------
// Match sampling
// ----------------------------------------------------------------

interface MatchStats {
  seconds: number;
  endedOnClock: boolean;
  kills: number;
  shots: number;
  hits: number;
  /** Kill distances, in tiles. */
  distances: number[];
  /** Kills where the victim had the killer outside its own view cone. */
  blindsided: number;
  /** Seconds each life lasted, from spawn to death. */
  lives: number[];
  /** Samples of "this entity was in someone's line of sight". */
  exposedSamples: number;
  totalSamples: number;
}

function playMatch(
  players: number,
  seed: number,
  difficulty: Difficulty,
): MatchStats {
  const world = new World(botSlots(players), seed, difficulty);
  const halfFov = BOT_TUNING[difficulty].halfFov;
  const spawnTick = new Map<number, number>(
    world.entities.map((e) => [e.id, 0]),
  );

  const distances: number[] = [];
  const lives: number[] = [];
  let kills = 0;
  let blindsided = 0;
  let exposedSamples = 0;
  let totalSamples = 0;

  while (!world.finished && world.state.tick < MATCH_TIME_TICKS) {
    for (const event of world.step()) {
      if (event.type === 'spawn') {
        spawnTick.set(event.entityId, world.state.tick);
        continue;
      }
      if (event.type !== 'kill') continue;

      kills++;
      const killer = world.byId(event.killerId)!;
      const victim = world.byId(event.victimId)!;

      // The kill event reports where the victim fell, which is where
      // the shot connected — the right anchor for both measurements.
      distances.push(Math.hypot(killer.x - event.x, killer.y - event.y) / TILE);

      const bearing = Math.atan2(killer.y - event.y, killer.x - event.x);
      if (Math.abs(angleDelta(victim.angle, bearing)) > halfFov) blindsided++;

      const born = spawnTick.get(event.victimId);
      if (born !== undefined) {
        lives.push(((world.state.tick - born) * TICK_MS) / 1000);
      }
    }

    // Four exposure samples a second is plenty and keeps the O(n^2)
    // line-of-sight sweep off the hot path.
    if (world.state.tick % 15 !== 0) continue;
    const living = world.entities.filter((e) => e.alive);
    for (const e of living) {
      totalSamples++;
      if (living.some((o) => o.id !== e.id && hasLOS(e.x, e.y, o.x, o.y))) {
        exposedSamples++;
      }
    }
  }

  return {
    seconds: (world.state.tick * TICK_MS) / 1000,
    endedOnClock: world.state.tick >= MATCH_TIME_TICKS,
    kills,
    shots: world.entities.reduce((a, e) => a + e.shotsFired, 0),
    hits: world.entities.reduce((a, e) => a + e.shotsHit, 0),
    distances,
    blindsided,
    lives,
    exposedSamples,
    totalSamples,
  };
}

function reportMatches(players: number, difficulty: Difficulty): void {
  const runs = Array.from({ length: MATCHES }, (_, i) =>
    playMatch(players, 1000 + i * 37, difficulty),
  );

  const durations = runs.map((r) => r.seconds);
  const allDistances = runs.flatMap((r) => r.distances);
  const allLives = runs.flatMap((r) => r.lives);
  const totalKills = runs.reduce((a, r) => a + r.kills, 0);
  const onClock = runs.filter((r) => r.endedOnClock).length;

  const row = (label: string, value: string): string =>
    `    ${label.padEnd(34)}${value}`;

  console.log(`\n  ${players} giocatori · ${difficulty}`);
  console.log(
    row(
      'durata partita',
      `mediana ${median(durations).toFixed(0)}s · max ${Math.max(...durations).toFixed(0)}s`,
    ),
  );
  console.log(
    row(
      `finite al cronometro`,
      `${onClock}/${MATCHES}  ${pct(onClock, MATCHES)}   (invece che a ${killTarget(players)} uccisioni)`,
    ),
  );
  console.log(
    row(
      'ritmo',
      `${(totalKills / MATCHES).toFixed(1)} uccisioni/partita · 1 ogni ${(
        durations.reduce((a, b) => a + b, 0) / totalKills
      ).toFixed(1)}s`,
    ),
  );
  console.log(
    row(
      'precisione dei bot',
      pct(
        runs.reduce((a, r) => a + r.hits, 0),
        runs.reduce((a, r) => a + r.shots, 0),
      ),
    ),
  );
  console.log(
    row(
      'distanza di uccisione (tile)',
      `mediana ${median(allDistances).toFixed(1)} · media ${mean(allDistances).toFixed(1)}` +
        ` · <3 ${pct(allDistances.filter((d) => d < 3).length, allDistances.length)}` +
        ` · >10 ${pct(allDistances.filter((d) => d > 10).length, allDistances.length)}`,
    ),
  );
  console.log(
    row(
      'uccisioni da fuori il cono visivo',
      pct(
        runs.reduce((a, r) => a + r.blindsided, 0),
        totalKills,
      ),
    ),
  );
  console.log(
    row(
      'durata di una vita',
      `mediana ${median(allLives).toFixed(1)}s · sotto i 2s ${pct(
        allLives.filter((l) => l < 2).length,
        allLives.length,
      )}`,
    ),
  );
  console.log(
    row(
      'tempo nella linea di vista altrui',
      pct(
        runs.reduce((a, r) => a + r.exposedSamples, 0),
        runs.reduce((a, r) => a + r.totalSamples, 0),
      ),
    ),
  );
}

// ----------------------------------------------------------------
// Map geometry
// ----------------------------------------------------------------

/** Every open interior tile, as pixel centres. */
function floorCells(): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let ty = 1; ty < MAP_H - 1; ty++) {
    for (let tx = 1; tx < MAP_W - 1; tx++) {
      if (!isSolid(tx, ty)) cells.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
    }
  }
  return cells;
}

function reportMap(): void {
  const cells = floorCells();
  const interior = (MAP_W - 2) * (MAP_H - 2);
  const solid = interior - cells.length;

  const row = (label: string, value: string): string =>
    `    ${label.padEnd(34)}${value}`;

  console.log('\n  Geometria della mappa');
  console.log(
    row(
      'ostruzione delle tile interne',
      `${pct(solid, interior)}   (${solid} solide / ${cells.length} libere)`,
    ),
  );

  // Average and worst sightline, sampled on 64 headings per tile.
  let raySum = 0;
  let rayCount = 0;
  let longest = 0;
  let over12 = 0;
  for (const c of cells) {
    for (let i = 0; i < 64; i++) {
      const d = castRay(c.x, c.y, (i / 64) * Math.PI * 2, Infinity).dist / TILE;
      raySum += d;
      rayCount++;
      if (d > 12) over12++;
      if (d > longest) longest = d;
    }
  }
  console.log(row('sightline media da una tile', `${(raySum / rayCount).toFixed(1)} tile`));
  console.log(
    row('sightline più lunga dell\'arena', `${longest.toFixed(1)} tile  (diagonale = 47)`),
  );
  console.log(row('raggi che corrono oltre 12 tile', pct(over12, rayCount)));

  // Mutual visibility over a strided sample of tile pairs — the single
  // number that says how much of the arena is a shooting gallery.
  let pairs = 0;
  let visible = 0;
  for (let i = 0; i < cells.length; i += 3) {
    for (let j = i + 3; j < cells.length; j += 3) {
      pairs++;
      if (hasLOS(cells[i]!.x, cells[i]!.y, cells[j]!.x, cells[j]!.y)) visible++;
    }
  }
  console.log(
    row('coppie di posizioni che si vedono', `${pct(visible, pairs)}   (campione ${pairs})`),
  );
}

// ----------------------------------------------------------------

console.log('\n═══ ARENA SNIPER · BILANCIAMENTO ═══');
reportMap();

console.log('\n  Partite simulate (bot contro bot, %d per configurazione)'.replace('%d', String(MATCHES)));
for (const difficulty of DIFFICULTIES) reportMatches(4, difficulty);
for (const players of [2, 6, 8]) reportMatches(players, 'normale');
console.log('');
