# Arena Sniper

A first-person, pixel-art arena shooter that runs entirely in the browser:
free-for-all, bolt-action sniper rifles, one-shot kills, first to 10 wins.
Playable solo against bots or online with friends over peer-to-peer WebRTC.

## Run & Operate

- `pnpm --filter @workspace/arena-shooter run dev` — the game (Vite, port 5173)
- `pnpm --filter @workspace/arena-shooter run test` — simulation, render and netcode tests
- `pnpm --filter @workspace/api-server run dev` — API + WebRTC signaling (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

Environment:

- `PORT`, `BASE_PATH` — injected by the host; both default sensibly for local dev.
- `DATABASE_URL` — **optional**. Without it the game runs fully; career stats
  fall back to browser local storage and the stats endpoints answer
  `503 {available:false}` so the client can tell "no database" from "outage".
- `VITE_SIGNAL_URL` — override the signaling WebSocket when the game and API
  are served from different origins (they are in local dev: Vite is on 5173,
  the API on 5000). In production both sit behind one origin and the default
  `wss://<host>/ws` is correct.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Game: Vite + React 19 for chrome, canvas 2D for the world. No game engine.
- API: Express 5, `ws` for signaling
- DB: PostgreSQL + Drizzle ORM (optional)
- Tests: Vitest

## Where things live

Everything gameplay-related is in `artifacts/arena-shooter/src`:

| Path       | Responsibility                                                         |
| ---------- | ---------------------------------------------------------------------- |
| `sim/`     | **Pure simulation.** No DOM, no canvas, no network. Runs headless.      |
| `render/`  | Canvas drawing: raycast walls, billboards, particles, HUD overlay.      |
| `audio/`   | Web Audio synthesis. No asset files.                                   |
| `net/`     | Signaling client, WebRTC peers, prediction and interpolation.           |
| `game/`    | The fixed-timestep loop that wires the above together.                  |
| `ui/`      | React menus, lobby, HUD, end screen.                                    |
| `stats/`   | Career stats client with local-storage fallback.                        |

Source of truth: map layout is `sim/map.ts`, every gameplay tunable is
`sim/constants.ts` (including the `BOT_TUNING` difficulty table — nothing else
in the simulation branches on difficulty), the wire format is
`net/protocol.ts`, the DB schema is `lib/db/src/schema/matches.ts`.

## Architecture decisions

- **The simulation is pure and advances in fixed 60 Hz ticks.** It has no DOM
  dependency, so it runs in a test, and no wall-clock dependency, so it behaves
  identically on a 60 Hz and a 240 Hz display. The renderer runs free and
  interpolates between the last two ticks.

- **Everything random in the simulation goes through a seeded PRNG** whose state
  lives in `WorldState`. This is what makes a match reproducible from a seed,
  testable against a known outcome, and safe to hand between peers.

- **The simulation emits events; it never draws or plays audio.** Particles,
  sound, screen shake and the kill feed are all subscribers. This is also how a
  guest shows the host's effects without simulating combat itself.

- **Input is the only way to influence an entity.** Keyboard, bot AI and network
  packets all produce the same `InputState`, so a bot slot and a human slot are
  genuinely interchangeable — that claim is enforced by `World` applying
  movement identically for every controller type.

- **Multiplayer is host-authoritative peer-to-peer.** One peer owns the world;
  guests predict their own movement and reconcile against snapshots. The server
  only introduces peers and then drops out — it never sees gameplay traffic, so
  hosting a match costs it nothing but a room entry.

- **Guests predict movement but never combat.** A guest that resolved its own
  hits would show kills the host never agreed to, and then have to take them
  back. It predicts its weapon cooldown for instant crosshair feedback, and
  nothing else.

- **Persistence is optional everywhere.** No `DATABASE_URL` is a supported
  configuration, not a startup failure.

- **The arena is tuned against measurements, not intuition.**
  `tools/balance.mts` (`run balance`) plays hundreds of headless matches and
  reports map geometry, pace, engagement range, bot accuracy and life
  expectancy. The first arena was 6.5% obstructed with 43% of position pairs in
  mutual line of sight, and it produced a median kill distance of 16 tiles with
  60% of deaths arriving from outside the victim's view — numbers nobody would
  have guessed by playing it. Change a constant or the map, re-run, compare.

## Gotchas

- **The two data channels are not interchangeable.** Inputs and snapshots go on
  the unreliable/unordered channel because a late packet is worthless and would
  only delay the one behind it. Lobby updates and kill events go on the reliable
  channel because losing one desynchronizes the session. Don't merge them.
- **Unreliable means unordered.** Anything consuming datagrams must reject stale
  sequence numbers — `SnapshotBuffer` and the host's input handler both do.
- **`pitch` is cosmetic.** It shifts the horizon; it must never steer a bullet,
  or what you hit stops matching what you see. Because aim is therefore
  one-dimensional, the hitscan radius is exactly the entity radius with no
  padding — the one axis left has to be worth something.
- **The bot's firing rules are all consequences of cover existing**, and every
  one of them was invisible on the first, nearly-empty arena. Change any of them
  and check `run balance` before believing it is an improvement:
  - The reaction timer must not restart when a target flickers back into view,
    or behind cover it never finishes and the bot never fires. It is also
    floored at zero, or it banks unlimited credit and stops gating anything.
  - Aim error is rolled once, at the moment of firing. Re-rolling it every tick
    means steering at a heading that jumps underneath you, which only settles on
    targets far enough away for the bearing to barely move.
  - A bot checks the line the bullet will actually travel, not just that the
    target is visible from its centre — the two differ exactly at the corner it
    is hugging — and it stands still on the tick it fires, because movement
    resolves before shots are traced and it would otherwise fire from a position
    it never checked.
- **In the standalone build the script must come after `#root`.** Stripping
  `type="module"` is what makes the single file work over `file://`, but it also
  removes the implied *defer*, and `defer` is ignored on inline scripts. Left in
  `<head>`, the bundle ran before `<body>` was parsed, `createRoot` got `null`
  and the page rendered nothing — while the build reported success and the dev
  server was unaffected, because the dev config keeps the module script. The
  plugin now relocates the script and asserts the ordering; do not undo either.
  This shipped broken, so `docs/index.html` and GitHub Pages showed a black
  screen from the first commit until it was found.
- Run `pnpm run typecheck:libs` (or `tsc --build`) before typechecking the apps:
  `lib/*` packages must emit their `.d.ts` first. If you see TS6305, delete the
  stale `*.tsbuildinfo` files and rebuild.
- `pnpm install` must be run from a shell with `sh` on PATH (Git Bash on
  Windows) — the `preinstall` guard script requires it.

## Product

- Free-for-all deathmatch, 1 human + up to 7 opponents (bots, humans, or both).
- One weapon: bolt-action sniper, infinite ammo, one-shot kill, ~1.4 s cycle,
  with a 2.6x telescopic sight on the right mouse button.
- Three power-ups: shield (absorbs one hit), rapid fire, speed boost.
- Won by reaching the kill target or by leading when the 5-minute clock expires.
  The target scales with the roster (`killTarget`, 2.5 per player): total kills
  in an FFA rise faster than the player count, so a fixed target made a 1v1 run
  out the clock every time and a full lobby finish in under a minute.
- Three bot difficulty levels; `normale` is the reference tuning that
  `run balance` is calibrated against.
- Solo vs bots, or online via a 4-character room code.
- Career stats and a global leaderboard when a database is configured, both
  surfaced on a stats screen reachable from the menu.
- Interface is Italian. There is no language switch: one language is a
  translation, two is a subsystem, and nothing asked for the second.

## Information design

A one-shot-kill shooter is a game about knowing where people are. All three of
these exist because the first version gave that away for free — the minimap drew
every living opponent at all times, which made the positional audio, the incoming
arc and the bots' view cones decorative.

- **The minimap shows only line of sight, plus gunshot pings.** A contact is
  drawn when `hasLOS` holds from the player to it. Anything else is knowledge the
  player has no way to have. A shot leaves a fading ring *at the position it was
  fired from*, not on the shooter, so the mark goes stale exactly as real
  information does.

- **Opponents have footsteps**, positioned and distance-attenuated. Accumulated
  from observed movement in `updateOpponentFootsteps` rather than added to the
  event stream: the simulation has no notion of a footstep, and giving it one
  would mean every peer shipping them over the wire for a purely local effect.
  Measured in distance rather than time, so speed is audible.

- **A scope glint marks whoever has you lined up with a round chambered.**
  Billboards are symmetric and carry no facing cue, so "is that one about to
  shoot me" — the only question that matters here — was unanswerable. Gated on
  the weapon being ready as well as aimed: it means *now*, and its absence right
  after someone fires is the cue to push.

## Presentation-layer decisions

These are the non-obvious ones, all following from "the simulation is pure":

- **Aiming down sights is a camera property, not a simulation one.** `zoom`
  multiplies `projDist` in `computeViewport`, which narrows both fields of view
  for free and leaves the ray count — and so the depth buffer — untouched. The
  cost of scoping is applied as *reduced movement input* in `buildLocalInput`,
  exactly like a partly-deflected analog stick, so `World` needs no concept of
  scoping and the wire format does not change.

- **Look sensitivity is a multiplier on the constant, and never reaches
  the simulation.** It lives on `Game`, not in `WorldState`: it describes
  how a hand moves a camera, so two peers set differently must still
  simulate the same match, and nothing about it goes over the wire.
  Exposed as a multiplier because `MOUSE_SENSITIVITY` is radians per
  mouse pixel and nobody holds an opinion about those. Offered in the
  pause screen as well as the menu, applying as the slider moves,
  because a menu is the one place you cannot tell whether it is right.
  `clampSensitivity` guards every entry point; note that the stored
  value must be tested for `null` *before* parsing, since `Number(null)`
  is 0 and would clamp to the slowest setting instead of the default.

- **Streaks and multi-kills are counted locally, not read off the entity.** A
  guest never simulates combat, so its own `streak` field is whatever its
  prediction guessed. The callouts are driven by the host's authoritative kill
  events instead.

- **"Who shot me" comes from the `shot` event, not the `kill` event.** The kill
  event reports where the *victim* fell; only the shot event carries the
  shooter's position.

- **The start countdown is the one thing measured in wall-clock time**, because
  it runs while the simulation is deliberately not advancing. It still has to
  drain the mouse accumulator every frame, or three seconds of motion arrive on
  the first tick at once.

- **The match clock is counted in ticks**, so it is identical on every peer and
  a frame-rate stall cannot rob anyone of playing time. A timed-out match is
  awarded by kills, then fewest deaths, then lowest id — the chain has to be
  total or two peers could disagree about who won.
