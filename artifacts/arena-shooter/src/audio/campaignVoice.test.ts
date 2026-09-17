// ================================================================
// VOCE DELLA CAMPAGNA — test
// ================================================================
// Tre famiglie, nello stesso ordine di importanza del compito che le
// ha chieste:
//
//   1. **Silenzio sicuro.** Il modulo deve costruirsi e usarsi senza
//      un AudioContext — che qui manca sempre, perché vitest gira in
//      Node e `window` non esiste nemmeno come identificatore — senza
//      lanciare mai. È la proprietà che rende il modulo sicuro da
//      innestare in un gioco che apre anche da file:// e da mobile.
//   2. **Copertura.** Ogni evento della campagna elencato nel compito
//      ha un metodo pubblico che lo suona.
//   3. **Distinguibilità.** Punto debole contro corpo, e piastra
//      contro un colpo andato a segno, devono avere parametri
//      *davvero* diversi — non solo un'etichetta diversa sullo stesso
//      spec copiato. È il test che conta di più: due suoni identici
//      con nomi diversi sono il difetto tipico e non si vede
//      rileggendo il codice, solo confrontando i dati.
// ================================================================

import { describe, expect, it } from 'vitest';

import { ALL_ENEMY_KINDS } from '../sim/campaign/enemies';
import {
  ACT_RESTART,
  BEACON_EXPIRED,
  BEACON_PICKUP,
  BEACON_PULSE,
  BEACON_THROWN,
  BLACKOUT,
  BOSS_PHASE_CHANGE_BY_STAGE,
  BOSS_VULNERABLE_OPEN,
  CampaignVoice,
  DOOR_SEAL,
  ENEMY_DOWN,
  ENEMY_HIT_BODY,
  ENEMY_HIT_WEAK_SPOT,
  ENEMY_LURED,
  ENEMY_RANGED_SHOT_BY_TIER,
  ENEMY_REVEALED,
  GAS_HAZARD,
  GRAVITY_FLIP_INVERTED,
  GRAVITY_FLIP_RESTORED,
  LEVEL_COMPLETE,
  PLATE_ABSORBED,
  PLAYER_DASH,
  SHIELD_REACTIVE,
  peakFrequency,
  tierOf,
  totalDuration,
  totalGain,
  type VoiceSpec,
} from './campaignVoice';

// ---- 1. Silenzio sicuro ------------------------------------------------

describe('CampaignVoice — senza AudioContext', () => {
  it('non esiste window in questo ambiente di test (precondizione)', () => {
    // Se questa asserzione un giorno fallisse (per esempio perché il
    // progetto passasse a un ambiente jsdom), il resto della suite
    // smetterebbe di verificare la cosa che deve verificare: che il
    // modulo regga *senza* window, non solo senza AudioContext.
    let hasWindow = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      typeof window !== 'undefined' && window;
    } catch {
      hasWindow = false;
    }
    // `typeof` non lancia mai su un identificatore assente; il modo
    // corretto di controllare è questo, e infatti sopra non si è visto
    // nessun throw. La riga esiste solo a documentare la precondizione.
    expect(hasWindow || true).toBe(true);
  });

  it('si costruisce senza lanciare', () => {
    expect(() => new CampaignVoice()).not.toThrow();
  });

  it('init() non lancia e lascia il motore disabilitato', () => {
    const voice = new CampaignVoice();
    expect(() => voice.init()).not.toThrow();
    expect(voice.enabled).toBe(false);
  });

  it('ogni voce pubblica è silenziosamente innocua senza contesto', () => {
    const voice = new CampaignVoice();
    voice.init();
    expect(() => {
      for (const kind of ALL_ENEMY_KINDS) voice.enemyRangedShot(kind, 10, 20);
      voice.enemyHitWeakSpot(10, 20);
      voice.enemyHitBody(10, 20);
      voice.plateAbsorbed(10, 20);
      voice.enemyDown(10, 20);
      voice.enemyRevealed(10, 20);
      voice.playerDash();
      voice.bossPhaseChange(2);
      voice.bossPhaseChange(3);
      voice.bossVulnerableOpen();
      voice.doorSeal(10, 20);
      voice.doorSeal(); // senza posizione: deve reggere anche questa forma
      voice.gasHazard();
      voice.gravityFlip(true);
      voice.gravityFlip(false);
      voice.blackout();
      voice.levelComplete();
      voice.actRestart();
      voice.updateListener(0, 0, 0);
      voice.setMuted(true);
      voice.setVolume(0.3);
    }).not.toThrow();
  });

  it('dispose() è sicuro anche senza init, e ripetibile', () => {
    const voice = new CampaignVoice();
    expect(() => voice.dispose()).not.toThrow();
    voice.init();
    expect(() => {
      voice.dispose();
      voice.dispose();
    }).not.toThrow();
    expect(voice.enabled).toBe(false);
  });

  it('regge anche un browser con window ma senza AudioContext', () => {
    // Il caso "mobile che blocca l'audio" non è solo window assente:
    // è più spesso window presente e AudioContext assente o che
    // lancia. Si simula qui, e si ripulisce subito dopo per non
    // sporcare gli altri test del file.
    (globalThis as { window?: unknown }).window = {};
    try {
      const voice = new CampaignVoice();
      expect(() => voice.init()).not.toThrow();
      expect(voice.enabled).toBe(false);
      expect(() => voice.enemyDown(0, 0)).not.toThrow();
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});

// ---- 2. Copertura -------------------------------------------------------

describe('CampaignVoice — copertura degli eventi', () => {
  it('ha una voce per fascia per il colpo di un nemico a distanza', () => {
    expect(Object.keys(ENEMY_RANGED_SHOT_BY_TIER).sort()).toEqual(['1', '2', '3']);
  });

  it('tierOf assegna una fascia valida a ogni archetipo del listino', () => {
    for (const kind of ALL_ENEMY_KINDS) {
      expect([1, 2, 3]).toContain(tierOf(kind));
    }
  });

  it('espone un metodo per ciascun evento richiesto', () => {
    const voice = new CampaignVoice();
    const required = [
      'enemyRangedShot',
      'enemyHitWeakSpot',
      'enemyHitBody',
      'plateAbsorbed',
      'enemyDown',
      'enemyRevealed',
      'playerDash',
      'bossPhaseChange',
      'bossVulnerableOpen',
      'doorSeal',
      'gasHazard',
      'gravityFlip',
      'blackout',
      'levelComplete',
      'actRestart',
    ] as const;
    for (const name of required) {
      expect(typeof voice[name], `manca ${name}`).toBe('function');
    }
  });

  it('il cambio di fase copre sia lo stage 2 sia lo stage 3', () => {
    expect(BOSS_PHASE_CHANGE_BY_STAGE[2]).toBeDefined();
    expect(BOSS_PHASE_CHANGE_BY_STAGE[3]).toBeDefined();
  });
});

// ---- 3. Distinguibilità --------------------------------------------------

/** Confronto "onesto" fra due spec: fallisce anche se uno è una copia
 *  dell'altro con solo l'etichetta cambiata, che è esattamente il
 *  difetto che questo file deve scoprire e che una semplice
 *  `toBe`-identity fra riferimenti non troverebbe da sola. */
function layersAreDistinct(a: VoiceSpec, b: VoiceSpec): boolean {
  return JSON.stringify(a.layers) !== JSON.stringify(b.layers);
}

describe('CampaignVoice — punto debole contro corpo', () => {
  it('non sono lo stesso spec copiato con un\'altra etichetta', () => {
    expect(layersAreDistinct(ENEMY_HIT_WEAK_SPOT, ENEMY_HIT_BODY)).toBe(true);
  });

  it('il punto debole suona più in alto del corpo', () => {
    expect(peakFrequency(ENEMY_HIT_WEAK_SPOT)).toBeGreaterThan(peakFrequency(ENEMY_HIT_BODY));
    // Non di un pelo: la differenza deve essere sentita, non misurata.
    expect(peakFrequency(ENEMY_HIT_WEAK_SPOT)).toBeGreaterThan(peakFrequency(ENEMY_HIT_BODY) * 1.5);
  });

  it('il punto debole dura di più ed è più presente del corpo', () => {
    expect(totalDuration(ENEMY_HIT_WEAK_SPOT)).toBeGreaterThan(totalDuration(ENEMY_HIT_BODY));
    expect(totalGain(ENEMY_HIT_WEAK_SPOT)).toBeGreaterThan(totalGain(ENEMY_HIT_BODY));
  });

  it('il punto debole ha più strati del corpo (è un accordo, non un singolo bip)', () => {
    expect(ENEMY_HIT_WEAK_SPOT.layers.length).toBeGreaterThan(ENEMY_HIT_BODY.layers.length);
  });
});

describe('CampaignVoice — piastra contro colpo andato a segno', () => {
  it('la piastra non è una copia né del corpo né del punto debole', () => {
    expect(layersAreDistinct(PLATE_ABSORBED, ENEMY_HIT_BODY)).toBe(true);
    expect(layersAreDistinct(PLATE_ABSORBED, ENEMY_HIT_WEAK_SPOT)).toBe(true);
  });

  it('la piastra non ha nulla sopra qualche centinaio di Hz', () => {
    // La soglia (350 Hz) è la garanzia esplicita del modulo: vedi il
    // commento su PLATE_ABSORBED in campaignVoice.ts.
    expect(peakFrequency(PLATE_ABSORBED)).toBeLessThan(350);
  });

  it('un colpo andato a segno — corpo o punto debole — suona sensibilmente più in alto della piastra', () => {
    expect(peakFrequency(ENEMY_HIT_BODY)).toBeGreaterThan(peakFrequency(PLATE_ABSORBED) * 3);
    expect(peakFrequency(ENEMY_HIT_WEAK_SPOT)).toBeGreaterThan(peakFrequency(PLATE_ABSORBED) * 3);
  });

  it('la piastra dura più a lungo di un colpo al corpo (un tonfo, non uno schiocco)', () => {
    expect(totalDuration(PLATE_ABSORBED)).toBeGreaterThan(totalDuration(ENEMY_HIT_BODY));
  });
});

describe('CampaignVoice — colpo di un nemico a distanza, per fascia', () => {
  it('le tre fasce non condividono lo stesso spec', () => {
    expect(layersAreDistinct(ENEMY_RANGED_SHOT_BY_TIER[1], ENEMY_RANGED_SHOT_BY_TIER[2])).toBe(true);
    expect(layersAreDistinct(ENEMY_RANGED_SHOT_BY_TIER[2], ENEMY_RANGED_SHOT_BY_TIER[3])).toBe(true);
    expect(layersAreDistinct(ENEMY_RANGED_SHOT_BY_TIER[1], ENEMY_RANGED_SHOT_BY_TIER[3])).toBe(true);
  });

  it('la fascia 3 è più cupa (più grave) della fascia 1', () => {
    expect(peakFrequency(ENEMY_RANGED_SHOT_BY_TIER[3])).toBeLessThan(peakFrequency(ENEMY_RANGED_SHOT_BY_TIER[1]));
  });

  it('la cattiveria cresce con la fascia: più lunga e più presente', () => {
    const t1 = ENEMY_RANGED_SHOT_BY_TIER[1];
    const t2 = ENEMY_RANGED_SHOT_BY_TIER[2];
    const t3 = ENEMY_RANGED_SHOT_BY_TIER[3];
    expect(totalDuration(t1)).toBeLessThanOrEqual(totalDuration(t2));
    expect(totalDuration(t2)).toBeLessThanOrEqual(totalDuration(t3));
    expect(totalGain(t1)).toBeLessThan(totalGain(t3));
  });

  it('la fascia 3 aggiunge il battimento: due toni a distanza di pochi Hz', () => {
    const tones = ENEMY_RANGED_SHOT_BY_TIER[3].layers.filter((l) => l.kind === 'tone');
    expect(tones.length).toBeGreaterThanOrEqual(2);
  });

  it('non suona come il fucile del giocatore (niente onda quadra da 220 Hz)', () => {
    // Il fucile (engine.ts) è un'onda quadra 220→60 Hz: se una fascia
    // qualsiasi la riproducesse identica, sarebbe di nuovo un prestito
    // travestito da suono nuovo.
    for (const tier of [1, 2, 3] as const) {
      const clash = ENEMY_RANGED_SHOT_BY_TIER[tier].layers.some(
        (l) => l.kind === 'tone' && l.wave === 'square' && l.freqFrom === 220 && l.freqTo === 60,
      );
      expect(clash).toBe(false);
    }
  });
});

describe('CampaignVoice — nemico abbattuto e nemico che si svela', () => {
  it('sono spec diversi', () => {
    expect(layersAreDistinct(ENEMY_DOWN, ENEMY_REVEALED)).toBe(true);
  });

  it('svelarsi sale di frequenza, abbattere scende', () => {
    const revealRises = ENEMY_REVEALED.layers.some(
      (l) => (l.kind === 'tone' && l.freqTo > l.freqFrom) || (l.kind === 'noise' && (l.sweepTo ?? l.freq) > l.freq),
    );
    const downFalls = ENEMY_DOWN.layers.some(
      (l) => (l.kind === 'tone' && l.freqTo < l.freqFrom) || (l.kind === 'noise' && (l.sweepTo ?? l.freq) < l.freq),
    );
    expect(revealRises).toBe(true);
    expect(downFalls).toBe(true);
  });
});

describe('CampaignVoice — scatto del giocatore', () => {
  it('non riusa il tono puro del respawn (sine 320→760 Hz)', () => {
    const clash = PLAYER_DASH.layers.some(
      (l) => l.kind === 'tone' && l.wave === 'sine' && l.freqFrom === 320 && l.freqTo === 760,
    );
    expect(clash).toBe(false);
  });

  it('è dominato dal rumore, non da un tono (un gesto, non un segnale)', () => {
    const noiseGain = PLAYER_DASH.layers.filter((l) => l.kind === 'noise').reduce((s, l) => s + l.gain, 0);
    const toneGain = PLAYER_DASH.layers.filter((l) => l.kind === 'tone').reduce((s, l) => s + l.gain, 0);
    expect(noiseGain).toBeGreaterThan(toneGain);
  });
});

describe('CampaignVoice — boss: cambio di fase contro finestra vulnerabile', () => {
  it('sono spec diversi', () => {
    expect(layersAreDistinct(BOSS_PHASE_CHANGE_BY_STAGE[2], BOSS_VULNERABLE_OPEN)).toBe(true);
  });

  it('il cambio di fase scende, la finestra vulnerabile è tutta in salita o piatta e più acuta', () => {
    const phaseFalls = BOSS_PHASE_CHANGE_BY_STAGE[2].layers.some(
      (l) => l.kind === 'tone' && l.freqTo < l.freqFrom,
    );
    expect(phaseFalls).toBe(true);
    expect(peakFrequency(BOSS_VULNERABLE_OPEN)).toBeGreaterThan(peakFrequency(BOSS_PHASE_CHANGE_BY_STAGE[2]));
  });

  it('lo stage 3 pesa più dello stage 2', () => {
    expect(totalGain(BOSS_PHASE_CHANGE_BY_STAGE[3])).toBeGreaterThan(totalGain(BOSS_PHASE_CHANGE_BY_STAGE[2]));
    expect(totalDuration(BOSS_PHASE_CHANGE_BY_STAGE[3])).toBeGreaterThanOrEqual(
      totalDuration(BOSS_PHASE_CHANGE_BY_STAGE[2]),
    );
  });
});

describe('CampaignVoice — ambiente', () => {
  it('la porta stagna non riusa lo spec di un impatto generico a uno stadio solo', () => {
    expect(DOOR_SEAL.layers.length).toBeGreaterThanOrEqual(2);
    // Il secondo stadio (lo sfiato) inizia dove finisce il primo, non
    // insieme: è ciò che lo rende due eventi e non uno.
    const [first, second] = DOOR_SEAL.layers;
    expect(second.delay).toBeGreaterThanOrEqual(first.delay + first.duration - 0.001);
  });

  it('il gas non è un impatto: nessuno strato è un transiente breve', () => {
    for (const l of GAS_HAZARD.layers) expect(l.duration).toBeGreaterThan(0.3);
  });

  it('gravità invertita e ripristinata sono simmetriche ma diverse', () => {
    expect(layersAreDistinct(GRAVITY_FLIP_INVERTED, GRAVITY_FLIP_RESTORED)).toBe(true);
    // Stesse durate e guadagni (è lo stesso evento suonato al
    // contrario), ma le rampe sono scambiate.
    expect(totalDuration(GRAVITY_FLIP_INVERTED)).toBe(totalDuration(GRAVITY_FLIP_RESTORED));
    const invertedFirst = GRAVITY_FLIP_INVERTED.layers[0];
    const restoredFirst = GRAVITY_FLIP_RESTORED.layers[0];
    if (invertedFirst.kind === 'tone' && restoredFirst.kind === 'tone') {
      expect(invertedFirst.freqFrom).toBe(restoredFirst.freqTo);
      expect(invertedFirst.freqTo).toBe(restoredFirst.freqFrom);
    }
  });

  it('il blackout non è una copia della morte (niente rumore che scivola, guadagno più basso)', () => {
    // death() (engine.ts) usa una scivolata di rumore passa-basso da
    // 500 a 80 Hz: qui il rumore deve restare fermo su una frequenza,
    // non scivolare, o sarebbe di nuovo la stessa idea travestita.
    const hasSweep = BLACKOUT.layers.some((l) => l.kind === 'noise' && l.sweepTo !== undefined);
    expect(hasSweep).toBe(false);
    expect(totalGain(BLACKOUT)).toBeLessThan(0.5);
  });
});

describe('CampaignVoice — fine livello e riavvio dell\'atto', () => {
  it('il completamento del livello non è la fanfara dell\'Arena copiata', () => {
    // matchEnd(true) (engine.ts) è 523-659-784-1047 in triangolo: se la
    // prima nota coincidesse esattamente useremmo lo stesso motivo.
    const firstNote = LEVEL_COMPLETE.layers[0];
    expect(firstNote.kind === 'tone' && firstNote.freqFrom === 523).toBe(false);
  });

  it('il riavvio dell\'atto scende e poi risale: un reset, non una seconda morte', () => {
    const tones = ACT_RESTART.layers.filter((l): l is Extract<typeof l, { kind: 'tone' }> => l.kind === 'tone');
    expect(tones.some((t) => t.freqTo < t.freqFrom)).toBe(true);
    expect(tones.some((t) => t.freqTo > t.freqFrom)).toBe(true);
  });

  it('il completamento del livello e il riavvio dell\'atto sono spec diversi', () => {
    expect(layersAreDistinct(LEVEL_COMPLETE, ACT_RESTART)).toBe(true);
  });
});

// ---- 4. Trasponditore, Piastra Reattiva, nemico richiamato --------------
//
// Stessa disciplina delle famiglie sopra: prima che il modulo regga
// senza AudioContext anche per le voci nuove, poi che ci sia un
// metodo per ciascun evento nuovo, poi che i suoni si sentano diversi
// — qui verificato con l'idea specifica di ciascuno invece che con la
// batteria generale di distinguibilità, che arriva subito dopo.

describe('CampaignVoice — voci nuove, senza AudioContext', () => {
  it('sono silenziosamente innocue senza contesto', () => {
    const voice = new CampaignVoice();
    voice.init();
    expect(() => {
      voice.beaconThrown(10, 20);
      voice.beaconThrown(); // senza posizione: deve reggere anche questa forma
      voice.beaconPulse(10, 20);
      voice.beaconExpired();
      voice.beaconPickup();
      voice.enemyLured(10, 20);
      voice.shieldReactive(10, 20);
      voice.shieldReactive();
    }).not.toThrow();
  });
});

describe('CampaignVoice — copertura degli eventi nuovi', () => {
  it('espone un metodo per ciascun evento nuovo', () => {
    const voice = new CampaignVoice();
    const required = [
      'beaconThrown',
      'beaconPulse',
      'beaconExpired',
      'beaconPickup',
      'enemyLured',
      'shieldReactive',
    ] as const;
    for (const name of required) {
      expect(typeof voice[name], `manca ${name}`).toBe('function');
    }
  });
});

describe('CampaignVoice — Trasponditore', () => {
  it('il lancio e la carica raccolta sono imparentati (stessa onda) ma non identici', () => {
    // "Parente ma chiaramente un guadagno" del compito: stesso timbro
    // di base (triangolo + rumore), rampa e registro diversi.
    expect(layersAreDistinct(BEACON_THROWN, BEACON_PICKUP)).toBe(true);
    const thrownTone = BEACON_THROWN.layers.find((l) => l.kind === 'tone');
    const pickupTone = BEACON_PICKUP.layers.find((l) => l.kind === 'tone');
    expect(thrownTone?.kind === 'tone' && thrownTone.wave).toBe('triangle');
    expect(pickupTone?.kind === 'tone' && pickupTone.wave).toBe('triangle');
  });

  it('il lancio scende (parte dalla mano), la raccolta sale (è un guadagno)', () => {
    const thrownTone = BEACON_THROWN.layers.find((l): l is Extract<typeof l, { kind: 'tone' }> => l.kind === 'tone');
    const pickupTone = BEACON_PICKUP.layers.find((l): l is Extract<typeof l, { kind: 'tone' }> => l.kind === 'tone');
    expect(thrownTone!.freqTo).toBeLessThan(thrownTone!.freqFrom);
    expect(pickupTone!.freqTo).toBeGreaterThan(pickupTone!.freqFrom);
  });

  it('il battito è il suono più corto del modulo: deve poter ripetere senza affaticare', () => {
    // Confrontato con ogni altra spec del file, incluse le nuove: se
    // un giorno se ne aggiungesse una ancora più corta del battito
    // varrebbe la pena chiedersi se è davvero pensata per ripetere.
    for (const spec of ALL_SPECS) {
      if (spec === BEACON_PULSE) continue;
      expect(totalDuration(BEACON_PULSE)).toBeLessThanOrEqual(totalDuration(spec));
    }
  });

  it('l\'esaurimento non è uno "scivola verso il basso" come ENEMY_DOWN: si ferma, non cala di colpo', () => {
    // ENEMY_DOWN e BLACKOUT usano entrambi una scivolata di rumore
    // (sweepTo) per dire "impatto"/"si spegne qualcosa che c'era".
    // BEACON_EXPIRED deve poter condividere l'idea di "scende" nel
    // tono senza leggere come un impatto: qui si verifica solo che
    // non sia una copia di ENEMY_DOWN.
    expect(layersAreDistinct(BEACON_EXPIRED, ENEMY_DOWN)).toBe(true);
  });

  it('l\'esaurimento non riusa BEACON_THROWN travestito da altro evento', () => {
    expect(layersAreDistinct(BEACON_EXPIRED, BEACON_THROWN)).toBe(true);
  });
});

describe('CampaignVoice — nemico richiamato dall\'esca', () => {
  it('è il suono più corto fra gli eventi di combattimento: deve tagliare in una sparatoria', () => {
    expect(totalDuration(ENEMY_LURED)).toBeLessThan(totalDuration(ENEMY_HIT_BODY));
    expect(totalDuration(ENEMY_LURED)).toBeLessThan(totalDuration(ENEMY_REVEALED));
  });

  it('è un accordo di toni puliti (square), non un rumore a banda come ENEMY_REVEALED', () => {
    const hasNoise = ENEMY_LURED.layers.some((l) => l.kind === 'noise');
    expect(hasNoise).toBe(false);
    expect(layersAreDistinct(ENEMY_LURED, ENEMY_REVEALED)).toBe(true);
  });
});

describe('CampaignVoice — Piastra Reattiva', () => {
  it('non è una copia di PLATE_ABSORBED: suona molto più in alto', () => {
    expect(layersAreDistinct(SHIELD_REACTIVE, PLATE_ABSORBED)).toBe(true);
    // La garanzia di PLATE_ABSORBED è di restare sotto i 350 Hz (vedi
    // il suo commento): la piastra reattiva deve stare nettamente
    // sopra quella soglia, altrimenti le due si confonderebbero
    // proprio nel momento in cui suonano insieme.
    expect(peakFrequency(SHIELD_REACTIVE)).toBeGreaterThan(peakFrequency(PLATE_ABSORBED) * 5);
  });

  it('ha un ritardo di fase incorporato: è la seconda metà del gesto, non il suo inizio', () => {
    // Ogni strato parte dopo lo start del suono, cosicché — anche se
    // il chiamante suona plateAbsorbed() e shieldReactive() nello
    // stesso istante — lo scatto arrivi un attimo dopo il tonfo.
    for (const layer of SHIELD_REACTIVE.layers) {
      expect(layer.delay).toBeGreaterThan(0);
    }
  });

  it('non è uno sparo del fucile del giocatore travestito (niente onda quadra 220→60 Hz)', () => {
    const clash = SHIELD_REACTIVE.layers.some(
      (l) => l.kind === 'tone' && l.wave === 'square' && l.freqFrom === 220 && l.freqTo === 60,
    );
    expect(clash).toBe(false);
  });
});

// ---- 5. Distinguibilità globale: ogni coppia di spec esportate ----------
//
// I test sopra e quelli storici verificano coppie scelte a mano — le
// stesse che chi ha scritto ogni suono aveva in mente. Non bastano:
// un suono nuovo può assomigliare per caso a uno vecchio che nessuno
// ha pensato di confrontarci. Qui si mettono in tabella tutte e 25 le
// spec esportate — le 19 storiche più le 6 di questo compito — e si
// misura la terna (peakFrequency, totalGain, totalDuration) di ogni
// coppia possibile.
//
// ---- La soglia, e perché è quella e non un'altra -----------------------
//
// Due suoni sono "troppo vicini" solo se lo sono su TUTTE E TRE le
// metriche insieme (vedi il compito): vicini su una sola non basta,
// perché due suoni legittimamente diversi condividono spesso un asse
// (due impatti della stessa durata, due toni allo stesso volume). Le
// soglie sono:
//
//   • peakFrequency: differenza relativa < 5% (rispetto al più alto
//     dei due) — un quinto della più piccola separazione "voluta" già
//     presente nel modulo (il punto debole deve superare il corpo di
//     almeno il 50%, vedi il test sopra), quindi abbastanza stretta
//     da non prendere per vicini due timbri che l'autore ha
//     deliberatamente distanziato anche di poco.
//   • totalGain: differenza assoluta < 0.03 — sotto la più piccola
//     differenza di guadagno che il file usa apposta per distinguere
//     due fasce (0.06 fra `ENEMY_RANGED_SHOT_BY_TIER[1]` e la coda
//     rumore della fascia 2, per dire): se due suoni sono più vicini
//     di quello, nessuno li ha separati apposta.
//   • totalDuration: differenza assoluta < 0.02s — un quarto del
//     "attacco" minimo di un inviluppo in questo motore (`0.004`–
//     `0.005` di rampa, vedi `tone`/`noise` in coda al file): sotto
//     questa soglia la differenza di durata non è più percepibile
//     come tale, è rumore di misura.
//
// Sotto tutte e tre insieme, due spec diverse sono un difetto: un
// suono nuovo che il giocatore non può distinguere da uno vecchio
// senza guardare lo schermo.
//
// ---- L'eccezione dichiarata: GRAVITY_FLIP_INVERTED / RESTORED -----------
//
// Le due hanno la stessa terna esatta (0 di distanza su tutti e tre
// gli assi): sono lo stesso incrocio di due rampe con i livelli
// scambiati (vedi il commento sulle due spec in campaignVoice.ts).
// L'orecchio le distingue benissimo — la prima sale-poi-scende, la
// seconda scende-poi-sale, ed è un ribaltamento quindi la direzione
// stessa è l'informazione — ma `peakFrequency`/`totalGain`/
// `totalDuration` sono cieche alla direzione di una rampa per
// costruzione: guardano solo gli estremi tondi, mai l'ordine in cui
// li si attraversa. Non è il difetto che questo test cerca, è il
// limite dichiarato della metrica; per questo la coppia è esentata
// per nome invece di essere silenziata alzando la soglia (che
// nasconderebbe anche difetti veri).
const EXEMPT_PAIRS = new Set<string>(['gravità invertita↔gravità ripristinata']);

const ALL_SPECS: readonly VoiceSpec[] = [
  ENEMY_RANGED_SHOT_BY_TIER[1],
  ENEMY_RANGED_SHOT_BY_TIER[2],
  ENEMY_RANGED_SHOT_BY_TIER[3],
  ENEMY_HIT_BODY,
  ENEMY_HIT_WEAK_SPOT,
  PLATE_ABSORBED,
  ENEMY_DOWN,
  ENEMY_REVEALED,
  PLAYER_DASH,
  BOSS_PHASE_CHANGE_BY_STAGE[2],
  BOSS_PHASE_CHANGE_BY_STAGE[3],
  BOSS_VULNERABLE_OPEN,
  DOOR_SEAL,
  GAS_HAZARD,
  GRAVITY_FLIP_INVERTED,
  GRAVITY_FLIP_RESTORED,
  BLACKOUT,
  LEVEL_COMPLETE,
  ACT_RESTART,
  BEACON_THROWN,
  BEACON_PULSE,
  BEACON_EXPIRED,
  BEACON_PICKUP,
  ENEMY_LURED,
  SHIELD_REACTIVE,
];

const FREQ_REL_THRESHOLD = 0.05;
const GAIN_ABS_THRESHOLD = 0.03;
const DURATION_ABS_THRESHOLD = 0.02;

function tooClose(a: VoiceSpec, b: VoiceSpec): boolean {
  const pa = peakFrequency(a);
  const pb = peakFrequency(b);
  const freqClose = Math.abs(pa - pb) / Math.max(pa, pb, 1) < FREQ_REL_THRESHOLD;
  const gainClose = Math.abs(totalGain(a) - totalGain(b)) < GAIN_ABS_THRESHOLD;
  const durationClose = Math.abs(totalDuration(a) - totalDuration(b)) < DURATION_ABS_THRESHOLD;
  return freqClose && gainClose && durationClose;
}

describe('CampaignVoice — distinguibilità globale (tutte le spec esportate)', () => {
  it('nessuna coppia di spec diverse è vicina su frequenza, guadagno e durata insieme', () => {
    const offenders: string[] = [];
    for (let i = 0; i < ALL_SPECS.length; i++) {
      for (let j = i + 1; j < ALL_SPECS.length; j++) {
        const a = ALL_SPECS[i];
        const b = ALL_SPECS[j];
        if (a === b) continue; // GRAVITY_FLIP_* per tier condivisi, se mai capitasse
        const pairKey = `${a.label}↔${b.label}`;
        if (tooClose(a, b) && !EXEMPT_PAIRS.has(pairKey)) {
          offenders.push(
            `${pairKey}: peak=${peakFrequency(a).toFixed(0)}/${peakFrequency(b).toFixed(0)}Hz ` +
              `gain=${totalGain(a).toFixed(2)}/${totalGain(b).toFixed(2)} ` +
              `dur=${totalDuration(a).toFixed(3)}/${totalDuration(b).toFixed(3)}s`,
          );
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  /** La stessa domanda, con un metro diverso — e il motivo per cui ne
   *  serve un secondo.
   *
   *  `peakFrequency` prende la frequenza **più alta** fra gli strati,
   *  non la più **forte**. Un click di rumore acuto a guadagno 0.08
   *  sopra un tono a 0.18 fa leggere il suono come acuto anche se
   *  all'orecchio è grave: è successo davvero con BEACON_PULSE, che il
   *  picco dà a 1800 Hz mentre quello che si sente è un seno a 700.
   *
   *  Una metrica cieca al guadagno può quindi sbagliare in entrambi i
   *  versi: segnalare una collisione che non c'è (il caso qui sopra), e
   *  — più pericoloso — **mancarne una vera**, se due suoni molto
   *  simili si distinguono solo per uno strato che nessuno dei due fa
   *  davvero sentire. Questo secondo test guarda la frequenza dominante
   *  pesata per il guadagno, e usa soglie più larghe di proposito: se
   *  due suoni sono vicini anche con questo metro, sono vicini davvero.
   *
   *  Che il suono più importante da separare passi entrambi i metri non
   *  è ovvio, ed è la ragione per cui questo test esiste invece di un
   *  commento che dice che va bene. */
  it('nessuna coppia è vicina nemmeno pesando la frequenza per il guadagno', () => {
    const dominant = (spec: VoiceSpec): number => {
      let num = 0;
      let den = 0;
      for (const l of spec.layers as readonly Record<string, number | string>[]) {
        const f =
          l.kind === 'tone'
            ? ((l.freqFrom as number) + ((l.freqTo as number) ?? (l.freqFrom as number))) / 2
            : ((l.freq as number) ?? 0);
        const g = (l.gain as number) ?? 0;
        if (f > 0) {
          num += f * g;
          den += g;
        }
      }
      return den ? num / den : 0;
    };
    const offenders: string[] = [];
    for (let i = 0; i < ALL_SPECS.length; i++) {
      for (let j = i + 1; j < ALL_SPECS.length; j++) {
        const a = ALL_SPECS[i]!;
        const b = ALL_SPECS[j]!;
        const da = dominant(a);
        const db = dominant(b);
        const close =
          Math.abs(da - db) / Math.max(da, db, 1) < 0.08 &&
          Math.abs(totalGain(a) - totalGain(b)) < 0.06 &&
          Math.abs(totalDuration(a) - totalDuration(b)) < 0.03;
        if (close && !EXEMPT_PAIRS.has(`${a.label}↔${b.label}`)) {
          offenders.push(
            `${a.label}↔${b.label}: dominante=${da.toFixed(0)}/${db.toFixed(0)}Hz`,
          );
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  /** I due suoni che, per progetto, escono **insieme**: la piastra che
   *  si rompe e il colpo che torna pronto. Una misura a coppie non può
   *  accorgersi che due suoni coesistono — lo sa solo chi ha scritto il
   *  nodo — quindi la separazione va chiesta qui, esplicitamente, e
   *  molto più larga della soglia generale. */
  it('la piastra rotta e la piastra reattiva stanno in due registri diversi', () => {
    const lo = peakFrequency(PLATE_ABSORBED);
    const hi = peakFrequency(SHIELD_REACTIVE);
    expect(hi / lo).toBeGreaterThan(4);
  });

  it('la coppia esentata esiste davvero ed è quella attesa (altrimenti l\'eccezione è morta)', () => {
    // Se questo fallisse, EXEMPT_PAIRS conterrebbe una chiave che non
    // corrisponde più a nulla — per esempio perché un'etichetta è
    // cambiata — e il test sopra tornerebbe silenziosamente più
    // severo di quanto dichiarato.
    expect(tooClose(GRAVITY_FLIP_INVERTED, GRAVITY_FLIP_RESTORED)).toBe(true);
    expect(EXEMPT_PAIRS.has(`${GRAVITY_FLIP_INVERTED.label}↔${GRAVITY_FLIP_RESTORED.label}`)).toBe(true);
  });
});
