// ================================================================
// IA DEI NEMICI
// ================================================================
// Scritta sullo schema di sim/bots.ts, che nell'Arena ha già la
// proprietà che qui serve: **l'IA non muove niente e non spara
// niente**. Produce un'intenzione — dove vorrebbe andare, dove
// vorrebbe guardare, se preme il grilletto — e chi la applica è il
// mondo, con le stesse funzioni che applicano l'intenzione del
// giocatore. Un nemico è quindi sostituibile con un giocatore senza
// toccare la simulazione, ed è la ragione per cui questo file si
// prova a mano senza istanziare un mondo.
//
// Non si importa `updateBot` direttamente: quello è legato alla mappa
// globale dell'Arena (`castRay`/`hasLOS` la leggono da un modulo),
// mentre qui la mappa è un parametro perché ogni livello ha la sua.
// Riusare quel file avrebbe voluto dire modificarlo, e l'Arena è
// multiplayer: si tocca il meno possibile. Quello che si riusa è il
// *disegno*, che è la parte che valeva.
//
// Tre cose sono deliberate e vale la pena fissarle qui:
//
//   • **Il guinzaglio.** Un nemico non lascia la sua stanza. Senza,
//     bastava farsi vedere una volta per trascinarsi dietro il
//     livello intero, e il ritmo "entra → leggi → risolvi" diventava
//     una fuga unica dall'inizio alla fine.
//   • **Il preavviso è la reazione.** Nessun nemico spara nell'istante
//     in cui ti vede: tiene la linea di vista per `reactionMs`, e
//     romperla azzera il conto. È lo stesso contratto delle turret
//     (GDD sezione 4), e vale la pena che sia lo stesso: il giocatore
//     ne impara uno.
//   • **Chi sta fermo lo sta facendo apposta.** La vulnerabilità
//     `immobile` non è un caso fortunato: la Vedetta si pianta *per*
//     sparare meglio. Il tell e la ricompensa sono lo stesso gesto.
// ================================================================

import { TILE } from '../constants';
import { angleDelta } from '../raycast';
import { BEACON_LURE_TILES } from './constants';
import { archetypeOf, type EnemyArchetype } from './enemies';
import { campCastRay, campHasLOS, type GetTileFn } from './raycast';
import type { EnemyState } from './types';

/** Quanto può ruotare in un tick. Uno solo per tutti: se ogni
 *  archetipo avesse il suo, "mi ha preso mentre giravo" diventerebbe
 *  imprevedibile invece che ingiusto una volta e imparato la seconda.
 *
 *  Il valore è quello che decide se traversare serve. Il nemico spara
 *  solo quando ha il muso entro 0.22 rad dal bersaglio, quindi la
 *  domanda è: un giocatore che scarta riesce a uscire dal cono più in
 *  fretta di quanto l'altro lo insegua? A 0.085 rad/tick (5 rad/s) no,
 *  mai, a nessuna distanza — e la traversata era decorativa. A 0.04 il
 *  conto cambia con la distanza: da lontano il nemico tiene la mira
 *  facilmente, da vicino no. Che è la relazione giusta, perché mette
 *  d'accordo il rischio con la ricompensa invece di opporli. */
export const ENEMY_TURN_RATE = 0.04;

/** Semiampiezza del cono visivo. Fuori di qui non ti vedono nemmeno
 *  in piena luce: è la stessa correzione che l'Arena aveva già
 *  dovuto fare ai suoi bot, che con la sola linea di vista avevano
 *  una consapevolezza a 360°. */
export const ENEMY_HALF_FOV = 1.15;

/** Oltre la portata utile, di quanti tile vedono comunque. Serve a
 *  far sì che si accorgano di te *prima* di poterti sparare: un
 *  nemico che nota e avanza è leggibile, uno che spara appena entri
 *  in portata è un'imboscata. */
export const ENEMY_VISION_MARGIN_TILES = 3;

/** Quanto si allontana da una parete quando la sfiora. */
const WHISKER_PROBE = TILE * 1.8;
const WHISKER_SPLAY = 0.5;

/** Durata di una carica del Martello, e da quale distanza la lancia. */
export const CHARGE_MS = 700;
export const CHARGE_MIN_TILES = 2.2;
export const CHARGE_MAX_TILES = 8;

/** Il rettangolo, in px, oltre il quale un nemico non insegue. */
export interface Leash {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface EnemyAiCtx {
  getTile: GetTileFn;
  mapW: number;
  mapH: number;
  playerX: number;
  playerY: number;
  /** Il giocatore è invisibile mentre è intoccabile dopo un
   *  checkpoint: sparargli addosso in quella finestra sarebbe un
   *  colpo che non può fare danno, cioè rumore. */
  playerTargetable: boolean;
  /** L'esca del Trasponditore, se ce n'è una viva. Un nemico che la
   *  vede e la può raggiungere le ruba il bersaglio al giocatore —
   *  anche a `playerTargetable` false: l'esca non è "il giocatore
   *  travestito", è un bersaglio suo, indipendente dall'invulnerabilità
   *  da respawn.
   *
   *  `tiles` è il raggio di richiamo, in tile: normalmente
   *  BEACON_LURE_TILES, ma più largo con l'innesto Eco Ampio (vedi
   *  skills.ts beaconStatsFor). Campo opzionale e non un secondo
   *  parametro obbligatorio apposta: world.ts lo passa sempre, ma
   *  beacon.test.ts costruisce `lure: {x, y}` a mano in una manciata
   *  di punti, scritti prima che il Banco esistesse, e romperli per un
   *  dettaglio di bilanciamento che quei test non stanno verificando
   *  non ne vale la candela. Assente, vale la costante — cioè il
   *  comportamento che quei test già misurano. */
  lure: { x: number; y: number; tiles?: number } | null;
  leash: Leash | null;
  dtMs: number;
}

/** L'unica uscita dell'IA. Il mondo la applica; l'IA non tocca lo
 *  stato se non per i suoi timer. */
export interface EnemyIntent {
  /** Direzione di movimento in spazio mondo, già normalizzata, o zero. */
  moveX: number;
  moveY: number;
  /** Velocità da usare questo tick (la carica va più veloce del passo). */
  speed: number;
  /** Angolo assoluto a cui guardare, già limitato dal rateo di
   *  rotazione. */
  angle: number;
  /** True nel tick in cui il colpo parte. */
  attack: boolean;
  /** Sta fermo di proposito: alimenta la vulnerabilità `immobile`. */
  still: boolean;
  /** Sta accorciando le distanze o caricando: vulnerabilità
   *  `scoperto`. */
  closing: boolean;
  /** Sta inseguendo l'esca invece del giocatore. Il mondo la legge per
   *  non far arrivare addosso al giocatore vero un colpo diretto
   *  altrove — vedi CampaignWorld.updateEnemies. */
  lured: boolean;
}

function idleIntent(e: EnemyState): EnemyIntent {
  return {
    moveX: 0,
    moveY: 0,
    speed: 0,
    angle: e.angle,
    attack: false,
    still: true,
    closing: false,
    lured: false,
  };
}

/** Due baffi in avanti per aggirare gli spigoli. Preso pari pari
 *  dall'Arena: è già la versione corretta, quella che sceglie un lato
 *  invece di bloccarsi quando sono chiusi entrambi. */
function avoidObstacles(ctx: EnemyAiCtx, e: EnemyState, desired: number): number {
  const left = campCastRay(
    ctx.getTile,
    e.x,
    e.y,
    desired - WHISKER_SPLAY,
    WHISKER_PROBE,
    ctx.mapW,
    ctx.mapH,
  );
  const right = campCastRay(
    ctx.getTile,
    e.x,
    e.y,
    desired + WHISKER_SPLAY,
    WHISKER_PROBE,
    ctx.mapW,
    ctx.mapH,
  );
  if (left.hit && right.hit) return left.dist > right.dist ? -0.9 : 0.9;
  if (left.hit) return 0.6;
  if (right.hit) return -0.6;
  return 0;
}

function insideLeash(leash: Leash | null, x: number, y: number): boolean {
  if (!leash) return true;
  return x >= leash.minX && x <= leash.maxX && y >= leash.minY && y <= leash.maxY;
}

function clampToLeash(leash: Leash | null, x: number, y: number): { x: number; y: number } {
  if (!leash) return { x, y };
  return {
    x: Math.max(leash.minX, Math.min(leash.maxX, x)),
    y: Math.max(leash.minY, Math.min(leash.maxY, y)),
  };
}

/** Vede il bersaglio (giocatore o esca)? Linea libera *e* dentro il
 *  cono, come i bot dell'Arena. La distanza limite è la portata più un
 *  margine.
 *
 *  Usata solo per il giocatore: il richiamo dell'esca ha già la sua
 *  condizione di visibilità (distanza + LOS, senza cono né margine —
 *  vedi updateEnemyAi), e la sostituisce del tutto invece di sommarsi
 *  a questa. */
function canSeeTarget(
  ctx: EnemyAiCtx,
  e: EnemyState,
  a: EnemyArchetype,
  targetX: number,
  targetY: number,
): boolean {
  if (!ctx.playerTargetable) return false;
  const dx = targetX - e.x;
  const dy = targetY - e.y;
  const dist = Math.hypot(dx, dy);
  const visionTiles =
    (a.attack === 'none' ? 9 : Math.max(a.rangeTiles, 4)) + ENEMY_VISION_MARGIN_TILES;
  if (dist > visionTiles * TILE) return false;
  if (Math.abs(angleDelta(e.angle, Math.atan2(dy, dx))) > ENEMY_HALF_FOV) return false;
  return campHasLOS(ctx.getTile, e.x, e.y, targetX, targetY, ctx.mapW, ctx.mapH);
}

/** Un tick di intenzione per un nemico.
 *
 *  Muta solo i timer e lo stato di macchina che gli appartengono
 *  (`ai`, `reactionTimer`, `attackCooldown`, la memoria dell'ultimo
 *  avvistamento). Posizione e angolo li scrive il chiamante, che è
 *  ciò che rende questa funzione provabile senza un mondo. */
export function updateEnemyAi(e: EnemyState, ctx: EnemyAiCtx): EnemyIntent {
  if (!e.alive) return idleIntent(e);
  const a = archetypeOf(e.kind);
  const dt = ctx.dtMs;

  if (e.attackCooldown > 0) e.attackCooldown = Math.max(0, e.attackCooldown - dt);
  if (e.ventMs > 0) e.ventMs = Math.max(0, e.ventMs - dt);
  if (e.revealMs > 0) e.revealMs = Math.max(0, e.revealMs - dt);

  // ---- La carica del Martello vince su tutto -------------------
  // Una volta partita non si corregge: è quello che la rende
  // schivabile. Una carica che insegue sarebbe solo un nemico
  // veloce. `lured` non si ricalcola nemmeno lui: dice verso cosa la
  // carica è partita, non verso cosa punterebbe adesso.
  if (e.chargeMs > 0) {
    e.chargeMs = Math.max(0, e.chargeMs - dt);
    if (e.chargeMs === 0) e.attackCooldown = a.cooldownMs;
    return {
      moveX: e.chargeDirX,
      moveY: e.chargeDirY,
      speed: a.chargeSpeed ?? a.speed,
      angle: Math.atan2(e.chargeDirY, e.chargeDirX),
      attack: false,
      still: false,
      closing: true,
      lured: e.lured,
    };
  }

  // ---- Il bersaglio: l'esca o il giocatore -----------------------
  // Il richiamo vince anche su un nemico già ingaggiato — è tutto il
  // punto dell'arma — quindi la scelta non guarda affatto `e.ai`. E
  // vince pure su `playerTargetable`: l'esca è un bersaglio suo, non
  // "il giocatore travestito". Nessun cono né margine di visione qui,
  // solo distanza e LOS: un nemico si volta verso l'esca anche se la
  // aveva alle spalle un istante prima, perché voltarsi *è* l'effetto.
  let targetX = ctx.playerX;
  let targetY = ctx.playerY;
  let lured = false;
  if (
    ctx.lure &&
    Math.hypot(ctx.lure.x - e.x, ctx.lure.y - e.y) <=
      (ctx.lure.tiles ?? BEACON_LURE_TILES) * TILE &&
    campHasLOS(ctx.getTile, e.x, e.y, ctx.lure.x, ctx.lure.y, ctx.mapW, ctx.mapH)
  ) {
    targetX = ctx.lure.x;
    targetY = ctx.lure.y;
    lured = true;
  }

  const dx = targetX - e.x;
  const dy = targetY - e.y;
  const dist = Math.hypot(dx, dy);
  const bearing = Math.atan2(dy, dx);
  // Lured bypassa canSeeTarget: la sua condizione di visibilità è già
  // verificata sopra, e non deve passare anche dal cono o da
  // playerTargetable.
  const sees = lured || canSeeTarget(ctx, e, a, targetX, targetY);

  if (sees) {
    // Riacquisire lo stesso bersaglio non fa ripartire la reazione.
    // Senza questa regola un nemico davanti a un riparo, dove la
    // linea lampeggia di continuo, non finiva mai di reagire e non
    // sparava mai — lo stesso difetto che i bot dell'Arena avevano
    // avuto e che era rimasto invisibile su una mappa quasi vuota.
    if (e.ai !== 'engage') {
      e.ai = 'engage';
      e.reactionTimer = a.reactionMs;
    }
    e.lastSeenX = targetX;
    e.lastSeenY = targetY;
  } else if (e.ai === 'engage') {
    e.ai = 'search';
    e.reactionTimer = a.reactionMs;
  }

  let wantAngle = e.angle;
  let moveX = 0;
  let moveY = 0;
  let attack = false;
  let closing = false;
  let plant = false;

  switch (e.ai) {
    case 'engage': {
      wantAngle = bearing;

      const rangePx = Math.max(a.rangeTiles, 1) * TILE;
      const keepPx = a.keepAwayTiles * TILE;

      if (a.attack === 'none') {
        // L'Archivista non combatte: si tiene lontano e continua a
        // fare il suo lavoro. Scappare *è* il suo attacco, perché
        // ogni secondo in cui resta vivo gli altri incassano meno.
        if (dist < keepPx) {
          moveX = -Math.cos(bearing);
          moveY = -Math.sin(bearing);
        }
        break;
      }

      if (dist > rangePx) {
        moveX = Math.cos(bearing);
        moveY = Math.sin(bearing);
        closing = true;
      } else if (keepPx > 0 && dist < keepPx) {
        moveX = -Math.cos(bearing);
        moveY = -Math.sin(bearing);
      } else if (a.vulnerability === 'immobile') {
        // Si pianta per mirare. È il tell, e coincide con la finestra
        // in cui incassa il doppio.
        plant = true;
      } else {
        // Traversata perpendicolare, lato stabile per nemico: il
        // profilo si muove senza che l'IA oscilli a ogni tick.
        const side = e.id.length % 2 === 0 ? 1 : -1;
        const perp = bearing + (Math.PI / 2) * side;
        moveX = Math.cos(perp) * 0.6;
        moveY = Math.sin(perp) * 0.6;
      }

      // La reazione scende solo mentre la linea regge, e non va sotto
      // zero: tenere il bersaglio in vista non accumula credito oltre
      // "pronto", o il ritmo del fuoco diventerebbe quello della
      // ricarica e basta.
      e.reactionTimer = Math.max(0, e.reactionTimer - dt);

      const aimed = Math.abs(angleDelta(e.angle, bearing)) < 0.22;
      const ready = e.reactionTimer <= 0 && e.attackCooldown <= 0 && aimed;

      if (ready && a.chargeSpeed && dist >= CHARGE_MIN_TILES * TILE && dist <= CHARGE_MAX_TILES * TILE) {
        e.chargeMs = CHARGE_MS;
        e.chargeDirX = Math.cos(bearing);
        e.chargeDirY = Math.sin(bearing);
        e.reactionTimer = a.reactionMs;
        break;
      }

      if (ready && dist <= rangePx) {
        attack = true;
        e.attackCooldown = a.cooldownMs;
        e.reactionTimer = a.reactionMs;
      }
      break;
    }

    case 'search': {
      if (e.lastSeenX === null || e.lastSeenY === null) {
        e.ai = 'patrol';
        break;
      }
      const sx = e.lastSeenX - e.x;
      const sy = e.lastSeenY - e.y;
      if (Math.hypot(sx, sy) < 16) {
        e.lastSeenX = null;
        e.lastSeenY = null;
        e.ai = 'patrol';
        break;
      }
      wantAngle = Math.atan2(sy, sx);
      moveX = Math.cos(wantAngle);
      moveY = Math.sin(wantAngle);
      break;
    }

    case 'patrol':
    default: {
      // Chi ha un punto di pattuglia fa la spola; chi non ce l'ha
      // resta al suo posto e gira lo sguardo. Una pattuglia casuale
      // avrebbe spostato i nemici fuori dalla composizione pensata
      // per la stanza, che è dove sta il level design.
      const goalReached =
        e.goalX !== null &&
        e.goalY !== null &&
        Math.hypot(e.goalX - e.x, e.goalY - e.y) < 14;

      e.patrolTimer -= dt;
      if (goalReached || e.patrolTimer <= 0) {
        if (e.postX !== null && e.patrolX !== null && e.patrolY !== null) {
          const atPost = e.goalX === e.postX;
          e.goalX = atPost ? e.patrolX : e.postX;
          e.goalY = atPost ? e.patrolY : e.postY;
        } else {
          e.goalX = e.postX;
          e.goalY = e.postY;
        }
        e.patrolTimer = 2600;
      }

      if (e.goalX !== null && e.goalY !== null) {
        const gx = e.goalX - e.x;
        const gy = e.goalY - e.y;
        if (Math.hypot(gx, gy) > 10) {
          wantAngle = Math.atan2(gy, gx);
          moveX = Math.cos(wantAngle);
          moveY = Math.sin(wantAngle);
        } else {
          // Arrivato: scandaglia invece di fissare il muro.
          wantAngle = e.angle + 0.012;
        }
      }
      break;
    }
  }

  // Piantare i piedi per il colpo. Stessa ragione dell'Arena: la
  // linea di tiro è verificata da dove il nemico sta *adesso*, ma il
  // movimento si risolve prima del colpo — chi traversa mentre spara
  // tira da una posizione che nessuno ha controllato.
  if (attack) {
    moveX = 0;
    moveY = 0;
  }

  // Fuori dal guinzaglio si torna dentro, qualunque cosa si stesse
  // facendo. Va prima dei baffi, così il rientro può comunque
  // aggirare uno spigolo.
  if (!insideLeash(ctx.leash, e.x + moveX * 8, e.y + moveY * 8) && !attack) {
    const home = clampToLeash(ctx.leash, e.postX ?? e.x, e.postY ?? e.y);
    const hx = home.x - e.x;
    const hy = home.y - e.y;
    if (Math.hypot(hx, hy) > 6) {
      wantAngle = Math.atan2(hy, hx);
      moveX = Math.cos(wantAngle);
      moveY = Math.sin(wantAngle);
      closing = false;
    } else {
      moveX = 0;
      moveY = 0;
    }
  }

  if (e.ai !== 'engage' && (moveX !== 0 || moveY !== 0)) {
    const correction = avoidObstacles(ctx, e, wantAngle);
    if (correction !== 0) {
      wantAngle += correction;
      moveX = Math.cos(wantAngle);
      moveY = Math.sin(wantAngle);
    }
  }

  const delta = angleDelta(e.angle, wantAngle);
  const step = Math.max(-ENEMY_TURN_RATE, Math.min(ENEMY_TURN_RATE, delta));

  return {
    moveX,
    moveY,
    speed: a.speed,
    angle: e.angle + step,
    attack,
    still: plant || (moveX === 0 && moveY === 0),
    closing,
    lured,
  };
}
