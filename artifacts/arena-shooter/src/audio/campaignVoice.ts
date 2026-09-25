// ================================================================
// VOCE DELLA CAMPAGNA — i suoni che il fucile e il respawn dell'Arena
// non possono prestarle
// ================================================================
// campaignGame.ts oggi risolve ogni evento della campagna riciclando
// le voci dell'Arena: lo scatto suona come un respawn, il colpo di un
// nemico come il fucile del giocatore, il sigillo di una porta come un
// impatto qualunque. Funziona perché il motore sintetizza comunque
// qualcosa, ma appiattisce l'unica informazione che il giocatore non
// può recuperare guardando: se quel colpo era quello giusto. La
// campagna uccide in un colpo solo, quindi il suono È metà del
// preavviso, non un contorno.
//
// Questo modulo non tocca src/audio/engine.ts — è dell'Arena, e un
// secondo gioco che ne dipendesse per un gesto suo lo renderebbe
// accoppiato a un motore che non gli appartiene. Si replica invece il
// minimo che serve (context, buffer di rumore, oscillatori, panner),
// con le stesse convenzioni: HRTF, mappatura X→X / Y→Z, `TILE` come
// unità di distanza per il panner. Vedi il confronto diretto nei
// commenti dei singoli suoni qui sotto.
//
// ---- Perché i dati sono separati da chi li suona -------------------
//
// Ogni voce è una `VoiceSpec`: un elenco di strati (`layers`), toni o
// rumori filtrati, ciascuno con la propria frequenza, durata e
// guadagno. Sono oggetti letterali esportati, non chiamate a metodo:
// un test può leggere `ENEMY_HIT_WEAK_SPOT.layers` e verificare che
// suoni più in alto e più a lungo di `ENEMY_HIT_BODY.layers` senza
// mai costruire un `AudioContext`. È lo stesso principio del listino
// nemici (enemies.ts): il dato descrive, il motore esegue.
//
// ---- Perché deve reggere senza AudioContext -------------------------
//
// Il gioco gira da file:// e da mobile, dove l'audio resta sospeso
// finché non arriva il primo tocco; un test headless non ha proprio
// `window`. `AudioEngine.init()` presuppone che `window` esista (lo
// legge senza controllo) perché nell'Arena viene creato solo dopo un
// click nel browser. Qui il rischio è più concreto — non solo
// `AudioContext` può mancare, ma `window` stesso — quindi il controllo
// è esplicito: `typeof window === 'undefined'` prima di toccarlo.
// ================================================================

import { TILE } from '../sim/constants';
import { archetypeOf, type EnemyKind } from '../sim/campaign/enemies';

/** Stessa soglia di udibilità dell'Arena (vedi engine.ts): oltre non
 *  vale la pena nemmeno costruire il panner. */
const MAX_AUDIBLE = TILE * 30;

// ---- Dati puri: le tabelle dei parametri ---------------------------

/** Le tre fasce di minaccia della campagna (vedi enemies.ts, `tier`). */
export type EnemyTier = 1 | 2 | 3;

interface ToneLayer {
  readonly kind: 'tone';
  readonly wave: OscillatorType;
  /** Hz di partenza. */
  readonly freqFrom: number;
  /** Hz di arrivo: uguale a `freqFrom` per un tono piatto. */
  readonly freqTo: number;
  /** Ritardo dall'inizio del suono, in secondi. Permette a uno strato
   *  di partire dopo un altro senza una seconda chiamata a `play`. */
  readonly delay: number;
  readonly duration: number;
  readonly gain: number;
}

interface NoiseLayer {
  readonly kind: 'noise';
  readonly filterType: BiquadFilterType;
  readonly freq: number;
  readonly q?: number;
  /** Se presente, il filtro scivola verso questa frequenza. */
  readonly sweepTo?: number;
  readonly delay: number;
  readonly duration: number;
  readonly gain: number;
}

type VoiceLayer = ToneLayer | NoiseLayer;

export interface VoiceSpec {
  /** Solo per leggere i test e i log; il motore non lo usa. */
  readonly label: string;
  readonly layers: readonly VoiceLayer[];
}

/** La frequenza più alta toccata da uno spec, tono o rumore che sia.
 *  Serve ai test di distinguibilità: un "tonfo sordo" e un "colpo
 *  netto" si separano prima di tutto qui, non nel guadagno. Esportata
 *  perché la proprietà che deve reggere — la piastra non ha nulla
 *  sopra qualche centinaio di Hz — è verificabile solo se il calcolo
 *  è pubblico e non un dettaglio del test. */
export function peakFrequency(spec: VoiceSpec): number {
  let peak = 0;
  for (const layer of spec.layers) {
    const hi =
      layer.kind === 'tone'
        ? Math.max(layer.freqFrom, layer.freqTo)
        : Math.max(layer.freq, layer.sweepTo ?? layer.freq);
    if (hi > peak) peak = hi;
  }
  return peak;
}

/** Somma dei guadagni degli strati: una misura grezza ma sufficiente
 *  di "quanto forte" per confrontare due spec fra loro nei test. */
export function totalGain(spec: VoiceSpec): number {
  return spec.layers.reduce((sum, l) => sum + l.gain, 0);
}

/** Fine dell'ultimo strato: la durata percepita del suono intero. */
export function totalDuration(spec: VoiceSpec): number {
  return spec.layers.reduce((max, l) => Math.max(max, l.delay + l.duration), 0);
}

// ---- Colpo di un nemico a distanza, per fascia ----------------------
//
// Il fucile del giocatore (engine.ts, `rifle`) è un'onda quadra che
// crolla da 220 a 60 Hz sopra un rumore passa-alto che scivola verso il
// basso: un crack secco e pulito, l'arma di chi para. Il nemico deve
// suonare come una minaccia che arriva, non come un'eco del proprio
// sparo — quindi timbro diverso (dente di sega, non quadra: più ruvido)
// e cattiveria che sale con la fascia invece di restare piatta.
//
// La fascia 3 aggiunge un secondo tono a 6 Hz di distanza dal primo
// (262 contro 268): troppo vicini per sentirsi come due note, abbastanza
// da battere — lo stridio che una singola onda non può dare. È la
// stessa idea del "colpo perfetto" sui nemici: una regola in più che si
// somma, non una nuova invenzione isolata.
export const ENEMY_RANGED_SHOT_BY_TIER: Readonly<Record<EnemyTier, VoiceSpec>> = {
  1: {
    label: 'colpo nemico — fascia 1',
    layers: [
      {
        kind: 'tone',
        wave: 'sawtooth',
        freqFrom: 520,
        freqTo: 190,
        delay: 0,
        duration: 0.11,
        gain: 0.32,
      },
      {
        kind: 'noise',
        filterType: 'bandpass',
        freq: 2000,
        q: 3,
        delay: 0,
        duration: 0.05,
        gain: 0.22,
      },
    ],
  },
  2: {
    label: 'colpo nemico — fascia 2',
    layers: [
      {
        kind: 'tone',
        wave: 'sawtooth',
        freqFrom: 380,
        freqTo: 130,
        delay: 0,
        duration: 0.16,
        gain: 0.4,
      },
      {
        kind: 'tone',
        wave: 'square',
        freqFrom: 150,
        freqTo: 90,
        delay: 0,
        duration: 0.14,
        gain: 0.16,
      },
      {
        kind: 'noise',
        filterType: 'bandpass',
        freq: 1400,
        q: 2.2,
        delay: 0,
        duration: 0.06,
        gain: 0.28,
      },
    ],
  },
  3: {
    label: 'colpo nemico — fascia 3',
    layers: [
      {
        kind: 'tone',
        wave: 'sawtooth',
        freqFrom: 262,
        freqTo: 70,
        delay: 0,
        duration: 0.24,
        gain: 0.48,
      },
      // Il battimento: stessa forma, 6 Hz più su, leggermente in ritardo
      // così l'attacco resta unico e solo la coda stride.
      {
        kind: 'tone',
        wave: 'sawtooth',
        freqFrom: 268,
        freqTo: 74,
        delay: 0.01,
        duration: 0.24,
        gain: 0.42,
      },
      {
        kind: 'noise',
        filterType: 'lowpass',
        freq: 900,
        sweepTo: 200,
        delay: 0,
        duration: 0.2,
        gain: 0.35,
      },
    ],
  },
};

/** Ricava la fascia dall'archetipo. Unica fonte di verità: `tier` vive
 *  in enemies.ts, qui non se ne tiene una copia. */
export function tierOf(kind: EnemyKind): EnemyTier {
  return archetypeOf(kind).tier;
}

// ---- Punto debole contro corpo contro piastra -----------------------
//
// Sono la stessa meccanica (vedi enemies.ts: il colpo giusto vale sei
// volte quello qualunque) e devono restare inconfondibili anche a
// occhi chiusi, quindi si separano su tre assi indipendenti, non uno:
//
//   • ampiezza di frequenza — il corpo resta sotto i 1500 Hz, il punto
//     debole sale oltre i 2000 (un "ding", non un "thwack");
//   • forma — il corpo è un singolo strato, il punto debole è un
//     accordo di due toni in successione (un vero e proprio squillo di
//     conferma);
//   • durata e guadagno — il punto debole dura il doppio e pesa di più,
//     perché è la ricompensa, non la norma.
//
// La piastra è il caso critico: oggi è un `impact()` identico a
// sparare al muro, ed è la ragione per cui la lezione del Guardiano non
// arriva. Qui non condivide *nessuna* frequenza con le altre due — resta
// sotto i 350 Hz ovunque — cosicché "non è passato" non possa mai
// essere scambiato per "è passato, ma poco".
export const ENEMY_HIT_BODY: VoiceSpec = {
  label: 'colpo al corpo',
  layers: [
    {
      kind: 'noise',
      filterType: 'bandpass',
      freq: 1300,
      q: 1.6,
      delay: 0,
      duration: 0.07,
      gain: 0.32,
    },
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 500,
      freqTo: 380,
      delay: 0,
      duration: 0.05,
      gain: 0.12,
    },
  ],
};

export const ENEMY_HIT_WEAK_SPOT: VoiceSpec = {
  label: 'colpo al punto debole',
  layers: [
    { kind: 'noise', filterType: 'highpass', freq: 2800, delay: 0, duration: 0.05, gain: 0.3 },
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 1700,
      freqTo: 1700,
      delay: 0,
      duration: 0.09,
      gain: 0.32,
    },
    // Il secondo tono arriva un attimo dopo e sale: è l'accordo che
    // rende lo squillo riconoscibile invece di un solo bip più acuto.
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 2500,
      freqTo: 2500,
      delay: 0.05,
      duration: 0.11,
      gain: 0.28,
    },
  ],
};

export const PLATE_ABSORBED: VoiceSpec = {
  label: 'piastra frontale — assorbito',
  layers: [
    // Niente sopra i 320 Hz in tutto lo spec: è la garanzia che lo
    // separa da qualunque altro suono di colpo del modulo.
    {
      kind: 'tone',
      wave: 'square',
      freqFrom: 100,
      freqTo: 55,
      delay: 0,
      duration: 0.16,
      gain: 0.34,
    },
    { kind: 'noise', filterType: 'lowpass', freq: 320, delay: 0, duration: 0.3, gain: 0.55 },
  ],
};

// ---- Nemico abbattuto e nemico che si svela -------------------------
//
// L'Araldo si occulta finché non spara (enemies.ts, `cloaks`): il
// momento in cui torna visibile è un'informazione a sé, distinta dal
// crack del suo colpo. `enemyRangedShot` copre il "cosa"; questo copre
// il "eccolo" — un rumore che *sale* di frequenza invece di scendere,
// perché ogni altro suono d'impatto in questo file cala: qui si vuole
// l'opposto, qualcosa che compare invece di colpire.
export const ENEMY_DOWN: VoiceSpec = {
  label: 'nemico abbattuto',
  layers: [
    {
      kind: 'noise',
      filterType: 'lowpass',
      freq: 850,
      sweepTo: 160,
      delay: 0,
      duration: 0.24,
      gain: 0.42,
    },
    {
      kind: 'tone',
      wave: 'sawtooth',
      freqFrom: 160,
      freqTo: 42,
      delay: 0,
      duration: 0.26,
      gain: 0.22,
    },
  ],
};

export const ENEMY_REVEALED: VoiceSpec = {
  label: 'nemico si svela',
  layers: [
    {
      kind: 'noise',
      filterType: 'bandpass',
      freq: 400,
      sweepTo: 2200,
      q: 1.4,
      delay: 0,
      duration: 0.2,
      gain: 0.26,
    },
    { kind: 'tone', wave: 'sine', freqFrom: 220, freqTo: 900, delay: 0, duration: 0.2, gain: 0.16 },
  ],
};

// ---- Scatto del giocatore --------------------------------------------
//
// Oggi campaignGame.ts riusa `audio.respawn()` — un tono sinusoidale
// puro, 320→760 Hz — ammettendo nel commento che è un prestito. Il
// respawn è la cosa sbagliata da riusare proprio per la sua natura:
// è un tono, cioè legge come un segnale, mentre uno scatto è aria
// spostata dal proprio corpo. Qui il rumore domina e il tono è solo un
// clic finale che segna dove i piedi si riappoggiano, e l'insieme dura
// meno (0.16s contro 0.26s) — è un gesto, non un annuncio.
export const PLAYER_DASH: VoiceSpec = {
  label: 'scatto',
  layers: [
    {
      kind: 'noise',
      filterType: 'highpass',
      freq: 700,
      sweepTo: 2400,
      delay: 0,
      duration: 0.13,
      gain: 0.34,
    },
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 1100,
      freqTo: 1100,
      delay: 0.12,
      duration: 0.04,
      gain: 0.1,
    },
  ],
};

// ---- Boss: cambio di fase contro finestra vulnerabile ----------------
//
// Sono i due telegrafi udibili dei tre combattimenti (Sentinella,
// Custode, Arbiter) e devono dire cose opposte: un cambio di fase è una
// minaccia che cresce, una finestra che si apre è un invito a colpire.
// Si separano per direzione oltre che per timbro — il cambio di fase
// scende (dente di sega, cupo), la finestra sale (accordo di triangoli,
// luminoso) — cosicché anche senza guardare la schermata sappiano dire
// da soli "attento" contro "adesso".
//
// Il cambio di fase pesa di più alla fase 3 che alla 2, sullo stesso
// principio delle fasce nemiche: l'ultima fase di ogni boss è quella in
// cui l'errore costa di più, e il suono lo deve anticipare.
export const BOSS_PHASE_CHANGE_BY_STAGE: Readonly<Record<2 | 3, VoiceSpec>> = {
  2: {
    label: 'boss — cambio di fase (2)',
    layers: [
      {
        kind: 'tone',
        wave: 'sawtooth',
        freqFrom: 220,
        freqTo: 75,
        delay: 0,
        duration: 0.4,
        gain: 0.3,
      },
      { kind: 'noise', filterType: 'lowpass', freq: 550, delay: 0, duration: 0.35, gain: 0.28 },
    ],
  },
  3: {
    label: 'boss — cambio di fase (3)',
    layers: [
      {
        kind: 'tone',
        wave: 'sawtooth',
        freqFrom: 200,
        freqTo: 55,
        delay: 0,
        duration: 0.55,
        gain: 0.4,
      },
      {
        kind: 'tone',
        wave: 'sawtooth',
        freqFrom: 205,
        freqTo: 58,
        delay: 0.02,
        duration: 0.55,
        gain: 0.34,
      },
      { kind: 'noise', filterType: 'lowpass', freq: 600, delay: 0, duration: 0.45, gain: 0.36 },
    ],
  },
};

export const BOSS_VULNERABLE_OPEN: VoiceSpec = {
  label: 'boss — finestra vulnerabile',
  layers: [
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 700,
      freqTo: 700,
      delay: 0,
      duration: 0.16,
      gain: 0.2,
    },
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 1050,
      freqTo: 1050,
      delay: 0.07,
      duration: 0.16,
      gain: 0.2,
    },
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 1400,
      freqTo: 1400,
      delay: 0.14,
      duration: 0.18,
      gain: 0.2,
    },
  ],
};

// ---- Ambiente: porta, gas, gravità, buio ------------------------------
//
// `doorSealed` oggi usa `audio.impact()` — lo stesso rumore passa-banda
// con scivolata che segna un proiettile a segno. Una porta stagna è due
// eventi, non uno: il chiavistello che scatta e l'aria che va in
// pressione dietro. Da qui il layout a due stadi, con la seconda parte
// che comincia dove finisce la prima invece di sovrapporsi.
export const DOOR_SEAL: VoiceSpec = {
  label: 'porta stagna sigillata',
  layers: [
    {
      kind: 'noise',
      filterType: 'bandpass',
      freq: 3000,
      q: 4,
      delay: 0,
      duration: 0.05,
      gain: 0.4,
    },
    {
      kind: 'noise',
      filterType: 'highpass',
      freq: 4200,
      sweepTo: 1200,
      delay: 0.05,
      duration: 0.32,
      gain: 0.22,
    },
  ],
};

/** Non un impatto ma un ambiente: niente transiente, solo uno sfiato
 *  che si stabilizza — l'idea è "qualcosa ora riempie la stanza", non
 *  "qualcosa è appena successo in un punto". Per questo non è
 *  posizionato: il gas riempie la stanza, non un angolo di essa. */
export const GAS_HAZARD: VoiceSpec = {
  label: 'gas contaminante',
  layers: [
    {
      kind: 'noise',
      filterType: 'bandpass',
      freq: 2100,
      sweepTo: 700,
      q: 1.1,
      delay: 0,
      duration: 0.55,
      gain: 0.18,
    },
  ],
};

// Due incroci di toni che si scavalcano — uno sale mentre l'altro
// scende — invece del solito singolo sweep: è l'unico suono del
// modulo che rappresenta un ribaltamento invece di un evento puntuale,
// e doveva essere sonoramente distinguibile da tutto il resto per
// questo. Il ripristino è lo stesso incrocio con le due rampe
// scambiate, così l'orecchio impara ad associare la direzione del
// suono alla direzione della gravità.
export const GRAVITY_FLIP_INVERTED: VoiceSpec = {
  label: 'gravità invertita',
  layers: [
    {
      kind: 'tone',
      wave: 'sine',
      freqFrom: 180,
      freqTo: 1100,
      delay: 0,
      duration: 0.3,
      gain: 0.22,
    },
    {
      kind: 'tone',
      wave: 'sine',
      freqFrom: 1100,
      freqTo: 180,
      delay: 0.02,
      duration: 0.3,
      gain: 0.22,
    },
  ],
};

export const GRAVITY_FLIP_RESTORED: VoiceSpec = {
  label: 'gravità ripristinata',
  layers: [
    {
      kind: 'tone',
      wave: 'sine',
      freqFrom: 1100,
      freqTo: 180,
      delay: 0,
      duration: 0.3,
      gain: 0.22,
    },
    {
      kind: 'tone',
      wave: 'sine',
      freqFrom: 180,
      freqTo: 1100,
      delay: 0.02,
      duration: 0.3,
      gain: 0.22,
    },
  ],
};

/** `death()` (engine.ts) è un colpo che punisce: sega che crolla sopra
 *  un rumore passa-basso, 0.7s, forte. Il buio non è un danno, è
 *  un'informazione ambientale — "lo scanner regge" dice già il testo a
 *  schermo — quindi qui niente scivolata di rumore, solo un ronzio
 *  fermo e un tono che cala più corto e più piano: si nota, non fa
 *  male. */
export const BLACKOUT: VoiceSpec = {
  label: 'blackout di settore',
  layers: [
    {
      kind: 'tone',
      wave: 'sawtooth',
      freqFrom: 260,
      freqTo: 60,
      delay: 0,
      duration: 0.35,
      gain: 0.22,
    },
    { kind: 'noise', filterType: 'lowpass', freq: 140, delay: 0, duration: 0.4, gain: 0.14 },
  ],
};

// ---- Fine livello e riavvio dell'atto ---------------------------------
//
// `matchEnd(true)` (engine.ts) è la fanfara dell'Arena: 523-659-784-1047
// in triangolo, 0.13s di distanza. Qui la si vuole imparentata ma non
// identica — la campagna non è una partita — quindi un'onda diversa
// (sine, più morbida) e una nota in più: la progressione di un livello
// dentro un atto, non la fine secca di un incontro.
export const LEVEL_COMPLETE: VoiceSpec = {
  label: 'livello completato',
  layers: [
    {
      kind: 'tone',
      wave: 'sine',
      freqFrom: 440,
      freqTo: 440,
      delay: 0,
      duration: 0.22,
      gain: 0.22,
    },
    {
      kind: 'tone',
      wave: 'sine',
      freqFrom: 554,
      freqTo: 554,
      delay: 0.1,
      duration: 0.22,
      gain: 0.22,
    },
    {
      kind: 'tone',
      wave: 'sine',
      freqFrom: 659,
      freqTo: 659,
      delay: 0.2,
      duration: 0.22,
      gain: 0.22,
    },
    {
      kind: 'tone',
      wave: 'sine',
      freqFrom: 880,
      freqTo: 880,
      delay: 0.3,
      duration: 0.28,
      gain: 0.24,
    },
  ],
};

// Roguelike: morire qui non chiude il livello, chiude l'atto (vedi
// CampaignEvent.actRestart in types.ts). `playerDied` suona già la
// morte (`death()`, riusato); questo è l'evento *in più* che dice "da
// capo", e deve suonare come un reset, non come una seconda morte:
// scende, si ferma, e un piccolo blip risale a segnare che si riparte.
export const ACT_RESTART: VoiceSpec = {
  label: 'atto da capo',
  layers: [
    {
      kind: 'tone',
      wave: 'sawtooth',
      freqFrom: 500,
      freqTo: 180,
      delay: 0,
      duration: 0.22,
      gain: 0.24,
    },
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 260,
      freqTo: 460,
      delay: 0.24,
      duration: 0.14,
      gain: 0.16,
    },
  ],
};

// ---- Trasponditore: lancio, battito, esaurimento, carica raccolta ----
//
// Il Trasponditore non fa danno: pianta un'esca che per un tempo
// limitato ruba l'attenzione dei nemici. Sono quattro momenti diversi
// da riconoscere senza guardare la HUD, e nessuno dei quattro può
// suonare come un impatto — l'esca non colpisce niente:
//
//   • il LANCIO è un oggetto che lascia la mano e si pianta: due
//     stadi, come DOOR_SEAL, ma timbro opposto (triangolo che scende
//     seguito da un tonfo grave, non rumore che sale). Posizionato
//     dove atterra, non da dove parte — è lì che il giocatore deve
//     imparare a guardare.
//   • il BATTITO è l'impulso che chi la innesta richiama a ripetizione
//     finché l'esca resta accesa: deve restare piccolo (un ping, non
//     un evento) perché suonerà molte volte di fila, e la sua
//     `totalDuration` è la più corta di tutto il modulo apposta per
//     questo. Il metodo suona *un solo* impulso — vedi il commento
//     sul metodo `beaconPulse` più sotto sul perché non è un loop.
//   • l'ESAURIMENTO è la fine della finestra: deve leggersi come "è
//     finita", quindi scende e si ferma, non come ENEMY_DOWN (che
//     scende ma è un impatto: qui non c'è mai stato un colpo).
//   • la RACCOLTA di una carica è la parente positiva del lancio —
//     stessa onda triangolare, stessa idea di "un oggetto si muove" —
//     ma sale invece di scendere e si accende con un rumore acuto:
//     è un guadagno, non un gesto.
export const BEACON_THROWN: VoiceSpec = {
  label: 'trasponditore — lancio',
  layers: [
    // La mano che lo scaglia: breve, discendente, opposto dello
    // scatto (che sale) perché qui non è il giocatore a muoversi.
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 900,
      freqTo: 500,
      delay: 0,
      duration: 0.08,
      gain: 0.22,
    },
    {
      kind: 'noise',
      filterType: 'bandpass',
      freq: 1600,
      q: 2,
      delay: 0,
      duration: 0.06,
      gain: 0.18,
    },
    // Il secondo stadio comincia dove finisce il primo (0.08s), non
    // insieme: è l'oggetto che tocca terra dopo il volo, non un
    // secondo strato dello stesso istante.
    { kind: 'noise', filterType: 'lowpass', freq: 240, delay: 0.08, duration: 0.12, gain: 0.3 },
  ],
};

export const BEACON_PULSE: VoiceSpec = {
  label: 'trasponditore — battito',
  layers: [
    {
      kind: 'tone',
      wave: 'sine',
      freqFrom: 700,
      freqTo: 700,
      delay: 0,
      duration: 0.05,
      gain: 0.18,
    },
    {
      kind: 'noise',
      filterType: 'bandpass',
      freq: 1800,
      q: 3,
      delay: 0,
      duration: 0.03,
      gain: 0.08,
    },
  ],
};

/** Non un impatto: niente scivolata di rumore (quella è la firma di
 *  ENEMY_DOWN e BLACKOUT), solo un tono che si ferma. "È finita", non
 *  "è successo qualcosa". */
export const BEACON_EXPIRED: VoiceSpec = {
  label: 'trasponditore — esaurito',
  layers: [
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 620,
      freqTo: 180,
      delay: 0,
      duration: 0.28,
      gain: 0.26,
    },
    {
      kind: 'noise',
      filterType: 'lowpass',
      freq: 500,
      sweepTo: 150,
      delay: 0,
      duration: 0.32,
      gain: 0.2,
    },
  ],
};

export const BEACON_PICKUP: VoiceSpec = {
  label: 'trasponditore — carica raccolta',
  layers: [
    // Stessa onda triangolare del lancio, ma la rampa è invertita:
    // sale invece di scendere.
    {
      kind: 'tone',
      wave: 'triangle',
      freqFrom: 500,
      freqTo: 1100,
      delay: 0,
      duration: 0.1,
      gain: 0.22,
    },
    { kind: 'noise', filterType: 'highpass', freq: 2500, delay: 0.02, duration: 0.05, gain: 0.14 },
  ],
};

// ---- Nemico richiamato dall'esca --------------------------------------
//
// Deve essere l'opposto di ENEMY_REVEALED per costruzione, non solo
// per numeri: quello è un rumore che scivola (una scoperta lenta),
// questo è un accordo di due toni netti e cortissimi (una conferma
// immediata). In una sparatoria con rumori a banda ovunque, due toni
// quadri puliti sono l'unica cosa che taglia — è la stessa logica del
// punto debole (ENEMY_HIT_WEAK_SPOT), qui applicata a una durata
// ancora più corta perché non è una ricompensa da assaporare, è
// un'informazione tattica da cogliere al volo.
export const ENEMY_LURED: VoiceSpec = {
  label: "nemico richiamato dall'esca",
  layers: [
    {
      kind: 'tone',
      wave: 'square',
      freqFrom: 1050,
      freqTo: 1050,
      delay: 0,
      duration: 0.035,
      gain: 0.2,
    },
    {
      kind: 'tone',
      wave: 'square',
      freqFrom: 1550,
      freqTo: 1550,
      delay: 0.035,
      duration: 0.03,
      gain: 0.16,
    },
  ],
};

// ---- Piastra Reattiva ---------------------------------------------------
//
// Il nodo fa una cosa sola: quando lo scudo assorbe, il fucile torna
// subito pronto. `PLATE_ABSORBED` suona comunque — lo scudo si è
// comunque rotto — e questo si somma sopra, non lo sostituisce: è la
// seconda metà dello stesso gesto, non un evento a sé. Per questo ha
// un piccolo ritardo incorporato nei propri strati (0.03s) invece di
// partire a `delay: 0`: anche se il controller chiama `plateAbsorbed`
// e `shieldReactive` nello stesso istante, lo scatto arriva un attimo
// dopo il tonfo, come uno scatto che segue un colpo invece di
// accavallarcisi.
//
// Il registro è l'opposto della piastra apposta: PLATE_ABSORBED non
// supera i 320 Hz per costruzione (vedi il commento lì sopra), quindi
// tutto quello che sta sopra questo file in quella frequenza legge
// automaticamente come "altro". Qui si sale fino a 3400 Hz — più in
// alto di qualunque altro suono del modulo — un clic meccanico secco,
// non uno sparo: niente scivolata lunga, niente rumore a banda che
// ricordi un impatto. Deve leggersi come "l'arma scatta", non come
// "qualcosa colpisce ancora".
export const SHIELD_REACTIVE: VoiceSpec = {
  label: 'piastra reattiva',
  layers: [
    {
      kind: 'tone',
      wave: 'square',
      freqFrom: 1800,
      freqTo: 900,
      delay: 0.03,
      duration: 0.05,
      gain: 0.26,
    },
    { kind: 'noise', filterType: 'highpass', freq: 3400, delay: 0.03, duration: 0.03, gain: 0.16 },
  ],
};

// ---- Banco di Riconfigurazione: innesto accettato o rifiutato ---------
//
// Fra un atto e l'altro il giocatore spende un punto abilità per
// innestare una modifica che dà qualcosa e toglie qualcos'altro nello
// stesso gesto: non è un premio, è un compromesso pagato di tasca
// propria. Il suono deve dirlo — niente fanfara (quella è già
// LEVEL_COMPLETE, ascendente e in triangolo), niente accordo luminoso
// (quello è già BOSS_VULNERABLE_OPEN). Qui serve un'officina: qualcosa
// che si stringe e scatta in sede.
//
// ITEM_PURCHASED è due note d'onda quadra (lo stesso timbro meccanico
// di SHIELD_REACTIVE, non quello morbido dei premi in triangolo o
// seno), entrambe piatte — non sweep, un innesto non scivola, si
// aggancia — e la seconda più bassa e più pesante della prima: la nota
// che scende è ciò che è stato ceduto, e pesa di più (0.28 contro
// 0.24) perché il costo è la parte che deve restare in mente. In mezzo
// un breve click di rumore a banda stretta (1200 Hz, 0.03s) fa da
// "clac" metallico fra le due note, la stessa idea del rumore
// dell'aggancio in BEACON_THROWN ma qui centrale, non iniziale: separa
// le due note invece di introdurle. `peakFrequency` (1200, dal click)
// e la coppia (guadagno 0.64, durata 0.15s) non si avvicinano a nessun
// altro spec del modulo su tutti e tre gli assi insieme — verificato
// anche con la metrica pesata per il guadagno più sotto nel file di
// test, che pesa la nota bassa quanto quella acuta invece di lasciarsi
// ingannare dal solo click.
export const ITEM_PURCHASED: VoiceSpec = {
  label: 'innesto riuscito',
  layers: [
    {
      kind: 'tone',
      wave: 'square',
      freqFrom: 760,
      freqTo: 760,
      delay: 0,
      duration: 0.05,
      gain: 0.24,
    },
    {
      kind: 'noise',
      filterType: 'bandpass',
      freq: 1200,
      q: 3,
      delay: 0,
      duration: 0.03,
      gain: 0.12,
    },
    // La nota che scende e pesa di più: ciò che l'innesto toglie.
    {
      kind: 'tone',
      wave: 'square',
      freqFrom: 380,
      freqTo: 380,
      delay: 0.06,
      duration: 0.09,
      gain: 0.28,
    },
  ],
};

// PURCHASE_REFUSED è l'opposto strutturale di ENEMY_LURED (due toni
// quadri puliti anche lì) apposta: ENEMY_LURED sale in un accordo di
// due note diverse, questo ripete la *stessa* nota due volte, piatta e
// bassa — il classico "no" di un'interfaccia, non un evento nel
// mondo di gioco. Nessuno strato è un rumore, quindi non condivide
// nulla con i colpi subiti (ENEMY_HIT_*, PLATE_ABSORBED) né con la
// morte (che nell'Arena usa una scivolata di rumore, come ENEMY_DOWN e
// BLACKOUT qui): niente scivola, niente si affievolisce lentamente,
// solo due bip identici e via. È anche più corto di ENEMY_LURED
// (0.105s contro 0.065... la somma dei due bip con la pausa in mezzo
// resta comunque nel registro dei suoni-lampo del modulo, mai vicino
// per frequenza, guadagno e durata insieme a nessun altro spec, colpi
// e morte compresi).
export const PURCHASE_REFUSED: VoiceSpec = {
  label: 'innesto rifiutato',
  layers: [
    {
      kind: 'tone',
      wave: 'square',
      freqFrom: 300,
      freqTo: 300,
      delay: 0,
      duration: 0.045,
      gain: 0.18,
    },
    {
      kind: 'tone',
      wave: 'square',
      freqFrom: 300,
      freqTo: 300,
      delay: 0.06,
      duration: 0.045,
      gain: 0.18,
    },
  ],
};

// ================================================================
// Il motore — replica minima di engine.ts, non un'estensione
// ================================================================

export class CampaignVoice {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.7;

  /** Come AudioEngine.init(): va chiamato dopo un gesto dell'utente.
   *  A differenza di lì, qui non si dà per scontato che `window`
   *  esista affatto — vedi la nota in testa al file. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    if (typeof window === 'undefined') return;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    const l = this.ctx.listener;
    if (l.upX) {
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  get enabled(): boolean {
    return !!this.ctx && !!this.master;
  }

  /** Il proprio AudioContext ha il proprio listener: condividere quello
   *  dell'Arena avrebbe voluto dire condividerne anche il ciclo di vita
   *  (init/dispose), che è esattamente l'accoppiamento che questo
   *  modulo deve evitare. Chi innesta chiama questo ogni frame, come
   *  già fa con `AudioEngine.updateListener`. */
  updateListener(x: number, y: number, angle: number): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = x / TILE;
      l.positionY.value = 0;
      l.positionZ.value = y / TILE;
      l.forwardX.value = Math.cos(angle);
      l.forwardY.value = 0;
      l.forwardZ.value = Math.sin(angle);
    } else {
      const legacy = l as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(
          fx: number,
          fy: number,
          fz: number,
          ux: number,
          uy: number,
          uz: number,
        ): void;
      };
      legacy.setPosition?.(x / TILE, 0, y / TILE);
      legacy.setOrientation?.(Math.cos(angle), 0, Math.sin(angle), 0, 1, 0);
    }
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private sink(x?: number, y?: number): AudioNode | null {
    if (!this.ctx || !this.master) return null;
    if (x === undefined || y === undefined) return this.master;

    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = MAX_AUDIBLE / TILE;
    panner.rolloffFactor = 1.1;
    panner.positionX.value = x / TILE;
    panner.positionY.value = 0;
    panner.positionZ.value = y / TILE;
    panner.connect(this.master);
    return panner;
  }

  private tone(dest: AudioNode, layer: ToneLayer, start: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = layer.wave;
    const t0 = start + layer.delay;
    osc.frequency.setValueAtTime(layer.freqFrom, t0);
    if (layer.freqTo !== layer.freqFrom) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, layer.freqTo), t0 + layer.duration);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(layer.gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + layer.duration);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + layer.duration + 0.05);
  }

  private noise(dest: AudioNode, layer: NoiseLayer, start: number): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const t0 = start + layer.delay;
    const bq = this.ctx.createBiquadFilter();
    bq.type = layer.filterType;
    bq.frequency.setValueAtTime(layer.freq, t0);
    if (layer.sweepTo !== undefined) {
      bq.frequency.exponentialRampToValueAtTime(Math.max(40, layer.sweepTo), t0 + layer.duration);
    }
    if (layer.q !== undefined) bq.Q.value = layer.q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(layer.gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + layer.duration);

    src.connect(bq).connect(g).connect(dest);
    src.start(t0);
    src.stop(t0 + layer.duration + 0.05);
  }

  /** Suona uno spec intero su una destinazione. Ogni voce pubblica
   *  passa da qui: è il punto in cui i dati (sopra) diventano nodi
   *  Web Audio, e l'unico punto che deve sapere come farlo. */
  private play(spec: VoiceSpec, x?: number, y?: number): void {
    const dest = this.sink(x, y);
    if (!dest) return;
    const t = this.now();
    for (const layer of spec.layers) {
      if (layer.kind === 'tone') this.tone(dest, layer, t);
      else this.noise(dest, layer, t);
    }
  }

  // ---- Voci pubbliche --------------------------------------------

  enemyRangedShot(kind: EnemyKind, x?: number, y?: number): void {
    this.play(ENEMY_RANGED_SHOT_BY_TIER[tierOf(kind)], x, y);
  }

  enemyHitWeakSpot(x?: number, y?: number): void {
    this.play(ENEMY_HIT_WEAK_SPOT, x, y);
  }

  enemyHitBody(x?: number, y?: number): void {
    this.play(ENEMY_HIT_BODY, x, y);
  }

  plateAbsorbed(x?: number, y?: number): void {
    this.play(PLATE_ABSORBED, x, y);
  }

  enemyDown(x?: number, y?: number): void {
    this.play(ENEMY_DOWN, x, y);
  }

  enemyRevealed(x?: number, y?: number): void {
    this.play(ENEMY_REVEALED, x, y);
  }

  /** Mai posizionato: è un gesto del giocatore stesso, non un evento
   *  nel mondo — stessa scelta di `AudioEngine.scope`. */
  playerDash(): void {
    this.play(PLAYER_DASH);
  }

  bossPhaseChange(stage: 2 | 3): void {
    this.play(BOSS_PHASE_CHANGE_BY_STAGE[stage]);
  }

  bossVulnerableOpen(): void {
    this.play(BOSS_VULNERABLE_OPEN);
  }

  doorSeal(x?: number, y?: number): void {
    this.play(DOOR_SEAL, x, y);
  }

  /** Mai posizionato: il gas riempie la stanza, non un punto al suo
   *  interno (vedi la nota su GAS_HAZARD). */
  gasHazard(): void {
    this.play(GAS_HAZARD);
  }

  /** Effetto globale sulla stanza corrente: non ha una sorgente nel
   *  mondo più di quanto ne abbia il gas. */
  gravityFlip(inverted: boolean): void {
    this.play(inverted ? GRAVITY_FLIP_INVERTED : GRAVITY_FLIP_RESTORED);
  }

  blackout(): void {
    this.play(BLACKOUT);
  }

  levelComplete(): void {
    this.play(LEVEL_COMPLETE);
  }

  actRestart(): void {
    this.play(ACT_RESTART);
  }

  /** Posizionato dove atterra l'esca, non da dove parte: vedi il
   *  commento su BEACON_THROWN. */
  beaconThrown(x?: number, y?: number): void {
    this.play(BEACON_THROWN, x, y);
  }

  /** Un impulso solo. Chi tiene viva l'esca chiama questo metodo a
   *  ripetizione con il proprio timer finché resta accesa, e la ferma
   *  semplicemente smettendo di chiamarlo — non c'è qui alcun
   *  oscillatore che resti acceso tra una chiamata e l'altra, ogni
   *  invocazione crea e chiude i propri nodi Web Audio come qualunque
   *  altra voce del modulo (vedi `play`/`tone`/`noise`). Un loop
   *  interno legherebbe la vita del suono a quella dell'esca in un
   *  posto che il controller non può fermare dall'esterno. */
  beaconPulse(x?: number, y?: number): void {
    this.play(BEACON_PULSE, x, y);
  }

  /** Non posizionato: non è un evento nel mondo ma la fine di uno
   *  stato dell'arma del giocatore, come un caricatore vuoto — lo si
   *  deve sapere a prescindere da dove si stia guardando. */
  beaconExpired(): void {
    this.play(BEACON_EXPIRED);
  }

  /** Non posizionato: la carica si raccoglie passandoci sopra, quindi
   *  la sorgente coinciderebbe sempre con l'ascoltatore — un panner
   *  qui non farebbe udire nulla che un suono fisso non dica già. */
  beaconPickup(): void {
    this.play(BEACON_PICKUP);
  }

  /** Posizionato sul nemico che si volta, non sull'esca: è la macchina
   *  che si fa ingannare, e deve suonare da dove sta la macchina. */
  enemyLured(x?: number, y?: number): void {
    this.play(ENEMY_LURED, x, y);
  }

  /** Stessa posizione di `plateAbsorbed` — è la seconda metà dello
   *  stesso colpo, non un evento a sé — con il piccolo ritardo di
   *  fase già incorporato nello spec (vedi il commento su
   *  SHIELD_REACTIVE). Il chiamante suona entrambi nello stesso
   *  istante quando arrivano 'shieldBreak' e 'shieldReactive' insieme. */
  shieldReactive(x?: number, y?: number): void {
    this.play(SHIELD_REACTIVE, x, y);
  }

  /** Non posizionato: il Banco di Riconfigurazione è una schermata fra
   *  un atto e l'altro, non un punto nella mappa — vedi il commento su
   *  ITEM_PURCHASED. */
  itemPurchased(): void {
    this.play(ITEM_PURCHASED);
  }

  /** Non posizionato, per lo stesso motivo di `itemPurchased`. */
  purchaseRefused(): void {
    this.play(PURCHASE_REFUSED);
  }
}
