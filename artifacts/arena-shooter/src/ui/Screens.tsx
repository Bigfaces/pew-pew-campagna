import { useEffect, useState } from 'react';

import type { HudSnapshot, MatchSummary } from '../game/game';
import { skinOf } from '../render/palette';
import {
  ADS_SENS_MULT,
  clampSensitivity,
  DIFFICULTIES,
  killTarget,
  SENS_MAX,
  SENS_MIN,
  SENS_STEP,
  type Difficulty,
} from '../sim/constants';
import {
  accuracyOf,
  fetchLeaderboard,
  readLocalCareer,
  type CareerTotals,
  type LeaderboardEntry,
} from '../stats/client';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Movimento — avanti, indietro, laterale'],
  ['MOUSE', 'Mira — clicca una volta per catturare il puntatore'],
  ['Q / E', 'Rotazione — funziona sempre, anche senza mouse'],
  ['CLICK SIN.', 'Sparo — un colpo uccide, otturatore da riarmare'],
  ['CLICK DES.', "Ottica — tieni premuto per mirare col cannocchiale"],
  ['ESC', 'Pausa'],
  ['M', 'Muto'],
];

/** Difficulty keys are simulation values; their labels are not. */
const DIFF_LABEL: Record<Difficulty, string> = {
  facile: 'FACILE',
  normale: 'NORMALE',
  difficile: 'DIFFICILE',
};

/** The roster is not a difficulty setting — it changes what game you
 *  are playing. One opponent is a duel of patience; seven is a brawl
 *  where the rifle barely has time to cycle. Saying so beats letting
 *  someone find out by picking a number. */
const ROSTER_NOTE: Record<number, string> = {
  1: 'Duello: lento, di posizione, si vince ascoltando',
  2: 'Triangolo: chi spara per primo si scopre',
  3: 'Equilibrato: la taratura di riferimento',
  5: 'Affollata: scontri continui, poca pausa',
  7: 'Mischia: caos, il fucile fa appena in tempo a riarmarsi',
};

const DIFF_NOTE: Record<Difficulty, string> = {
  facile: 'I bot reagiscono lenti, mirano male e si muovono piano.',
  normale: 'Taratura di riferimento: reazione ~0,5 s, mira imprecisa.',
  difficile: 'Reazione ~0,3 s, mira quasi perfetta, vista più ampia.',
};

function Controls(): React.ReactElement {
  return (
    <dl className="controls">
      {CONTROLS.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Look sensitivity, shown as a multiplier because the underlying
 *  figure is radians per mouse pixel and nobody has an opinion about
 *  those. Rendered in the menu *and* in the pause screen: the menu is
 *  where you find the setting, but a pointer speed can only really be
 *  judged with the arena in front of you, and there it applies as you
 *  drag rather than on the next match. */
function SensitivityField({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <div className="field">
      <label htmlFor="sens">
        SENSIBILITÀ MOUSE — {value.toFixed(2)}×
      </label>
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
        {Math.round(ADS_SENS_MULT * 100)}%: mirare col cannocchiale resta lento
        per scelta.
      </p>
    </div>
  );
}

export interface MenuConfig {
  name: string;
  bots: number;
  difficulty: Difficulty;
  /** Multiplier on MOUSE_SENSITIVITY, 1 by default. */
  sensitivity: number;
}

export function Menu({
  onStart,
  onCampaign,
  onHost,
  onJoin,
  onStats,
  initial,
  netAvailable,
  standalone = false,
  error,
}: {
  onStart: (cfg: MenuConfig) => void;
  onCampaign: () => void;
  onHost: (cfg: MenuConfig) => void;
  onJoin: (cfg: MenuConfig, room: string) => void;
  onStats: (cfg: MenuConfig) => void;
  initial: MenuConfig;
  netAvailable: boolean;
  standalone?: boolean;
  error: string | null;
}): React.ReactElement {
  const [name, setName] = useState(initial.name);
  const [bots, setBots] = useState(initial.bots);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial.difficulty);
  const [sensitivity, setSensitivity] = useState(initial.sensitivity);
  const [room, setRoom] = useState('');
  const [joining, setJoining] = useState(false);

  const cfg = (): MenuConfig => ({
    name: (name.trim().slice(0, 12) || 'GIOCATORE').toUpperCase(),
    bots,
    difficulty,
    sensitivity,
  });

  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title">ARENA SNIPER</h1>
        <p className="subtitle">
          TUTTI CONTRO TUTTI · OTTURATORE · UN COLPO UCCIDE
        </p>

        <div className="field">
          <label htmlFor="pname">NOME IN CODICE</label>
          <input
            id="pname"
            type="text"
            value={name}
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <label>AVVERSARI</label>
          <div className="seg">
            {[1, 2, 3, 5, 7].map((n) => (
              <button
                key={n}
                type="button"
                data-on={bots === n}
                onClick={() => setBots(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="hint">
            {ROSTER_NOTE[bots] ?? ''} · primo a {killTarget(bots + 1)} uccisioni
          </p>
        </div>

        <div className="field">
          <label>DIFFICOLTÀ</label>
          <div className="seg">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                data-on={difficulty === d}
                onClick={() => setDifficulty(d)}
              >
                {DIFF_LABEL[d]}
              </button>
            ))}
          </div>
          <p className="hint">{DIFF_NOTE[difficulty]}</p>
        </div>

        <SensitivityField value={sensitivity} onChange={setSensitivity} />

        {error && (
          <p className="muted-note" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        {joining ? (
          <div className="field">
            <label htmlFor="room">CODICE STANZA</label>
            <input
              id="room"
              type="text"
              value={room}
              maxLength={8}
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCD"
              onChange={(e) => setRoom(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && room.length >= 4) onJoin(cfg(), room);
              }}
            />
          </div>
        ) : (
          <Controls />
        )}

        {joining ? (
          <>
            <button
              className="btn"
              type="button"
              disabled={room.length < 4}
              onClick={() => onJoin(cfg(), room)}
            >
              CONNETTI
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => setJoining(false)}
            >
              INDIETRO
            </button>
          </>
        ) : (
          <>
            <button className="btn" type="button" onClick={() => onStart(cfg())}>
              ▶ {standalone ? 'ENTRA NELL’ARENA' : 'GIOCATORE SINGOLO'}
            </button>
            <button className="btn secondary" type="button" onClick={onCampaign}>
              CAMPAGNA (BETA) — KESSLER-9
            </button>
            {/* Hidden entirely in the standalone build: an online
                button there could only ever fail. */}
            {!standalone && (
              <>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={!netAvailable}
                  onClick={() => onHost(cfg())}
                >
                  OSPITA PARTITA ONLINE
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={!netAvailable}
                  onClick={() => setJoining(true)}
                >
                  ENTRA CON UN CODICE
                </button>
              </>
            )}
            <button
              className="btn secondary"
              type="button"
              onClick={() => onStats(cfg())}
            >
              STATISTICHE
            </button>
          </>
        )}

        <p className="muted-note">
          {standalone
            ? 'Versione a file singolo — nessun server, nessuna rete, niente da installare.'
            : netAvailable
              ? 'Le partite online sono peer-to-peer: il server fa solo incontrare i giocatori.'
              : 'Questo browser non supporta WebRTC, quindi il gioco online non è disponibile.'}
        </p>
      </div>
    </div>
  );
}

/** Career totals from local storage, plus the global board when the
 *  backend has a database. Both degrade quietly: no database is a
 *  supported configuration, not an error to report. */
export function StatsScreen({
  onBack,
}: {
  onBack: () => void;
}): React.ReactElement {
  const [career] = useState<CareerTotals>(readLocalCareer);
  const [board, setBoard] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void fetchLeaderboard(10).then((rows) => {
      if (!live) return;
      setBoard(rows);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const ratio =
    career.deaths > 0
      ? (career.kills / career.deaths).toFixed(2)
      : career.kills.toFixed(2);

  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title" style={{ fontSize: 30 }}>
          STATISTICHE
        </h1>
        <p className="subtitle">CARRIERA E CLASSIFICA</p>

        {career.matches === 0 ? (
          <p className="muted-note">
            Nessuna partita registrata. Giocane una e torna qui.
          </p>
        ) : (
          <div className="stats">
            <div className="stat">
              <b>{career.matches}</b>
              <span>PARTITE</span>
            </div>
            <div className="stat">
              <b>{career.wins}</b>
              <span>VITTORIE</span>
            </div>
            <div className="stat">
              <b>{career.kills}</b>
              <span>UCCISIONI</span>
            </div>
            <div className="stat">
              <b>{ratio}</b>
              <span>RAPPORTO U/M</span>
            </div>
            <div className="stat">
              <b>{Math.round(accuracyOf(career))}%</b>
              <span>PRECISIONE</span>
            </div>
            <div className="stat">
              <b>{career.bestStreak}</b>
              <span>SERIE RECORD</span>
            </div>
          </div>
        )}

        {loading ? (
          <p className="muted-note">Carico la classifica…</p>
        ) : board === null ? (
          <p className="muted-note">
            Classifica globale non disponibile: il server non ha un database
            configurato. Le statistiche qui sopra restano salvate in questo
            browser.
          </p>
        ) : board.length === 0 ? (
          <p className="muted-note">La classifica globale è ancora vuota.</p>
        ) : (
          <table className="board">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>GIOCATORE</th>
                <th className="num">V</th>
                <th className="num">U</th>
              </tr>
            </thead>
            <tbody>
              {board.map((row, i) => (
                <tr key={row.callsign}>
                  <td className="rank" data-first={i === 0}>
                    {i === 0 ? '★' : i + 1}
                  </td>
                  <td>{row.callsign}</td>
                  <td className="num">{row.wins}</td>
                  <td className="num">{row.kills}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button className="btn" type="button" onClick={onBack}>
          INDIETRO
        </button>
      </div>
    </div>
  );
}

/** Pre-match room. The host sees the code and starts; guests wait. */
export function Lobby({
  code,
  slots,
  isHost,
  bots,
  onBots,
  difficulty,
  onDifficulty,
  onStart,
  onLeave,
  status,
}: {
  code: string;
  slots: { peerId: string; name: string; skin: number; isHost: boolean }[];
  isHost: boolean;
  bots: number;
  onBots: (n: number) => void;
  difficulty: Difficulty;
  onDifficulty: (d: Difficulty) => void;
  onStart: () => void;
  onLeave: () => void;
  status: string;
}): React.ReactElement {
  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title" style={{ fontSize: 30 }}>
          {isHost ? 'STAI OSPITANDO' : 'SEI ENTRATO'}
        </h1>
        <p className="subtitle">
          {code ? `CODICE STANZA — ${code}` : 'CONNESSIONE…'}
        </p>

        <table className="board">
          <thead>
            <tr>
              <th>GIOCATORI NELLA STANZA</th>
              <th className="num">RUOLO</th>
            </tr>
          </thead>
          <tbody>
            {slots.length === 0 && (
              <tr>
                <td colSpan={2} style={{ color: 'var(--dim)' }}>
                  in attesa…
                </td>
              </tr>
            )}
            {slots.map((s) => (
              <tr key={s.peerId}>
                <td>
                  <span
                    className="swatch"
                    style={{ background: skinOf(s.skin).body }}
                  />
                  {s.name}
                </td>
                <td className="num" style={{ color: 'var(--dim)' }}>
                  {s.isHost ? 'OSPITE' : 'CLIENTE'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {isHost && (
          <>
            <div className="field">
              <label>RIEMPI I POSTI LIBERI CON BOT</label>
              <div className="seg">
                {[0, 1, 2, 3, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    data-on={bots === n}
                    onClick={() => onBots(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>DIFFICOLTÀ DEI BOT</label>
              <div className="seg">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    data-on={difficulty === d}
                    onClick={() => onDifficulty(d)}
                  >
                    {DIFF_LABEL[d]}
                  </button>
                ))}
              </div>
              {/* Bots only ever run on the host, so this is the one
                  setting in the lobby that guests do not need sent. */}
              <p className="hint">Vale per tutti: i bot girano sull’ospite.</p>
            </div>
          </>
        )}

        {status && <p className="muted-note">{status}</p>}

        {isHost ? (
          <button className="btn" type="button" onClick={onStart}>
            AVVIA PARTITA
          </button>
        ) : (
          <p className="muted-note">In attesa che l’ospite avvii la partita…</p>
        )}
        <button className="btn secondary" type="button" onClick={onLeave}>
          ESCI
        </button>
      </div>
    </div>
  );
}

export function PauseScreen({
  onResume,
  onQuit,
  sensitivity,
  onSensitivity,
}: {
  onResume: () => void;
  onQuit: () => void;
  sensitivity: number;
  onSensitivity: (v: number) => void;
}): React.ReactElement {
  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title" style={{ fontSize: 32 }}>
          IN PAUSA
        </h1>
        <p className="subtitle">L’ARENA ASPETTA</p>
        <Controls />
        <SensitivityField value={sensitivity} onChange={onSensitivity} />
        <button className="btn" type="button" onClick={onResume}>
          RIPRENDI
        </button>
        <button className="btn secondary" type="button" onClick={onQuit}>
          ABBANDONA LA PARTITA
        </button>
      </div>
    </div>
  );
}

export function EndScreen({
  snap,
  summary,
  onRematch,
  onMenu,
}: {
  snap: HudSnapshot;
  summary: MatchSummary | null;
  onRematch: () => void;
  onMenu: () => void;
}): React.ReactElement {
  const won = snap.winnerId === snap.localId;
  const winner = snap.scores.find((s) => s.id === snap.winnerId);
  // A match that ran out of clock is decided differently from one won
  // on kills, and saying so avoids the end screen looking arbitrary.
  const onTime = snap.timeLeftMs <= 0;

  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title" style={{ fontSize: 34 }}>
          {won ? 'VITTORIA' : 'SCONFITTA'}
        </h1>
        <p className="subtitle">
          {winner
            ? onTime
              ? `TEMPO SCADUTO — ${winner.name} È IN TESTA`
              : `${winner.name} SI PRENDE L’ARENA`
            : 'PARTITA CONCLUSA'}
        </p>

        <table className="board">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th>GIOCATORE</th>
              <th className="num">U</th>
              <th className="num">M</th>
            </tr>
          </thead>
          <tbody>
            {snap.scores.map((s, i) => (
              <tr key={s.id} data-local={s.isLocal}>
                <td className="rank" data-first={i === 0}>
                  {i === 0 ? '★' : i + 1}
                </td>
                <td>
                  <span
                    className="swatch"
                    style={{ background: skinOf(s.skin).body }}
                  />
                  {s.name}
                </td>
                <td className="num">{s.kills}</td>
                <td className="num">{s.deaths}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {summary && (
          <div className="stats">
            <div className="stat">
              <b>{summary.kills}</b>
              <span>UCCISIONI</span>
            </div>
            <div className="stat">
              <b>
                {summary.shotsFired > 0
                  ? Math.round((summary.shotsHit / summary.shotsFired) * 100)
                  : 0}
                %
              </b>
              <span>PRECISIONE</span>
            </div>
            <div className="stat">
              <b>{summary.bestStreak}</b>
              <span>SERIE MIGLIORE</span>
            </div>
            <div className="stat">
              <b>{Math.round(summary.durationMs / 1000)}s</b>
              <span>DURATA</span>
            </div>
          </div>
        )}

        <button className="btn" type="button" onClick={onRematch}>
          ⟲ RIVINCITA
        </button>
        <button className="btn secondary" type="button" onClick={onMenu}>
          MENU PRINCIPALE
        </button>
      </div>
    </div>
  );
}
