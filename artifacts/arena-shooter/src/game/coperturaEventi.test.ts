// ================================================================
// COPERTURA DI CampaignEvent — ogni type gestito, o escluso a motivo
// ================================================================
// Una revisione ha trovato 7 tipi di CampaignEvent che
// `handleEvents` (campaignGame.ts) non gestiva affatto: beaconThrown,
// beaconExpired, enemyLured, shieldReactive — che avevano già un
// metodo pronto e testato in CampaignVoice e restavano semplicemente
// mai chiamati — e blackoutCleared, gasCleared, bossEnraged, per cui
// non è previsto nessun suono dedicato.
//
// eventiRaccolta.test.ts prova che un `case` non compaia due volte
// nello stesso switch (un ramo morto). Questo file prova l'altra metà
// della stessa classe di difetto: che ogni `type` dell'unione
// CampaignEvent (sim/campaign/types.ts) compaia *almeno* una volta —
// o, se manca di proposito, sia dichiarato in ESCLUSIONI_VOLUTE qui
// sotto con un motivo. Senza questa guardia un evento nuovo aggiunto
// alla sim può restare silenziosamente ignorato dal controller per
// sempre: compila, i test della sim restano verdi (provano solo che
// l'evento *esiste*, non che qualcuno lo ascolti), e solo un playtest
// se ne accorge — esattamente come è successo qui.
//
// Stesso approccio di eventiRaccolta.test.ts e comandi.test.ts: si
// legge il sorgente da disco invece di importare campaignGame.ts, che
// usa `canvas`/`document` e non è istanziabile in una suite senza
// jsdom.
// ================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const CAMPAIGN_GAME = path.resolve(process.cwd(), 'src/game/campaignGame.ts');
const CAMPAIGN_TYPES = path.resolve(process.cwd(), 'src/sim/campaign/types.ts');

/** Tipi di CampaignEvent che `handleEvents` non gestisce di proposito,
 *  ciascuno con il motivo. Se domani uno di questi guadagnasse un
 *  `case` vero, non è un errore — è solo che la voce qui sotto va
 *  tolta insieme al motivo che non vale più. */
const ESCLUSIONI_VOLUTE: Readonly<Record<string, string>> = {
  itemPurchased:
    "azione di menu, non evento di un tick giocato: il riscontro arriva dal valore " +
    "di ritorno di tryPurchase (vedi il commento in handleEvents e " +
    'sim/campaign/acquisti.test.ts), non da qui.',
  nodeRefunded:
    'stesso motivo di itemPurchased: azione di menu, riscontro dal valore di ritorno.',
  purchaseRefused:
    'stesso motivo di itemPurchased: azione di menu, riscontro dal valore di ritorno.',
  gasCleared:
    "nessun suono dedicato previsto: a differenza della gravità (GDD.md, sezione " +
    '"Voce audio" — "la gravità suona in entrambi i versi", il ripristino è un ' +
    "cambio di regole tanto quanto l'inversione) non c'è un'analoga intenzione " +
    "scritta per l'uscita dal gas — solo l'ingresso (gasEntered) ha voce.",
  blackoutCleared:
    'stesso motivo di gasCleared: nessuna intenzione scritta per il ripristino, ' +
    'solo blackoutEntered ha voce.',
  bossEnraged:
    "nessun suono dedicato previsto: l'alterazione ha già un segno a schermo (HUD " +
    "e render/campaignScene.ts, colore ed etichetta 'ALTERATO'/'ALTERATA', più una " +
    "battuta di ARBITER in ui/arbiter.ts) e niente nel GDD chiede anche un suono.",
};

/** Estrae il corpo di un blocco delimitato da graffe a partire dalla
 *  prima occorrenza di `marker`, bilanciando le graffe — stesso
 *  principio di corpoCampaignLegendScreen in src/ui/legenda.test.ts. */
function bodyAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`marcatore non trovato: ${marker}`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i);
    }
  }
  throw new Error(`graffa di chiusura non trovata per: ${marker}`);
}

/** Tutti i `type: '...'` dell'unione CampaignEvent, nell'ordine in cui
 *  compaiono. Legge fra "export type CampaignEvent =" e il `;` che la
 *  chiude — trovato per bilanciamento di graffe, non con la prima `;`
 *  incontrata, perché alcune varianti (es. 'purchaseRefused') hanno un
 *  campo `reason` con `;` dentro la propria riga ma non fuori da una
 *  graffa. */
function tipiEvento(): string[] {
  const src = readFileSync(CAMPAIGN_TYPES, 'utf8');
  const marker = 'export type CampaignEvent =';
  const start = src.indexOf(marker);
  expect(start, `"${marker}" non si trova più in ${CAMPAIGN_TYPES}`).toBeGreaterThan(-1);

  let depth = 0;
  let end = -1;
  for (let i = start + marker.length; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ';' && depth === 0) {
      end = i;
      break;
    }
  }
  expect(end, 'fine dell\'unione CampaignEvent non trovata (nessun ";" a profondità 0)').toBeGreaterThan(-1);

  const block = src.slice(start, end);
  const tipi = [...block.matchAll(/\btype:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]!);
  expect(tipi.length, 'nessun type estratto da CampaignEvent: il regex è da aggiornare').toBeGreaterThan(20);
  return tipi;
}

/** Le etichette `case '...'` al primo livello dello switch che inizia
 *  con `switch (ev.type)` in handleEvents — stesso mascheramento a
 *  profondità di eventiRaccolta.test.ts, qui usato per elencare invece
 *  che per contare. */
function caseLabelsInHandleEvents(): Set<string> {
  const src = readFileSync(CAMPAIGN_GAME, 'utf8');
  const body = bodyAfter(src, 'switch (ev.type)');

  let nestedDepth = 0;
  let masked = '';
  for (const ch of body) {
    if (ch === '{') {
      masked += nestedDepth === 0 ? ch : ' ';
      nestedDepth++;
    } else if (ch === '}') {
      nestedDepth--;
      masked += nestedDepth === 0 ? ch : ' ';
    } else {
      masked += nestedDepth === 0 ? ch : ch === '\n' ? '\n' : ' ';
    }
  }

  const labels = new Set<string>();
  for (const m of masked.matchAll(/\bcase\s+'([a-zA-Z]+)'\s*:/g)) labels.add(m[1]!);
  return labels;
}

describe('handleEvents — copertura di CampaignEvent', () => {
  const tipi = tipiEvento();
  const handled = caseLabelsInHandleEvents();

  it('ogni type ha un case in handleEvents, o è in ESCLUSIONI_VOLUTE con un motivo', () => {
    const mancanti = tipi.filter((t) => !handled.has(t) && !(t in ESCLUSIONI_VOLUTE));
    expect(
      mancanti,
      mancanti
        .map((t) => `'${t}' non ha un case in handleEvents e non è in ESCLUSIONI_VOLUTE`)
        .join('\n') || undefined,
    ).toEqual([]);
  });

  it('ogni esclusione ha un motivo scritto, non un segnaposto', () => {
    for (const [tipo, motivo] of Object.entries(ESCLUSIONI_VOLUTE)) {
      expect(motivo.trim().length, `'${tipo}' non ha un motivo vero`).toBeGreaterThan(15);
    }
  });

  it('ogni esclusione corrisponde a un type che esiste davvero (altrimenti è morta)', () => {
    const insieme = new Set(tipi);
    for (const tipo of Object.keys(ESCLUSIONI_VOLUTE)) {
      expect(insieme.has(tipo), `'${tipo}' non è (più) un type di CampaignEvent`).toBe(true);
    }
  });

  it('nessun type compare sia come case sia come esclusione (ambiguo)', () => {
    const doppi = Object.keys(ESCLUSIONI_VOLUTE).filter((t) => handled.has(t));
    expect(doppi, doppi.join(', ')).toEqual([]);
  });

  // I quattro che la revisione chiedeva di collegare a un metodo già
  // pronto in CampaignVoice — non solo "hanno un case", ma il case
  // giusto.
  it.each(['beaconThrown', 'beaconExpired', 'enemyLured', 'shieldReactive'])(
    "'%s' ha un case vero (non un'esclusione)",
    (tipo) => {
      expect(handled.has(tipo), `'${tipo}' dovrebbe avere un case in handleEvents`).toBe(true);
    },
  );
});
