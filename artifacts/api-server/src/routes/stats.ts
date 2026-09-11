import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";

import {
  getDb,
  insertMatchSchema,
  isDatabaseConfigured,
  matchesTable,
} from "@workspace/db";

import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Persistence is optional. When no database is configured every
 *  endpoint answers 503 with an explicit flag, so the client can fall
 *  back to local storage instead of guessing from a network error. */
function unavailable(res: Parameters<Parameters<IRouter["get"]>[1]>[1]): void {
  res.status(503).json({ available: false, reason: "no database configured" });
}

router.get("/stats/health", (_req, res) => {
  res.json({ available: isDatabaseConfigured() });
});

/** Record one finished match. */
router.post("/matches", async (req, res) => {
  const db = getDb();
  if (!db) return unavailable(res);

  const parsed = insertMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid match payload" });
  }

  // Reject internally inconsistent reports. The client is untrusted:
  // these numbers come straight from a browser, so a match claiming
  // more hits than shots is either a bug or a forgery.
  const m = parsed.data;
  if (m.shotsHit > m.shotsFired || m.bestStreak > m.kills) {
    return res.status(400).json({ error: "inconsistent match payload" });
  }

  try {
    const [row] = await db.insert(matchesTable).values(m).returning();
    return res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "failed to record match");
    return res.status(500).json({ error: "could not record match" });
  }
});

/** Aggregate leaderboard across all recorded matches. */
router.get("/leaderboard", async (req, res) => {
  const db = getDb();
  if (!db) return unavailable(res);

  const limit = Math.min(Number(req.query["limit"]) || 20, 100);

  try {
    const rows = await db
      .select({
        callsign: matchesTable.callsign,
        matches: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${matchesTable.won})::int`,
        kills: sql<number>`coalesce(sum(${matchesTable.kills}), 0)::int`,
        deaths: sql<number>`coalesce(sum(${matchesTable.deaths}), 0)::int`,
        bestStreak: sql<number>`coalesce(max(${matchesTable.bestStreak}), 0)::int`,
        shotsFired: sql<number>`coalesce(sum(${matchesTable.shotsFired}), 0)::int`,
        shotsHit: sql<number>`coalesce(sum(${matchesTable.shotsHit}), 0)::int`,
      })
      .from(matchesTable)
      .groupBy(matchesTable.callsign)
      .orderBy(desc(sql`coalesce(sum(${matchesTable.kills}), 0)`))
      .limit(limit);

    return res.json({ available: true, entries: rows });
  } catch (err) {
    logger.error({ err }, "failed to read leaderboard");
    return res.status(500).json({ error: "could not read leaderboard" });
  }
});

/** Career totals plus recent history for one callsign. */
router.get("/stats/:callsign", async (req, res) => {
  const db = getDb();
  if (!db) return unavailable(res);

  const callsign = String(req.params["callsign"] ?? "").slice(0, 12);
  if (!callsign) return res.status(400).json({ error: "callsign required" });

  try {
    const recent = await db
      .select()
      .from(matchesTable)
      .where(eq(matchesTable.callsign, callsign))
      .orderBy(desc(matchesTable.playedAt))
      .limit(10);

    const totals = recent.reduce(
      (acc, m) => ({
        matches: acc.matches + 1,
        wins: acc.wins + (m.won ? 1 : 0),
        kills: acc.kills + m.kills,
        deaths: acc.deaths + m.deaths,
        shotsFired: acc.shotsFired + m.shotsFired,
        shotsHit: acc.shotsHit + m.shotsHit,
        bestStreak: Math.max(acc.bestStreak, m.bestStreak),
      }),
      {
        matches: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        shotsFired: 0,
        shotsHit: 0,
        bestStreak: 0,
      },
    );

    return res.json({ available: true, callsign, totals, recent });
  } catch (err) {
    logger.error({ err }, "failed to read player stats");
    return res.status(500).json({ error: "could not read stats" });
  }
});

export default router;
