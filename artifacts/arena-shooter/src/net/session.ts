// ================================================================
// NETWORK SESSIONS
// ================================================================
// Host-authoritative peer-to-peer:
//
//   The host runs the one true World. Guests send inputs, predict
//   their own movement locally, and correct against the snapshots
//   that come back. Remote players are drawn from interpolated
//   snapshot history.
//
//   Bots only ever exist on the host, filling unused slots. Because
//   a bot and a remote player differ only in where their InputState
//   comes from, no gameplay code has to know which is which.
// ================================================================

import type { Entity, InputState, SimEvent } from '../sim/types';
import { emptyInput } from '../sim/types';
import type { InputMap, SlotConfig, World } from '../sim/world';
import { PeerLink } from './peer';
import {
  applyEntity,
  applyPowerups,
  packEntity,
  packPowerups,
  type LobbySlot,
  type NetInput,
  type NetMessage,
  type NetSnapshot,
  type NetWelcome,
} from './protocol';
import {
  LatencyTracker,
  PredictionBuffer,
  SnapshotBuffer,
  type InterpolatedEntity,
} from './reconcile';
import { SignalingClient } from './signaling';

/** Snapshots per second. Well below the 60 Hz tick rate: interpolation
 *  covers the gap, and tripling the packet rate would buy nothing a
 *  player could perceive. */
const SNAPSHOT_HZ = 20;
const SNAPSHOT_INTERVAL = 1000 / SNAPSHOT_HZ;
const PING_INTERVAL = 2000;

/** The seam between the game loop and the network. */
export interface NetAdapter {
  readonly mode: 'host' | 'guest';
  readonly ping: number;
  /** Host: inputs received from guests, keyed by entity id. */
  drainInputs(): InputMap;
  /** Host: publish state after a tick. */
  publish(world: World, events: readonly SimEvent[]): void;
  /** Guest: hand the local input to the network and record it for replay. */
  submitInput(input: InputState): void;
  /** Guest: overwrite local state with the authority and replay
   *  unacknowledged inputs. Returns the inputs to re-apply. */
  takeCorrection(world: World, localId: number): readonly InputState[];
  /** Guest: interpolated poses for entities the guest does not own. */
  sampleRemote(nowMs: number): InterpolatedEntity[] | null;
  dispose(): void;
}

export interface SessionEvents {
  onLobby: (slots: LobbySlot[]) => void;
  onStart: (slots: SlotConfig[], localId: number, seed: number) => void;
  onError: (message: string) => void;
  onPeerLeft: (peerId: string) => void;
}

// ================================================================
// HOST
// ================================================================

interface GuestRecord {
  peerId: string;
  name: string;
  link: PeerLink;
  /** Entity id this guest controls. */
  entityId: number;
  latestInput: InputState;
  lastSeq: number;
  latency: LatencyTracker;
}

export class HostSession implements NetAdapter {
  readonly mode = 'host';
  private signaling = new SignalingClient();
  private guests = new Map<string, GuestRecord>();
  private events: SessionEvents;
  private hostName: string;
  private nextEntityId = 1;
  private lastSnapshot = 0;
  private lastPing = 0;
  private started = false;
  private seed = (Math.random() * 0xffffffff) >>> 0;

  roomCode = '';

  constructor(name: string, events: SessionEvents) {
    this.hostName = name;
    this.events = events;
  }

  get ping(): number {
    // Host latency is the worst link, since that is what bounds the
    // match's responsiveness for everyone.
    let worst = 0;
    for (const g of this.guests.values()) worst = Math.max(worst, g.latency.median);
    return worst;
  }

  get guestCount(): number {
    return this.guests.size;
  }

  async open(): Promise<string> {
    await this.signaling.connect((msg) => {
      switch (msg.t) {
        case 'hosted':
          this.roomCode = msg.room;
          this.pushLobby();
          break;
        case 'peer-joined':
          this.addGuest(msg.peerId, msg.name);
          break;
        case 'peer-left':
          this.removeGuest(msg.peerId);
          break;
        case 'signal':
          void this.guests.get(msg.from)?.link.handleSignal(msg.data);
          break;
        case 'error':
          this.events.onError(msg.message);
          break;
      }
    });

    this.signaling.onError = (m) => this.events.onError(m);
    this.signaling.host(this.hostName);

    // Resolve once the server has assigned a code.
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (this.roomCode) {
          clearInterval(poll);
          resolve(this.roomCode);
        } else if (Date.now() - started > 8000) {
          clearInterval(poll);
          reject(new Error('server did not assign a room code'));
        }
      }, 50);
    });
  }

  private addGuest(peerId: string, name: string): void {
    if (this.started) return; // No mid-match joins.

    const link = new PeerLink(peerId, true);
    const record: GuestRecord = {
      peerId,
      name: name || 'PLAYER',
      link,
      entityId: this.nextEntityId++,
      latestInput: emptyInput(),
      lastSeq: 0,
      latency: new LatencyTracker(),
    };
    this.guests.set(peerId, record);

    link.onSignal = (data) => this.signaling.relay(peerId, data);
    link.onOpen = () => this.pushLobby();
    link.onClose = () => this.removeGuest(peerId);
    link.onFailed = (reason) => {
      this.events.onError(`${record.name}: ${reason}`);
      this.removeGuest(peerId);
    };
    link.onMessage = (data) => this.onGuestMessage(record, data as NetMessage);

    void link.createOffer().catch(() => {
      this.events.onError(`could not reach ${record.name}`);
      this.removeGuest(peerId);
    });
  }

  private removeGuest(peerId: string): void {
    const g = this.guests.get(peerId);
    if (!g) return;
    g.link.close();
    this.guests.delete(peerId);
    this.events.onPeerLeft(peerId);
    this.pushLobby();
  }

  private onGuestMessage(g: GuestRecord, msg: NetMessage): void {
    if (msg.t === 'i') {
      const inp = msg as NetInput;
      // Datagrams reorder; an older input must not overwrite a newer.
      if (inp.q <= g.lastSeq) return;
      g.lastSeq = inp.q;
      g.latestInput = {
        forward: inp.f,
        strafe: inp.s,
        aimAngle: inp.a,
        fire: inp.x,
        seq: inp.q,
      };
    } else if (msg.t === 'o') {
      g.latency.add(performance.now() - msg.c);
    } else if (msg.t === 'p') {
      g.link.sendFast({ t: 'o', c: msg.c });
    }
  }

  lobbySlots(): LobbySlot[] {
    const slots: LobbySlot[] = [
      { peerId: 'host', name: this.hostName, skin: 0, isHost: true },
    ];
    let skin = 1;
    for (const g of this.guests.values()) {
      slots.push({ peerId: g.peerId, name: g.name, skin: skin++, isHost: false });
    }
    return slots;
  }

  private pushLobby(): void {
    const slots = this.lobbySlots();
    this.events.onLobby(slots);
    for (const g of this.guests.values()) {
      g.link.sendReliable({ t: 'l', slots, starting: false });
    }
  }

  /** Build the slot list and tell every guest to start. */
  startMatch(botCount: number): SlotConfig[] {
    this.started = true;

    const slots: SlotConfig[] = [
      { name: this.hostName, skin: 0, controller: 'local' },
    ];
    let skin = 1;
    for (const g of this.guests.values()) {
      g.entityId = slots.length;
      slots.push({ name: g.name, skin: skin++, controller: 'remote' });
    }
    for (let i = 0; i < botCount; i++) {
      slots.push({ name: `BOT-${i + 1}`, skin: skin++, controller: 'bot' });
    }

    for (const g of this.guests.values()) {
      const welcome: NetWelcome = {
        t: 'w',
        id: g.entityId,
        seed: this.seed,
        slots: slots.map((s, i) => ({
          id: i,
          name: s.name,
          skin: s.skin,
          bot: s.controller === 'bot',
        })),
      };
      g.link.sendReliable(welcome);
    }

    // Signaling has done its job; gameplay is peer-to-peer from here.
    this.signaling.close();
    return slots;
  }

  get matchSeed(): number {
    return this.seed;
  }

  // ---- NetAdapter ----------------------------------------------------

  drainInputs(): InputMap {
    const map: InputMap = {};
    for (const g of this.guests.values()) {
      map[g.entityId] = g.latestInput;
      // Fire is edge-triggered: consuming it here stops one click
      // from firing on every tick until the next packet arrives.
      if (g.latestInput.fire) {
        g.latestInput = { ...g.latestInput, fire: false };
      }
    }
    return map;
  }

  publish(world: World, events: readonly SimEvent[]): void {
    const now = performance.now();

    if (events.length > 0) {
      // Reliable: a missed kill event leaves a corpse standing.
      const payload = { t: 'e', v: events as unknown[] };
      for (const g of this.guests.values()) g.link.sendReliable(payload);
    }

    if (now - this.lastSnapshot < SNAPSHOT_INTERVAL) return;
    this.lastSnapshot = now;

    const powerMask = packPowerups(world.state.powerups);
    const packed = world.entities.map(packEntity);

    for (const g of this.guests.values()) {
      const snap: NetSnapshot = {
        t: 's',
        k: world.state.tick,
        q: g.lastSeq,
        p: powerMask,
        e: packed,
      };
      g.link.sendFast(snap);
    }

    if (now - this.lastPing > PING_INTERVAL) {
      this.lastPing = now;
      for (const g of this.guests.values()) g.link.sendFast({ t: 'p', c: now });
    }
  }

  submitInput(): void {
    /* the host applies its own input directly */
  }

  takeCorrection(): readonly InputState[] {
    return [];
  }

  sampleRemote(): InterpolatedEntity[] | null {
    return null;
  }

  dispose(): void {
    for (const g of this.guests.values()) g.link.close();
    this.guests.clear();
    this.signaling.close();
  }
}

// ================================================================
// GUEST
// ================================================================

export class GuestSession implements NetAdapter {
  readonly mode = 'guest';
  private signaling = new SignalingClient();
  private link: PeerLink | null = null;
  private events: SessionEvents;
  private name: string;

  private prediction = new PredictionBuffer();
  private snapshots = new SnapshotBuffer();
  private latency = new LatencyTracker();

  private localId = 0;
  private pendingCorrection: NetSnapshot | null = null;
  private hostId = '';

  roomCode = '';

  constructor(name: string, events: SessionEvents) {
    this.name = name;
    this.events = events;
  }

  get ping(): number {
    return this.latency.median;
  }

  async join(room: string): Promise<void> {
    await this.signaling.connect((msg) => {
      switch (msg.t) {
        case 'joined': {
          this.roomCode = msg.room;
          this.hostId = msg.hostId;
          // The host is the offerer, so the guest only answers.
          const link = new PeerLink(msg.hostId, false);
          this.link = link;
          link.onSignal = (data) => this.signaling.relay(msg.hostId, data);
          link.onMessage = (data) => this.onHostMessage(data as NetMessage);
          link.onFailed = (reason) => this.events.onError(reason);
          link.onClose = () => this.events.onError('host disconnected');
          break;
        }
        case 'signal':
          void this.link?.handleSignal(msg.data);
          break;
        case 'peer-left':
          if (msg.peerId === this.hostId) {
            this.events.onError('host left the match');
          }
          break;
        case 'error':
          this.events.onError(msg.message);
          break;
      }
    });

    this.signaling.onError = (m) => this.events.onError(m);
    this.signaling.join(room.toUpperCase(), this.name);
  }

  private onHostMessage(msg: NetMessage): void {
    switch (msg.t) {
      case 'l':
        this.events.onLobby(msg.slots);
        break;

      case 'w': {
        this.localId = msg.id;
        const slots: SlotConfig[] = msg.slots.map((s) => ({
          name: s.name,
          skin: s.skin,
          // Everything the guest does not control is remote, bots
          // included: their behaviour arrives as state, and running a
          // second copy of the AI locally would only fight the host.
          controller: s.id === msg.id ? 'local' : 'remote',
        }));
        this.prediction.clear();
        this.snapshots.clear();
        this.signaling.close();
        this.events.onStart(slots, msg.id, msg.seed);
        break;
      }

      case 's':
        this.snapshots.push(msg, performance.now());
        this.pendingCorrection = msg;
        break;

      case 'e':
        // Cosmetic events are replayed by the game controller.
        this.onEvents?.(msg.v as SimEvent[]);
        break;

      case 'p':
        this.link?.sendFast({ t: 'o', c: msg.c });
        break;

      case 'o':
        this.latency.add(performance.now() - msg.c);
        break;
    }
  }

  /** Set by the game controller to receive host-side effect events. */
  onEvents: ((events: SimEvent[]) => void) | null = null;

  // ---- NetAdapter ----------------------------------------------------

  drainInputs(): InputMap {
    return {};
  }

  publish(): void {
    /* guests are not authoritative */
  }

  submitInput(input: InputState): void {
    this.prediction.record(input);
    this.link?.sendFast({
      t: 'i',
      q: input.seq,
      f: input.forward,
      s: input.strafe,
      a: input.aimAngle,
      x: input.fire,
    } satisfies NetInput);
  }

  takeCorrection(world: World, localId: number): readonly InputState[] {
    const snap = this.pendingCorrection;
    if (!snap) return [];
    this.pendingCorrection = null;

    // Authoritative scores and power-up availability apply to every
    // entity; positions of others come from interpolation instead.
    applyPowerups(world.state.powerups, snap.p);

    const local = world.byId(localId);
    for (const ne of snap.e) {
      const target = world.byId(ne.i);
      if (!target) continue;
      if (target === local) {
        applyEntity(target, ne);
      } else {
        // Keep the authoritative facts, leave the pose to interpolation.
        target.alive = ne.l;
        target.kills = ne.k;
        target.deaths = ne.d;
      }
    }

    return this.prediction.acknowledge(snap.q);
  }

  sampleRemote(nowMs: number): InterpolatedEntity[] | null {
    return this.snapshots.sample(nowMs);
  }

  get assignedId(): number {
    return this.localId;
  }

  dispose(): void {
    this.link?.close();
    this.link = null;
    this.signaling.close();
    this.prediction.clear();
    this.snapshots.clear();
  }
}

/** Copy interpolated poses onto entities the guest does not own. */
export function applyRemotePoses(
  entities: readonly Entity[],
  poses: readonly InterpolatedEntity[],
  localId: number,
): void {
  const byId = new Map<number, InterpolatedEntity>();
  for (const p of poses) byId.set(p.id, p);

  for (const e of entities) {
    if (e.id === localId) continue;
    const p = byId.get(e.id);
    if (!p) continue;
    e.x = p.x;
    e.y = p.y;
    e.angle = p.angle;
    e.alive = p.alive;
    e.weaponCooldown = p.weaponCooldown;
    e.shieldActive = (p.powerBits & 1) !== 0;
    e.rapidFireTimer = p.powerBits & 2 ? 1 : 0;
    e.speedBoostTimer = p.powerBits & 4 ? 1 : 0;
  }
}
