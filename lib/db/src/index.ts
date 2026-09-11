import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Persistence is optional by design. The game is fully playable with
// no database at all — stats simply fall back to local storage in the
// browser — so a missing DATABASE_URL must not be fatal.
//
// This module previously threw at import time, which meant merely
// importing anything from the db package took the whole API server
// down when the variable was absent.

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;
let initialized = false;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env["DATABASE_URL"]);
}

/** Returns the Drizzle client, or null when no database is configured.
 *  Callers are expected to branch on null rather than assume. */
export function getDb(): NodePgDatabase<typeof schema> | null {
  if (initialized) return db;
  initialized = true;

  const url = process.env["DATABASE_URL"];
  if (!url) return null;

  pool = new Pool({ connectionString: url });
  // A pool error (server restart, network blip) is emitted on the pool
  // itself; without a listener Node treats it as an unhandled error
  // and exits the process.
  pool.on("error", () => {
    /* connection-level errors surface again on the next query */
  });

  db = drizzle(pool, { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
  initialized = false;
}

export * from "./schema";
