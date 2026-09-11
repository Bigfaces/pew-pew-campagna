// ================================================================
// SKILL TREE — ramo Precisione (Sprint 1)
// ================================================================
// Pure functions over the list of unlocked node ids. No state lives
// here — CampaignState.unlockedNodes is the single source of truth,
// same principle as the Arena keeping all tunables in constants.ts.
// ================================================================

import {
  BASE_WEAPON_STATS,
  NODE_AGGANCIO_MOVE_MULT,
  NODE_AGGANCIO_TRANSITION_MS,
  NODE_OTTURATORE_COOLDOWN_MS,
  PRECISION_NODES,
  type PrecisionNodeId,
} from './constants';

export interface WeaponStats {
  cooldownMs: number;
  adsTransitionMs: number;
  adsMoveMult: number;
}

export function weaponStatsFor(unlocked: readonly string[]): WeaponStats {
  const stats: WeaponStats = { ...BASE_WEAPON_STATS };
  if (unlocked.includes('otturatore-rapido')) {
    stats.cooldownMs = NODE_OTTURATORE_COOLDOWN_MS;
  }
  if (unlocked.includes('aggancio-ottico')) {
    stats.adsTransitionMs = NODE_AGGANCIO_TRANSITION_MS;
    stats.adsMoveMult = NODE_AGGANCIO_MOVE_MULT;
  }
  return stats;
}

export function hasGrazeDamage(unlocked: readonly string[]): boolean {
  return unlocked.includes('danno-di-striscio');
}

export function isValidNode(id: string): id is PrecisionNodeId {
  return PRECISION_NODES.some((n) => n.id === id);
}

export function nodeCost(id: string): number {
  return PRECISION_NODES.find((n) => n.id === id)?.cost ?? Infinity;
}

/** Skill points spent so far, derived from the unlocked list rather
 *  than tracked separately — one source of truth, per CampaignState. */
export function pointsSpent(unlocked: readonly string[]): number {
  return unlocked.reduce((sum, id) => sum + nodeCost(id), 0);
}
