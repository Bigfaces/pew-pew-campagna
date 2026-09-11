// ================================================================
// WEBRTC SIGNALING
// ================================================================
// A rendezvous point, nothing more. Peers use it to exchange SDP
// offers/answers and ICE candidates; once the peer connection is
// established every byte of gameplay flows directly between browsers
// and this server sees none of it.
//
// That is the whole reason the game can be peer-to-peer and still
// have a "join by code" flow: hosting a match costs this process a
// few hundred bytes of room bookkeeping, not a simulation.
//
// Deliberately in-memory: rooms are ephemeral and worthless once the
// match ends, so persisting them would add a failure mode for no gain.
// ================================================================

import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

import { logger } from './lib/logger';

const PROTOCOL_VERSION = 1;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;
const MAX_PLAYERS = 8;
/** A room with no host is dead; reap it rather than leak the entry. */
const EMPTY_ROOM_TTL_MS = 60_000;
const HEARTBEAT_MS = 30_000;

interface Peer {
  id: string;
  name: string;
  socket: WebSocket;
  room: string | null;
  isHost: boolean;
  alive: boolean;
}

interface Room {
  code: string;
  hostId: string;
  peers: Set<string>;
  createdAt: number;
}

const peers = new Map<string, Peer>();
const rooms = new Map<string, Room>();

function send(peer: Peer, msg: unknown): void {
  if (peer.socket.readyState !== WebSocket.OPEN) return;
  try {
    peer.socket.send(JSON.stringify(msg));
  } catch (err) {
    logger.warn({ err, peerId: peer.id }, 'signaling send failed');
  }
}

function makeCode(): string {
  // Retry on collision rather than trusting randomness with a
  // 4-character space — a duplicate would silently hijack a match.
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code +=
        ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  // Fall back to a longer code rather than failing the request.
  return randomUUID().slice(0, 8).toUpperCase();
}

function leaveRoom(peer: Peer): void {
  if (!peer.room) return;
  const room = rooms.get(peer.room);
  peer.room = null;
  if (!room) return;

  room.peers.delete(peer.id);

  if (peer.isHost) {
    // The host owned the simulation, so the match cannot continue.
    // Tell everyone and drop the room.
    for (const id of room.peers) {
      const other = peers.get(id);
      if (other) {
        send(other, { t: 'peer-left', peerId: peer.id });
        other.room = null;
      }
    }
    rooms.delete(room.code);
    logger.info({ room: room.code }, 'room closed (host left)');
    return;
  }

  for (const id of room.peers) {
    const other = peers.get(id);
    if (other) send(other, { t: 'peer-left', peerId: peer.id });
  }
}

function handleMessage(peer: Peer, raw: unknown): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    send(peer, { t: 'error', message: 'malformed message' });
    return;
  }

  switch (msg.t) {
    case 'host': {
      if (msg.version !== PROTOCOL_VERSION) {
        send(peer, { t: 'error', message: 'protocol version mismatch' });
        return;
      }
      leaveRoom(peer);
      const code = makeCode();
      rooms.set(code, {
        code,
        hostId: peer.id,
        peers: new Set([peer.id]),
        createdAt: Date.now(),
      });
      peer.room = code;
      peer.isHost = true;
      peer.name = String(msg.name ?? 'HOST').slice(0, 12);
      send(peer, { t: 'hosted', room: code, peerId: peer.id });
      logger.info({ room: code }, 'room created');
      break;
    }

    case 'join': {
      if (msg.version !== PROTOCOL_VERSION) {
        send(peer, { t: 'error', message: 'protocol version mismatch' });
        return;
      }
      const code = String(msg.room ?? '').toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        send(peer, { t: 'error', message: 'room not found' });
        return;
      }
      if (room.peers.size >= MAX_PLAYERS) {
        send(peer, { t: 'error', message: 'room is full' });
        return;
      }

      leaveRoom(peer);
      room.peers.add(peer.id);
      peer.room = code;
      peer.isHost = false;
      peer.name = String(msg.name ?? 'PLAYER').slice(0, 12);

      send(peer, { t: 'joined', room: code, peerId: peer.id, hostId: room.hostId });
      // Only the host is told, because only the host initiates the
      // peer connection — guests never talk to each other.
      const host = peers.get(room.hostId);
      if (host) {
        send(host, { t: 'peer-joined', peerId: peer.id, name: peer.name });
      }
      break;
    }

    case 'signal': {
      const target = peers.get(String(msg.to ?? ''));
      if (!target || !peer.room || target.room !== peer.room) {
        // Silently drop: relaying outside your own room would let any
        // client push SDP at any other.
        return;
      }
      send(target, { t: 'signal', from: peer.id, data: msg.data });
      break;
    }

    case 'leave':
      leaveRoom(peer);
      break;

    default:
      send(peer, { t: 'error', message: 'unknown message type' });
  }
}

export function attachSignaling(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    const peer: Peer = {
      id: randomUUID(),
      name: 'PLAYER',
      socket,
      room: null,
      isHost: false,
      alive: true,
    };
    peers.set(peer.id, peer);

    socket.on('message', (data) => handleMessage(peer, data));
    socket.on('pong', () => {
      peer.alive = true;
    });
    socket.on('error', (err) => {
      logger.warn({ err, peerId: peer.id }, 'signaling socket error');
    });
    socket.on('close', () => {
      leaveRoom(peer);
      peers.delete(peer.id);
    });
  });

  // Half-open TCP connections do not fire 'close', so without an
  // explicit liveness probe a crashed client would hold its room
  // slot indefinitely.
  const heartbeat = setInterval(() => {
    for (const peer of peers.values()) {
      if (!peer.alive) {
        peer.socket.terminate();
        continue;
      }
      peer.alive = false;
      try {
        peer.socket.ping();
      } catch {
        peer.socket.terminate();
      }
    }

    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.peers.size === 0 && now - room.createdAt > EMPTY_ROOM_TTL_MS) {
        rooms.delete(room.code);
      }
    }
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

/** Exposed for the health endpoint and tests. */
export function signalingStats(): { rooms: number; peers: number } {
  return { rooms: rooms.size, peers: peers.size };
}

/** Test helper: drop all in-memory state between cases. */
export function resetSignaling(): void {
  rooms.clear();
  peers.clear();
}
