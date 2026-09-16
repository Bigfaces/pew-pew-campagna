// ================================================================
// CAMPAIGN SCENE RENDERING — walls, drone, boss, cores
// ================================================================
// Same wireframe/procedural-texture look as the Arena (GDD.md section
// 9: "gli sprite futuri... solo nemici/boss, muri restano wireframe"),
// reusing the Arena's own camera math and texture set — only the wall
// raycast is campaign-specific, since it walks a different map.
// ================================================================

import { TILE } from '../sim/constants';
import {
  BOSS_GRAZE_ARC_HALF,
  BOSS_REAR_ARC_HALF,
  COLLAPSE_HOLD_MS,
} from '../sim/campaign/constants';
import {
  CORE_BAND_CENTRE,
  ENEMY_FRONT_PLATE_HALF,
  ENEMY_REAR_ARC_HALF,
  HEAD_BAND_LOW,
  archetypeOf,
  type EnemyArchetype,
  type EnemyKind,
} from '../sim/campaign/enemies';
import { angleDelta } from '../sim/raycast';
import { campCastRay, type GetTileFn } from '../sim/campaign/raycast';
import type { LevelDef, TilePos, TurretDef } from '../sim/campaign/levelTypes';
import type {
  BossPhase,
  BossState,
  CampaignState,
  CoreState,
  EnemyState,
  TurretState,
} from '../sim/campaign/types';
import {
  EYE_HEIGHT,
  SLICE_W,
  heightToScreenY,
  horizonY,
  projectPoint,
  type CameraFx,
  type Viewport,
} from './camera';
import { getTextures, shadedTile, TEX_SIZE } from './textures';
import type { CameraView } from './scene';

/** Oltre questo non c'è niente da disegnare: la diagonale del livello
 *  più grande dell'atto (26x13), arrotondata in su. Era la diagonale
 *  dell'unica mappa esistente; con tre livelli deve coprire il più
 *  grande, o gli altri verrebbero tagliati in fondo. */
const CAMP_MAP_DIAGONAL_TILES = 30;
const MAX_RENDER_DIST = CAMP_MAP_DIAGONAL_TILES * TILE;
const FOG_DIST = TILE * 14;

export function renderCampaignWalls(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  depth: Float32Array,
  getTile: GetTileFn,
  mapW: number,
  mapH: number,
): void {
  const tex = getTextures();
  const hy = horizonY(vp, fx);
  const shakeX = fx.shakeX + fx.bobX;

  for (let i = 0; i < vp.numRays; i++) {
    const cameraX = (2 * (i + 0.5)) / vp.numRays - 1;
    const rayAngle = cam.angle + Math.atan(cameraX * vp.tanHalfFovH);

    const hit = campCastRay(getTile, cam.x, cam.y, rayAngle, MAX_RENDER_DIST, mapW, mapH);
    const perp = Math.max(0.0001, hit.dist * Math.cos(rayAngle - cam.angle));
    depth[i] = perp;

    const wallH = (TILE / perp) * vp.projDist;
    const top = hy - ((TILE - EYE_HEIGHT) / perp) * vp.projDist;

    let darkness = Math.min(1, perp / FOG_DIST);
    if (hit.side === 'y') darkness = Math.min(1, darkness + 0.16);

    // Always the "stone" tile (1): the campaign map has no cover tiles,
    // and the sealed door renders identically to the wall around it —
    // it belongs, it does not announce itself.
    const slice = shadedTile(tex, hit.tile, darkness);
    const sx = Math.min(TEX_SIZE - 1, Math.floor(hit.wallX * TEX_SIZE));

    ctx.drawImage(
      slice,
      sx,
      0,
      1,
      TEX_SIZE,
      i * SLICE_W + shakeX,
      top,
      SLICE_W + 1,
      wallH,
    );
  }
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
  rotation: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.fillStyle = '#0d0f18';
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, size * 0.12);
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  cy: number,
  size: number,
  nowMs: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.26 + Math.sin(nowMs * 0.004) * 0.1;
  ctx.fillStyle = '#5eead4';
  ctx.beginPath();
  ctx.arc(screenX, cy, size * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawDiamond(ctx, screenX, cy, size, '#5eead4', nowMs * 0.0018);
}

function drawShield(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  cy: number,
  size: number,
  nowMs: number,
): void {
  // Blue, like the Arena's own shield pickup (render/palette.ts
  // PU_COLOR.shield) — a deliberate visual echo: same promise, one
  // hit of protection, even though the campaign's is a separate
  // pickup rather than that shared PowerUp type.
  ctx.save();
  ctx.globalAlpha = 0.3 + Math.sin(nowMs * 0.004) * 0.12;
  ctx.fillStyle = '#44ccff';
  ctx.beginPath();
  ctx.arc(screenX, cy, size * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawDiamond(ctx, screenX, cy, size, '#44ccff', nowMs * 0.0018);
}

function drawTurret(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  cy: number,
  size: number,
  turret: TurretState,
  def: TurretDef,
  nowMs: number,
): void {
  // Brightens and reddens as it locks on — the "linea di mira visibile
  // prima di sparare" the GDD calls for (drawn as a warning glow rather
  // than a literal beam, keeping the wireframe style). È l'unica cosa
  // che rende la minaccia leggibile invece che subita, quindi vale per
  // il drone e per la turret allo stesso modo.
  const ready = 1 - Math.max(0, Math.min(1, turret.reactionTimer / def.reactionMs));
  const pulse = 0.5 + Math.sin(nowMs * 0.02) * 0.5 * ready;

  ctx.save();
  ctx.globalAlpha = 0.3 + pulse * 0.4;
  ctx.fillStyle = '#ff3b3b';
  ctx.beginPath();
  ctx.arc(screenX, cy, size * (1.3 + pulse * 0.6), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const color = `rgb(255,${Math.round(60 + 100 * (1 - ready))},60)`;
  if (def.kind === 'drone') {
    // Il drone resta un rombo sospeso: fluttua.
    drawDiamond(ctx, screenX, cy, size, color, Math.PI / 4);
    return;
  }
  // La turret è fissa alla struttura: un blocco squadrato, così a
  // colpo d'occhio si distingue una cosa che vola da una imbullonata,
  // anche se si comportano allo stesso modo.
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.18);
  ctx.strokeRect(screenX - size * 0.8, cy - size * 0.8, size * 1.6, size * 1.6);
  ctx.beginPath();
  ctx.moveTo(screenX - size * 0.8, cy);
  ctx.lineTo(screenX + size * 0.8, cy);
  ctx.stroke();
  ctx.restore();
}

/** Il colore di base di ogni archetipo. Non è decorazione: a distanza
 *  la tinta è la prima cosa che si legge, e "quello arancione mi viene
 *  addosso" deve poter diventare un'abitudine. Le fasce salgono di
 *  saturazione, così un nemico dell'Atto III si distingue da uno del I
 *  anche prima di riconoscerne la forma. */
const ENEMY_COLOR: Record<EnemyKind, string> = {
  ronzino: '#8fd4ff',
  vedetta: '#7fb6e8',
  saldatore: '#ffb347',
  ripetitore: '#9ad6a0',
  guardiano: '#c9d2e0',
  falco: '#ff8fd0',
  crogiolo: '#b6ff7a',
  araldo: '#c39bff',
  martello: '#ff7a5c',
  archivista: '#ffe066',
};

/** Il punto debole si disegna solo quando è davvero colpibile adesso.
 *
 *  Vale la stessa regola del boss (vedi drawBoss): un telegrafo che
 *  segnala una cosa che *non* farebbe danno è peggio di nessun
 *  telegrafo, perché insegna una lezione falsa. Il dorso quindi si
 *  accende solo da dietro, il nucleo e la testa sempre — quelli sono
 *  una questione di alzo, e l'alzo è in mano a chi spara. */
function drawEnemyWeakSpot(
  ctx: CanvasRenderingContext2D,
  a: EnemyArchetype,
  screenX: number,
  floorY: number,
  tileH: number,
  w: number,
  behind: boolean,
  veil: number,
  nowMs: number,
): void {
  const base = (a.floatZ ?? 0) * tileH;
  // Il minimo conta più del massimo: la pulsazione deve dire "guarda
  // qui", non far sparire il bersaglio per mezzo secondo ogni secondo.
  // La prima stesura scendeva a 0.2 e il nucleo, disegnato su un corpo
  // scuro, per metà del ciclo non si vedeva affatto.
  const pulse = (0.68 + Math.sin(nowMs * 0.011) * 0.28) * veil;

  if (a.weakSpot === 'rear') {
    if (!behind) return;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ff5050';
    const h = a.height * tileH;
    ctx.fillRect(screenX - w * 0.22, floorY - base - h * 0.62, w * 0.44, h * 0.26);
    ctx.restore();
    return;
  }

  const h = a.height * tileH;
  const cy =
    a.weakSpot === 'core'
      ? floorY - base - h * CORE_BAND_CENTRE
      : floorY - base - h * (HEAD_BAND_LOW + 0.06);
  const r = Math.max(2, w * 0.16);
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = a.weakSpot === 'core' ? '#ff6a4a' : '#ffd24a';
  ctx.beginPath();
  ctx.arc(screenX, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Un anello chiaro attorno: il punto debole va trovato anche su un
  // corpo scuro e contro una parete scura, e il pieno da solo non
  // stacca abbastanza.
  ctx.globalAlpha = Math.min(1, pulse + 0.2 * veil);
  ctx.strokeStyle = '#fff2e8';
  ctx.lineWidth = Math.max(1, r * 0.35);
  ctx.beginPath();
  ctx.arc(screenX, cy, r * 1.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  floorY: number,
  tileH: number,
  cam: CameraView,
  e: EnemyState,
  a: EnemyArchetype,
  nowMs: number,
): void {
  const h = a.height * tileH;
  const base = (a.floatZ ?? 0) * tileH;
  const w = h * (a.kind === 'martello' ? 0.78 : 0.56);
  const topY = floorY - base - h;
  const color = ENEMY_COLOR[e.kind];

  // Quanto manca al colpo. Stesso contratto visivo delle turret
  // (drawTurret): l'alone si stringe e scalda mentre il tempo di
  // reazione scende, quindi la minaccia si legge prima di subirla. È
  // l'unica cosa che rende leale la morte in un colpo.
  const ready = 1 - Math.max(0, Math.min(1, e.reactionTimer / Math.max(a.reactionMs, 1)));
  const aiming = e.ai === 'engage' && a.attack !== 'none';

  // L'Araldo è velato finché non spara. Un velo totale sarebbe un
  // agguato e basta: resta una distorsione: si vede *che* c'è
  // qualcosa, non cosa.
  const cloaked = (a.cloaks ?? false) && e.revealMs <= 0;
  // Il velo va *moltiplicato* in ogni disegno, non impostato una volta
  // sul contesto: globalAlpha si sovrascrive, non si accumula
  // attraverso save/restore, quindi ogni decorazione che apre il suo
  // save lo azzerava. In pratica l'Araldo occultato aveva il corpo
  // trasparente e il punto debole acceso a piena luce, cioè un
  // bersaglio *più* visibile di uno normale: il velo faceva
  // esattamente il contrario di quello per cui esiste.
  const veil = cloaked ? 0.18 : 1;
  ctx.save();

  if (aiming) {
    ctx.save();
    ctx.globalAlpha = (0.12 + ready * 0.4) * (cloaked ? 0.4 : 1) * veil;
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.ellipse(screenX, floorY - base - h * 0.5, w * (1.1 - ready * 0.35), h * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Ombra di contatto: chi vola non ne ha una attaccata ai piedi, e
  // quella staccata è il modo in cui si legge che sta in aria.
  ctx.save();
  ctx.globalAlpha = (base > 0 ? 0.22 : 0.4) * veil;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(screenX, floorY - 1, w * 0.6, w * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.globalAlpha = veil;
  if (base > 0) {
    // Chi vola è un rombo, come il drone: la forma dice "questo non
    // cammina" prima che si veda muovere.
    //
    // Il lato è h/√2 e non "un po' meno del lato corto": ruotato di
    // 45° un quadrato è alto quanto la sua diagonale, e serve che il
    // rombo copra *tutta* l'altezza h. Con la misura precedente la
    // banda alta della sagoma cadeva fuori dal disegno, quindi il
    // segno della testa galleggiava sopra il nemico: si mirava a un
    // punto dove non c'era niente da colpire.
    drawDiamond(ctx, screenX, floorY - base - h * 0.5, h * 0.707, color, Math.PI / 4, veil);
  } else {
    ctx.fillStyle = '#0d0f18';
    ctx.fillRect(screenX - w / 2, topY, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.2, w * 0.09);
    ctx.strokeRect(screenX - w / 2, topY, w, h);
    // La testa: una fascia separata, così la banda alta che conta per
    // il colpo mirato è visibile e non va indovinata.
    ctx.beginPath();
    ctx.moveTo(screenX - w / 2, floorY - base - h * HEAD_BAND_LOW);
    ctx.lineTo(screenX + w / 2, floorY - base - h * HEAD_BAND_LOW);
    ctx.stroke();
  }

  const angleToCam = Math.atan2(cam.y - e.y, cam.x - e.x);
  const frontDiff = Math.abs(angleDelta(e.angle, angleToCam));
  const behind = Math.PI - frontDiff <= ENEMY_REAR_ARC_HALF;

  // La piastra del Guardiano si disegna *mentre la stai guardando*:
  // è la risposta alla domanda "perché i miei colpi non fanno
  // niente", e senza di essa la lezione non arriva mai.
  if (a.frontImmune && frontDiff <= ENEMY_FRONT_PLATE_HALF) {
    ctx.save();
    ctx.globalAlpha = 0.85 * veil;
    ctx.fillStyle = '#5c6c8a';
    ctx.fillRect(screenX - w * 0.44, topY + h * 0.12, w * 0.88, h * 0.62);
    ctx.strokeStyle = '#eef3ff';
    ctx.lineWidth = Math.max(1, w * 0.06);
    ctx.strokeRect(screenX - w * 0.44, topY + h * 0.12, w * 0.88, h * 0.62);
    ctx.restore();
  } else {
    drawEnemyWeakSpot(ctx, a, screenX, floorY, tileH, w, behind, veil, nowMs);
  }

  // La finestra aperta: un contorno che pulsa. Dice "adesso", che è
  // l'unica informazione che una vulnerabilità a tempo può dare.
  const windowOpen =
    (a.vulnerability === 'sfiatato' && e.ventMs > 0) ||
    (a.vulnerability === 'immobile' && e.still) ||
    (a.vulnerability === 'scoperto' && (e.closing || e.chargeMs > 0));
  if (windowOpen) {
    ctx.save();
    ctx.globalAlpha = (0.45 + Math.sin(nowMs * 0.016) * 0.3) * veil;
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = Math.max(1.4, w * 0.08);
    ctx.strokeRect(screenX - w * 0.6, topY - h * 0.04, w * 1.2, h * 1.08);
    ctx.restore();
  }

  // Irrobustito da un Archivista: un guscio esterno. Chi lo vede
  // sull'uno ha la risposta su chi sparare per primo.
  if (e.hardened) {
    ctx.save();
    ctx.globalAlpha = 0.5 * veil;
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = Math.max(1, w * 0.05);
    ctx.setLineDash([Math.max(2, w * 0.14), Math.max(2, w * 0.1)]);
    ctx.strokeRect(screenX - w * 0.72, topY - h * 0.08, w * 1.44, h * 1.16);
    ctx.restore();
  }

  // L'Archivista dichiara il proprio raggio: la sua minaccia è un'area,
  // e un'area che non si vede non si può evitare.
  if (a.hardensAlliesTiles !== undefined) {
    ctx.save();
    ctx.globalAlpha = (0.25 + Math.sin(nowMs * 0.004) * 0.1) * veil;
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = Math.max(1, w * 0.06);
    ctx.beginPath();
    ctx.ellipse(screenX, floorY - 1, w * 1.5, w * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

const BOSS_PHASE_COLOR: Record<BossPhase, string> = {
  // Sentinella
  guard: '#8aa0c8',
  telegraph: '#ffb020',
  charge: '#ff3b3b',
  recover: '#c88a50',
  // Custode: freddo mentre manipola, ambra al preavviso, acceso nella
  // finestra. Il colore è metà del tell — l'altra metà è il tempo.
  blackout: '#4a5a80',
  invert: '#6a4a90',
  tell: '#ffb020',
  exposed: '#ff5c3b',
  // ARBITER: bianco freddo dietro i moduli, poi i colori delle due
  // macchine che riusa, poi l'ambra della finestra finale.
  modules: '#cfd8e8',
  coreSealed: '#6a7a9a',
  coreOpening: '#ffb020',
  coreOpen: '#ffd166',
  defeated: '#3d6b4a',
};

/** Il Custode. Una colonna, non un cingolato: non si muove, quindi
 *  non ha un davanti e un dietro da leggere. Quello che va letto è il
 *  *momento*, e infatti tutto il disegno racconta la fase — l'anello
 *  esterno gira mentre manipola, il nucleo si apre solo nella
 *  finestra. */
function drawCustode(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  floorY: number,
  tileH: number,
  boss: BossState,
  nowMs: number,
): void {
  const color = BOSS_PHASE_COLOR[boss.phase];
  const h = tileH * 1.5;
  const w = tileH * 0.55;
  const top = floorY - h;

  ctx.save();

  // Corpo: una colonna aperta, righe orizzontali. Wireframe come tutto
  // il resto — niente asset, coerente con i muri.
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, tileH * 0.04);
  ctx.strokeRect(screenX - w / 2, top, w, h);
  for (let i = 1; i < 5; i++) {
    const y = top + (h * i) / 5;
    ctx.beginPath();
    ctx.moveTo(screenX - w / 2, y);
    ctx.lineTo(screenX + w / 2, y);
    ctx.stroke();
  }

  // Anello: gira mentre manipola, si ferma al preavviso. Il movimento
  // è il segnale che sta ancora lavorando.
  const manipulating = boss.phase === 'blackout' || boss.phase === 'invert';
  const spin = manipulating ? nowMs * 0.004 : 0;
  const ringY = top + h * 0.3;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(screenX, ringY, w * 0.85, w * 0.22, spin, 0, Math.PI * 2);
  ctx.stroke();

  // Nucleo: chiuso mentre manipola, spalancato nella finestra. È
  // l'unica cosa che si può colpire, e si vede da lontano che è
  // aperta — la finestra deve essere un appuntamento, non un indovinello.
  const open = boss.phase === 'exposed';
  const coreY = top + h * 0.55;
  const r = tileH * (open ? 0.22 : 0.07) * (open ? 1 + Math.sin(nowMs * 0.02) * 0.12 : 1);
  ctx.globalAlpha = open ? 0.95 : 0.5;
  ctx.fillStyle = open ? '#ffd166' : color;
  ctx.beginPath();
  ctx.arc(screenX, coreY, r, 0, Math.PI * 2);
  ctx.fill();

  if (open) {
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(screenX, coreY, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** ARBITER. Il disegno racconta le tre fasi: gli anelli dei moduli
 *  ancora vivi, il corpo che diventa un cingolato quando comincia a
 *  cacciare, il nucleo che si apre alla fine. */
function drawArbiter(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  floorY: number,
  tileH: number,
  cam: CameraView,
  boss: BossState,
  modulesAlive: number,
  nowMs: number,
): void {
  const color = BOSS_PHASE_COLOR[boss.phase];
  const h = tileH * 1.7;
  const w = tileH * 0.6;
  const top = floorY - h;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, tileH * 0.045);

  // Corpo: sempre lo stesso profilo, così è riconoscibile fra una
  // fase e l'altra. Cambia cosa gli gira attorno.
  ctx.strokeRect(screenX - w / 2, top, w, h);
  ctx.beginPath();
  ctx.moveTo(screenX - w / 2, top + h * 0.25);
  ctx.lineTo(screenX + w / 2, top + h * 0.25);
  ctx.moveTo(screenX - w / 2, top + h * 0.75);
  ctx.lineTo(screenX + w / 2, top + h * 0.75);
  ctx.stroke();

  if (boss.stage === 1) {
    // Un anello per modulo ancora in piedi: si vede a colpo d'occhio
    // quanto manca, senza leggere la HUD.
    for (let i = 0; i < modulesAlive; i++) {
      const spin = nowMs * 0.0016 + (i * Math.PI * 2) / Math.max(1, modulesAlive);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.ellipse(
        screenX,
        top + h * 0.5,
        w * (1.1 + i * 0.22),
        w * 0.3,
        spin,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (boss.stage === 2) {
    // In caccia mostra lo scudo frontale, come la Sentinella: è lo
    // stesso indizio per la stessa regola.
    const toCam = Math.atan2(cam.y - boss.y, cam.x - boss.x);
    const facing = Math.cos(toCam - boss.angle);
    ctx.globalAlpha = facing > 0 ? 0.9 : 0.25;
    ctx.beginPath();
    ctx.arc(screenX, top + h * 0.5, w * 0.95, -0.9, 0.9);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Terza fase: il nucleo. Chiuso è una scheggia, aperto è un sole.
  const open = boss.phase === 'coreOpen';
  const r = tileH * (open ? 0.26 : 0.08) * (open ? 1 + Math.sin(nowMs * 0.018) * 0.1 : 1);
  ctx.globalAlpha = open ? 0.95 : 0.55;
  ctx.fillStyle = open ? '#ffd166' : color;
  ctx.beginPath();
  ctx.arc(screenX, top + h * 0.5, r, 0, Math.PI * 2);
  ctx.fill();
  if (open) {
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.arc(screenX, top + h * 0.5, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBoss(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  floorY: number,
  tileH: number,
  cam: CameraView,
  boss: BossState,
  hasGraze: boolean,
  enraged: boolean,
  nowMs: number,
): void {
  const scale = boss.phase === 'charge' ? 1.12 : 1;
  const h = tileH * 1.7 * scale;
  const w = h * 0.62;
  const topY = floorY - h;

  // Contact shadow.
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(screenX, floorY - 1, w * 0.7, w * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = BOSS_PHASE_COLOR[boss.phase];
  ctx.fillRect(screenX - w / 2, topY, w, h);
  ctx.strokeStyle = '#0d0f18';
  ctx.lineWidth = Math.max(1.5, w * 0.05);
  ctx.strokeRect(screenX - w / 2, topY, w, h);

  // Whether the viewer is currently standing in front (shielded) or
  // behind (core exposed) the boss — the single most important piece
  // of feedback in this fight, so it is drawn regardless of phase.
  const angleToCam = Math.atan2(cam.y - boss.y, cam.x - boss.x);
  const frontDiff = Math.abs(angleDelta(boss.angle, angleToCam));
  const rearDiff = Math.PI - frontDiff;
  const solidExposed = rearDiff <= BOSS_REAR_ARC_HALF;
  // The wider graze arc only actually damages the boss once Danno di
  // Striscio is unlocked (see resolveBossHit in sim/campaign/world.ts)
  // — without it, standing there does nothing, so the telegraph must
  // not claim otherwise.
  const grazeExposed = hasGraze && rearDiff <= BOSS_GRAZE_ARC_HALF;
  const exposed = solidExposed || grazeExposed;
  const canDamageNow = boss.phase === 'charge' || boss.phase === 'recover';

  const patchW = w * 0.36;
  const patchH = h * 0.3;
  if (exposed && canDamageNow) {
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(nowMs * 0.012) * 0.25;
    ctx.fillStyle = solidExposed ? '#ff5050' : '#ffb37a';
    ctx.fillRect(screenX - patchW / 2, topY + h * 0.28, patchW, patchH);
    ctx.restore();
  } else if (frontDiff <= BOSS_REAR_ARC_HALF) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#dff0ff';
    ctx.fillRect(screenX - patchW / 2, topY + h * 0.28, patchW, patchH);
    ctx.restore();
  }

  // Seconda fase: un contorno che pulsa, così il cambio di ritmo si
  // vede prima di subirlo. Il colore della fase resta quello: questo
  // dice "è cambiata", non sostituisce "cosa sta facendo".
  if (enraged && boss.phase !== 'defeated') {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(nowMs * 0.009) * 0.35;
    ctx.strokeStyle = '#ff7a2f';
    ctx.lineWidth = Math.max(1.5, w * 0.07);
    ctx.strokeRect(screenX - w / 2 - w * 0.05, topY - h * 0.02, w * 1.1, h * 1.04);
    ctx.restore();
  }

  if (boss.phase === 'defeated') {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#7dfc9a';
    ctx.lineWidth = Math.max(1, w * 0.04);
    ctx.strokeRect(screenX - w / 2, topY, w, h);
    ctx.restore();
  }
}

interface CampaignBillboard {
  dist: number;
  draw: () => void;
}

/** Project and draw every non-wall entity, far to near — cores, the
 *  drone and the boss can all appear in the same shot in Magazzino, so
 *  they share one depth-sorted pass instead of three fixed-order ones
 *  that would let a farther entity paint over a nearer one. */
/** Un quadrato sul pavimento, in prospettiva: i quattro angoli del
 *  tile proiettati e riempiti.
 *
 *  Gas, pozzo e uscita stanno *per terra*, e disegnarli come cartelli
 *  verticali avrebbe mentito su dove sono — una nube che galleggia
 *  all'altezza degli occhi non si legge come una zona da evitare
 *  camminando. Un tile viene saltato se un angolo finisce dietro la
 *  camera, e occluso sul suo centro invece che per colonna: è una
 *  decalcomania, non geometria, e un tile mezzo nascosto dietro uno
 *  spigolo costa meno di un depth-test per colonna. */
function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  depth: Float32Array,
  tile: TilePos,
  fill: string,
  lift = 1,
): void {
  const x0 = tile.tx * TILE;
  const y0 = tile.ty * TILE;
  const corners = [
    [x0, y0],
    [x0 + TILE, y0],
    [x0 + TILE, y0 + TILE],
    [x0, y0 + TILE],
  ] as const;

  const centre = projectPoint(
    vp,
    fx,
    cam.x,
    cam.y,
    cam.angle,
    x0 + TILE / 2,
    y0 + TILE / 2,
  );
  if (!centre.visible) return;
  const col = Math.round((centre.screenX - fx.shakeX - fx.bobX) / SLICE_W);
  if (col < 0 || col >= vp.numRays) return;
  if (depth[col]! < centre.perp - 2) return;

  const pts: { x: number; y: number }[] = [];
  for (const [cx, cy] of corners) {
    const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, cx, cy);
    if (!p.visible) return;
    pts.push({ x: p.screenX, y: heightToScreenY(vp, fx, p.perp, lift) });
  }

  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawExitMarker(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  floorY: number,
  tileH: number,
  nowMs: number,
): void {
  const pulse = 0.55 + Math.sin(nowMs * 0.004) * 0.25;
  const w = tileH * 0.34;
  const h = tileH * 0.9;
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = '#7dfc9a';
  ctx.lineWidth = Math.max(1.5, tileH * 0.04);
  ctx.strokeRect(screenX - w / 2, floorY - h, w, h);
  ctx.globalAlpha = pulse * 0.22;
  ctx.fillStyle = '#7dfc9a';
  ctx.fillRect(screenX - w / 2, floorY - h, w, h);
  ctx.restore();
}

/** Tutto ciò che non è muro, ordinato dal più lontano al più vicino.
 *
 *  Prende lo stato invece di quindici parametri: la firma precedente
 *  elencava core, scudo, drone e boss uno per uno, e ogni trabocchetto
 *  nuovo ne aggiungeva due o tre. Passare `state` e `level` la rende
 *  stabile — e la dipendenza esiste già comunque, visto che questo
 *  modulo è il renderer *della campagna*. */
export function renderCampaignScenery(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
  cam: CameraView,
  depth: Float32Array,
  level: LevelDef,
  state: CampaignState,
  hasGraze: boolean,
  enraged: boolean,
  nowMs: number,
): void {
  // --- decalcomanie sul pavimento, sotto tutto il resto ---
  for (const zone of level.gasZones) {
    const breathe = 0.16 + Math.sin(nowMs * 0.0015) * 0.05;
    for (const t of zone.tiles) {
      drawFloorTile(ctx, vp, fx, cam, depth, t, `rgba(150, 255, 140, ${breathe})`, 2);
    }
  }

  for (const c of level.chasms) {
    // Il vuoto: nero pieno, senza pulsazioni. Un pavimento che cede
    // avvisa perché si può ancora scegliere di non starci; una
    // voragine non avvisa perché è già tutto detto — non c'è niente
    // sotto, e si vede.
    for (const t of c.tiles) {
      drawFloorTile(ctx, vp, fx, cam, depth, t, 'rgba(2, 3, 6, 0.96)', 1);
    }
  }

  for (const z of level.gravityZones) {
    const pulse = 0.10 + Math.sin(nowMs * 0.002) * 0.04;
    for (const t of z.tiles) {
      drawFloorTile(ctx, vp, fx, cam, depth, t, `rgba(150, 110, 220, ${pulse})`, 2);
    }
  }

  for (const f of state.collapsingFloors) {
    const def = level.collapsingFloors.find((x) => x.id === f.id);
    if (!def) continue;
    // Mentre il giocatore ci sta sopra, il pavimento si scalda: è
    // l'unico preavviso che esista, e senza di esso il crollo
    // sembrerebbe arbitrario invece che meritato.
    const stress = Math.max(0, Math.min(1, f.standingMs / COLLAPSE_HOLD_MS));
    const fill = f.collapsed
      ? 'rgba(10, 10, 14, 0.85)'
      : `rgba(${Math.round(180 + 60 * stress)}, ${Math.round(120 - 80 * stress)}, 40, ${
          0.18 + stress * 0.4
        })`;
    for (const t of def.tiles) drawFloorTile(ctx, vp, fx, cam, depth, t, fill, 2);
  }

  // --- billboard, ordinati per distanza ---
  const list: CampaignBillboard[] = [];

  const occluded = (screenX: number, perp: number): boolean => {
    const col = Math.round((screenX - fx.shakeX - fx.bobX) / SLICE_W);
    if (col < 0 || col >= vp.numRays) return true;
    return depth[col]! < perp - 2;
  };

  const push = (
    x: number,
    y: number,
    anchor: number,
    make: (screenX: number, y: number, tileH: number, perp: number) => () => void,
  ): void => {
    const p = projectPoint(vp, fx, cam.x, cam.y, cam.angle, x, y, anchor);
    if (!p.visible || occluded(p.screenX, p.perp)) return;
    list.push({ dist: p.perp, draw: make(p.screenX, p.perp, p.tileH, p.perp) });
  };

  for (const c of state.cores) {
    if (c.collected) continue;
    push(c.x, c.y, 1, (screenX, _y, tileH, perp) => {
      const bobZ = TILE * 0.4 + Math.sin(nowMs * 0.003 + c.x) * TILE * 0.08;
      const cy = heightToScreenY(vp, fx, perp, bobZ);
      return () => drawCore(ctx, screenX, cy, tileH * 0.36, nowMs);
    });
  }

  for (const sh of state.shields) {
    if (sh.collected) continue;
    push(sh.x, sh.y, 1, (screenX, _y, tileH, perp) => {
      const bobZ = TILE * 0.4 + Math.sin(nowMs * 0.003 + sh.x) * TILE * 0.08;
      const cy = heightToScreenY(vp, fx, perp, bobZ);
      return () => drawShield(ctx, screenX, cy, tileH * 0.36, nowMs);
    });
  }

  for (const t of state.turrets) {
    if (!t.alive) continue;
    const def = level.turrets.find((d) => d.id === t.id);
    if (!def) continue;
    const tx = (def.tx + 0.5) * TILE;
    const ty = (def.ty + 0.5) * TILE;
    push(tx, ty, 1, (screenX, _y, tileH, perp) => {
      // Il drone fluttua a mezz'aria, la turret è imbullonata più in
      // basso: la differenza di quota fa metà del lavoro di
      // distinguerle a distanza.
      const z = def.kind === 'drone' ? TILE * 0.55 : TILE * 0.42;
      const cy = heightToScreenY(vp, fx, perp, z);
      return () => drawTurret(ctx, screenX, cy, tileH * 0.3, t, def, nowMs);
    });
  }

  if (level.exit) {
    const ex = (level.exit.tx + 0.5) * TILE;
    const ey = (level.exit.ty + 0.5) * TILE;
    push(ex, ey, 0.5, (screenX, _y, tileH, perp) => {
      const floorY = heightToScreenY(vp, fx, perp, 0);
      return () => drawExitMarker(ctx, screenX, floorY, tileH, nowMs);
    });
  }

  for (const e of state.enemies) {
    if (!e.alive) continue;
    const a = archetypeOf(e.kind);
    push(e.x, e.y, 0.5, (screenX, _y, tileH, perp) => {
      const floorY = heightToScreenY(vp, fx, perp, 0);
      return () => drawEnemy(ctx, screenX, floorY, tileH, cam, e, a, nowMs);
    });
  }

  const boss = state.boss;
  if (boss) {
    const kind = level.boss?.kind;
    const modulesAlive = (level.boss?.moduleTurretIds ?? []).filter((id) =>
      state.turrets.some((t) => t.id === id && t.alive),
    ).length;
    push(boss.x, boss.y, 0.5, (screenX, _y, tileH, perp) => {
      const floorY = heightToScreenY(vp, fx, perp, 0);
      if (kind === 'custode') return () => drawCustode(ctx, screenX, floorY, tileH, boss, nowMs);
      if (kind === 'arbiter') {
        return () =>
          drawArbiter(ctx, screenX, floorY, tileH, cam, boss, modulesAlive, nowMs);
      }
      return () => drawBoss(ctx, screenX, floorY, tileH, cam, boss, hasGraze, enraged, nowMs);
    });
  }

  list.sort((a, b) => b.dist - a.dist);
  for (const b of list) b.draw();
}

/** Il buio. Non è un velo uniforme: resta un alone attorno a chi
 *  guarda, o il livello diventerebbe una schermata nera invece di una
 *  stanza al buio. Ed è di proposito che *non* spegne la minimappa —
 *  al contrario del gas. Due trappole che tolgono informazione in modi
 *  opposti valgono più di due che la tolgono allo stesso modo. */
export function renderDarkness(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  strength: number,
): void {
  if (strength <= 0) return;
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const inner = Math.min(vp.width, vp.height) * 0.12;
  const outer = Math.max(vp.width, vp.height) * 0.62;
  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  const a = Math.min(1, strength);
  g.addColorStop(0, `rgba(2, 3, 6, ${a * 0.35})`);
  g.addColorStop(1, `rgba(2, 3, 6, ${a * 0.97})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, vp.width, vp.height);
  ctx.restore();
}

/** Il velo che il gas lascia sugli occhi. Disegnato dopo la scena e
 *  prima dell'interfaccia: acceca il mondo, non la HUD — quella si
 *  spegne da sé (niente minimappa, niente ottica), ed è una cosa
 *  diversa dal vedere male. */
export function renderGasVeil(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  strength: number,
  nowMs: number,
): void {
  if (strength <= 0) return;
  const a = Math.min(1, strength);
  ctx.save();
  ctx.globalAlpha = a * (0.22 + Math.sin(nowMs * 0.006) * 0.05);
  ctx.fillStyle = '#9bff8c';
  ctx.fillRect(0, 0, vp.width, vp.height);
  ctx.restore();
}

// ================================================================
// MINIMAPPA — nodi Percezione
// ================================================================
// La campagna non ha mai avuto una minimappa: il segnaposto nel menu
// prometteva "minimappa estesa", ma non c'era niente da estendere.
// Quindi il primo nodo *è* la minimappa, e il secondo aggiunge i
// contatti — cioè la parte che nel segnaposto si chiamava "estesa",
// stavolta guadagnata.
//
// Non riusa renderMinimap dell'Arena: quella è legata a MAP_W/MAP_H
// dell'Arena e ai suoi tipi Entity/PowerUp, e generalizzarla
// vorrebbe dire toccare un file da cui dipende il multiplayer. Stessa
// scelta già fatta per physics e raycast della campagna.
// ================================================================

/** Cache del fondo: i muri non cambiano solo perché il giocatore si
 *  muove, quindi ridisegnare ogni tile per frame sarebbe lavoro
 *  buttato. La chiave include livello e stato delle porte, cioè le
 *  due sole cose che possono cambiare il disegno. */
let campMinimapCache: {
  canvas: HTMLCanvasElement;
  size: number;
  levelId: string;
  doors: string;
} | null = null;

function campMinimapBackground(
  size: number,
  level: LevelDef,
  getTile: GetTileFn,
  doorKey: string,
): HTMLCanvasElement {
  const cached = campMinimapCache;
  if (cached && cached.size === size && cached.levelId === level.id && cached.doors === doorKey) {
    return cached.canvas;
  }

  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const sx = size / level.width;
  const sy = size / level.height;

  g.fillStyle = 'rgba(6, 12, 18, 0.82)';
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(120, 190, 230, 0.30)';
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      if (getTile(tx, ty) !== 0) g.fillRect(tx * sx, ty * sy, sx + 0.5, sy + 0.5);
    }
  }
  // I trabocchetti sul fondo, non tra i contatti: sono parte della
  // pianta della stazione, non cose che si muovono.
  g.fillStyle = 'rgba(150, 255, 140, 0.22)';
  for (const z of level.gasZones) {
    for (const t of z.tiles) g.fillRect(t.tx * sx, t.ty * sy, sx, sy);
  }
  g.fillStyle = 'rgba(230, 140, 40, 0.26)';
  for (const f of level.collapsingFloors) {
    for (const t of f.tiles) g.fillRect(t.tx * sx, t.ty * sy, sx, sy);
  }
  g.strokeStyle = 'rgba(150, 220, 255, 0.45)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, size - 1, size - 1);

  campMinimapCache = { canvas: c, size, levelId: level.id, doors: doorKey };
  return c;
}

/** Dove finisce la minimappa, in px CSS (vp.width è già in px CSS).
 *
 *  Esportata perché la HUD deve sapere quanto spazio lasciarle. La
 *  colonna centrale della HUD è larga quanto il suo contenuto, e senza
 *  questo dato le finisce sotto — è esattamente quello che faceva la
 *  prima versione, verificata su iPhone 13. Una formula sola, letta da
 *  chi disegna e da chi deve scansarsi, invece di due numeri da tenere
 *  d'accordo a mano ogni volta che uno dei due cambia. */
export function campMinimapBox(vpWidth: number): { w: number; h: number; pad: number } {
  const w = Math.round(Math.min(200, Math.max(120, vpWidth * 0.17)));
  return { w, h: Math.round(w * 0.55), pad: 12 };
}

/** Disegna la minimappa del settore. `showContacts` è falso col solo
 *  Scanner di Settore: vedi la pianta e te stesso, ma non cosa c'è
 *  sopra — che è esattamente la differenza che vende il secondo nodo. */
export function renderCampaignMinimap(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  level: LevelDef,
  state: CampaignState,
  getTile: GetTileFn,
  showContacts: boolean,
): void {
  const { w, h, pad } = campMinimapBox(vp.width);
  const mx = vp.width - w - pad;
  const my = pad;
  const sx = w / (level.width * TILE);
  const sy = h / (level.height * TILE);
  const doorKey = state.doors.map((d) => (d.closed ? '1' : '0')).join('');

  ctx.save();
  ctx.globalAlpha = 0.92;
  // Il fondo è disegnato su un canvas quadrato di lato `w` e poi
  // schiacciato all'altezza reale: una sola cache invece di una per
  // ogni rapporto di forma.
  ctx.drawImage(campMinimapBackground(w, level, getTile, doorKey), mx, my, w, h);

  const dot = (x: number, y: number, color: string, r: number): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mx + x * sx, my + y * sy, r, 0, Math.PI * 2);
    ctx.fill();
  };

  if (level.exit) {
    dot((level.exit.tx + 0.5) * TILE, (level.exit.ty + 0.5) * TILE, '#7dfc9a', 3);
  }

  if (showContacts) {
    for (const c of state.cores) {
      if (!c.collected) dot(c.x, c.y, '#ffd166', 2);
    }
    for (const sh of state.shields) {
      if (!sh.collected) dot(sh.x, sh.y, '#44ccff', 2);
    }
    for (const t of state.turrets) {
      if (!t.alive) continue;
      const def = level.turrets.find((d) => d.id === t.id);
      if (def) dot((def.tx + 0.5) * TILE, (def.ty + 0.5) * TILE, '#ff5c5c', 2.5);
    }
    for (const e of state.enemies) {
      if (!e.alive) continue;
      // Chi si occulta non compare nemmeno sulla minimappa finché non
      // spara: se ci comparisse, il velo varrebbe solo contro chi non
      // ha preso Lettura Termica — cioè sarebbe una punizione per chi
      // ha investito nel ramo sbagliato invece di una minaccia.
      if (archetypeOf(e.kind).cloaks && e.revealMs <= 0) continue;
      dot(e.x, e.y, e.ai === 'engage' ? '#ff9a3c' : '#ffd166', 3);
    }
    if (state.boss && state.boss.phase !== 'defeated') {
      dot(state.boss.x, state.boss.y, '#ff7a2f', 4);
    }
  }

  // Il giocatore per ultimo: un contatto non deve mai coprire la
  // freccia che dice dove sei.
  const p = state.player;
  const px = mx + p.x * sx;
  const py = my + p.y * sy;
  ctx.fillStyle = '#eaf6ff';
  ctx.beginPath();
  ctx.moveTo(px + Math.cos(p.angle) * 5, py + Math.sin(p.angle) * 5);
  ctx.lineTo(px + Math.cos(p.angle + 2.5) * 4, py + Math.sin(p.angle + 2.5) * 4);
  ctx.lineTo(px + Math.cos(p.angle - 2.5) * 4, py + Math.sin(p.angle - 2.5) * 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
