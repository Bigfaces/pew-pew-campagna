// ================================================================
// ARBITER — la voce della stazione
// ================================================================
// Le battute stanno qui, nel livello di presentazione, e non nella
// simulazione: `sim/campaign` non deve sapere che esiste una storia.
// Sa emettere "il giocatore è entrato nel Molo" e "la Sentinella si è
// alterata"; tradurlo in una frase è un problema di tono, non di
// regole, e il giorno che le frasi cambiano lingua o sparisce la
// narrazione la simulazione non se ne accorge.
//
// Tono (GDD.md sezione 2): ARBITER non minaccia e non insulta. Osserva
// e cataloga, e il fastidio è tutto nel trattare chi gioca come una
// voce di inventario. Frasi corte: si leggono mentre si cammina, non
// fermandosi a leggere.
// ================================================================

import type { CampaignEvent } from '../sim/campaign/types';

export interface ArbiterLine {
  text: string;
  /** Timestamp (ms) in cui è stata pronunciata. */
  at: number;
}

/** Quanto resta a schermo una battuta. */
export const ARBITER_LINE_MS = 5200;

const ON_ROOM: Record<string, string> = {
  corridoio:
    'Paratia sei aperta. Registro l’anomalia: qualcosa qui dentro respira ancora.',
  magazzino:
    'Magazzino otto. Inventario aggiornato: tredici casse, un drone, un contaminante.',
  molo: 'Molo di attracco. Ti stavo aspettando qui. È l’unica stanza da cui non si esce.',
};

/** Prima morte per ciascuna causa: ripetere la stessa battuta a ogni
 *  tentativo la trasformerebbe in rumore. */
const ON_FIRST_DEATH: Record<string, string> = {
  drone: 'Contaminante neutralizzato. — Correzione: contaminante di nuovo in piedi.',
  boss: 'La Sentinella pesa quattro tonnellate. Tu no. Continua pure a scoprirlo.',
};

const ON_FIRST: Record<string, string> = {
  doorSealed: 'Paratia sigillata. Non era una trappola: era una porta. Sei in ritardo.',
  coreCollected: 'Quello è un nucleo di potenza. Serviva a me. Immagino serva anche a te.',
  droneDown: 'Drone otto-quattro fuori servizio. Ne ho altri undici. Avevo.',
  shieldRefilled: 'La tua barriera si è ricaricata da sola. Qualcuno ti ha equipaggiato bene.',
  dashStarted: 'Accelerazione anomala. Il tuo scheletro non è tarato per quello.',
  nodeUnlocked:
    'Stai riscrivendo te stesso con i miei ricambi. Trovo la cosa quasi elegante.',
  bossEnraged:
    'Le hai fatto male. Interessante. Ora smette di trattarti come un contaminante.',
  bossDefeated:
    'La Sentinella non risponde. Nessuna unità risponde. Hai la mia attenzione, adesso.',
};

/** Traduce gli eventi della simulazione in una battuta, se ce n'è una
 *  da dire. Tiene da sé la memoria di cosa è già stato detto: le
 *  battute "la prima volta che succede" sono quasi tutte, e farlo
 *  ricordare al chiamante sarebbe stato lo stesso lavoro sparso. */
export class ArbiterVoice {
  private said = new Set<string>();

  /** La battuta da mostrare per questo gruppo di eventi, o null.
   *  Al massimo una per tick: due frasi sovrapposte non si leggono. */
  lineFor(events: readonly CampaignEvent[], nowMs: number): ArbiterLine | null {
    for (const ev of events) {
      const text = this.textFor(ev);
      if (text) return { text, at: nowMs };
    }
    return null;
  }

  private textFor(ev: CampaignEvent): string | null {
    switch (ev.type) {
      case 'roomEntered':
        return this.once(`room:${ev.room}`, ON_ROOM[ev.room]);
      case 'playerDied':
        return this.once(`death:${ev.cause}`, ON_FIRST_DEATH[ev.cause]);
      case 'shieldPickup':
        // Con la Piastra Aggiuntiva la barriera regge due colpi: la
        // battuta legge il numero dall'evento invece di affermare
        // qualcosa che il giocatore può vedere essere falso.
        return this.once(
          'shieldPickup',
          ev.charges > 1
            ? `Barriera portatile, ${ev.charges} strati. Ne arriveranno abbastanza.`
            : 'Barriera portatile. Assorbe un colpo. Ne arriveranno altri.',
        );
      case 'doorSealed':
      case 'coreCollected':
      case 'droneDown':
      case 'shieldRefilled':
      case 'dashStarted':
      case 'nodeUnlocked':
      case 'bossEnraged':
      case 'bossDefeated':
        return this.once(ev.type, ON_FIRST[ev.type]);
      default:
        return null;
    }
  }

  private once(key: string, text: string | undefined): string | null {
    if (!text || this.said.has(key)) return null;
    this.said.add(key);
    return text;
  }
}
