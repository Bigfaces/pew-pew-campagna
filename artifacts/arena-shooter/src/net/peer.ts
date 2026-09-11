// ================================================================
// PEER CONNECTION
// ================================================================
// One RTCPeerConnection per link, carrying two data channels with
// deliberately opposite guarantees:
//
//   "fast"     unreliable, unordered — inputs and snapshots. These
//              are superseded 60 times a second, so a lost packet
//              must never delay the one behind it. TCP-like
//              retransmission is exactly the wrong behaviour here.
//
//   "reliable" ordered and guaranteed — lobby updates, match start,
//              kill events. Losing one of these desynchronizes the
//              session in a way the next packet cannot repair.
//
// Mixing the two on one channel is the classic netcode mistake: you
// either add latency to everything or lose things you cannot afford
// to lose.
// ================================================================

/** Public STUN only. A TURN relay would be needed for the minority of
 *  symmetric-NAT users; without it those connections simply fail, and
 *  we surface that rather than hanging forever. */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const CONNECT_TIMEOUT_MS = 15000;

export type PeerMessageHandler = (data: unknown) => void;

export class PeerLink {
  readonly id: string;
  private pc: RTCPeerConnection;
  private fast: RTCDataChannel | null = null;
  private reliable: RTCDataChannel | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  onMessage: PeerMessageHandler | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  /** Emitted with a human-readable reason when the link cannot form. */
  onFailed: ((reason: string) => void) | null = null;
  /** Called with SDP/ICE payloads that must reach the other side. */
  onSignal: ((data: unknown) => void) | null = null;

  private opened = false;

  constructor(id: string, initiator: boolean) {
    this.id = id;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.onSignal?.({ kind: 'ice', candidate: ev.candidate.toJSON() });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed') {
        this.fail('peer connection failed (NAT traversal)');
      } else if (s === 'disconnected' || s === 'closed') {
        if (this.opened) this.onClose?.();
      }
    };

    if (initiator) {
      // Only the offering side creates channels; the answering side
      // receives them through ondatachannel.
      this.fast = this.pc.createDataChannel('fast', {
        ordered: false,
        maxRetransmits: 0,
      });
      this.reliable = this.pc.createDataChannel('reliable', { ordered: true });
      this.wire(this.fast);
      this.wire(this.reliable);
    } else {
      this.pc.ondatachannel = (ev) => {
        if (ev.channel.label === 'fast') this.fast = ev.channel;
        else this.reliable = ev.channel;
        this.wire(ev.channel);
      };
    }

    this.timeout = setTimeout(() => {
      if (!this.opened) this.fail('timed out connecting to peer');
    }, CONNECT_TIMEOUT_MS);
  }

  private fail(reason: string): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.onFailed?.(reason);
    this.close();
  }

  private wire(ch: RTCDataChannel): void {
    ch.onmessage = (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.onMessage?.(parsed);
    };
    ch.onopen = () => {
      // Ready only once both channels are usable, so callers never
      // have to check which one exists yet.
      if (this.fast?.readyState === 'open' && this.reliable?.readyState === 'open') {
        if (this.timeout) {
          clearTimeout(this.timeout);
          this.timeout = null;
        }
        this.opened = true;
        this.onOpen?.();
      }
    };
    ch.onclose = () => {
      if (this.opened) this.onClose?.();
    };
  }

  get ready(): boolean {
    return this.opened;
  }

  /** Send on the unreliable channel. Silently drops when the channel
   *  is saturated — back-pressure on positional updates is better
   *  resolved by skipping than by queueing stale state. */
  sendFast(msg: unknown): void {
    const ch = this.fast;
    if (ch?.readyState !== 'open') return;
    if (ch.bufferedAmount > 64 * 1024) return;
    try {
      ch.send(JSON.stringify(msg));
    } catch {
      /* channel closed mid-send */
    }
  }

  sendReliable(msg: unknown): void {
    const ch = this.reliable;
    if (ch?.readyState !== 'open') return;
    try {
      ch.send(JSON.stringify(msg));
    } catch {
      /* channel closed mid-send */
    }
  }

  async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.onSignal?.({ kind: 'offer', sdp: offer });
  }

  /** Handle one relayed signaling payload from the other side. */
  async handleSignal(data: unknown): Promise<void> {
    const msg = data as { kind?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    try {
      if (msg.kind === 'offer' && msg.sdp) {
        await this.pc.setRemoteDescription(msg.sdp);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.onSignal?.({ kind: 'answer', sdp: answer });
      } else if (msg.kind === 'answer' && msg.sdp) {
        await this.pc.setRemoteDescription(msg.sdp);
      } else if (msg.kind === 'ice' && msg.candidate) {
        // Candidates can arrive before the remote description is set;
        // the browser queues them, but a genuinely bad one should not
        // tear down an otherwise working connection.
        await this.pc.addIceCandidate(msg.candidate).catch(() => {});
      }
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'signaling error');
    }
  }

  close(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    try {
      this.fast?.close();
      this.reliable?.close();
      this.pc.close();
    } catch {
      /* already torn down */
    }
  }
}

/** Feature probe so the UI can explain the absence rather than
 *  failing on click. */
export function webrtcSupported(): boolean {
  return (
    typeof RTCPeerConnection !== 'undefined' &&
    typeof RTCPeerConnection.prototype.createDataChannel === 'function'
  );
}
