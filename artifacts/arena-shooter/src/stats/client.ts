// ================================================================
// STATS CLIENT
// ================================================================
// Career stats are a nice-to-have layered on top of the game, never a
// dependency of it. Every function here degrades to local storage
// when the API or its database is unavailable, and no failure is ever
// surfaced as an error the player has to dismiss.
// ================================================================

import type { MatchSummary } from '../game/game';

const LOCAL_KEY = 'arena-sniper.career';
const API_BASE = import.meta.env['VITE_API_BASE'] ?? '';

/** The standalone build runs from file://, where a relative API path
 *  resolves to a file URL and every request throws. The failure is
 *  already caught, but skipping it avoids a console error after every
 *  match for a call that could never succeed. */
const OFFLINE_ONLY = import.meta.env['VITE_STANDALONE'] === '1';

export interface CareerTotals {
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  bestStreak: number;
}

export interface LeaderboardEntry extends CareerTotals {
  callsign: string;
}

const EMPTY: CareerTotals = {
  matches: 0,
  wins: 0,
  kills: 0,
  deaths: 0,
  shotsFired: 0,
  shotsHit: 0,
  bestStreak: 0,
};

// ---- local fallback -------------------------------------------------

export function readLocalCareer(): CareerTotals {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<CareerTotals>;
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

function writeLocalCareer(summary: MatchSummary): CareerTotals {
  const prev = readLocalCareer();
  const next: CareerTotals = {
    matches: prev.matches + 1,
    wins: prev.wins + (summary.won ? 1 : 0),
    kills: prev.kills + summary.kills,
    deaths: prev.deaths + summary.deaths,
    shotsFired: prev.shotsFired + summary.shotsFired,
    shotsHit: prev.shotsHit + summary.shotsHit,
    bestStreak: Math.max(prev.bestStreak, summary.bestStreak),
  };
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  } catch {
    // Storage disabled; the in-memory return value is still correct.
  }
  return next;
}

// ---- remote ---------------------------------------------------------

/** Abort rather than let a hung request outlive the screen. */
async function post(path: string, body: unknown): Promise<Response | null> {
  if (OFFLINE_ONLY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    return await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Record a finished match. Always updates local storage; additionally
 *  posts to the API when one is reachable. Never throws. */
export async function recordMatch(
  summary: MatchSummary,
  callsign: string,
): Promise<CareerTotals> {
  const local = writeLocalCareer(summary);

  await post('/api/matches', {
    callsign: callsign.slice(0, 12),
    won: summary.won,
    kills: summary.kills,
    deaths: summary.deaths,
    shotsFired: summary.shotsFired,
    shotsHit: summary.shotsHit,
    bestStreak: summary.bestStreak,
    durationMs: Math.round(summary.durationMs),
    opponents: summary.opponents,
  });

  return local;
}

/** Global leaderboard, or null when the backend has no database. */
export async function fetchLeaderboard(
  limit = 20,
): Promise<LeaderboardEntry[] | null> {
  if (OFFLINE_ONLY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard?limit=${limit}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      available?: boolean;
      entries?: LeaderboardEntry[];
    };
    return data.available ? (data.entries ?? []) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function accuracyOf(t: CareerTotals): number {
  return t.shotsFired > 0 ? (t.shotsHit / t.shotsFired) * 100 : 0;
}
