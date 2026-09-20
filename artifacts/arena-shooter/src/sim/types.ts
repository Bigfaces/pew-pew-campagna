// ================================================================
// SIMULATION TYPES
// ================================================================
// Everything here must be plain, JSON-serializable data. Non è più
// per il multiplayer — l'host che serializzava WorldState su un
// canale WebRTC è andato via con l'Arena — ma la disciplina resta
// quella giusta: niente riferimenti circolari, e uno stato facile da
// leggere, loggare e testare headless.
//
// Questo è anche il motivo per cui il campo bot-only qui sotto tiene
// ancora `botTargetId` invece di un riferimento a `Entity`: sarebbe
// un ciclo, e un ciclo non si serializza — anche se oggi non c'è più
// nessun peer a cui spedirlo.
// ================================================================

export type BotState = 'patrol' | 'aim' | 'seek' | 'collect';

/** A participant in the match — human or bot, local or remote.
 *  There is deliberately no separate "RemotePlayer" type. */
export interface Entity {
  id: number;
  name: string;
  /** Palette index; the renderer resolves it to actual colours so
   *  that snapshots stay compact. */
  skin: number;
  /** How this entity is driven. The simulation itself only branches
   *  on `bot` (to run AI); `local` vs `remote` matters to the netcode
   *  layer, never to the physics. */
  controller: 'local' | 'bot' | 'remote';

  x: number;
  y: number;
  /** Yaw in radians, 0 = +X. Doubles as the first-person look angle. */
  angle: number;
  /** Normalized vertical look, -1..1. Purely cosmetic: it shifts the
   *  horizon rather than rotating the camera, so it cannot affect
   *  what a shot hits. Shots always travel along the horizontal. */
  pitch: number;

  alive: boolean;
  kills: number;
  deaths: number;
  /** Consecutive kills without dying — drives the streak callouts. */
  streak: number;
  bestStreak: number;
  shotsFired: number;
  shotsHit: number;

  weaponCooldown: number; // ms until the next shot is allowed
  respawnTimer: number; // ms until respawn, when dead

  shieldActive: boolean;
  rapidFireTimer: number;
  speedBoostTimer: number;

  // ---- Bot-only fields (inert for human-controlled entities) ----
  botState: BotState;
  botTargetId: number | null;
  botGoalX: number | null;
  botGoalY: number | null;
  botTimer: number;
  botReactionTimer: number;
  botLastSeenX: number | null;
  botLastSeenY: number | null;
}

export type PowerUpKind = 'shield' | 'rapidfire' | 'speed';

export interface PowerUp {
  kind: PowerUpKind;
  x: number;
  y: number;
  active: boolean;
  respawnTimer: number;
  /** Fixed per-instance phase offset so pickups don't bob in unison. */
  phase: number;
}
