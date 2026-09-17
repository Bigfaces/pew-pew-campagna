import { useRef } from 'react';

import type { CampaignGame } from '../game/campaignGame';

/** Radius the joystick knob can travel, in CSS px — matches the base
 *  drawn in ui.css (.touch-joystick is 2x this). */
const JOY_RADIUS = 50;

/** Touch drags are shorter than a mouse's free-running motion, so a
 *  1:1 pixel mapping barely turns you at all — this makes a
 *  comfortable swipe worth roughly the same turn as it would need to
 *  be worth on a desk. */
const TOUCH_LOOK_MULT = 1.6;

/** Pointer capture keeps a drag tracking a finger that slides outside
 *  the small joystick/button it started on. It is a robustness nicety,
 *  not a requirement — the browser can refuse it (no pointer session
 *  active for the id, capture unsupported in a given context), and
 *  that must not take the handler down with it. */
function captureQuietly(e: React.PointerEvent<HTMLDivElement>): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Input still works without capture — see above.
  }
}

/** On-screen joystick (movement), a drag zone (look) and a fire
 *  button — the touch equivalent of WASD + mouse + click. Only
 *  visible on coarse-pointer (touch) devices; see the
 *  `@media (pointer: coarse)` rule in ui.css. Present unconditionally
 *  in the DOM rather than behind a JS device check, so it degrades
 *  correctly for any input the CSS media query itself gets right
 *  (a tablet with a mouse plugged in, etc.) instead of a guess made
 *  once at mount time.
 *
 *  Talks to CampaignGame through three plain methods
 *  (setTouchMove/addTouchLook/queueFire) rather than dispatching
 *  synthetic keyboard/mouse events — the game already has a place for
 *  this input to land next to the keyboard and mouse paths, so there
 *  is no reason to fake a keyboard just to reach it. */
export function TouchControls({
  game,
  adsActive,
  dashReady,
  beaconCharges,
}: {
  game: CampaignGame | null;
  adsActive: boolean;
  /** null finché il nodo Scatto non è sbloccato: il pulsante non
   *  esiste finché la meccanica non esiste. 0..1 quando c'è, 1 =
   *  pronto. */
  dashReady: number | null;
  /** Lanci di Trasponditore rimasti. A differenza dello scatto non è
   *  mai `null`: l'arma è innata, quindi il pulsante c'è dal primo
   *  livello e a zero cariche si spegne invece di sparire — un
   *  bersaglio che scompare da sotto il pollice a metà combattimento è
   *  peggio di uno inerte. */
  beaconCharges: number;
}): React.ReactElement {
  const knobRef = useRef<HTMLDivElement | null>(null);
  const joyOrigin = useRef<{ x: number; y: number } | null>(null);
  const lookLast = useRef<{ x: number; y: number } | null>(null);

  const updateJoy = (clientX: number, clientY: number): void => {
    const origin = joyOrigin.current;
    if (!origin) return;
    let dx = clientX - origin.x;
    let dy = clientY - origin.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS;
      dy = (dy / len) * JOY_RADIUS;
    }
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    game?.setTouchMove(dx / JOY_RADIUS, -dy / JOY_RADIUS);
  };

  const resetJoy = (): void => {
    joyOrigin.current = null;
    if (knobRef.current) knobRef.current.style.transform = 'translate(0, 0)';
    game?.setTouchMove(0, 0);
  };

  const onJoyDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    captureQuietly(e);
    const rect = e.currentTarget.getBoundingClientRect();
    joyOrigin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    updateJoy(e.clientX, e.clientY);
  };

  const onLookDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    captureQuietly(e);
    lookLast.current = { x: e.clientX, y: e.clientY };
  };

  const onLookMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const last = lookLast.current;
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    lookLast.current = { x: e.clientX, y: e.clientY };
    game?.addTouchLook(dx * TOUCH_LOOK_MULT, dy * TOUCH_LOOK_MULT);
  };

  return (
    <div className="touch-controls">
      <div
        className="touch-look-zone"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={() => (lookLast.current = null)}
        onPointerCancel={() => (lookLast.current = null)}
      />
      <div
        className="touch-joystick"
        onPointerDown={onJoyDown}
        onPointerMove={(e) => updateJoy(e.clientX, e.clientY)}
        onPointerUp={resetJoy}
        onPointerCancel={resetJoy}
      >
        <div className="touch-joystick-knob" ref={knobRef} />
      </div>
      {/* Toggle, not hold: a thumb cannot stay on the scope button and
          keep aiming with the same hand. */}
      <div
        className="touch-ads"
        data-on={adsActive}
        onPointerDown={(e) => {
          captureQuietly(e);
          game?.toggleAds();
        }}
      >
        OTTICA
      </div>
      {dashReady !== null && (
        <div
          className="touch-dash"
          data-ready={dashReady >= 1 ? 'true' : 'false'}
          onPointerDown={(e) => {
            captureQuietly(e);
            game?.queueDash();
          }}
        >
          SCATTO
        </div>
      )}
      <div
        className="touch-beacon"
        data-ready={beaconCharges > 0 ? 'true' : 'false'}
        onPointerDown={(e) => {
          captureQuietly(e);
          game?.queueBeacon();
        }}
      >
        ESCA
      </div>
      <div
        className="touch-fire"
        onPointerDown={(e) => {
          captureQuietly(e);
          game?.queueFire();
        }}
      >
        SPARA
      </div>
    </div>
  );
}
