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
  NODE_DASH_STEER_RATE,
  NODE_OTTURATORE_COOLDOWN_MS,
  NODE_PASSO_LUNGO_MULT,
  NODE_SLANCIO_SPEED_MULT,
  SHIELD_CHARGES_BASE,
  SHIELD_CHARGES_UPGRADED,
  SHOP_DOPPIO_INNESCO_CHARGES,
  SHOP_DOPPIO_INNESCO_RANGE_TILES,
  SHOP_ECO_AMPIO_LIFETIME_MS,
  SHOP_ECO_AMPIO_LURE_TILES,
  SHOP_ITEMS,
  SHOP_OTTURATORE_SPINTO_ADS_MS,
  SHOP_OTTURATORE_SPINTO_DELTA_MS,
  SHOP_PIASTRA_FUSA_CHARGES_DELTA,
  SHOP_PIASTRA_FUSA_COOLDOWN_DELTA_MS,
  SHOP_SCATTO_TESO_DASH_MULT,
  SHOP_SCATTO_TESO_SPEED_MULT,
  SHOP_ZAVORRA_DASH_COOLDOWN_MS,
  SHOP_ZAVORRA_SPEED_MULT,
  BEACON_CHARGES_START,
  BEACON_LIFETIME_MS,
  BEACON_LURE_TILES,
  BEACON_RANGE_TILES,
  type ShopItemDef,
  type ShopItemId,
  type SkillNodeId,
} from './constants';

// ================================================================
// LA CUCITURA
// ================================================================
// Ogni funzione qui sotto prende DUE liste: i nodi dell'albero e gli
// innesti comprati al Banco. Il secondo parametro è opzionale e vale
// la lista vuota, così una chiamata scritta prima che il Banco
// esistesse continua a dire la verità invece di rompersi — e i test
// che costruiscono liste arbitrarie non devono passarne due.
//
// L'ordine di applicazione è sempre lo stesso: prima i nodi, poi gli
// innesti, e gli innesti in ordine di definizione in SHOP_ITEMS. Due
// innesti che toccano lo stesso campo compongono quindi in modo
// prevedibile, invece di dipendere da quale è stato comprato prima —
// che sarebbe uno stato nascosto dentro una lista che sembra un
// insieme.
// ================================================================

export interface WeaponStats {
  cooldownMs: number;
  adsTransitionMs: number;
  adsMoveMult: number;
}

export function weaponStatsFor(
  unlocked: readonly string[],
  purchased: readonly string[] = [],
): WeaponStats {
  const stats: WeaponStats = { ...BASE_WEAPON_STATS };
  if (unlocked.includes('otturatore-rapido')) {
    stats.cooldownMs = NODE_OTTURATORE_COOLDOWN_MS;
  }
  if (unlocked.includes('aggancio-ottico')) {
    stats.adsTransitionMs = NODE_AGGANCIO_TRANSITION_MS;
    stats.adsMoveMult = NODE_AGGANCIO_MOVE_MULT;
  }
  // Banco. I due delta sulla ricarica si sommano invece di
  // sovrascriversi: chi ha comprato Otturatore Spinto e Piastra Fusa
  // torna esattamente al punto di partenza, ed è il prezzo giusto per
  // aver voluto le due cose insieme.
  if (purchased.includes('otturatore-spinto')) {
    stats.cooldownMs += SHOP_OTTURATORE_SPINTO_DELTA_MS;
    stats.adsTransitionMs = SHOP_OTTURATORE_SPINTO_ADS_MS;
  }
  if (purchased.includes('piastra-fusa')) {
    stats.cooldownMs += SHOP_PIASTRA_FUSA_COOLDOWN_DELTA_MS;
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
  /** rad/tick di sterzata concessi durante lo scatto. Zero senza il
   *  nodo Scatto Angolare, che è il caso in cui lo scatto resta la
   *  linea retta che è sempre stato. */
  dashSteerRate: number;
}

export function movementStatsFor(
  unlocked: readonly string[],
  purchased: readonly string[] = [],
): MovementStats {
  // I prerequisiti sono già garantiti da tryUnlockNode, ma leggerli
  // anche qui rende la funzione vera per *qualsiasi* lista — e i test
  // ne costruiscono di arbitrarie senza passare dall'albero.
  const hasDash = unlocked.includes('scatto');
  const stats: MovementStats = {
    speedMult: unlocked.includes('passo-lungo') ? NODE_PASSO_LUNGO_MULT : 1,
    hasDash,
    dashCooldownMs: DASH_COOLDOWN_MS,
    dashSpeed:
      hasDash && unlocked.includes('slancio') ? DASH_SPEED * NODE_SLANCIO_SPEED_MULT : DASH_SPEED,
    dashInvulnerable: hasDash && unlocked.includes('scatto-evasivo'),
    dashSteerRate: hasDash && unlocked.includes('scatto-angolare') ? NODE_DASH_STEER_RATE : 0,
  };
  // Banco. I due moltiplicatori sul passo si moltiplicano fra loro —
  // 1.15 × 0.88 ≈ 1.01 — quindi chi compra Zavorra e Scatto Teso
  // riporta il passo quasi dov'era e tiene i due guadagni. È una
  // sinergia trovabile, e costa due punti su quattordici: due nodi.
  if (purchased.includes('zavorra-alleggerita')) {
    stats.speedMult *= SHOP_ZAVORRA_SPEED_MULT;
    stats.dashCooldownMs = SHOP_ZAVORRA_DASH_COOLDOWN_MS;
  }
  if (purchased.includes('scatto-teso')) {
    stats.speedMult *= SHOP_SCATTO_TESO_SPEED_MULT;
    stats.dashSpeed *= SHOP_SCATTO_TESO_DASH_MULT;
  }
  return stats;
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

// ---- Terzo anello (Atto III) ----
// Stessa forma dei quattro del secondo: una funzione pura per nodo,
// che ricontrolla anche il prerequisito. tryUnlockNode lo garantisce
// già, ma leggerlo qui rende la funzione vera per *qualsiasi* lista —
// e i test ne costruiscono di arbitrarie senza passare dall'albero.

/** Piastra Reattiva: assorbire un colpo restituisce subito il colpo.
 *
 *  È difesa scritta nell'unica valuta che questo gioco abbia, il
 *  tempo fra due colpi. Incassare smette di essere solo una perdita:
 *  paga la finestra che l'attaccante ha appena aperto su di sé. */
export function shieldRefundsShot(unlocked: readonly string[]): boolean {
  return unlocked.includes('piastra-reattiva') && unlocked.includes('piastra-aggiuntiva');
}

/** Eco: l'esca svela anche chi si occulta.
 *
 *  Sta in Percezione e non fra i nodi dell'arma perché quello che fa
 *  è *vedere*: il Trasponditore da solo non ha nessun effetto
 *  sull'Araldo, ed è un buco lasciato apposta perché il nemico più
 *  tardo della campagna resti un problema aperto anche a chi ha
 *  comprato tutto il resto. */
export function beaconRevealsCloaked(unlocked: readonly string[]): boolean {
  return unlocked.includes('eco') && unlocked.includes('sensori-inerziali');
}

// ---- Sopravvivenza ----

/** Quanti colpi assorbe uno scudo appena raccolto. */
export function shieldCapacity(
  unlocked: readonly string[],
  purchased: readonly string[] = [],
): number {
  const base = unlocked.includes('piastra-aggiuntiva')
    ? SHIELD_CHARGES_UPGRADED
    : SHIELD_CHARGES_BASE;
  return base + (purchased.includes('piastra-fusa') ? SHOP_PIASTRA_FUSA_CHARGES_DELTA : 0);
}

/** Riserva di Bordo: entrare in una stanza nuova ricarica lo scudo.
 *  Non è sfruttabile in loop perché i checkpoint avanzano soltanto
 *  (vedi CampaignWorld.updateCheckpoint): tornare indietro e rientrare
 *  non conta come stanza nuova. */
export function refillsShieldOnRoomEnter(unlocked: readonly string[]): boolean {
  return unlocked.includes('riserva-di-bordo');
}

// ---- Trasponditore ----
// Il Banco è l'unica cosa che tocchi questi quattro numeri: nessun
// nodo dell'albero cambia l'esca (Eco cambia *chi* si vede, non come
// vola). Tenere la funzione qui e non dentro world.ts significa che il
// banco di bilanciamento può interrogarla senza costruire un mondo.

export interface BeaconStats {
  /** Quanto lontano vola il lancio, in tile. */
  rangeTiles: number;
  /** Entro quanto richiama, in tile. */
  lureTiles: number;
  /** Quanto vive l'esca, in ms. */
  lifetimeMs: number;
  /** Cariche con cui si comincia un livello. */
  chargesStart: number;
}

export function beaconStatsFor(
  unlocked: readonly string[],
  purchased: readonly string[] = [],
): BeaconStats {
  const stats: BeaconStats = {
    rangeTiles: BEACON_RANGE_TILES,
    lureTiles: BEACON_LURE_TILES,
    lifetimeMs: BEACON_LIFETIME_MS,
    chargesStart: BEACON_CHARGES_START,
  };
  if (purchased.includes('eco-ampio')) {
    stats.lureTiles = SHOP_ECO_AMPIO_LURE_TILES;
    stats.lifetimeMs = SHOP_ECO_AMPIO_LIFETIME_MS;
  }
  if (purchased.includes('doppio-innesco')) {
    stats.chargesStart = SHOP_DOPPIO_INNESCO_CHARGES;
    stats.rangeTiles = SHOP_DOPPIO_INNESCO_RANGE_TILES;
  }
  return stats;
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
export function pointsSpent(
  unlocked: readonly string[],
  purchased: readonly string[] = [],
): number {
  const onNodes = unlocked.reduce((sum, id) => {
    const cost = nodeCost(id);
    return sum + (Number.isFinite(cost) ? cost : 0);
  }, 0);
  // Gli innesti sconosciuti costano zero per la stessa ragione dei
  // nodi — un profilo vecchio non deve bloccare la spesa — ma qui la
  // clemenza non basta da sola: la lista arriva già filtrata dal
  // caricamento del profilo (stats/campaignProfile.ts), perché un id
  // inventato che costa zero e *vale* un acquisto sarebbe un regalo.
  const onShop = purchased.reduce((sum, id) => {
    const item = shopItemById(id);
    return sum + (item ? item.cost : 0);
  }, 0);
  return onNodes + onShop;
}

// ---- Banco ----

export function shopItemById(id: string): ShopItemDef | null {
  return SHOP_ITEMS.find((i) => i.id === id) ?? null;
}

export function isValidShopItem(id: string): id is ShopItemId {
  return SHOP_ITEMS.some((i) => i.id === id);
}

/** Quanto costa un innesto, o Infinity se non si sa cos'è. Infinity e
 *  non zero, al contrario di `nodeCost`: qui il chiamante è
 *  `tryPurchase`, e un costo infinito è esattamente il rifiuto che si
 *  vuole per un id che nessuno riconosce. La clemenza verso i profili
 *  vecchi vive in `pointsSpent`, che è un'altra domanda — "quanto ho
 *  già speso" e non "posso comprare questo". */
export function shopItemCost(id: string): number {
  return shopItemById(id)?.cost ?? Infinity;
}

/** I nodi che si possono rendere al Banco in cambio di un innesto.
 *
 *  Esiste perché senza di lui il Banco sarebbe irraggiungibile, e non
 *  per una sfumatura: l'albero si apre dalla pausa in qualunque
 *  momento, quindi chi spende i punti appena li guadagna arriva
 *  all'intervallo d'atto con in tasca solo quelli arrivati col boss.
 *  Misurati sul percorso vero: uno alla fine dell'Atto I, **zero**
 *  alla fine dell'Atto II. Il secondo Banco non si sarebbe mai potuto
 *  aprire.
 *
 *  La regola di sicurezza è una sola e basta: si può rendere solo un
 *  nodo da cui nessun altro nodo posseduto dipende. Guardare i figli
 *  diretti è sufficiente anche per le catene lunghe — se C dipende da
 *  B e B da A, finché B è posseduto A non è rendibile, quindi la lista
 *  resta sempre chiusa sui prerequisiti senza bisogno di risalirla.
 *
 *  È anche la finzione che il Banco dichiara: non vende hardware
 *  nuovo, rilavora quello che si ha già. Portargli un pezzo montato e
 *  uscirne con un altro è letteralmente il suo mestiere. */
export function refundableNodes(unlocked: readonly string[]): readonly string[] {
  return unlocked.filter((id) => {
    if (!isValidNode(id)) return false;
    return !unlocked.some((other) => other !== id && nodeRequires(other) === id);
  });
}

/** Se rendere questo nodo è lecito. Separata da `refundableNodes` per
 *  chi ha già un id in mano e non vuole costruire una lista per
 *  chiederne uno. */
export function canRefundNode(unlocked: readonly string[], id: string): boolean {
  return refundableNodes(unlocked).includes(id);
}
