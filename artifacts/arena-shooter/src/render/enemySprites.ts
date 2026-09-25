// ================================================================
// CORPI — la pianta di ogni nemico e di ogni boss
// ================================================================
// Solo dati: scatole in spazio modello, che spriteBaker.ts cuoce in
// otto direzioni. Nessuna immagine, nessuna rete — vedi la nota lunga
// lì, sul perché scaricare gli sprite era la strada che questo repo
// non poteva permettersi.
//
// Due regole hanno guidato ogni corpo, e sono regole di *gioco*, non
// di gusto:
//
//   1. **Davanti e dietro devono distinguersi a colpo d'occhio.** Tre
//      archetipi su dieci hanno il punto debole sul dorso, e da lì la
//      differenza fra un colpo che vale uno e uno che vale tre. Ogni
//      bipede ha quindi una visiera davanti e uno zaino dietro: due
//      sagome diverse, non lo stesso rettangolo girato.
//   2. **La regola si vede nel corpo.** La piastra del Guardiano è una
//      scatola vera, montata davanti al torace: non è più solo un
//      pannello che compare quando lo guardi in faccia, è il motivo
//      per cui è sagomato così. Stessa cosa per l'anello
//      dell'Archivista e per l'ariete del Martello.
//
// Le proporzioni sono in frazioni dell'altezza: z va da 0 (i piedi) a
// 1 (la cima), gli stessi 0..1 che la scena mappa sull'altezza
// dell'archetipo. Così la banda della testa e il nucleo disegnati
// addosso allo sprite cadono dove la simulazione li colpisce davvero.
// ================================================================

import type { BossKind } from '../sim/campaign/levelTypes';
import type { EnemyKind } from '../sim/campaign/enemies';
import { bakeSprite, shade, type BodyPlan, type Box, type SpriteSheet } from './spriteBaker';

/** Il colore di base di ogni archetipo. Non è decorazione: a distanza
 *  la tinta è la prima cosa che si legge, e "quello arancione mi viene
 *  addosso" deve poter diventare un'abitudine. */
export const ENEMY_COLOR: Record<EnemyKind, string> = {
  ronzino: '#8fd4ff',
  vedetta: '#7fb6e8',
  saldatore: '#ffb347',
  ripetitore: '#9ad6a0',
  guardiano: '#93a4bd',
  falco: '#ff8fd0',
  crogiolo: '#b6ff7a',
  araldo: '#c39bff',
  martello: '#ff7a5c',
  archivista: '#ffe066',
};

export const BOSS_COLOR: Record<BossKind, string> = {
  sentinella: '#ff6a5c',
  custode: '#8fb3ff',
  arbiter: '#d78bff',
};

/** Quattro tinte da una: corpo, parti in ombra, dettagli chiari,
 *  e l'accento caldo che segna lenti, bocchette e nuclei. */
function palette(base: string): { body: string; dark: string; light: string; hot: string } {
  return {
    body: base,
    dark: shade(base, 0.52),
    light: shade(base, 1.18),
    hot: '#ff9a3c',
  };
}

interface BipedOpts {
  color: string;
  /** Mezza larghezza del torace. */
  girth?: number;
  /** Quanto in alto arriva il torace (frazione dell'altezza). */
  chest?: number;
  /** Lunghezza dell'arma. 0 = disarmato. */
  gun?: number;
  /** Quanto sporge lo zaino: è il segnale "questa è la schiena". */
  pack?: number;
  /** Gambe più corte e tozze. */
  squat?: boolean;
}

/** Il bipede di serie. Tutti i camminatori partono da qui e poi
 *  cambiano due o tre cose: costruirne dieci da zero avrebbe prodotto
 *  dieci silhouette che non si somigliano abbastanza per sembrare la
 *  stessa flotta. */
function biped(o: BipedOpts): Box[] {
  const p = palette(o.color);
  const g = o.girth ?? 0.13;
  const chest = o.chest ?? 0.72;
  const hip = o.squat ? 0.26 : 0.34;
  const boxes: Box[] = [
    // Gambe, in controfase.
    {
      x: 0,
      y: -g * 0.55,
      z: hip / 2,
      sx: 0.05,
      sy: 0.05,
      sz: hip / 2,
      color: p.dark,
      part: 'legA',
    },
    { x: 0, y: g * 0.55, z: hip / 2, sx: 0.05, sy: 0.05, sz: hip / 2, color: p.dark, part: 'legB' },
    // Torace.
    {
      x: 0,
      y: 0,
      z: (hip + chest) / 2,
      sx: g * 0.62,
      sy: g,
      sz: (chest - hip) / 2,
      color: p.body,
      part: 'bob',
    },
    // Testa: dentro la banda alta che conta per il colpo mirato.
    {
      x: 0,
      y: 0,
      z: chest + (1 - chest) * 0.55,
      sx: g * 0.5,
      sy: g * 0.52,
      sz: (1 - chest) * 0.36,
      color: p.light,
      part: 'bob',
    },
    // La visiera: sporge in avanti, ed è metà del lavoro di capire da
    // che parte guarda.
    {
      x: g * 0.52,
      y: 0,
      z: chest + (1 - chest) * 0.55,
      sx: g * 0.2,
      sy: g * 0.56,
      sz: (1 - chest) * 0.24,
      color: p.hot,
      part: 'bob',
    },
    // Braccia.
    {
      x: 0,
      y: -(g + 0.045),
      z: (hip + chest) / 2 + 0.04,
      sx: 0.042,
      sy: 0.042,
      sz: (chest - hip) * 0.34,
      color: p.dark,
      part: 'armA',
    },
    {
      x: 0,
      y: g + 0.045,
      z: (hip + chest) / 2 + 0.04,
      sx: 0.042,
      sy: 0.042,
      sz: (chest - hip) * 0.34,
      color: p.dark,
      part: 'armB',
    },
  ];

  if (o.gun) {
    boxes.push({
      x: o.gun * 0.5,
      y: g + 0.045,
      z: (hip + chest) / 2 + 0.06,
      sx: o.gun * 0.5,
      sy: 0.028,
      sz: 0.028,
      color: p.dark,
      part: 'armB',
    });
  }
  if (o.pack) {
    // Lo zaino è l'altra metà: da dietro si vede un blocco che da
    // davanti non c'è.
    boxes.push({
      x: -(g * 0.62 + o.pack * 0.5),
      y: 0,
      z: (hip + chest) / 2 + 0.03,
      sx: o.pack * 0.5,
      sy: g * 0.8,
      sz: (chest - hip) * 0.4,
      color: p.dark,
      part: 'bob',
    });
  }
  return boxes;
}

interface FlyerOpts {
  color: string;
  /** Mezza larghezza della capsula. */
  pod?: number;
  /** Lunghezza dei bracci del rotore. */
  rotor?: number;
  /** Muso allungato in avanti. */
  nose?: number;
}

/** Il volante. Sta a mezz'aria, quindi non ha gambe e non cammina:
 *  quello che si muove è il rotore, e il corpo oscilla.
 *
 *  Come il bipede, **riempie l'altezza da 0 a 1**. La prima stesura
 *  teneva la capsula fra 0.39 e 0.61 — sensato pensando "tanto
 *  galleggia", sbagliato in pratica: `floatZ` lo solleva già da terra,
 *  e l'unico effetto era uno sprite grande un terzo del suo
 *  fotogramma. Sullo schermo il Falco era un puntino, e il segno del
 *  punto debole galleggiava sopra il vuoto perché la banda della testa
 *  non conteneva niente. */
function flyer(o: FlyerOpts): Box[] {
  const p = palette(o.color);
  const pod = o.pod ?? 0.2;
  const rotor = o.rotor ?? 0.3;
  const boxes: Box[] = [
    // La capsula occupa la fascia centrale e alta, dove cade anche la
    // banda della testa (0.74 in su).
    { x: 0, y: 0, z: 0.52, sx: pod * 0.9, sy: pod, sz: pod * 1.35, color: p.body, part: 'bob' },
    // La lente davanti.
    {
      x: pod * 0.95,
      y: 0,
      z: 0.58,
      sx: pod * 0.22,
      sy: pod * 0.55,
      sz: pod * 0.55,
      color: p.hot,
      part: 'bob',
    },
    // La pinna dietro: senza, un corpo visto da qualsiasi lato è lo
    // stesso corpo.
    {
      x: -(pod + 0.07),
      y: 0,
      z: 0.6,
      sx: 0.08,
      sy: 0.02,
      sz: 0.16,
      color: p.dark,
      part: 'bob',
    },
    // Il sensore appeso sotto: dà peso alla parte bassa del
    // fotogramma, che altrimenti resta vuota e fa sembrare il nemico
    // più in alto di dove sta davvero.
    { x: 0.02, y: 0, z: 0.14, sx: 0.05, sy: 0.05, sz: 0.1, color: p.dark, part: 'bob' },
  ];
  // Quattro bracci che girano, in cima.
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    boxes.push({
      x: Math.cos(ang) * rotor,
      y: Math.sin(ang) * rotor,
      z: 0.88,
      sx: 0.09,
      sy: 0.09,
      sz: 0.035,
      color: p.light,
      part: 'spin',
    });
  }
  if (o.nose) {
    boxes.push({
      x: pod + o.nose * 0.5,
      y: 0,
      z: 0.58,
      sx: o.nose * 0.5,
      sy: 0.035,
      sz: 0.035,
      color: p.dark,
      part: 'bob',
    });
  }
  return boxes;
}

const WALK: Pick<BodyPlan, 'stride' | 'bob'> = { stride: 0.09, bob: 0.018 };
const HOVER: Pick<BodyPlan, 'stride' | 'bob'> = { stride: 0, bob: 0.03 };

export const ENEMY_BODIES: Record<EnemyKind, BodyPlan> = {
  // ---- Fascia 1 ----
  ronzino: { boxes: flyer({ color: ENEMY_COLOR.ronzino, pod: 0.19, rotor: 0.29 }), ...HOVER },
  vedetta: {
    boxes: [
      ...biped({ color: ENEMY_COLOR.vedetta, gun: 0.3, pack: 0.07 }),
      // L'antenna: sporge dallo zaino, e a distanza è ciò che rende la
      // Vedetta riconoscibile prima ancora del colore.
      {
        x: -0.16,
        y: 0,
        z: 0.82,
        sx: 0.016,
        sy: 0.016,
        sz: 0.13,
        color: shade(ENEMY_COLOR.vedetta, 0.6),
        part: 'bob',
      },
    ],
    ...WALK,
  },
  saldatore: {
    boxes: [
      ...biped({ color: ENEMY_COLOR.saldatore, girth: 0.16, chest: 0.7, squat: true }),
      // Il cannello: il suo attacco è il contatto, e l'arma che lo fa
      // deve essere la cosa che sporge di più.
      {
        x: 0.21,
        y: 0.2,
        z: 0.5,
        sx: 0.11,
        sy: 0.035,
        sz: 0.035,
        color: shade(ENEMY_COLOR.saldatore, 0.5),
        part: 'armB',
      },
      { x: 0.32, y: 0.2, z: 0.5, sx: 0.035, sy: 0.04, sz: 0.04, color: '#ffe9a8', part: 'armB' },
    ],
    ...WALK,
  },

  // ---- Fascia 2 ----
  ripetitore: {
    boxes: [
      ...biped({ color: ENEMY_COLOR.ripetitore, gun: 0.26, pack: 0.13 }),
      // Seconda canna: spara a raffica, e si vede.
      {
        x: 0.13,
        y: 0.14,
        z: 0.58,
        sx: 0.13,
        sy: 0.026,
        sz: 0.026,
        color: shade(ENEMY_COLOR.ripetitore, 0.5),
        part: 'armB',
      },
      // Le bocchette che si aprono dopo il colpo: la finestra di
      // sfiato è la sua vulnerabilità, e sta addosso al modello.
      {
        x: -0.2,
        y: 0,
        z: 0.66,
        sx: 0.03,
        sy: 0.08,
        sz: 0.05,
        color: '#ff9a3c',
        part: 'bob',
      },
    ],
    ...WALK,
  },
  guardiano: {
    boxes: [
      ...biped({ color: ENEMY_COLOR.guardiano, girth: 0.15, chest: 0.74, gun: 0.22 }),
      // LA PIASTRA. È il corpo della regola: immune di fronte, e da
      // davanti non si vede altro che questa.
      {
        x: 0.19,
        y: 0,
        z: 0.54,
        sx: 0.05,
        sy: 0.23,
        sz: 0.26,
        color: shade(ENEMY_COLOR.guardiano, 0.8),
        part: 'core',
      },
      {
        x: 0.25,
        y: 0,
        z: 0.54,
        sx: 0.015,
        sy: 0.19,
        sz: 0.22,
        color: shade(ENEMY_COLOR.guardiano, 1.25),
        part: 'core',
      },
    ],
    ...WALK,
  },
  falco: {
    boxes: [
      ...flyer({ color: ENEMY_COLOR.falco, pod: 0.16, rotor: 0.24, nose: 0.2 }),
      // Ali a freccia: è il più veloce del listino e deve sembrarlo
      // stando fermo.
      {
        x: -0.05,
        y: -0.26,
        z: 0.5,
        sx: 0.14,
        sy: 0.13,
        sz: 0.035,
        color: shade(ENEMY_COLOR.falco, 0.75),
        part: 'bob',
      },
      {
        x: -0.05,
        y: 0.26,
        z: 0.5,
        sx: 0.14,
        sy: 0.13,
        sz: 0.035,
        color: shade(ENEMY_COLOR.falco, 0.75),
        part: 'bob',
      },
    ],
    ...HOVER,
  },
  crogiolo: {
    boxes: [
      ...biped({ color: ENEMY_COLOR.crogiolo, girth: 0.17, chest: 0.68, squat: true }),
      // Il serbatoio: quello che esplode. Grosso, in vista, e di un
      // colore che non è quello del corpo.
      { x: -0.02, y: 0, z: 0.52, sx: 0.15, sy: 0.15, sz: 0.15, color: '#d8ffb0', part: 'bob' },
      { x: 0, y: 0, z: 0.76, sx: 0.04, sy: 0.04, sz: 0.07, color: '#8fdd55', part: 'bob' },
    ],
    ...WALK,
  },

  // ---- Fascia 3 ----
  araldo: {
    boxes: [
      ...biped({ color: ENEMY_COLOR.araldo, girth: 0.11, chest: 0.76, gun: 0.28, pack: 0.06 }),
      // L'aureola che gira: quando è velato si vede quasi solo questa,
      // ed è il "c'è qualcosa lì" che il velo deve concedere.
      ...[0, 1, 2, 3, 4, 5].map((i): Box => {
        const ang = (i / 6) * Math.PI * 2;
        return {
          x: Math.cos(ang) * 0.17,
          y: Math.sin(ang) * 0.17,
          z: 0.97,
          sx: 0.028,
          sy: 0.028,
          sz: 0.012,
          color: '#e6d2ff',
          part: 'spin',
        };
      }),
    ],
    ...WALK,
  },
  martello: {
    boxes: [
      ...biped({ color: ENEMY_COLOR.martello, girth: 0.22, chest: 0.66, squat: true, pack: 0.1 }),
      // L'ariete. Carica in linea retta e colpisce toccando: la parte
      // che ti arriva addosso è quella che si vede per prima.
      {
        x: 0.26,
        y: 0,
        z: 0.44,
        sx: 0.08,
        sy: 0.2,
        sz: 0.16,
        color: shade(ENEMY_COLOR.martello, 0.62),
        part: 'core',
      },
      // Testa piccola su un corpo enorme: il punto debole è il dorso,
      // non la testa, e la sagoma non deve suggerire il contrario.
      { x: 0.1, y: 0, z: 0.78, sx: 0.05, sy: 0.05, sz: 0.05, color: '#ffd0c0', part: 'bob' },
    ],
    ...WALK,
  },
  archivista: {
    boxes: [
      ...biped({ color: ENEMY_COLOR.archivista, girth: 0.14, chest: 0.72 }),
      // L'anello proiettore: la sua minaccia è un'area, e l'area va
      // dichiarata dal corpo prima che dalla HUD.
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): Box => {
        const ang = (i / 8) * Math.PI * 2;
        return {
          x: Math.cos(ang) * 0.24,
          y: Math.sin(ang) * 0.24,
          z: 0.44,
          sx: 0.035,
          sy: 0.035,
          sz: 0.014,
          color: '#fff1b8',
          part: 'spin',
        };
      }),
    ],
    ...WALK,
  },
};

export const BOSS_BODIES: Record<BossKind, BodyPlan> = {
  sentinella: {
    boxes: [
      ...biped({ color: BOSS_COLOR.sentinella, girth: 0.2, chest: 0.72, squat: true }),
      // Il nucleo sulla schiena: è *il* punto debole della Sentinella,
      // e adesso è una cosa che si vede girandole attorno invece di
      // una regola da imparare morendo.
      { x: -0.24, y: 0, z: 0.56, sx: 0.05, sy: 0.12, sz: 0.12, color: '#ffd166', part: 'core' },
      {
        x: 0.24,
        y: 0,
        z: 0.5,
        sx: 0.06,
        sy: 0.18,
        sz: 0.2,
        color: shade(BOSS_COLOR.sentinella, 0.6),
        part: 'core',
      },
    ],
    stride: 0.11,
    bob: 0.02,
  },
  custode: {
    boxes: [
      // Non un bipede: una colonna. Il Custode non insegue, manipola
      // la stanza — e una cosa che non cammina non deve avere gambe.
      { x: 0, y: 0, z: 0.28, sx: 0.2, sy: 0.2, sz: 0.28, color: shade(BOSS_COLOR.custode, 0.7) },
      { x: 0, y: 0, z: 0.66, sx: 0.16, sy: 0.16, sz: 0.2, color: BOSS_COLOR.custode, part: 'bob' },
      { x: 0.17, y: 0, z: 0.66, sx: 0.03, sy: 0.1, sz: 0.1, color: '#ffd166', part: 'bob' },
      {
        x: 0,
        y: 0,
        z: 0.87,
        sx: 0.09,
        sy: 0.09,
        sz: 0.08,
        color: shade(BOSS_COLOR.custode, 1.2),
        part: 'bob',
      },
      ...[0, 1, 2, 3, 4, 5].map((i): Box => {
        const ang = (i / 6) * Math.PI * 2;
        return {
          x: Math.cos(ang) * 0.3,
          y: Math.sin(ang) * 0.3,
          z: 0.52,
          sx: 0.05,
          sy: 0.05,
          sz: 0.07,
          color: shade(BOSS_COLOR.custode, 0.85),
          part: 'spin',
        };
      }),
    ],
    stride: 0,
    bob: 0.022,
  },
  arbiter: {
    boxes: [
      { x: 0, y: 0, z: 0.5, sx: 0.22, sy: 0.22, sz: 0.24, color: BOSS_COLOR.arbiter, part: 'bob' },
      { x: 0.22, y: 0, z: 0.5, sx: 0.05, sy: 0.12, sz: 0.12, color: '#ffe066', part: 'bob' },
      { x: 0, y: 0, z: 0.2, sx: 0.14, sy: 0.14, sz: 0.2, color: shade(BOSS_COLOR.arbiter, 0.6) },
      {
        x: 0,
        y: 0,
        z: 0.84,
        sx: 0.12,
        sy: 0.12,
        sz: 0.11,
        color: shade(BOSS_COLOR.arbiter, 1.15),
        part: 'bob',
      },
      // I quattro moduli in orbita. Sono anche quattro turret vere
      // nella simulazione: qui il corpo dice quello che la prima fase
      // chiede, cioè che vanno tolti prima del resto.
      ...[0, 1, 2, 3].map((i): Box => {
        const ang = (i / 4) * Math.PI * 2;
        return {
          x: Math.cos(ang) * 0.29,
          y: Math.sin(ang) * 0.29,
          z: 0.74,
          sx: 0.055,
          sy: 0.055,
          sz: 0.055,
          color: '#ff8fd0',
          part: 'spin',
        };
      }),
    ],
    stride: 0,
    bob: 0.026,
  },
};

let cached: {
  enemies: Record<EnemyKind, SpriteSheet>;
  bosses: Record<BossKind, SpriteSheet>;
} | null = null;

/** Cuoce tutto la prima volta che serve, e poi non più. Come
 *  getTextures(): il costo è una manciata di millisecondi all'avvio, e
 *  vale per tutta la partita. */
export function getSprites(): {
  enemies: Record<EnemyKind, SpriteSheet>;
  bosses: Record<BossKind, SpriteSheet>;
} {
  if (cached) return cached;
  const enemies = {} as Record<EnemyKind, SpriteSheet>;
  for (const kind of Object.keys(ENEMY_BODIES) as EnemyKind[]) {
    enemies[kind] = bakeSprite(ENEMY_BODIES[kind]);
  }
  const bosses = {} as Record<BossKind, SpriteSheet>;
  for (const kind of Object.keys(BOSS_BODIES) as BossKind[]) {
    bosses[kind] = bakeSprite(BOSS_BODIES[kind]);
  }
  cached = { enemies, bosses };
  return cached;
}
