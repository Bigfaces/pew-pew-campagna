// ================================================================
// IL FUCILE MUTO
// ================================================================
// `AudioEngine.rifle()` (audio/engine.ts) esisteva da prima di questo
// giro di correzioni e non era mai chiamato da nessuna parte — un
// `grep` sul sorgente lo confermava. Il giocatore sparava a vuoto in
// silenzio fino al click dell'otturatore, ~1.4s dopo il colpo mancato:
// l'unico segnale sonoro esistente non era lo sparo, era la sua
// conseguenza.
//
// `fireWeapon()` (sim/campaign/world.ts) non emette un evento suo —
// verificato leggendo il file, che questo test non tocca — quindi il
// cablaggio in tick() (campaignGame.ts) non può passare da handleEvents
// come fanno gli altri suoni: deve leggere il cooldown dell'arma prima
// e dopo world.step(). Non è provabile chiamando CampaignGame: la
// classe usa `canvas`/`document` e questa suite gira senza jsdom (vedi
// src/ui/comandi.test.ts, stesso motivo). Si legge quindi il sorgente
// come testo, sullo stesso principio di comandi.test.ts ed
// eventiRaccolta.test.ts: una guardia contro la regressione, non una
// riprova della logica (quella la fa il gioco vero, guidato a mano
// nel browser).
// ================================================================

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function sorgenteCampaignGame(): string {
  return readFileSync(new URL('./campaignGame.ts', import.meta.url), 'utf8');
}

/** Corpo del metodo `tick()`, per bilanciamento di graffe a partire
 *  dalla prima dopo la firma — stesso approccio di
 *  corpoCampaignLegendScreen in src/ui/legenda.test.ts. */
function corpoTick(): string {
  const src = sorgenteCampaignGame();
  const marcatore = 'private tick(): void {';
  const inizio = src.indexOf(marcatore);
  expect(inizio, '"private tick(): void {" non si trova più in campaignGame.ts').toBeGreaterThan(-1);

  const primaGraffa = inizio + marcatore.length - 1;
  let profondita = 0;
  for (let i = primaGraffa; i < src.length; i++) {
    if (src[i] === '{') profondita++;
    else if (src[i] === '}') {
      profondita--;
      if (profondita === 0) return src.slice(inizio, i + 1);
    }
  }
  throw new Error('graffa di chiusura di tick() non trovata');
}

describe('tick() — lo sparo del giocatore suona', () => {
  const corpo = corpoTick();

  it('legge il cooldown prima di world.step, e chiama audio.rifle() dopo', () => {
    const indiceStep = corpo.indexOf('this.world.step(');
    expect(indiceStep, 'tick() non chiama più this.world.step(...) così com\'è scritto').toBeGreaterThan(-1);

    const primaDelloStep = corpo.slice(0, indiceStep);
    expect(
      primaDelloStep,
      'tick() deve leggere weaponCooldown prima di world.step(), per sapere se l\'arma era pronta',
    ).toMatch(/weaponCooldown/);

    const dopoLoStep = corpo.slice(indiceStep);
    expect(
      dopoLoStep,
      'tick() non chiama più this.audio.rifle() dopo world.step(): il fucile del giocatore è di nuovo muto',
    ).toContain('this.audio.rifle(');
  });

  it('la chiamata a rifle() è condizionata a input.fire, non incondizionata', () => {
    // Senza questa condizione ogni tick suonerebbe lo sparo, anche a
    // grilletto non premuto.
    const finestra = corpo.slice(
      corpo.indexOf('this.world.step('),
      corpo.indexOf('this.audio.rifle(') + 'this.audio.rifle('.length,
    );
    expect(finestra).toMatch(/input\.fire/);
  });
});
