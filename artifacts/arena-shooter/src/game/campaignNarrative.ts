// ================================================================
// NARRAZIONE DELLA CAMPAGNA — quando dire cosa, non cosa dire
// ================================================================
// I testi (intro/outro in sim/campaign/levels.ts, ACT_BREAKS e
// ARBITER_LAST_WORDS in ui/arbiter.ts) sono già scritti e approvati:
// questo file non ne aggiunge nessuno. Decide solo l'ordine e il
// ritmo — le "tre battute distinte" del briefing — in un modulo che
// non tocca `document`/`canvas` di proposito.
//
// Il motivo non è astratto: CampaignGame (game/campaignGame.ts) usa
// il DOM ovunque, e questa suite gira senza jsdom (vedi package.json —
// nessun `environment` configurato, nessuna dipendenza jsdom). Senza
// questo modulo, la logica "quali battute mostrare" e "in quale
// ordine" vivrebbe solo dentro una classe che i test non possono
// istanziare, e l'unico modo di verificarla sarebbe un browser vero —
// che è già il piano per il resto (vedi il comando di verifica), ma
// non deve essere l'unico per una decisione che è pura logica, senza
// un pixel disegnato.
// ================================================================

import type { LevelDef } from '../sim/campaign/levelTypes';
import { levelById } from '../sim/campaign/levels';
import { ARBITER_LAST_WORDS } from '../ui/arbiter';

/** Cosa dire, e in quale ordine, quando un livello finisce (uscita
 *  raggiunta o boss abbattuto). */
export interface LevelCompletionPlan {
  /** Battute da leggere in fila, sul canale dei sottotitoli di
   *  ARBITER, prima di qualunque transizione di schermata. */
  lines: readonly string[];
  /** Vero se il livello appena chiuso era l'ultimo del suo atto. */
  actEnded: boolean;
  /** L'atto appena chiuso, solo se `actEnded`. */
  actCompleted: number | null;
}

/** Decide se un livello chiude un atto guardando *dove porta*, non
 *  contando "il terzo livello finisce sempre l'atto" — che oggi è
 *  vero (vedi levels.ts) ma è un fatto di level design, non una
 *  regola che questo modulo deve assumere. Un livello senza livello
 *  dopo (next === null) chiude un atto per definizione: non c'è un
 *  "atto successivo" a cui appartenere. */
export function planLevelCompletion(
  completed: LevelDef,
  next: string | null,
): LevelCompletionPlan {
  const nextLevel = next === null ? null : levelById(next);
  const actEnded = nextLevel === null || nextLevel.act !== completed.act;

  const lines: string[] = [];
  // Le ultime parole sono di ARBITER — le dice lui, mentre il suo
  // corpo modulare viene ancora abbattuto (vedi il commento su
  // ARBITER_LAST_WORDS in ui/arbiter.ts). L'outro è il sigillo del
  // livello, la stessa voce che apre con `intro`. Sono cose diverse
  // dette da momenti diversi, quindi vengono prima le une e poi
  // l'altra, mai mescolate. Sentinella e Custode non hanno ultime
  // parole: restano abbattuti dentro la simulazione, non spenti — solo
  // ARBITER è la voce della stazione, e solo la sua fine è definitiva.
  if (completed.boss?.kind === 'arbiter') lines.push(...ARBITER_LAST_WORDS);
  lines.push(completed.outro);

  return { lines, actEnded, actCompleted: actEnded ? completed.act : null };
}

/** Una riga mostrata, e per quanto. */
interface NarrativeLine {
  text: string;
  at: number;
}

/** Sequenzia sottotitoli nel tempo: una riga alla volta, ciascuna
 *  visibile per `durationMs`, poi la prossima in coda. Alla fine della
 *  coda chiama `onDone`, una volta sola.
 *
 *  Guidata da un orologio passato dall'esterno (`advance(now)`)
 *  invece che da un proprio `setTimeout`: è lo stesso schema del resto
 *  di CampaignGame, che non ha temporizzatori propri fuori dal loop a
 *  passo fisso, e rende la coda avanzabile a mano nei test — passare
 *  `now` a piacere batte aspettare `durationMs` veri in una suite che
 *  gira senza timer finti. */
export class NarrativeQueue {
  private queue: string[] = [];
  private current: NarrativeLine | null = null;
  private onDone: (() => void) | null = null;

  constructor(private readonly durationMs: number) {}

  /** Accoda righe da leggere in ordine. Un `onDone` nuovo rimpiazza
   *  quello vecchio: una sola transizione narrativa alla volta ha un
   *  significato, due sovrapposte no — e non può succedere comunque,
   *  perché la sim ha già smesso di generare eventi di livello nel
   *  momento in cui questa coda ne sta ancora leggendo uno vecchio. */
  enqueue(lines: readonly string[], onDone: (() => void) | null = null): void {
    this.queue.push(...lines);
    this.onDone = onDone;
  }

  /** La riga da mostrare adesso, o null se la coda è vuota e non c'è
   *  nulla ancora a schermo. */
  currentLine(): string | null {
    return this.current?.text ?? null;
  }

  /** Vero se c'è ancora qualcosa da leggere o da fare: usato dai test
   *  per sapere quando la sequenza è arrivata in fondo senza dover
   *  ripetere qui la logica di `advance`. */
  isIdle(): boolean {
    return this.current === null && this.queue.length === 0 && this.onDone === null;
  }

  /** Fa avanzare la coda se la riga corrente è scaduta. Senza una
   *  riga corrente si assume scaduta: è così che la prima riga di una
   *  coda appena accodata parte al prossimo `advance` invece di
   *  aspettare `durationMs` in più per un turno che non c'è mai
   *  stato. */
  advance(now: number): void {
    const expired = this.current === null || now - this.current.at >= this.durationMs;
    if (!expired) return;
    if (this.queue.length > 0) {
      this.current = { text: this.queue.shift()!, at: now };
      return;
    }
    // La coda è vuota: la riga scaduta smette di essere mostrata a
    // prescindere che ci sia un `onDone` ad aspettarla, altrimenti una
    // sequenza senza callback (l'outro isolato di un livello normale)
    // resterebbe a schermo per sempre invece di scomparire da sola
    // come faceva prima che esistesse questa coda.
    this.current = null;
    if (this.onDone) {
      const done = this.onDone;
      this.onDone = null;
      done();
    }
  }
}
