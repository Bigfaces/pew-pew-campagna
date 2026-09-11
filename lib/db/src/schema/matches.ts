import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** One row per completed match, from the reporting player's view.
 *
 *  Deliberately denormalized: there is no players table and no join.
 *  A callsign is a self-chosen label with no account behind it, so
 *  promoting it to an entity would imply an identity the game does
 *  not actually have. Aggregates are computed on read instead. */
export const matchesTable = pgTable(
  "matches",
  {
    id: serial("id").primaryKey(),
    callsign: text("callsign").notNull(),
    won: boolean("won").notNull(),
    kills: integer("kills").notNull(),
    deaths: integer("deaths").notNull(),
    shotsFired: integer("shots_fired").notNull(),
    shotsHit: integer("shots_hit").notNull(),
    bestStreak: integer("best_streak").notNull(),
    durationMs: integer("duration_ms").notNull(),
    opponents: integer("opponents").notNull(),
    playedAt: timestamp("played_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The leaderboard groups by callsign and orders by recency, so
    // both columns are worth indexing.
    index("matches_callsign_idx").on(t.callsign),
    index("matches_played_at_idx").on(t.playedAt),
  ],
);

export const insertMatchSchema = createInsertSchema(matchesTable, {
  callsign: z.string().trim().min(1).max(12),
  kills: z.number().int().min(0).max(1000),
  deaths: z.number().int().min(0).max(1000),
  shotsFired: z.number().int().min(0).max(100000),
  shotsHit: z.number().int().min(0).max(100000),
  bestStreak: z.number().int().min(0).max(1000),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  opponents: z.number().int().min(0).max(16),
}).omit({ id: true, playedAt: true });

export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Match = typeof matchesTable.$inferSelect;
