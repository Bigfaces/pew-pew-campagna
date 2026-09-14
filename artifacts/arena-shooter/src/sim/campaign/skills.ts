// ================================================================
// SKILL TREE — quattro rami
// ================================================================
// Pure functions over the list of unlocked node ids. No state lives
// here — CampaignState.unlockedNodes is the single source of truth,
// same principle as the Arena keeping all tunables in constants.ts.
//
// Un gruppo di funzioni per famiglia di effetti (arma, movimento,
// scudo, informazione) invece di un unico oggetto "tutte le
// statistiche": chi chiama ne vuole sempre una sola, e una funzione
// per famiglia dice anche a chi legge *dove* un nodo si fa sentire.
// ================================================================

import {
  ALL_SKILL_NODES,
  BASE_WEAPON_STATS,
  DASH_COOLDOWN_MS,
  NODE_AGGANCIO_MOVE_MULT,
  NODE_AGGANCIO_TRANSITION_MS,
  DASH_SPEED,
  NODE_OTTURATORE_COOLDOWN_MS,
  NODE_PASSO_LUNGO_MULT,
  NODE_SLANCIO_SPEED_MULT,
  SHIELD_CHARGES_BASE,
  SHIELD_CHARGES_UPGRADED,
  type SkillNodeId,
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

// ---- Mobilità ----

export interface MovementStats {
  /** Multiplies PLAYER_SPEED. */
  speedMult: number;
  hasDash: boolean;
  dashCooldownMs: number;
  /** px/tick durante lo scatto. È questo, non la durata, a decidere
   *  quanto è larga la passerella che si riesce ad attraversare. */
  dashSpeed: number;
  /** Whether an active dash makes the player untouchable. */
  dashInvulnerable: boolean;
}

export function movementStatsFor(unlocked: readonly string[]): MovementStats {
  // I prerequisiti sono già garantiti da tryUnlockNode, ma leggerli
  // anche qui rende la funzione vera per *qualsiasi* lista — e i test
  // ne costruiscono di arbitrarie senza passare dall'albero.
  const hasDash = unlocked.includes('scatto');
  return {
    speedMult: unlocked.includes('passo-lungo') ? NODE_PASSO_LUNGO_MULT : 1,
    hasDash,
    dashCooldownMs: DASH_COOLDOWN_MS,
    dashSpeed:
      hasDash && unlocked.includes('slancio')
        ? DASH_SPEED * NODE_SLANCIO_SPEED_MULT
        : DASH_SPEED,
    dashInvulnerable: hasDash && unlocked.includes('scatto-evasivo'),
  };
}

// ---- Secondo anello (Atto II) ----
// Quattro nodi, uno per ramo, ognuno risposta a una minaccia che
// l'Atto II introduce. È la progressione che l'atto merita: prima
// arriva il problema, poi il ramo che se ne occupa offre la risposta —
// invece di nodi che migliorano numeri già buoni.

/** Mira Stabile: l'ottica non si abbassa più per gas o gravità. */
export function scopeResistsInterference(unlocked: readonly string[]): boolean {
  return unlocked.includes('mira-stabile') && unlocked.includes('aggancio-ottico');
}

/** Ancoraggio: la gravità invertita ribalta ancora la vista, ma non
 *  specchia più i comandi. Toglie la parte che punisce i riflessi e
 *  lascia quella che disorienta — che è la metà interessante. */
export function resistsGravityFlip(unlocked: readonly string[]): boolean {
  return unlocked.includes('ancoraggio') && unlocked.includes('riserva-di-bordo');
}

/** Sensori Inerziali: lo scanner regge dentro il contaminante. */
export function scannerResistsGas(unlocked: readonly string[]): boolean {
  return unlocked.includes('sensori-inerziali') && hasContacts(unlocked);
}

// ---- Sopravvivenza ----

/** Quanti colpi assorbe uno scudo appena raccolto. */
export function shieldCapacity(unlocked: readonly string[]): number {
  return unlocked.includes('piastra-aggiuntiva')
    ? SHIELD_CHARGES_UPGRADED
    : SHIELD_CHARGES_BASE;
}

/** Riserva di Bordo: entrare in una stanza nuova ricarica lo scudo.
 *  Non è sfruttabile in loop perché i checkpoint avanzano soltanto
 *  (vedi CampaignWorld.updateCheckpoint): tornare indietro e rientrare
 *  non conta come stanza nuova. */
export function refillsShieldOnRoomEnter(unlocked: readonly string[]): boolean {
  return unlocked.includes('riserva-di-bordo');
}

// ---- Percezione ----
// Questi due non toccano la simulazione: cambiano solo cosa il
// giocatore vede. Il nodo resta comunque stato della sim
// (unlockedNodes) — è il renderer a chiedere, non a decidere.

export function hasMinimap(unlocked: readonly string[]): boolean {
  return unlocked.includes('scanner-di-settore');
}

export function hasContacts(unlocked: readonly string[]): boolean {
  return unlocked.includes('lettura-termica') && hasMinimap(unlocked);
}


// ---- Albero ----

export function isValidNode(id: string): id is SkillNodeId {
  return ALL_SKILL_NODES.some((n) => n.id === id);
}

export function nodeCost(id: string): number {
  return ALL_SKILL_NODES.find((n) => n.id === id)?.cost ?? Infinity;
}

/** The node this one sits behind, if any. */
export function nodeRequires(id: string): SkillNodeId | null {
  return ALL_SKILL_NODES.find((n) => n.id === id)?.requires ?? null;
}

/** Whether this node's prerequisite (if it has one) is already
 *  unlocked. Nodes with no prerequisite are always available. */
export function prereqMet(unlocked: readonly string[], id: string): boolean {
  const req = nodeRequires(id);
  return req === null || unlocked.includes(req);
}

/** Skill points spent so far, derived from the unlocked list rather
 *  than tracked separately — one source of truth, per CampaignState.
 *
 *  Ids sconosciuti valgono 0, non Infinity: un profilo salvato da una
 *  versione precedente può contenere un nodo che non esiste più, e
 *  farlo costare infinito bloccherebbe per sempre l'albero di quel
 *  giocatore invece di ignorare la riga che non si sa più leggere. */
export function pointsSpent(unlocked: readonly string[]): number {
  return unlocked.reduce((sum, id) => {
    const cost = nodeCost(id);
    return sum + (Number.isFinite(cost) ? cost : 0);
  }, 0);
}
