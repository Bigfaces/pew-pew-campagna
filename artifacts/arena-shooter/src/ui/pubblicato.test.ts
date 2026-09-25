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
// Ma un confronto per stringhe vede solo *cosa si legge*, non *cosa
// gira*: una modifica che cambia logica senza toccare una parola a
// schermo gli resta invisibile. È successo davvero, non per ipotesi:
// in campaignGame.ts un `case 'coreCollected'` compariva due volte
// nello stesso switch, e in uno switch vince il primo ramo — il
// secondo, identico a vedersi, non veniva mai eseguito. Si sentiva il
// suono del nucleo raccolto e non compariva mai la sua riga in HUD, e
// ogni stringa che questo file sapeva cercare era comunque, da
// qualche parte nel sorgente, dentro il bundle: nessuna delle prove
// qui sotto se ne sarebbe accorta. Da qui l'impronta
// (`../../tools/impronta.ts`): un hash sha256 di tutti i sorgenti che
// finiscono nel bundle, calcolato leggendoli dal disco, inciso
// nell'HTML pubblicato da `vite.config.standalone.ts` e confrontato
// qui sotto byte per byte. Cambia un `case`, cambia l'impronta — non
// serve che cambi anche una stringa. Le prove per stringhe restano,
// non sono sostituite: dicono *cosa* manca quando il file è vecchio;
// l'impronta dice solo *che* lo è.
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
import { calcolaImpronta } from '../../tools/impronta';

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
    const nome = pickupNotice(ev, XP_CORE)
      .split(/[^A-ZÀ-Ü ]/)[0]!
      .trim();
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

  // L'impronta prende quello che le stringhe qui sopra non possono
  // vedere: una modifica alla *logica* che non cambia una parola a
  // schermo. Ricalcolata dal sorgente vero (stessa funzione che usa
  // vite.config.standalone.ts per inciderla nell'HTML) e pretesa
  // identica, byte per byte, dentro il file pubblicato.
  it("porta l'impronta esatta dei sorgenti — non solo le stringhe che sa nominare", () => {
    const { hash, file } = calcolaImpronta();
    const atteso = `<meta name="impronta-sorgenti" content="${hash}">`;
    const trovato = pubblicato().includes(atteso);

    // Aiuto per capire *cosa* è cambiato, non prova di niente: le date
    // del filesystem sopravvivono a una modifica locale ma non a un
    // clone, dove git non le preserva e ogni file può risultare
    // "modificato adesso". Su un clone fresco questo elenco può quindi
    // uscire vuoto, o pieno di file che in realtà non c'entrano — è
    // per questo dichiarato come aiuto e non incluso nell'asserzione.
    let aiuto = '';
    if (!trovato && existsSync(PUBBLICATO)) {
      const etaPubblicato = statSync(PUBBLICATO).mtimeMs;
      const radice = path.resolve(PUBBLICATO, '..', '..', 'artifacts/arena-shooter');
      const piuRecenti = file
        .map((relativo) => ({ relativo, mtime: statSync(path.join(radice, relativo)).mtimeMs }))
        .filter((f) => f.mtime > etaPubblicato)
        .sort((a, b) => b.mtime - a.mtime);
      aiuto =
        '\n\n(aiuto, non prova — su un clone fresco le date del filesystem non sono ' +
        'affidabili e questo elenco può essere vuoto o fuorviante: sorgenti con data ' +
        `di modifica più recente di ${PUBBLICATO}:\n` +
        (piuRecenti.length > 0
          ? piuRecenti.map((f) => `  ${f.relativo}`).join('\n')
          : '  (nessuno — le date non aiutano qui)');
    }

    expect(
      trovato,
      `il file pubblicato non porta l'impronta attesa (${hash}): non è questo test ` +
        'da correggere, è la build da rifare —\n\n' +
        '  pnpm --filter @workspace/arena-shooter run build:standalone\n' +
        '  copy artifacts\\arena-shooter\\dist\\standalone\\index.html docs\\index.html' +
        aiuto,
    ).toBe(true);
  });
});
