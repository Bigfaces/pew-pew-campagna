// ================================================================
// SPRITE — cotti in codice all'avvio, come le texture
// ================================================================
// Il briefing (GDD sezione 9) concede gli sprite su nemici e boss, e
// solo lì: i muri restano texture procedurali, perché sono il tratto
// distintivo tecnico del gioco. Restava da decidere *da dove* arrivano
// gli sprite, e la risposta scontata — scaricarli — è quella che il
// progetto non può permettersi.
//
// Il repo non ha un solo file binario, e non è un dettaglio estetico:
// la build a file singolo (vite.config.ts) esiste *grazie* a questo,
// perché inlinea ogni byte. Un set di sprite scaricati finirebbe lì
// dentro in base64 e il .html che si apre col doppio clic passerebbe
// da 360 kB a qualche megabyte. Ci sarebbero anche le licenze da
// portarsi dietro, e una cartella di asset da tenere allineata al
// codice che li usa.
//
// Quindi si cuociono, con la stessa tecnica che il gioco usa già per
// i muri (render/textures.ts) e per i suoni (audio/engine.ts): si
// disegnano una volta all'avvio dentro canvas fuori schermo, e poi si
// copiano con drawImage. Zero asset, zero rete, build a file singolo
// intatta.
//
// ---- Come si ottengono otto direzioni senza disegnarle otto volte --
//
// Un corpo è una lista di **scatole** in spazio modello. Il forno le
// proietta a ogni angolo e le ordina per profondità. Disegnare otto
// direzioni a mano avrebbe voluto dire ottanta immagini per dieci
// archetipi, e ogni ritocco moltiplicato per otto; così invece il
// corpo si descrive una volta e le direzioni sono un conto.
//
// Ed è una direzione che *serve*: da quando tre archetipi hanno il
// punto debole sul dorso, capire da che parte guarda un nemico non è
// più un vezzo — è l'informazione che decide se il colpo vale uno o
// tre. Un rettangolo non la dava.
//
// La proiezione è ortogonale e le scatole restano allineate agli assi
// dello schermo: è l'AABB della scatola ruotata, non un rendering 3D
// con le facce inclinate. A questa risoluzione la differenza non si
// vede, e il costo è una manciata di fillRect invece di una pipeline.
// ================================================================

/** Un corpo, in spazio modello.
 *
 *  Convenzione: **x avanti** (dove il nemico guarda), **y a destra**,
 *  **z in alto**, con z che va da 0 (i piedi) a 1 (la cima della
 *  sagoma). Lo stesso 0..1 che la scena mappa sull'altezza
 *  dell'archetipo, così il punto debole disegnato addosso allo sprite
 *  cade dove la simulazione lo colpisce. */
export interface Box {
  x: number;
  y: number;
  z: number;
  /** Semi-dimensioni sui tre assi. */
  sx: number;
  sy: number;
  sz: number;
  color: string;
  /** A quale gruppo animato appartiene. Vedi `PART_MOTION`. */
  part?: PartId;
}

/** I gruppi animati. Sono pochi di proposito: un corpo che si muove
 *  in dieci modi diversi non si legge a otto pixel di larghezza. */
export type PartId =
  /** Ferma rispetto al corpo. */
  | 'core'
  /** Le due gambe, in controfase. */
  | 'legA'
  | 'legB'
  /** Il braccio armato, in controfase con la gamba omonima. */
  | 'armA'
  | 'armB'
  /** Oscilla in verticale: ciò che vola, e la testa di chi cammina. */
  | 'bob'
  /** Gira: rotori, anelli, lame. */
  | 'spin';

export interface BodyPlan {
  boxes: readonly Box[];
  /** Ampiezza del passo, in unità modello. 0 = non cammina. */
  stride: number;
  /** Ampiezza dell'oscillazione verticale. */
  bob: number;
}

/** Otto direzioni: abbastanza per leggere "mi dà le spalle" senza che
 *  il salto fra una e l'altra diventi uno scatto. Sedici
 *  raddoppierebbero l'atlante per una differenza che a questa
 *  risoluzione non si vede. */
export const SPRITE_ANGLES = 8;

/** Quattro fotogrammi: passo destro, in mezzo, passo sinistro, in
 *  mezzo. Il ciclo minimo che legge come un cammino. */
export const SPRITE_FRAMES = 4;

/** Dimensione di un fotogramma nell'atlante. Alto quanto basta perché
 *  un boss non si schiacci, largo abbastanza per le braccia aperte.
 *  Lo scaling è nearest (imageSmoothingEnabled è false nel gioco), che
 *  a queste dimensioni è il look giusto e non un compromesso.
 *
 *  La larghezza è 52 e non 40 perché con 40 otto corpi su tredici
 *  sbordavano nel riquadro accanto dell'atlante — e sbordare non dà
 *  errore, dà un nemico che si porta dietro un pezzo di sé girato da
 *  un'altra parte. I rotori dei volanti, per esempio, sembravano una
 *  barra continua invece di quattro bracci. Lo impone un test. */
export const FRAME_W = 52;
export const FRAME_H = 56;

/** Margine interno, in px, perché nessuna scatola tocchi il bordo del
 *  fotogramma — un pixel tagliato diventa una riga verticale netta che
 *  si vede a tutte le distanze. */
const PAD = 3;

export interface SpriteSheet {
  canvas: HTMLCanvasElement;
  frameW: number;
  frameH: number;
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Dove sta una parte al fotogramma `f`, come spostamenti da sommare.
 *
 *  Restituisce (dx, dz): avanti/indietro e su/giù. Le gambe vanno in
 *  controfase, le braccia pure ma invertite rispetto alla gamba dello
 *  stesso lato — è ciò che rende un cammino un cammino e non due
 *  bastoni che oscillano insieme. */
function partOffset(
  part: PartId | undefined,
  f: number,
  plan: BodyPlan,
): { dx: number; dz: number; spin: number } {
  const phase = (f / SPRITE_FRAMES) * Math.PI * 2;
  const swing = Math.sin(phase) * plan.stride;
  switch (part) {
    case 'legA':
      return { dx: swing, dz: 0, spin: 0 };
    case 'legB':
      return { dx: -swing, dz: 0, spin: 0 };
    case 'armA':
      return { dx: -swing * 0.6, dz: 0, spin: 0 };
    case 'armB':
      return { dx: swing * 0.6, dz: 0, spin: 0 };
    case 'bob':
      // Due oscillazioni per passo: il bacino sale a ogni appoggio,
      // non a ogni ciclo.
      return { dx: 0, dz: Math.abs(Math.sin(phase)) * plan.bob, spin: 0 };
    case 'spin':
      return { dx: 0, dz: 0, spin: phase };
    default:
      return { dx: 0, dz: 0, spin: 0 };
  }
}

/** Schiarisce o scurisce un colore esadecimale. Serve a dare volume:
 *  le facce più vicine al punto di vista sono più chiare, ed è tutto
 *  il rilievo che questa proiezione può dare — ma basta, perché a otto
 *  pixel di larghezza il rilievo è un gradiente, non una geometria. */
export function shade(color: string, amount: number): string {
  const [r, g, b] = parseColor(color);
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(r * amount)},${clamp(g * amount)},${clamp(b * amount)})`;
}

/** Legge sia `#rrggbb` sia `rgb(r,g,b)`.
 *
 *  Le due forme servono entrambe perché `shade` si applica *due
 *  volte*: una dalla pianta del corpo (per fare le parti scure e
 *  chiare da un colore di base) e una dal forno (per l'ombreggiatura
 *  per profondità). La prima stesura leggeva solo l'esadecimale, e la
 *  seconda passata riceveva la stringa `rgb(...)` prodotta dalla
 *  prima: `parseInt` restituiva NaN, gli scorrimenti davano 0, e ogni
 *  scatola già ombreggiata diventava **nera**. Teste, gambe e zaini di
 *  tutti e tredici i corpi — cioè metà di ogni sprite — e non c'era
 *  modo di accorgersene leggendo il codice, perché nero è un colore
 *  plausibile per un robot. */
function parseColor(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = color.match(/-?\d+(\.\d+)?/g);
  if (!m || m.length < 3) return [255, 0, 255];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/** Cuoce un corpo in un atlante: una colonna per direzione, una riga
 *  per fotogramma. */
export function bakeSprite(plan: BodyPlan): SpriteSheet {
  const canvas = createCanvas(FRAME_W * SPRITE_ANGLES, FRAME_H * SPRITE_FRAMES);
  const ctx = canvas.getContext('2d')!;

  // z=0 in basso, z=1 in alto, dentro il margine.
  const scale = FRAME_H - PAD * 2;
  const originY = FRAME_H - PAD;
  const originX = FRAME_W / 2;

  for (let f = 0; f < SPRITE_FRAMES; f++) {
    for (let a = 0; a < SPRITE_ANGLES; a++) {
      const theta = (a / SPRITE_ANGLES) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      // Profondità di ogni scatola: positiva verso chi guarda. Si
      // disegna dal fondo, come farebbe un pittore.
      const drawn = plan.boxes.map((b) => {
        const off = partOffset(b.part, f, plan);
        // Lo `spin` ruota la scatola attorno all'asse verticale del
        // corpo, non attorno alla propria: è quello che serve a un
        // rotore o a un anello, ed è l'unica rotazione che questa
        // proiezione può rendere onestamente.
        const cs = Math.cos(off.spin);
        const sn = Math.sin(off.spin);
        const bx = (b.x + off.dx) * cs - b.y * sn;
        const by = (b.x + off.dx) * sn + b.y * cs;
        const bz = b.z + off.dz;
        return { b, bx, by, bz, depth: bx * cos + by * sin };
      });
      drawn.sort((p, q) => p.depth - q.depth);

      const ox = a * FRAME_W;
      const oy = f * FRAME_H;

      for (const p of drawn) {
        // Larghezza proiettata: è l'estensione della scatola ruotata
        // sull'asse orizzontale dello schermo.
        const halfW = Math.abs(p.b.sx * sin) + Math.abs(p.b.sy * cos);
        const u = -p.bx * sin + p.by * cos;

        const x0 = ox + originX + (u - halfW) * scale;
        const x1 = ox + originX + (u + halfW) * scale;
        const y0 = oy + originY - (p.bz + p.b.sz) * scale;
        const y1 = oy + originY - (p.bz - p.b.sz) * scale;

        // Più vicino a chi guarda, più chiaro. L'intervallo è stretto:
        // schiarire troppo il davanti fa sembrare il nemico illuminato
        // da una torcia che non esiste in nessuna delle stanze.
        const lit = 0.88 + Math.max(-1, Math.min(1, p.depth * 2.2)) * 0.2;
        ctx.fillStyle = shade(p.b.color, lit);
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));

        // Il contorno scuro è ciò che tiene separate due scatole dello
        // stesso colore. Senza, un corpo diventa una macchia.
        if (x1 - x0 > 2.5 && y1 - y0 > 2.5) {
          ctx.strokeStyle = shade(p.b.color, 0.34);
          ctx.lineWidth = 1;
          ctx.strokeRect(
            Math.round(x0) + 0.5,
            Math.round(y0) + 0.5,
            Math.max(1, Math.round(x1 - x0) - 1),
            Math.max(1, Math.round(y1 - y0) - 1),
          );
        }
      }
    }
  }

  return { canvas, frameW: FRAME_W, frameH: FRAME_H };
}

/** Quale colonna dell'atlante mostra un nemico visto da `relAngle`.
 *
 *  `relAngle` è l'angolo *dalla sua faccia a chi guarda*: 0 vuol dire
 *  che lo stai guardando in faccia, π che gli vedi la schiena — lo
 *  stesso conto che la simulazione fa per decidere se il colpo prende
 *  il dorso. Che disegno e regola usino la stessa quantità non è un
 *  risparmio: è la ragione per cui quello che vedi è quello che
 *  colpisci. */
export function angleIndex(relAngle: number): number {
  const step = (Math.PI * 2) / SPRITE_ANGLES;
  const i = Math.round(relAngle / step) % SPRITE_ANGLES;
  return i < 0 ? i + SPRITE_ANGLES : i;
}

/** Dove va disegnato un fotogramma, dati l'altezza che deve occupare
 *  a schermo e il punto in cui poggiano i piedi.
 *
 *  Sta qui e non nella scena perché dipende da PAD e
 *  dall'orientamento del forno: se la scena rifacesse il conto per
 *  conto suo, cambiare il margine interno scollerebbe in silenzio i
 *  nemici dal pavimento. `heightPx` è l'altezza del *modello* (z da 0
 *  a 1), non del fotogramma, che è un po' più alto per via del
 *  margine. */
export function spriteBox(
  heightPx: number,
  footX: number,
  footY: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const unit = heightPx / (FRAME_H - PAD * 2);
  return {
    dx: footX - (FRAME_W / 2) * unit,
    dy: footY - (FRAME_H - PAD) * unit,
    dw: FRAME_W * unit,
    dh: FRAME_H * unit,
  };
}

/** Un fotogramma, tinto di un colore, disegnato nella scena.
 *
 *  Serve al velo di fase dei boss, dove il colore *è* il telegrafo.
 *  La strada ovvia — disegnare lo sprite e poi passarci sopra un
 *  rettangolo in `source-atop` — è sbagliata, e lo è in modo
 *  silenzioso: `source-atop` compone contro **tutto** il canvas di
 *  destinazione, non contro l'ultima cosa disegnata, e a quel punto
 *  il canvas ha già i muri opachi. Il risultato è un rettangolo di
 *  colore steso sul muro dietro il boss.
 *
 *  Con un buffer grande quanto un fotogramma il ritaglio è per
 *  costruzione: lì dentro l'unica cosa non trasparente è lo sprite.
 *  Costa un drawImage in più per boss, cioè uno per fotogramma di
 *  gioco. */
let tintBuffer: HTMLCanvasElement | null = null;

export function drawTintedFrame(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  src: { sx: number; sy: number; sw: number; sh: number },
  dst: { dx: number; dy: number; dw: number; dh: number },
  tint: string,
  strength: number,
): void {
  if (!tintBuffer) tintBuffer = createCanvas(FRAME_W, FRAME_H);
  const b = tintBuffer.getContext('2d')!;
  b.clearRect(0, 0, FRAME_W, FRAME_H);
  b.globalCompositeOperation = 'source-over';
  b.globalAlpha = 1;
  b.drawImage(sheet.canvas, src.sx, src.sy, src.sw, src.sh, 0, 0, FRAME_W, FRAME_H);
  b.globalCompositeOperation = 'source-atop';
  b.globalAlpha = strength;
  b.fillStyle = tint;
  b.fillRect(0, 0, FRAME_W, FRAME_H);
  b.globalCompositeOperation = 'source-over';
  b.globalAlpha = 1;
  ctx.drawImage(tintBuffer, 0, 0, FRAME_W, FRAME_H, dst.dx, dst.dy, dst.dw, dst.dh);
}

/** Il rettangolo sorgente di un fotogramma dentro l'atlante. */
export function frameRect(
  sheet: SpriteSheet,
  relAngle: number,
  frame: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const a = angleIndex(relAngle);
  const f = ((frame % SPRITE_FRAMES) + SPRITE_FRAMES) % SPRITE_FRAMES;
  return { sx: a * sheet.frameW, sy: f * sheet.frameH, sw: sheet.frameW, sh: sheet.frameH };
}
