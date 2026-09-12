import { LEVEL_XP_THRESHOLDS, PRECISION_NODES } from '../sim/campaign/constants';
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

/** A locked branch's nodes, shown for context in the skill menu even
 *  though nothing here does anything yet — GDD.md section 6 names
 *  them as the plan, not a promise of this sprint. */
const PLANNED_BRANCHES: { name: string; nodes: string[] }[] = [
  { name: 'MOBILITÀ', nodes: ['Scatto breve', 'Passo silenzioso', 'Velocità base +'] },
  { name: 'SOPRAVVIVENZA', nodes: ['Scudo aggiuntivo', 'Rigenerazione tra le stanze'] },
  { name: 'PERCEZIONE', nodes: ['Minimappa estesa', 'Direzione dei passi più precisa'] },
];

/** 0..1 progress through the current level's XP band. `null` next
 *  threshold means the top of the table — shown as a full bar rather
 *  than a hard level cap. */
function levelProgress(xp: number, level: number, next: number | null): number {
  const floor = LEVEL_XP_THRESHOLDS[level - 1] ?? 0;
  if (next === null) return 1;
  return Math.max(0, Math.min(1, (xp - floor) / (next - floor)));
}

function XpBar({ snap }: { snap: CampaignHudSnapshot }): React.ReactElement {
  const progress = levelProgress(snap.xp, snap.level, snap.xpForNextLevel);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span>LIVELLO {snap.level}</span>
        <span className="hint" style={{ margin: 0 }}>
          {snap.xp} XP
          {snap.xpForNextLevel !== null && ` / ${snap.xpForNextLevel}`}
        </span>
      </div>
      <span className="power-bar" style={{ display: 'block', marginTop: 4 }}>
        <i style={{ width: `${progress * 100}%`, background: '#7dfc9a' }} />
      </span>
    </div>
  );
}

function NodeButton({
  id,
  name,
  cost,
  unlocked,
  affordable,
  onUnlock,
}: {
  id: string;
  name: string;
  cost: number;
  unlocked: boolean;
  affordable: boolean;
  onUnlock: (id: string) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="btn secondary"
      disabled={unlocked || !affordable}
      onClick={() => onUnlock(id)}
      style={{
        marginTop: 6,
        padding: '6px 10px',
        fontSize: 11,
        opacity: unlocked ? 0.6 : 1,
        width: '100%',
      }}
    >
      {unlocked ? '✓ ' : `${cost} · `}
      {name}
    </button>
  );
}

/** Compact in-game overlay: room, the timed-door warning, boss status,
 *  and a small level/XP readout. Everything you can act on (spending
 *  skill points) lives in the pause menu instead — see
 *  CampaignPauseScreen — so the live view stays uncluttered on a
 *  small screen. */
export function CampaignHud({ snap }: { snap: CampaignHudSnapshot }): React.ReactElement {
  return (
    <div className="hud">
      {/* One centred column rather than a second corner panel: two
          independently-positioned boxes at the same top offset is
          exactly what used to collide on phone-width screens (see
          ui.css .campaign-hud-top) — sharing one column is immune to
          that by construction, whatever either box's content length. */}
      <div className="hud-top campaign-hud-top">
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
        <div className="hud-clock">
          LIVELLO {snap.level} · {snap.xp}
          {snap.xpForNextLevel !== null && `/${snap.xpForNextLevel}`} XP
          {snap.availableSkillPoints > 0 &&
            ` · ${snap.availableSkillPoints} PUNTO${snap.availableSkillPoints > 1 ? 'I' : ''} (ESC)`}
        </div>
        {snap.shieldActive && (
          <div className="hud-clock" style={{ color: '#44ccff', borderColor: '#44ccff' }}>
            SCUDO ATTIVO
          </div>
        )}
        {snap.muted && <div className="hud-muted">AUDIO MUTO · M</div>}
      </div>

      {!snap.pointerLocked && (
        <div className="hud-hint campaign-hud-hint">
          CLICCA PER CATTURARE IL MOUSE &nbsp;·&nbsp; Q / E PER GIRARE SENZA
        </div>
      )}
    </div>
  );
}

/** Pause + progression menu. Doubles as the "crea il menu" ask: this
 *  is where the skill tree actually lives, not crammed into the live
 *  HUD. Mobilità/Sopravvivenza/Percezione are shown locked, matching
 *  the plan in GDD.md section 6 rather than pretending they exist. */
export function CampaignPauseScreen({
  snap,
  onUnlock,
  onResume,
  onQuit,
  onReset,
}: {
  snap: CampaignHudSnapshot;
  onUnlock: (id: string) => void;
  onResume: () => void;
  onQuit: () => void;
  onReset: () => void;
}): React.ReactElement {
  return (
    <div className="overlay">
      <div className="panel" style={{ maxWidth: 560 }}>
        <h1 className="title" style={{ fontSize: 32 }}>
          IN PAUSA
        </h1>
        <p className="subtitle">KESSLER-9 ASPETTA</p>

        <div className="field">
          <label>PROGRESSIONE</label>
          <XpBar snap={snap} />
          <p className="hint">
            Core raccolti: {snap.coresCollected} · Punti disponibili:{' '}
            {snap.availableSkillPoints}
            <br />
            La progressione resta salvata in questo browser; la posizione no —
            uscire e rientrare rigioca il livello dall'Attracco.
          </p>
        </div>

        <div className="field">
          <label>PRECISIONE</label>
          {PRECISION_NODES.map((n) => (
            <NodeButton
              key={n.id}
              id={n.id}
              name={n.name}
              cost={n.cost}
              unlocked={snap.unlockedNodes.includes(n.id)}
              affordable={snap.availableSkillPoints >= n.cost}
              onUnlock={onUnlock}
            />
          ))}
        </div>

        {PLANNED_BRANCHES.map((branch) => (
          <div className="field" key={branch.name} style={{ opacity: 0.5 }}>
            <label>{branch.name} — PROSSIMAMENTE</label>
            {branch.nodes.map((n) => (
              <button
                key={n}
                type="button"
                className="btn secondary"
                disabled
                style={{ marginTop: 6, padding: '6px 10px', fontSize: 11, width: '100%' }}
              >
                {n}
              </button>
            ))}
          </div>
        ))}

        <button className="btn" type="button" onClick={onResume}>
          RIPRENDI
        </button>
        <button className="btn secondary" type="button" onClick={onQuit}>
          ABBANDONA LA MISSIONE
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={onReset}
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          AZZERA LA PROGRESSIONE
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
          Livello {snap.level} · {snap.xp} XP · Core raccolti: {snap.coresCollected} · Nodi
          Precisione sbloccati: {snap.unlockedNodes.length} / {PRECISION_NODES.length}
        </p>
        <button className="btn" type="button" onClick={onMenu}>
          TORNA AL MENU
        </button>
      </div>
    </div>
  );
}
