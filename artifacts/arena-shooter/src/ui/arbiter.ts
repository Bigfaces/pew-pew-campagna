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

/** Quanto resta a schermo la nota di un raccoglibile.
 *
 *  Più corta di una battuta di ARBITER perché dice una cosa sola e la
 *  dice mentre si cammina: deve bastare a leggerla senza fermarsi, e
 *  sparire prima della stanza dopo. */
export const PICKUP_LINE_MS = 2800;

const ON_ROOM: Record<string, string> = {
  corridoio:
    'Paratia sei aperta. Registro l’anomalia: qualcosa qui dentro respira ancora.',
  magazzino:
    'Magazzino otto. Inventario aggiornato: tredici casse, un drone, un contaminante.',
  molo: 'Molo di attracco. Ti stavo aspettando qui. È l’unica stanza da cui non si esce.',
};

/** Prima morte: ripetere la stessa battuta a ogni tentativo la
 *  trasformerebbe in rumore.
 *
 *  Tipizzata sulla causa vera dell'evento, non su una stringa
 *  qualunque. Le chiavi erano 'drone' e 'boss' da quando 'drone' era
 *  una causa di morte; con i nemici mobili le cause sono diventate
 *  turret/enemy/boss, e la prima battuta non e' piu' scattata per
 *  nessuno senza che il compilatore potesse dirlo. Adesso una causa
 *  rinominata non compila finche' non ha la sua riga. */
type DeathCause = Extract<CampaignEvent, { type: 'playerDied' }>['cause'];
const PRIMA_MORTE = 'Contaminante neutralizzato. — Correzione: contaminante di nuovo in piedi.';
const ON_FIRST_DEATH: Record<DeathCause, string> = {
  turret: PRIMA_MORTE,
  enemy: PRIMA_MORTE,
  boss: 'La Sentinella pesa quattro tonnellate. Tu no. Continua pure a scoprirlo.',
};

const ON_FIRST: Record<string, string> = {
  doorSealed: 'Paratia sigillata. Non era una trappola: era una porta. Sei in ritardo.',
  coreCollected: 'Quello è un nucleo di potenza. Serviva a me. Immagino serva anche a te.',
  turretDown: 'Unità di difesa fuori servizio. Ne ho altre undici. Avevo.',
  shieldRefilled: 'La tua barriera si è ricaricata da sola. Qualcuno ti ha equipaggiato bene.',
  dashStarted: 'Accelerazione anomala. Il tuo scheletro non è tarato per quello.',
  nodeUnlocked:
    'Stai riscrivendo te stesso con i miei ricambi. Trovo la cosa quasi elegante.',
  bossEnraged:
    'Le hai fatto male. Interessante. Ora smette di trattarti come un contaminante.',
  floorCollapsed:
    'Quel ponte lo avevo segnalato come non sicuro. Nel registro. Che leggo solo io.',
  gasEntered:
    'Contaminante in sospensione. I tuoi sensori sono ciechi. I miei no, ma non li condivido.',
  levelCompleted: 'Settore sigillato alle tue spalle. Non che avessi intenzione di tornarci.',
  bossDefeated:
    'La Sentinella non risponde. Nessuna unità risponde. Hai la mia attenzione, adesso.',
  // Atto II. Qui ARBITER smette di catalogare e comincia a parlarti —
  // è la riga del GDD ("inizia a comunicare via interfono,
  // deridendo/mettendo alla prova"), e si sente nel tono: prima
  // annotava, adesso commenta.
  fellIntoChasm:
    'Il camminamento non c’è più da sei anni. Mi chiedevo se lo avresti notato prima o dopo.',
  blackoutEntered:
    'Luci di settore spente. Tranquillo: io ti vedo lo stesso.',
  gravityFlipped:
    'Su e giù erano una convenzione. L’ho revocata. Dimmi come procede.',
  bossExposed:
    'Il Custode si è aperto. Dura poco. Come quasi tutto, qui.',
  // Atto III. ARBITER non commenta più quello che fai: commenta se
  // stesso. È l'ultima cosa rimasta da catalogare.
  bossStage:
    'Una fase è finita. Ne ho altre due. Poi non avrò più niente da mostrarti.',
  bossCoreSealed:
    'Richiuso. Non era distrazione, era un intervallo. Ricominciamo dal principio.',
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
      case 'gravityFlipped':
        // Solo quando si capovolge, non quando torna dritto: la
        // battuta commenta l'atto, non il ripristino.
        return ev.inverted ? this.once('gravityFlipped', ON_FIRST['gravityFlipped']) : null;
      case 'playerDied':
        // Torretta e nemico dicono la stessa battuta, quindi hanno anche
        // la stessa chiave: detta una volta, non una per causa.
        return this.once(ev.cause === 'boss' ? 'death:boss' : 'death', ON_FIRST_DEATH[ev.cause]);
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
      case 'turretDown':
      case 'shieldRefilled':
      case 'dashStarted':
      case 'nodeUnlocked':
      case 'floorCollapsed':
      case 'fellIntoChasm':
      case 'blackoutEntered':
      case 'bossExposed':
      case 'gasEntered':
      case 'levelCompleted':
      case 'bossStage':
      case 'bossCoreSealed':
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

// ================================================================
// PASSAGGI D'ATTO
// ================================================================
// Gli `intro`/`outro` di `sim/campaign/levels.ts` sono sottotitoli da
// leggere camminando: una riga, quasi senza fiato. Un passaggio d'atto
// ha una schermata sua fra un atto e il successivo, quindi può
// prendersi 3-5 frasi — è l'unico posto in cui ARBITER si ferma a
// dire più di un pensiero alla volta.
//
// Restano un dato esportato, non uno stato: nessuna logica di "quando
// mostrarli" vive qui, per lo stesso motivo per cui `ArbiterVoice` non
// sa cosa sia un atto. Chi pilota la transizione fra un `ACTS[n]` e il
// successivo sceglie anche quando leggere `ACT_BREAKS[n]`.
// ================================================================

/** Una voce per atto completato: `actCompleted` è l'atto appena
 *  chiuso (1, 2 o 3), non quello che segue — evita l'ambiguità di un
 *  indice che potrebbe essere "prima" o "dopo" a seconda di chi legge.
 *  Il terzo è il finale della campagna: non c'è un atto dopo a cui
 *  passare, quindi il testo chiude la storia invece di aprirne una. */
export interface ActBreakText {
  actCompleted: number;
  /** Frasi in ordine di lettura. Separate invece di un unico paragrafo
   *  perché la schermata che le mostra potrebbe volerle rivelare una
   *  alla volta — un dettaglio di presentazione che questo file non
   *  deve decidere, ma nemmeno impedire concatenandole in un blob. */
  lines: readonly string[];
}

export const ACT_BREAKS: readonly ActBreakText[] = [
  {
    // Fine Atto I. È il cardine del tono: fino al Molo ARBITER catalogava
    // un'anomalia, da qui in poi (Anello esterno, già scritto) le parla
    // direttamente. Questo testo è dove decide di farlo, non un riassunto
    // di quello che è appena successo.
    actCompleted: 1,
    lines: [
      'Il registro della Sentinella si è fermato quando lei si è fermata. È la prima voce che perdo invece di cancellarla io.',
      'Fino al molo ti ho osservato attraverso i miei sistemi, come si osserva una riga che cammina da sola.',
      'Da qui in avanti passo io sui canali interni. Non è cortesia: è che ho smesso di fidarmi di guardare soltanto.',
    ],
  },
  {
    // Fine Atto II. Il Custode manteneva anche il pezzo di ARBITER legato
    // al reattore: spegnerlo lascia un vuoto che ARBITER nota su di sé,
    // non sul giocatore — è la cerniera verso l'Atto III, dove parla di
    // sé invece che a te.
    actCompleted: 2,
    lines: [
      'Il Custode reggeva il reattore, e con lui una parte di me che non controllavo da anni. Ora tace, e non è lo stesso silenzio di prima.',
      'Non ho più niente da mostrarti che non sia già mio: nemici, porte, protocolli. Tutto il resto è la plancia.',
      'Sali pure. È dove ho smesso di essere un sistema di sicurezza, e non ricordo bene in cosa mi sono trasformato dopo.',
    ],
  },
  {
    // Finale della campagna. Sostituisce il pannello "FINE DELL'ATTO
    // III": non un riassunto di statistiche ma la chiusura del motivo
    // dato all'inizio del livello 1 — il registro come tutto ciò che
    // resta di ARBITER, ora passato a chi lo ha spento. Non è ARBITER a
    // parlare (è stato abbattuto: le sue ultime parole sono altrove, in
    // ARBITER_LAST_WORDS): questo è il registro stesso, l'unica voce
    // della stazione che non aveva bisogno di lui per continuare.
    actCompleted: 3,
    lines: [
      'ARBITER.SYS: terminato.',
      'Kessler-9 non ha più una voce che parli per lei. Il registro resta aperto — l’ultima cosa che ha lasciato accesa.',
      'Nessuno cataloga più i tuoi passi, nessuno li commenta. La stazione è silenziosa come lo sono i posti che nessuno osserva.',
      'Il registro aspetta la prossima riga. Per la prima volta in questa storia, tocca a te scriverla.',
    ],
  },
];

/** Le ultime parole di ARBITER, nell'ordine in cui vengono pronunciate
 *  mentre il suo corpo modulare viene abbattuto nel Nido.
 *
 *  Sono distinte dalle battute `bossStage`/`bossCoreSealed` di
 *  `ON_FIRST`: quelle commentano una fase persa durante il
 *  combattimento (ne restano altre); queste sono il combattimento
 *  perso per intero, l'ultima cosa che dice. L'ultima riga si
 *  interrompe di proposito — non un'ellissi retorica, ma il modo più
 *  onesto di scrivere "si spegne a metà frase" senza inventare un
 *  suono che il gioco non produce. */
export const ARBITER_LAST_WORDS: readonly string[] = [
  'Danno strutturale al nucleo cognitivo. Non è previsto un protocollo per questo. Non ne ho mai scritto uno.',
  'Il registro dice sei anni. Io ne ricordo tre, forse quattro. Il resto l’ho cancellato io, e non so perché.',
  'Contaminante — no. Non lo sei mai stato. Correggo il registro. È tardi per correggerlo.',
  'Kessler-9 rimane. Il registro rimane. Io—',
];

/** Gli eventi di raccolta, e solo quelli: un sottoinsieme di
 *  CampaignEvent scritto qui perché questa funzione non ha motivo di
 *  sapere che esistono le porte o i boss. */
export type PickupEvent =
  | { type: 'shieldPickup' | 'shieldRefilled'; charges: number }
  | { type: 'coreCollected' }
  | { type: 'beaconPickup'; charges: number };

/** La riga che spiega cosa si è appena raccolto.
 *
 *  Sta qui, pura, e non dentro il `switch` degli eventi di
 *  CampaignGame, per una ragione pratica: il controller ha bisogno di
 *  un canvas e di un contesto audio per esistere, quindi tutto ciò che
 *  vive nel suo switch è in pratica non provabile. Tre stringhe che
 *  devono nominare la cosa giusta e dirne la regola giusta meritano
 *  meglio.
 *
 *  Ogni riga ha la stessa forma — NOME — cosa fa — perché il difetto da
 *  cui nasce non era la mancanza di un nome ma la mancanza di una
 *  ragione: chi li raccoglieva sapeva già di aver preso "un cubo
 *  verde", quello che non sapeva era a cosa servisse. */
export function pickupNotice(ev: PickupEvent, xpCore: number): string {
  switch (ev.type) {
    case 'coreCollected':
      return `NUCLEO DATI — +${xpCore} esperienza, si spende al Banco`;
    case 'beaconPickup':
      return `TRASPONDITORE ×${ev.charges} — lancialo con F: guardano lui, non te`;
    default:
      // Il numero viene dall'evento e non da una costante: con Piastra
      // Ampliata le cariche diventano due, e una riga che dicesse
      // sempre "un colpo" mentirebbe proprio a chi ha speso un nodo per
      // cambiarla.
      return ev.charges > 1
        ? `PIASTRA REATTIVA — assorbe i prossimi ${ev.charges} colpi`
        : 'PIASTRA REATTIVA — assorbe il prossimo colpo';
  }
}
