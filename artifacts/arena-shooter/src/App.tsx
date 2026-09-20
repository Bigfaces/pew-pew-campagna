import { useCallback, useEffect, useRef, useState } from 'react';

import { CampaignGame, type CampaignHudSnapshot } from './game/campaignGame';
import { clampSensitivity } from './sim/constants';
import {
  CampaignActBreakScreen,
  CampaignEndScreen,
  CampaignHud,
  CampaignPauseScreen,
} from './ui/CampaignHud';
import { Menu, type MenuConfig } from './ui/Screens';
import { TouchControls } from './ui/TouchControls';
import './ui/ui.css';

const SENS_KEY = 'arena-sniper.sensitivity';

type UiMode = 'menu' | 'campaign';

function loadConfig(): MenuConfig {
  let sensitivity = 1;
  try {
    // Tested for null before parsing, not after: `Number(null)` is 0,
    // which is a perfectly finite number and would clamp to the
    // *slowest* setting rather than the default. Never having chosen
    // has to stay distinguishable from having chosen badly.
    const rawSens = localStorage.getItem(SENS_KEY);
    if (rawSens !== null) sensitivity = clampSensitivity(Number(rawSens));
  } catch {
    // Private-mode browsers throw on storage access; the default is fine.
  }
  return { sensitivity };
}

export default function App(): React.ReactElement {
  const campaignRef = useRef<CampaignGame | null>(null);

  const [campaignSnap, setCampaignSnap] = useState<CampaignHudSnapshot | null>(null);
  const [config, setConfig] = useState<MenuConfig>(loadConfig);
  const [ui, setUi] = useState<UiMode>('menu');

  const attachCampaign = useCallback((canvas: HTMLCanvasElement | null) => {
    campaignRef.current?.destroy();
    campaignRef.current = null;
    if (!canvas) return;

    const initial = loadConfig();
    campaignRef.current = new CampaignGame(canvas, {
      sensitivity: initial.sensitivity,
      onHud: setCampaignSnap,
    });
    campaignRef.current.start();
  }, []);

  const persistConfig = (cfg: MenuConfig): void => {
    setConfig(cfg);
    try {
      localStorage.setItem(SENS_KEY, String(cfg.sensitivity));
    } catch {
      // Non-fatal: the setting simply won't persist.
    }
  };

  const enterCampaign = useCallback((cfg: MenuConfig) => {
    persistConfig(cfg);
    setCampaignSnap(null);
    setUi('campaign');
  }, []);

  const exitCampaign = useCallback(() => {
    setUi('menu');
    setCampaignSnap(null);
  }, []);

  useEffect(() => {
    return () => {
      campaignRef.current?.destroy();
      campaignRef.current = null;
    };
  }, []);

  return (
    <div className="app">
      {ui === 'campaign' && <canvas ref={attachCampaign} className="stage" />}

      {ui === 'campaign' && campaignSnap?.phase === 'playing' && (
        <>
          <CampaignHud snap={campaignSnap} />
          <TouchControls
            game={campaignRef.current}
            adsActive={campaignSnap.adsActive}
            dashReady={campaignSnap.dashReady}
            beaconCharges={campaignSnap.beaconCharges}
          />
        </>
      )}
      {ui === 'campaign' && campaignSnap?.phase === 'paused' && (
        <CampaignPauseScreen
          snap={campaignSnap}
          onUnlock={(id) => campaignRef.current?.tryUnlockNode(id)}
          onResume={() => campaignRef.current?.resume()}
          onQuit={exitCampaign}
          onReset={() => campaignRef.current?.resetProfile()}
        />
      )}
      {ui === 'campaign' && campaignSnap?.phase === 'over' && (
        <CampaignEndScreen snap={campaignSnap} onMenu={exitCampaign} />
      )}
      {ui === 'campaign' && campaignSnap?.phase === 'actBreak' && (
        <CampaignActBreakScreen
          snap={campaignSnap}
          onContinue={() => campaignRef.current?.continueFromActBreak()}
          shopRows={campaignRef.current?.shopRows() ?? []}
          onPurchase={(id, giveBack) => campaignRef.current?.tryPurchase(id, giveBack)}
        />
      )}

      {ui === 'menu' && <Menu initial={config} onCampaign={enterCampaign} />}
    </div>
  );
}
