import { useCallback, useEffect, useRef, useState } from 'react';

import { Game, type HudSnapshot, type MatchSummary } from './game/game';
import { webrtcSupported } from './net/peer';
import type { LobbySlot } from './net/protocol';
import { GuestSession, HostSession, type SessionEvents } from './net/session';
import { skinOf } from './render/palette';
import { recordMatch } from './stats/client';
import {
  clampSensitivity,
  DIFFICULTIES,
  type Difficulty,
} from './sim/constants';
import type { SlotConfig } from './sim/world';
import { Hud } from './ui/Hud';
import {
  EndScreen,
  Lobby,
  Menu,
  PauseScreen,
  StatsScreen,
  type MenuConfig,
} from './ui/Screens';
import './ui/ui.css';

const NAME_KEY = 'arena-sniper.callsign';
const DIFF_KEY = 'arena-sniper.difficulty';
const SENS_KEY = 'arena-sniper.sensitivity';

/** True in the single-file build opened straight from disk. There is
 *  no origin to reach a signaling server from, so online play is
 *  hidden rather than offered and left to fail. */
const STANDALONE = import.meta.env['VITE_STANDALONE'] === '1';

type UiMode = 'menu' | 'lobby' | 'stats';

function isDifficulty(v: string | null): v is Difficulty {
  return v !== null && (DIFFICULTIES as readonly string[]).includes(v);
}

function loadConfig(): MenuConfig {
  let name = 'GIOCATORE';
  let difficulty: Difficulty = 'normale';
  let sensitivity = 1;
  try {
    name = localStorage.getItem(NAME_KEY) || name;
    const stored = localStorage.getItem(DIFF_KEY);
    if (isDifficulty(stored)) difficulty = stored;
    // Tested for null before parsing, not after: `Number(null)` is 0,
    // which is a perfectly finite number and would clamp to the
    // *slowest* setting rather than the default. Never having chosen
    // has to stay distinguishable from having chosen badly.
    const rawSens = localStorage.getItem(SENS_KEY);
    if (rawSens !== null) sensitivity = clampSensitivity(Number(rawSens));
  } catch {
    // Private-mode browsers throw on storage access; the defaults are fine.
  }
  return { name, bots: 3, difficulty, sensitivity };
}

/** Slots for an offline match: the local player plus bots, each
 *  taking the next skin so no two share a colour. */
function soloSlots(cfg: MenuConfig): SlotConfig[] {
  const slots: SlotConfig[] = [{ name: cfg.name, skin: 0, controller: 'local' }];
  for (let i = 0; i < cfg.bots; i++) {
    slots.push({ name: skinOf(i + 1).name, skin: i + 1, controller: 'bot' });
  }
  return slots;
}

export default function App(): React.ReactElement {
  const gameRef = useRef<Game | null>(null);
  const hostRef = useRef<HostSession | null>(null);
  const guestRef = useRef<GuestSession | null>(null);

  const [snap, setSnap] = useState<HudSnapshot | null>(null);
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [config, setConfig] = useState<MenuConfig>(loadConfig);

  const [ui, setUi] = useState<UiMode>('menu');
  const [lobbySlots, setLobbySlots] = useState<LobbySlot[]>([]);
  const [roomCode, setRoomCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [lobbyBots, setLobbyBots] = useState(1);
  const [lobbyDiff, setLobbyDiff] = useState<Difficulty>(
    () => loadConfig().difficulty,
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const attach = useCallback((canvas: HTMLCanvasElement | null) => {
    gameRef.current?.destroy();
    gameRef.current = null;
    if (!canvas) return;

    const initial = loadConfig();
    gameRef.current = new Game(canvas, {
      slots: soloSlots(initial),
      difficulty: initial.difficulty,
      sensitivity: initial.sensitivity,
      onHud: setSnap,
      onMatchEnd: (s) => {
        setSummary(s);
        // Fire-and-forget: a stats outage must never block the UI.
        void recordMatch(s, loadConfig().name);
      },
    });
    gameRef.current.start();
  }, []);

  const teardownNet = useCallback(() => {
    hostRef.current?.dispose();
    hostRef.current = null;
    guestRef.current?.dispose();
    guestRef.current = null;
    gameRef.current?.setNetwork(null);
  }, []);

  useEffect(() => {
    return () => {
      teardownNet();
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, [teardownNet]);

  const persistConfig = (cfg: MenuConfig): void => {
    setConfig(cfg);
    // The one place a setting leaves the menu, so it is also the one
    // place the live game has to be told about it — every entry point
    // below already routes through here.
    gameRef.current?.setSensitivity(cfg.sensitivity);
    try {
      localStorage.setItem(NAME_KEY, cfg.name);
      localStorage.setItem(DIFF_KEY, cfg.difficulty);
      localStorage.setItem(SENS_KEY, String(cfg.sensitivity));
    } catch {
      // Non-fatal: the settings simply won't persist.
    }
  };

  // ---- single player -------------------------------------------------

  const startSolo = useCallback(
    (cfg: MenuConfig) => {
      persistConfig(cfg);
      teardownNet();
      setSummary(null);
      setError(null);
      setUi('menu');
      gameRef.current?.newMatch(
        soloSlots(cfg),
        undefined,
        undefined,
        cfg.difficulty,
      );
    },
    [teardownNet],
  );

  const rematch = useCallback(() => {
    setSummary(null);
    // Online rematches would need a fresh lobby handshake, so an
    // ended online match returns to solo rather than pretending.
    teardownNet();
    gameRef.current?.newMatch(
      soloSlots(config),
      undefined,
      undefined,
      config.difficulty,
    );
  }, [config, teardownNet]);

  // ---- online --------------------------------------------------------

  const sessionEvents = useCallback(
    (): SessionEvents => ({
      onLobby: setLobbySlots,
      onStart: (slots, localId, seed) => {
        setUi('menu');
        setSummary(null);
        // A guest runs no AI of its own — bots live on the host — so the
        // difficulty it passes here only labels its own world state.
        gameRef.current?.newMatch(slots, seed, localId);
      },
      onError: (message) => {
        setError(message);
        setStatus('');
      },
      onPeerLeft: () => setStatus(''),
    }),
    [],
  );

  const host = useCallback(
    async (cfg: MenuConfig) => {
      persistConfig(cfg);
      teardownNet();
      setError(null);
      setLobbyDiff(cfg.difficulty);
      setStatus('contatto il server di signaling…');

      const session = new HostSession(cfg.name, sessionEvents());
      hostRef.current = session;
      setIsHost(true);
      setUi('lobby');
      setLobbySlots([]);

      try {
        const code = await session.open();
        setRoomCode(code);
        setStatus('condividi il codice, poi avvia quando sono tutti dentro');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'impossibile ospitare');
        setUi('menu');
        teardownNet();
      }
    },
    [sessionEvents, teardownNet],
  );

  const join = useCallback(
    async (cfg: MenuConfig, room: string) => {
      persistConfig(cfg);
      teardownNet();
      setError(null);
      setStatus('connessione all’ospite…');

      const session = new GuestSession(cfg.name, sessionEvents());
      guestRef.current = session;
      session.onEvents = (events) => gameRef.current?.ingestRemoteEvents(events);
      setIsHost(false);
      setUi('lobby');
      setRoomCode(room);
      setLobbySlots([]);

      try {
        await session.join(room);
        gameRef.current?.setNetwork(session);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'impossibile entrare');
        setUi('menu');
        teardownNet();
      }
    },
    [sessionEvents, teardownNet],
  );

  const startHosted = useCallback(() => {
    const session = hostRef.current;
    if (!session) return;
    const slots = session.startMatch(lobbyBots);
    gameRef.current?.setNetwork(session);
    setUi('menu');
    setSummary(null);
    gameRef.current?.newMatch(slots, session.matchSeed, 0, lobbyDiff);
  }, [lobbyBots, lobbyDiff]);

  const leaveLobby = useCallback(() => {
    teardownNet();
    setUi('menu');
    setLobbySlots([]);
    setRoomCode('');
    setStatus('');
  }, [teardownNet]);

  // ---- render --------------------------------------------------------

  const phase = snap?.phase ?? 'menu';
  const inMenuPhase = phase === 'menu';

  return (
    <div className="app">
      <canvas
        ref={attach}
        className={`stage${phase === 'playing' ? '' : ' idle'}`}
      />

      {phase === 'playing' && snap && <Hud snap={snap} />}

      {ui === 'lobby' && (
        <Lobby
          code={roomCode}
          slots={lobbySlots}
          isHost={isHost}
          bots={lobbyBots}
          onBots={setLobbyBots}
          difficulty={lobbyDiff}
          onDifficulty={setLobbyDiff}
          onStart={startHosted}
          onLeave={leaveLobby}
          status={error ?? status}
        />
      )}

      {ui === 'stats' && inMenuPhase && (
        <StatsScreen onBack={() => setUi('menu')} />
      )}

      {ui === 'menu' && inMenuPhase && (
        <Menu
          initial={config}
          netAvailable={!STANDALONE && webrtcSupported()}
          standalone={STANDALONE}
          error={error}
          onStart={startSolo}
          onHost={(cfg) => void host(cfg)}
          onJoin={(cfg, room) => void join(cfg, room)}
          onStats={(cfg) => {
            persistConfig(cfg);
            setUi('stats');
          }}
        />
      )}

      {ui !== 'lobby' && phase === 'paused' && (
        <PauseScreen
          sensitivity={config.sensitivity}
          onSensitivity={(v) => persistConfig({ ...config, sensitivity: v })}
          onResume={() => gameRef.current?.resume()}
          onQuit={() => {
            teardownNet();
            gameRef.current?.toMenu();
          }}
        />
      )}

      {ui !== 'lobby' && phase === 'over' && snap && (
        <EndScreen
          snap={snap}
          summary={summary}
          onRematch={rematch}
          onMenu={() => {
            teardownNet();
            gameRef.current?.toMenu();
          }}
        />
      )}
    </div>
  );
}
