import {
  ALL_SKILL_NODES,
  LEVEL_XP_THRESHOLDS,
  SKILL_TREE,
  type SkillNodeDef,
} from '../sim/campaign/constants';
import { prereqMet } from '../sim/campaign/skills';
import type { CampaignHudSnapshot } from '../game/campaignGame';
import { ACT_BREAKS } from './arbiter';

const BOSS_PHASE_LABEL: Record<string, string> = {
  // Sentinella
  guard: 'IN GUARDIA',
  telegraph: 'SI PREPARA',
  charge: 'CARICA',
  recover: 'SCOPERTA',
  // Custode
  blackout: 'SPEGNE LE LUCI',
  invert: 'CAPOVOLGE',
  tell: 'SI APRE',
  exposed: 'SCOPERTO',
  // ARBITER
  modules: 'MODULI ATTIVI',
  coreSealed: 'NUCLEO SIGILLATO',
  coreOpening: 'NUCLEO IN APERTURA',
  coreOpen: 'NUCLEO SCOPERTO',
  defeated: 'ABBATTUTO',
};

const ACT_LABEL: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III' };

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

/** Un nodo dell'albero. I tre motivi per cui può essere non
 *  comprabile sono distinti di proposito — "già preso", "ti manca un
 *  punto" e "prima devi prendere quell'altro" sono informazioni
 *  diverse, e un unico pulsante grigio le confonderebbe tutte. */
function SkillNode({
  node,
  unlocked,
  points,
  unlockedNodes,
  onUnlock,
}: {
  node: SkillNodeDef;
  unlocked: boolean;
  points: number;
  unlockedNodes: string[];
  onUnlock: (id: string) => void;
}): React.ReactElement {
  const locked = !prereqMet(unlockedNodes, node.id);
  const affordable = points >= node.cost;
  const reqName = node.requires
    ? (ALL_SKILL_NODES.find((n) => n.id === node.requires)?.name ?? node.requires)
    : null;

  let status = '';
  if (unlocked) status = 'ATTIVO';
  else if (locked) status = `RICHIEDE ${reqName?.toUpperCase()}`;
  else if (!affordable) status = `${node.cost} PUNTO`;

  return (
    <button
      type="button"
      className="skill-node"
      data-unlocked={unlocked || undefined}
      data-locked={locked || undefined}
      disabled={unlocked || locked || !affordable}
      onClick={() => onUnlock(node.id)}
    >
      <span className="skill-node-head">
        <span className="skill-node-name">
          {unlocked ? '✓ ' : ''}
          {node.name}
        </span>
        {status && <span className="skill-node-status">{status}</span>}
      </span>
      <span className="skill-node-desc">{node.desc}</span>
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
      {/* Con la minimappa accesa la colonna smette di stare al centro
          e si sposta a sinistra: restare centrata e basta stringersi
          costerebbe il doppio dello spazio riservato (una colonna
          centrata perde larghezza da entrambi i lati per liberarne uno
          solo), e su un telefono non ne resterebbe abbastanza per
          leggere una riga. */}
      <div
        className="hud-top campaign-hud-top"
        data-minimap={snap.minimapReserve > 0 || undefined}
        style={
          snap.minimapReserve > 0
            ? { maxWidth: `calc(100vw - 24px - ${snap.minimapReserve}px)` }
            : undefined
        }
      >
        {/* Il nome arriva già pronto dallo snapshot: le stanze sono
            dato del livello, e una tabella qui sarebbe una seconda
            lista da aggiornare a ogni livello aggiunto — che è
            esattamente il modo in cui una stanza nuova finirebbe per
            chiamarsi `undefined`. */}
        <div className="hud-clock">
          {ACT_LABEL[snap.levelAct] ?? snap.levelAct} · {snap.levelOrdinal}/
          {snap.levelCount} · {snap.room}
        </div>
        {snap.door.armed && (
          <div className="hud-clock" data-urgent>
            PORTA IN CHIUSURA · {(snap.door.closeTimerMs / 1000).toFixed(1)}s
          </div>
        )}
        {snap.bossActive && snap.bossPhase !== 'defeated' && (
          <div
            className="hud-clock"
            style={snap.bossEnraged ? { color: '#ff7a2f', borderColor: '#ff7a2f' } : undefined}
          >
            {snap.bossName}
            {snap.bossEnraged ? ' ALTERAT' + (snap.bossName === 'SENTINELLA' ? 'A' : 'O') : ''}
            {snap.bossStage !== null && ` · FASE ${snap.bossStage}/3`} —{' '}
            {BOSS_PHASE_LABEL[snap.bossPhase] ?? snap.bossPhase} · {snap.bossDamageTaken}/
            {snap.bossHitsToDefeat}
          </div>
        )}
        <div className="hud-clock">
          LIVELLO {snap.level} · {snap.xp}
          {snap.xpForNextLevel !== null && `/${snap.xpForNextLevel}`} XP
          {snap.availableSkillPoints > 0 &&
            ` · ${snap.availableSkillPoints} ${snap.availableSkillPoints > 1 ? 'PUNTI' : 'PUNTO'} (ESC)`}
        </div>
        {snap.shieldCharges > 0 && (
          <div className="hud-clock" style={{ color: '#44ccff', borderColor: '#44ccff' }}>
            SCUDO{snap.shieldCharges > 1 ? ` ×${snap.shieldCharges}` : ''}
          </div>
        )}
        {/* Solo col nodo Scatto sbloccato: un indicatore per una
            meccanica che non possiedi è rumore. */}
        {snap.dashReady !== null && (
          <div className="hud-clock" data-ready={snap.dashReady >= 1 || undefined}>
            SCATTO{snap.dashReady >= 1 ? ' PRONTO' : ` ${Math.round(snap.dashReady * 100)}%`}
          </div>
        )}
        {snap.blinded && (
          <div className="hud-clock" style={{ color: '#9bff8c', borderColor: '#9bff8c' }}>
            SENSORI CIECHI
          </div>
        )}
        {snap.dark && (
          <div className="hud-clock" style={{ color: '#8fa8d8', borderColor: '#8fa8d8' }}>
            BUIO
          </div>
        )}
        {snap.gravityInverted && (
          <div className="hud-clock" style={{ color: '#b07adf', borderColor: '#b07adf' }}>
            GRAVITÀ INVERTITA
          </div>
        )}
        {snap.muted && <div className="hud-muted">AUDIO MUTO · M</div>}
      </div>

      {/* La lettura del bersaglio sta sotto il mirino e non nella
          colonna in alto: è l'unica informazione della HUD che cambia
          in base a dove stai guardando *adesso*, e cercarla in un
          angolo vorrebbe dire staccare gli occhi da quello che stai
          inquadrando. Esiste solo col nodo Lettura Termica. */}
      {snap.scanned && (
        <div className="campaign-scan">
          <span className="campaign-scan-name">{snap.scanned.name}</span>
          <span className="power-bar campaign-scan-bar">
            <i style={{ width: `${snap.scanned.hp * 100}%` }} />
          </span>
          <span className="campaign-scan-weak">{snap.scanned.weakSpot}</span>
          {snap.scanned.vulnerability !== '—' && (
            <>
              <span className="campaign-scan-sep">·</span>
              <span
                className="campaign-scan-vuln"
                data-open={snap.scanned.windowOpen || undefined}
              >
                {snap.scanned.vulnerability}
              </span>
            </>
          )}
          {snap.scanned.hardened && <span className="campaign-scan-hard">CORAZZATO</span>}
        </div>
      )}

      {snap.arbiter && <div className="arbiter-line">ARBITER — {snap.arbiter}</div>}

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
 *  HUD. Tutti e quattro i rami sono costruiti — vedi GDD.md sezione
 *  6; fino allo Sprint 1 tre di loro erano solo etichette spente. */
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
  const owned = snap.unlockedNodes.length;
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
            Core raccolti: {snap.coresCollected} · Nodi: {owned}/{ALL_SKILL_NODES.length} ·
            Punti disponibili: {snap.availableSkillPoints}
            <br />
            La progressione resta salvata in questo browser; la posizione no —
            uscire e rientrare rigioca il livello dall'Attracco.
          </p>
        </div>

        {SKILL_TREE.map((branch) => (
          <div className="field" key={branch.id}>
            <label>{branch.name}</label>
            <p className="hint" style={{ marginTop: 0 }}>
              {branch.tagline}
            </p>
            {branch.nodes.map((n) => (
              <SkillNode
                key={n.id}
                node={n}
                unlocked={snap.unlockedNodes.includes(n.id)}
                points={snap.availableSkillPoints}
                unlockedNodes={snap.unlockedNodes}
                onUnlock={onUnlock}
              />
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

/** Le frasi di un passaggio d'atto, scaglionate invece che tutte
 *  insieme: un `animationDelay` per riga (vedi `.act-break-line` in
 *  ui.css) invece di un timer React — niente stato da inizializzare
 *  né da ripulire se lo schermo cambia a metà rivelazione, lo stesso
 *  schema che già usa `.arbiter-line` per il proprio fade-in.
 *  Condivisa fra CampaignActBreakScreen e CampaignEndScreen: sono due
 *  schermate diverse (una prosegue, l'altra chiude la campagna) che
 *  raccontano allo stesso modo. */
function ActBreakLines({ lines }: { lines: readonly string[] }): React.ReactElement {
  return (
    <div className="act-break-lines">
      {lines.map((line, i) => (
        <p key={i} className="act-break-line" style={{ animationDelay: `${i * 900}ms` }}>
          {line}
        </p>
      ))}
    </div>
  );
}

/** Schermata d'atto: ferma il gioco fra la fine dell'Atto I o II e
 *  l'inizio del successivo. Non usata per l'Atto III — quello è
 *  CampaignEndScreen più sotto, perché lì non c'è un "prosegui" ma un
 *  "torna al menu", e sovrapporre le due scelte in un solo componente
 *  con un flag `isFinale` si è rivelato più confuso che utile: due
 *  pulsanti diversi restano due componenti, non un ramo. Il pulsante
 *  non aspetta la rivelazione delle righe: bloccarlo avrebbe imposto
 *  il proprio ritmo di lettura a chi il testo lo ha già letto una
 *  volta. */
export function CampaignActBreakScreen({
  snap,
  onContinue,
}: {
  snap: CampaignHudSnapshot;
  onContinue: () => void;
}): React.ReactElement {
  const brk = ACT_BREAKS.find((b) => b.actCompleted === snap.actBreakActCompleted);
  return (
    <div className="overlay">
      <div className="panel">
        <p className="subtitle">
          FINE DELL’ATTO {ACT_LABEL[snap.actBreakActCompleted ?? 1]}
        </p>
        <ActBreakLines lines={brk?.lines ?? []} />
        <button className="btn" type="button" onClick={onContinue}>
          PROSEGUI
        </button>
      </div>
    </div>
  );
}

/** Fine della campagna: sostituisce il vecchio pannello "ARBITER
 *  ABBATTUTO / FINE DELL'ATTO III". Il testo è il terzo ACT_BREAKS —
 *  il finale della storia, non un riassunto di statistiche — e le
 *  statistiche restano ma sotto quel testo, separate da un filo (vedi
 *  `.act-break-stats` in ui.css): sono un riepilogo che il testo si
 *  merita di avere sotto, non qualcosa a cui il testo fa da titolo. */
export function CampaignEndScreen({
  snap,
  onMenu,
}: {
  snap: CampaignHudSnapshot;
  onMenu: () => void;
}): React.ReactElement {
  const brk = ACT_BREAKS.find((b) => b.actCompleted === snap.actBreakActCompleted);
  return (
    <div className="overlay">
      <div className="panel">
        <p className="subtitle">FINE DELLA CAMPAGNA</p>
        <ActBreakLines lines={brk?.lines ?? []} />
        <p className="hint act-break-stats">
          Livello {snap.level} · {snap.xp} XP · Core raccolti: {snap.coresCollected} · Nodi
          sbloccati: {snap.unlockedNodes.length} / {ALL_SKILL_NODES.length}
        </p>
        <button className="btn" type="button" onClick={onMenu}>
          TORNA AL MENU
        </button>
      </div>
    </div>
  );
}
