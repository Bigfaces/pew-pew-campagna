// ================================================================
// LEGENDA DEL PRIMO AVVISTAMENTO — deve leggere, non ricopiare
// ================================================================
// GDD.md sezione 22. CAMPAIGN_CONTROLS è già l'unica fonte della
// legenda dei comandi (vedi comandi.test.ts e pubblicato.test.ts): la
// schermata del primo avvistamento deve *leggerla*, non ripetersi il
// testo a mano. Una seconda copia diverge il giorno in cui la prima
// cambia bilanciamento (il moltiplicatore del punto debole, il numero
// di piastre), e le due guardie citate sopra non se ne accorgerebbero
// — sorvegliano CAMPAIGN_CONTROLS, non un `<p>` scritto altrove.
//
// Non importiamo CampaignHud.tsx qui: è un componente React con JSX,
// e questa suite non ha un renderer DOM configurato per gli altri
// file .tsx della campagna (stesso motivo per cui comandi.test.ts
// legge campaignGame.ts come testo invece di importarlo). Il
// controllo è quindi testuale, sullo stesso sorgente — ed è la forma
// giusta per la domanda che si sta facendo: "ogni frase mostrata
// esiste già altrove?", non "il markup è corretto?".
// ================================================================

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CAMPAIGN_CONTROLS } from './CampaignHud';

function sorgenteHud(): string {
  return readFileSync(new URL('./CampaignHud.tsx', import.meta.url), 'utf8');
}

/** Da `SIGHTING_KEYS` (le chiavi che il componente legge da
 *  CAMPAIGN_CONTROLS) alla chiusura di CampaignLegendScreen: le due
 *  costanti di modulo che gli servono più il suo corpo, per
 *  bilanciamento di graffe a partire dalla prima dopo la sua
 *  dichiarazione — non una ricerca euristica della "prossima
 *  funzione", che includerebbe anche ActBreakLines (non esportata)
 *  subito dopo nel file e allargherebbe il controllo oltre quello che
 *  vogliamo isolare. */
function corpoCampaignLegendScreen(): string {
  const src = sorgenteHud();
  const inizioCostanti = src.indexOf('const SIGHTING_KEYS');
  expect(inizioCostanti, 'SIGHTING_KEYS non si trova più in CampaignHud.tsx').toBeGreaterThan(-1);

  const inizioFunzione = src.indexOf('export function CampaignLegendScreen', inizioCostanti);
  expect(
    inizioFunzione,
    'CampaignLegendScreen non si trova più in CampaignHud.tsx',
  ).toBeGreaterThan(-1);

  // Non la prima graffa dopo il nome: quella apre la destrutturazione
  // dei parametri (`({ onClose }: {...})`), non il corpo. Il corpo
  // comincia dopo l'annotazione di ritorno.
  const marcatore = '): React.ReactElement {';
  const dopoAnnotazione = src.indexOf(marcatore, inizioFunzione);
  expect(dopoAnnotazione, 'CampaignLegendScreen non ha la forma attesa').toBeGreaterThan(-1);
  const primaGraffa = dopoAnnotazione + marcatore.length - 1;

  let profondita = 0;
  for (let i = primaGraffa; i < src.length; i++) {
    if (src[i] === '{') profondita++;
    else if (src[i] === '}') {
      profondita--;
      if (profondita === 0) return src.slice(inizioCostanti, i + 1);
    }
  }
  throw new Error('graffa di chiusura di CampaignLegendScreen non trovata');
}

describe('schermata del primo avvistamento — il testo viene da CAMPAIGN_CONTROLS', () => {
  const corpo = corpoCampaignLegendScreen();
  const descrizioni = CAMPAIGN_CONTROLS.map(([, descrizione]) => descrizione);

  it('non contiene, scritta a mano, nessuna delle frasi di CAMPAIGN_CONTROLS', () => {
    // Il controllo che una copia romperebbe per davvero: se qualcuno
    // incollasse a mano «Vale tre volte: dietro, il nucleo o la testa
    // — la HUD dice quale» dentro il JSX invece di leggerla dalla
    // legenda, la stringa letterale comparirebbe nel sorgente due
    // volte — una nell'array, una nel componente — e questo la
    // troverebbe. Letta da CAMPAIGN_CONTROLS.find(...) come fa il
    // componente vero, la frase non compare mai come testo letterale
    // qui dentro.
    for (const descrizione of descrizioni) {
      expect(
        corpo.includes(`'${descrizione}'`) || corpo.includes(`"${descrizione}"`),
        `«${descrizione}» compare come stringa letterale nel componente: ` +
          'non deve essere ricopiata, va letta da CAMPAIGN_CONTROLS',
      ).toBe(false);
    }
  });

  it('legge da CAMPAIGN_CONTROLS, non da un array scritto a parte', () => {
    expect(corpo).toContain('CAMPAIGN_CONTROLS.find');
  });

  it('mostra almeno PUNTO DEBOLE e PIASTRE, le due voci che contano', () => {
    expect(corpo).toContain("'PUNTO DEBOLE'");
    expect(corpo).toContain("'PIASTRE'");
  });

  it('le mette in evidenza rispetto alle altre voci mostrate', () => {
    // Non un dettaglio di stile: se SIGHTING_EMPHASIS (o l'equivalente
    // che le distingue) sparisse, tutte le righe si disegnerebbero
    // uguali e "in evidenza" tornerebbe falso.
    expect(corpo).toMatch(/data-emphasis/);
  });
});
