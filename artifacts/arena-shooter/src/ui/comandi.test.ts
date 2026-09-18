// ================================================================
// COMANDI — la legenda non deve restare indietro
// ================================================================
// Questo test esiste per un difetto vero, trovato quando la campagna
// era ormai finita: la legenda dei comandi viveva solo sulle due
// schermate dell'Arena e si era fermata a prima che esistessero lo
// scatto e il Trasponditore. Nessuna delle quattro schermate della
// campagna ne mostrava una, e il tasto dell'esca non era scritto in
// nessun posto che un giocatore potesse leggere. Su telefono non si
// vedeva — ci sono i pulsanti a schermo — ma chi gioca in tastiera
// raccoglieva un'esca al secondo livello senza modo di sapere come
// lanciarla.
//
// Aggiungere un tasto e dimenticare la legenda è un errore che non
// fa rumore: il gioco funziona lo stesso, e solo chi non sa già il
// comando se ne accorge. Da qui una guardia che legge i binding dal
// sorgente del controller invece di fidarsi di una lista scritta due
// volte.
//
// Leggere un file come testo in un test è insolito e qui è la scelta
// giusta: campaignGame.ts non è importabile da questa suite (usa
// `canvas` e `document`, e la suite gira senza jsdom — è lo stesso
// motivo per cui esistono campaignNarrative.ts e campaignShop.ts), e
// le due cose da confrontare vivono per forza in file diversi.
// ================================================================

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CAMPAIGN_CONTROLS } from './CampaignHud';

/** Come si chiama, per il giocatore, ogni tasto che il controller
 *  lega. Un binding nuovo senza una voce qui fa fallire il test — ed
 *  è il momento in cui ci si ricorda anche della legenda. */
const NOME_VISIBILE: Readonly<Record<string, string>> = {
  escape: 'ESC',
  m: 'M',
  shift: 'MAIUSC',
  f: 'F',
};

function bindingsDelController(): string[] {
  const src = readFileSync(new URL('../game/campaignGame.ts', import.meta.url), 'utf8');
  // `if (k === 'x')` dentro il gestore della tastiera.
  const trovati = [...src.matchAll(/\bk === '([a-z]+)'/g)].map((m) => m[1]!);
  return [...new Set(trovati)];
}

describe('legenda dei comandi della campagna', () => {
  const bindings = bindingsDelController();

  it('il controller lega almeno i tasti che ci aspettiamo', () => {
    // Se questo fallisce, l'estrattore qui sopra ha smesso di
    // riconoscere la forma dei binding: va aggiustato lui, non la
    // legenda. Senza questo controllo il test potrebbe diventare
    // verde per il motivo peggiore — non aver trovato niente.
    expect(bindings.length).toBeGreaterThanOrEqual(4);
    expect(bindings).toContain('shift');
    expect(bindings).toContain('f');
  });

  it.each(bindingsDelController())('il tasto "%s" ha un nome visibile dichiarato', (k) => {
    expect(
      NOME_VISIBILE[k],
      `il controller lega "${k}" ma qui non c'è il suo nome: aggiungilo, e aggiungi la riga alla legenda`,
    ).toBeDefined();
  });

  it.each(bindingsDelController())('il tasto "%s" compare nella legenda', (k) => {
    const nome = NOME_VISIBILE[k];
    const chiavi = CAMPAIGN_CONTROLS.map(([c]) => c);
    expect(chiavi, `"${nome}" non è nella legenda della campagna`).toContain(nome);
  });

  it('ogni riga della legenda dice sia il tasto sia cosa fa', () => {
    for (const [tasto, cosa] of CAMPAIGN_CONTROLS) {
      expect(tasto.trim().length).toBeGreaterThan(0);
      expect(cosa.trim().length, `${tasto} non spiega cosa fa`).toBeGreaterThan(3);
    }
  });

  it('le due meccaniche della campagna sono spiegate, non solo elencate', () => {
    // Scatto e Trasponditore non valgono sempre: uno arriva con un
    // nodo, l'altro con una carica raccolta. Una legenda che li
    // elencasse e basta prometterebbe due comandi che a volte non
    // rispondono.
    const riga = (t: string): string => CAMPAIGN_CONTROLS.find(([c]) => c === t)?.[1] ?? '';
    expect(riga('MAIUSC').toLowerCase()).toContain('nodo');
    expect(riga('F').toLowerCase()).toContain('carica');
  });
});
