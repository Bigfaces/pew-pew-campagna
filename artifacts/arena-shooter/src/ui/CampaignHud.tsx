import { PRECISION_NODES } from '../sim/campaign/constants';
import type { CampaignHudSnapshot } from '../game/campaignGame';

const ROOM_LABEL: Record<CampaignHudSnapshot['room'], string> = {
  attracco: 'ATTRACCO',
  corridoio: 'CORRIDOIO',
  magazzino: 'MAGAZZINO',
  molo: 'MOLO',
};

const BOSS_PHASE_LABEL: Record<string, string> = {
  guard: 'IN GUARDIA',
  telegraph: 'SI PREPARA',
  charge: 'CARICA',
  recover: 'SCOPERTA',
  defeated: 'ABBATTUTA',
};

/** In-match overlay: room, cores, the Precisione skill tree, and a
 *  countdown warning while the timed door is armed. DOM rather than
 *  canvas, same reasoning as the Arena's Hud. */
export function CampaignHud({
  snap,
  onUnlock,
}: {
  snap: CampaignHudSnapshot;
  onUnlock: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-clock">{ROOM_LABEL[snap.room]}</div>
        {snap.door.armed && (
          <div className="hud-clock" data-urgent>
            PORTA IN CHIUSURA · {(snap.door.closeTimerMs / 1000).toFixed(1)}s
          </div>
        )}
        {snap.bossActive && snap.bossPhase !== 'defeated' && (
          <div className="hud-clock">
            SENTINELLA — {BOSS_PHASE_LABEL[snap.bossPhase] ?? snap.bossPhase} ·{' '}
            {snap.bossDamageTaken}/{snap.bossHitsToDefeat}
          </div>
        )}
        {snap.muted && <div className="hud-muted">AUDIO MUTO · M</div>}
      </div>

      <div
        className="hud-scores"
        style={{ left: 'auto', right: 14, pointerEvents: 'auto' }}
      >
        <div className="hud-row">
          <span className="dot" style={{ background: '#5eead4' }} />
          <span className="name">CORE</span>
          <span className="kills">
            {snap.availableCores} / {snap.coresCollected}
          </span>
        </div>
        {PRECISION_NODES.map((n) => {
          const unlocked = snap.unlockedNodes.includes(n.id);
          const affordable = snap.availableCores >= n.cost;
          return (
            <button
              key={n.id}
              type="button"
              className="btn secondary"
              disabled={unlocked || !affordable}
              onClick={() => onUnlock(n.id)}
              style={{
                marginTop: 6,
                padding: '6px 10px',
                fontSize: 11,
                opacity: unlocked ? 0.6 : 1,
              }}
            >
              {unlocked ? '✓ ' : `${n.cost} core · `}
              {n.name}
            </button>
          );
        })}
      </div>

      {!snap.pointerLocked && (
        <div className="hud-hint">
          CLICCA PER CATTURARE IL MOUSE &nbsp;·&nbsp; Q / E PER GIRARE SENZA
        </div>
      )}
    </div>
  );
}

export function CampaignPauseScreen({
  onResume,
  onQuit,
}: {
  onResume: () => void;
  onQuit: () => void;
}): React.ReactElement {
  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title" style={{ fontSize: 32 }}>
          IN PAUSA
        </h1>
        <p className="subtitle">KESSLER-9 ASPETTA</p>
        <button className="btn" type="button" onClick={onResume}>
          RIPRENDI
        </button>
        <button className="btn secondary" type="button" onClick={onQuit}>
          ABBANDONA LA MISSIONE
        </button>
      </div>
    </div>
  );
}

export function CampaignEndScreen({
  snap,
  onMenu,
}: {
  snap: CampaignHudSnapshot;
  onMenu: () => void;
}): React.ReactElement {
  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title" style={{ fontSize: 34 }}>
          SENTINELLA ABBATTUTA
        </h1>
        <p className="subtitle">IL MOLO È LIBERO — FINE DELLA VERTICAL SLICE</p>
        <p className="hint">
          Core raccolti: {snap.coresCollected} · Nodi Precisione sbloccati:{' '}
          {snap.unlockedNodes.length} / {PRECISION_NODES.length}
        </p>
        <button className="btn" type="button" onClick={onMenu}>
          TORNA AL MENU
        </button>
      </div>
    </div>
  );
}
