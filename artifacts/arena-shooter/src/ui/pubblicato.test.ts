// ================================================================
// IL FILE PUBBLICATO — non deve restare indietro rispetto al codice
// ================================================================
// `docs/index.html` è il gioco compilato in un file solo, ed è un
// artefatto di build committato di proposito (vedi docs/LEGGIMI.md):
// è ciò che si apre col doppio click ed è la pagina che GitHub Pages
// serve. Essendo generato, non si aggiorna da sé.
//
// È già andata storta una volta, ed è il difetto peggiore che questo
// progetto abbia avuto: il file è rimasto quello dell'Arena congelato
// al giorno del fork per tutta la costruzione della campagna. Tre
// atti, nove livelli, tre boss e il Banco erano nel sorgente e in
// nessun modo raggiungibili da chi non compilava — cioè da chiunque
// avesse ricevuto il link. Il repository si dichiarava giocabile e
// non lo era, e niente nella suite se ne accorgeva, perché il
// sorgente era giusto: sbagliato era solo il file spedito.
//
// Da qui una guardia che confronta il file pubblicato con la sola
// cosa che non può mentire, il sorgente da cui nasce. Le stringhe non
// sono scritte a mano qui: arrivano dagli stessi moduli che le
// disegnano, così un comando nuovo o una modalità nuova fanno
// fallire il test finché il file non viene rigenerato.
//
// Quando diventa rosso non c'è da correggere il test, c'è da rifare
// la build:
//
//   pnpm --filter @workspace/arena-shooter run build:standalone
//   copy artifacts\arena-shooter\dist\standalone\index.html docs\index.html
// ================================================================

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { XP_CORE } from '../sim/campaign/constants';
import { CAMPAIGN_DIFFICULTIES } from '../sim/campaign/types';
import { pickupNotice, type PickupEvent } from './arbiter';
import { CAMPAIGN_CONTROLS } from './CampaignHud';

/** Vitest gira con la radice del pacchetto come cwd; il file
 *  pubblicato sta due livelli più su, alla radice del repository. */
const PUBBLICATO = path.resolve(process.cwd(), '../../docs/index.html');

function pubblicato(): string {
  return readFileSync(PUBBLICATO, 'utf8');
}

describe('docs/index.html — il file che riceve chi non compila', () => {
  it('esiste', () => {
    expect(
      existsSync(PUBBLICATO),
      `manca ${PUBBLICATO}: è il gioco che si apre col doppio click`,
    ).toBe(true);
  });

  it('contiene davvero un gioco, non una pagina vuota', () => {
    // Il bundle sta sopra i 400 kB; la soglia è bassa di proposito,
    // serve solo a distinguere un file vero da un segnaposto.
    expect(statSync(PUBBLICATO).size).toBeGreaterThan(200_000);
  });

  // Ogni riga della legenda della campagna viene disegnata dal file
  // pubblicato, quindi il suo testo deve trovarcisi dentro. È il
  // controllo che avrebbe preso il difetto: nel file fermo al fork
  // non ce n'era nemmeno una.
  it.each(CAMPAIGN_CONTROLS.map(([tasto, descrizione]) => ({ tasto, descrizione })))(
    'porta la voce di legenda di $tasto',
    ({ tasto, descrizione }) => {
      expect(
        pubblicato().includes(descrizione),
        `il file pubblicato non contiene la voce «${tasto} — ${descrizione}»: ` +
          'è più vecchio del sorgente, va rigenerato con build:standalone',
      ).toBe(true);
    },
  );

  // Le note dei raccoglibili sono nate dallo stesso giro di prove in cui
  // è nata questa guardia: un tester che raccoglieva "cubi colorati"
  // senza sapere cosa fossero. Se il file pubblicato resta indietro,
  // torna a non dirglielo — quindi la guardia deve vederle anche lei.
  it.each([
    { type: 'coreCollected' },
    { type: 'shieldPickup', charges: 1 },
    { type: 'beaconPickup', charges: 1 },
  ] as PickupEvent[])('porta la nota di $type', (ev) => {
    // Solo il nome in lettere, non la riga intera: dopo il trattino ci
    // sono numeri che il bilanciamento può muovere, e nel nome stesso
    // c'è un conteggio («TRASPONDITORE ×2») che nel sorgente è un
    // segnaposto e nel file compilato non compare mai come tale. Una
    // guardia sull'aggiornamento del file non deve fallire per questo.
    const nome = pickupNotice(ev, XP_CORE).split(/[^A-ZÀ-Ü ]/)[0]!.trim();
    expect(
      pubblicato().includes(nome),
      `il file pubblicato non nomina «${nome}» quando lo si raccoglie: ` +
        'è più vecchio del sorgente, va rigenerato con build:standalone',
    ).toBe(true);
  });

  it.each(CAMPAIGN_DIFFICULTIES)('porta la modalità %s', (difficolta) => {
    expect(
      pubblicato().includes(difficolta.toUpperCase()),
      `il file pubblicato non offre la modalità ${difficolta.toUpperCase()}: ` +
        'va rigenerato con build:standalone',
    ).toBe(true);
  });
});
