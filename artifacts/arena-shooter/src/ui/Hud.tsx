import { PU_LABEL, PU_COLOR, skinOf } from '../render/palette';
import { TIME_WARNING_MS } from '../sim/constants';
import type { ActivePower, HudSnapshot } from '../game/game';

/** mm:ss, floored — a clock that rounds up would show 0:00 with time
 *  still on it. */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** One carried power-up: label, remaining seconds, and a draining bar.
 *  The bar is omitted when the exact figure is unknown (see
 *  ActivePower.msLeft) rather than faked at full. */
function PowerPill({ power }: { power: ActivePower }): React.ReactElement {
  const color = PU_COLOR[power.kind];
  return (
    <div className="power" style={{ borderColor: color }}>
      <span className="power-name" style={{ color }}>
        {PU_LABEL[power.kind]}
      </span>
      {power.msLeft !== null && (
        <span className="power-secs">{(power.msLeft / 1000).toFixed(1)}s</span>
      )}
      {power.fraction !== null && (
        <span className="power-bar">
          <i
            style={{
              width: `${Math.max(0, Math.min(1, power.fraction)) * 100}%`,
              background: color,
            }}
          />
        </span>
      )}
    </div>
  );
}

/** In-match HUD. Everything here is DOM rather than canvas, so it
 *  scales with the browser, stays selectable by devtools, and does
 *  not cost a redraw on frames where nothing changed. */
export function Hud({ snap }: { snap: HudSnapshot }): React.ReactElement {
  const urgent = snap.timeLeftMs <= TIME_WARNING_MS;

  return (
    <div className="hud">
      <div className="hud-scores">
        {snap.scores.map((s) => (
          <div
            key={s.id}
            className="hud-row"
            data-local={s.isLocal}
            data-alive={s.alive}
          >
            <span className="dot" />
            <span
              className="swatch"
              style={{ background: skinOf(s.skin).body, marginRight: 0 }}
            />
            <span className="name">{s.name}</span>
            <span className="kills">{s.kills}</span>
          </div>
        ))}
      </div>

      <div className="hud-top">
        <div className="hud-clock" data-urgent={urgent}>
          {clock(snap.timeLeftMs)}
        </div>
        {snap.net && (
          <div className="hud-net">
            {snap.net === 'host' ? 'OSPITE' : 'CLIENTE'}
            {snap.ping > 0 && <> · {snap.ping}ms</>}
          </div>
        )}
        {snap.muted && <div className="hud-muted">AUDIO MUTO · M</div>}
      </div>

      {/* Bottom-left is the only free corner: the minimap owns the top
          right and the kill feed hangs below it. */}
      <div className="hud-status">
        {snap.streak >= 2 && <div className="hud-streak">SERIE ×{snap.streak}</div>}
        {snap.powers.map((p) => (
          <PowerPill key={p.kind} power={p} />
        ))}
      </div>

      <div className="hud-target">PRIMO A {snap.killTarget} UCCISIONI</div>

      {!snap.pointerLocked && (
        <div className="hud-hint">
          CLICCA PER CATTURARE IL MOUSE &nbsp;·&nbsp; Q / E PER GIRARE SENZA
        </div>
      )}
    </div>
  );
}
