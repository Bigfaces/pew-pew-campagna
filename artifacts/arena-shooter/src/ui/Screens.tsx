import { useState } from 'react';

import { ADS_SENS_MULT, clampSensitivity, SENS_MAX, SENS_MIN, SENS_STEP } from '../sim/constants';
import {
  loadCampaignDifficultyChoice,
  loadLegendEnabled,
  saveCampaignDifficultyChoice,
  saveLegendEnabled,
  saveLegendShown,
} from '../stats/campaignProfile';
import { CAMPAIGN_DIFFICULTIES, type CampaignDifficulty } from '../sim/campaign/types';

/** Le tre fasi di GDD.md sezione 9: cosa succede quando si muore. */
const CAMPAIGN_DIFF_LABEL: Record<CampaignDifficulty, string> = {
  tutorial: 'TUTORIAL',
  medio: 'MEDIO',
  roguelike: 'ROGUELIKE',
};

const CAMPAIGN_DIFF_NOTE: Record<CampaignDifficulty, string> = {
  tutorial:
    'Morire riporta alla stanza raggiunta: si resettano solo i nemici e i trabocchetti lì dentro.',
  medio: 'Morire riporta allo spawn del livello: si resetta tutto il livello, non solo la stanza.',
  roguelike:
    'Morire fa ripartire l’intero atto dal primo livello. Personaggio e core raccolti restano tuoi.',
};

/** Look sensitivity, shown as a multiplier because the underlying
 *  figure is radians per mouse pixel and nobody has an opinion about
 *  those. */
function SensitivityField({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <div className="field">
      <label htmlFor="sens">SENSIBILITÀ MOUSE — {value.toFixed(2)}×</label>
      <input
        id="sens"
        type="range"
        min={SENS_MIN}
        max={SENS_MAX}
        step={SENS_STEP}
        value={value}
        onChange={(e) => onChange(clampSensitivity(e.target.valueAsNumber))}
      />
      <p className="hint">
        Non tocca la rotazione con Q / E. L’ottica la riduce comunque al{' '}
        {Math.round(ADS_SENS_MULT * 100)}%: mirare col cannocchiale resta lento per scelta.
      </p>
    </div>
  );
}

/** GDD.md sezione 22. Un solo pulsante on/off invece di un cursore
 *  come la sensibilità: qui non c'è una via di mezzo, la schermata
 *  compare o non compare mai. */
function LegendToggleField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <div className="field">
      <label>LEGENDA AL PRIMO NEMICO</label>
      <div className="seg">
        <button type="button" data-on={value} onClick={() => onChange(true)}>
          ATTIVA
        </button>
        <button type="button" data-on={!value} onClick={() => onChange(false)}>
          DISATTIVA
        </button>
      </div>
      <p className="hint">
        Spiega il punto debole (×3 danno) e le piastre alla prima comparsa di un nemico, una sola
        volta. Riaccenderla dopo averla spenta la fa ricomparire al prossimo nemico avvistato, come
        se non l'avessi mai vista.
      </p>
    </div>
  );
}

export interface MenuConfig {
  /** Multiplier on MOUSE_SENSITIVITY, 1 by default. */
  sensitivity: number;
}

export function Menu({
  onCampaign,
  initial,
}: {
  onCampaign: (cfg: MenuConfig) => void;
  initial: MenuConfig;
}): React.ReactElement {
  const [sensitivity, setSensitivity] = useState(initial.sensitivity);
  // Letta pigramente da localStorage, come faceva già il vecchio menu
  // dell'Arena: safe anche senza storage disponibile (vedi
  // campaignProfile.ts). Un personaggio già esistente ignora questa
  // scelta e usa la sua propria (CampaignProfile.difficulty) — questa
  // vale solo per un run che comincia da zero.
  const [campaignDifficulty, setCampaignDifficulty] = useState<CampaignDifficulty>(
    loadCampaignDifficultyChoice(),
  );
  const [legendEnabled, setLegendEnabled] = useState<boolean>(loadLegendEnabled());

  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title">KESSLER-9</h1>
        <p className="subtitle">TRE ATTI · NOVE LIVELLI · FUCILE A OTTURATORE</p>

        <div className="field">
          <label>DIFFICOLTÀ CAMPAGNA</label>
          <div className="seg">
            {CAMPAIGN_DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                data-on={campaignDifficulty === d}
                onClick={() => {
                  setCampaignDifficulty(d);
                  saveCampaignDifficultyChoice(d);
                }}
              >
                {CAMPAIGN_DIFF_LABEL[d]}
              </button>
            ))}
          </div>
          <p className="hint">{CAMPAIGN_DIFF_NOTE[campaignDifficulty]}</p>
        </div>

        <SensitivityField value={sensitivity} onChange={setSensitivity} />

        <LegendToggleField
          value={legendEnabled}
          onChange={(v) => {
            // Riaccenderla da spenta azzera "già mostrata": è l'unico
            // modo che il giocatore ha di rivederla, e senza questo
            // l'interruttore riacceso non farebbe mai ricomparire
            // niente — sembrerebbe rotto.
            if (v && !legendEnabled) saveLegendShown(false);
            setLegendEnabled(v);
            saveLegendEnabled(v);
          }}
        />

        <button className="btn" type="button" onClick={() => onCampaign({ sensitivity })}>
          ▶ INIZIA LA CAMPAGNA (BETA)
        </button>

        <p className="muted-note">
          I progressi si salvano in questo browser, non su un server: restano sul computer da cui
          giochi.
        </p>
      </div>
    </div>
  );
}
