// ================================================================
// LE NOTE DEI RACCOGLIBILI — dire cosa hai appena preso
// ================================================================
// Il primo tester esterno ha riassunto così tutta l'economia del
// gioco: «prendo dei cubi colorati gialli, verdi, blu, rossi. Non so
// cosa siano però li prendo». Era una descrizione esatta del codice:
// raccogliere un nucleo, una piastra o un trasponditore non produceva
// nessun testo — solo un suono, e solo per la piastra. Tre oggetti con
// tre regole diverse, e niente che le dicesse.
//
// Queste prove tengono ferme le due cose che una nota del genere deve
// fare: nominare l'oggetto e dirne la *regola*. La seconda è quella
// che mancava davvero — chi raccoglieva sapeva già di aver preso un
// cubo verde, non sapeva a cosa servisse.
// ================================================================

import { describe, expect, it } from 'vitest';

import { XP_CORE } from '../sim/campaign/constants';
import { pickupNotice, type PickupEvent } from './arbiter';

const NUCLEO: PickupEvent = { type: 'coreCollected' };
const PIASTRA = (charges: number): PickupEvent => ({ type: 'shieldPickup', charges });
const ESCA = (charges: number): PickupEvent => ({ type: 'beaconPickup', charges });

describe('la nota di un raccoglibile', () => {
  it.each([
    ['il nucleo', NUCLEO, 'NUCLEO DATI'],
    ['la piastra', PIASTRA(1), 'PIASTRA REATTIVA'],
    ['il trasponditore', ESCA(2), 'TRASPONDITORE'],
  ])('nomina %s', (_, ev, nome) => {
    expect(pickupNotice(ev as PickupEvent, XP_CORE)).toContain(nome);
  });

  it.each([
    ['il nucleo', NUCLEO],
    ['la piastra', PIASTRA(1)],
    ['il trasponditore', ESCA(2)],
  ])('spiega a cosa serve %s, non solo come si chiama', (_, ev) => {
    // La forma è NOME — regola: senza il trattino c'è solo il nome, che
    // è precisamente ciò che il gioco già comunicava col colore.
    const riga = pickupNotice(ev as PickupEvent, XP_CORE);
    const regola = riga.split('—')[1]?.trim() ?? '';
    expect(regola.length, `riga senza spiegazione: «${riga}»`).toBeGreaterThan(12);
  });

  it('dice quanta esperienza vale davvero un nucleo', () => {
    // Il numero arriva dalla costante, non da una copia scritta a
    // mano: se il bilanciamento cambia, la riga cambia con lui invece
    // di mentire.
    expect(pickupNotice(NUCLEO, XP_CORE)).toContain(String(XP_CORE));
  });

  it('conta le cariche della piastra invece di darle per una', () => {
    // Col nodo Piastra Ampliata le cariche diventano due. Una riga che
    // dicesse sempre "il prossimo colpo" mentirebbe proprio a chi ha
    // speso un nodo per cambiarla.
    expect(pickupNotice(PIASTRA(1), XP_CORE)).toContain('il prossimo colpo');
    expect(pickupNotice(PIASTRA(2), XP_CORE)).toContain('2 colpi');
  });

  it("nomina il tasto dell'esca, e lo nomina come lo nomina la legenda", async () => {
    // Se il tasto del Trasponditore cambiasse nella legenda dei comandi
    // e non qui, la nota insegnerebbe un tasto che non esiste.
    const { CAMPAIGN_CONTROLS } = await import('./CampaignHud');
    const voce = CAMPAIGN_CONTROLS.find(([, d]) => d.includes('Trasponditore'));
    expect(voce, 'il Trasponditore è sparito dalla legenda').toBeTruthy();
    expect(pickupNotice(ESCA(1), XP_CORE)).toContain(voce![0]);
  });
});
