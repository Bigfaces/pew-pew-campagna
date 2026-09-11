// ================================================================
// SIGNALING CLIENT
// ================================================================
// Thin WebSocket wrapper used only to introduce peers. It is
// intentionally short-lived: once every peer connection is
// established the socket can be closed without affecting the match.
// ================================================================

import {
  PROTOCOL_VERSION,
  type SignalFromServer,
  type SignalToServer,
} from './protocol';

/** Resolve the signaling endpoint from the page origin.
 *
 *  In development the game is served by Vite on one port and the API
 *  on another, so VITE_SIGNAL_URL overrides. In production both are
 *  behind the same origin and the default is correct. */
export function signalingUrl(): string {
  const override = import.meta.env['VITE_SIGNAL_URL'];
  if (override) return String(override);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export type SignalHandler = (msg: SignalFromServer) => void;

export class SignalingClient {
  private socket: WebSocket | null = null;
  private handler: SignalHandler | null = null;
  private closedByUs = false;

  onClose: (() => void) | null = null;
  onError: ((message: string) => void) | null = null;

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(handler: SignalHandler, url = signalingUrl()): Promise<void> {
    this.handler = handler;
    this.closedByUs = false;

    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('websocket failed'));
        return;
      }
      this.socket = socket;

      // Without a timeout a wrong or blocked URL leaves the UI stuck
      // on "connecting" with no explanation.
      const timeout = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          socket.close();
          reject(new Error('signaling server did not respond'));
        }
      }, 8000);

      socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        this.onError?.('signaling connection failed');
        reject(new Error('signaling connection failed'));
      };

      socket.onclose = () => {
        clearTimeout(timeout);
        this.socket = null;
        if (!this.closedByUs) this.onClose?.();
      };

      socket.onmessage = (ev) => {
        let msg: SignalFromServer;
        try {
          msg = JSON.parse(String(ev.data)) as SignalFromServer;
        } catch {
          return;
        }
        if (msg.t === 'error') this.onError?.(msg.message);
        this.handler?.(msg);
      };
    });
  }

  private send(msg: SignalToServer): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }

  host(name: string): void {
    this.send({ t: 'host', name, version: PROTOCOL_VERSION });
  }

  join(room: string, name: string): void {
    this.send({ t: 'join', room, name, version: PROTOCOL_VERSION });
  }

  relay(to: string, data: unknown): void {
    this.send({ t: 'signal', to, data });
  }

  close(): void {
    this.closedByUs = true;
    this.send({ t: 'leave' });
    this.socket?.close();
    this.socket = null;
  }
}
