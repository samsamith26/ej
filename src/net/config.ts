import type { PeerOptions } from 'peerjs';

/**
 * PeerJS options from env vars. Unset vars fall back to the public PeerJS
 * cloud signaling server and Google STUN.
 */
export function peerOptions(): PeerOptions {
  const env = import.meta.env;
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (env.VITE_TURN_URL) {
    iceServers.push({ urls: env.VITE_TURN_URL, username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL });
  }
  const opts: PeerOptions = { config: { iceServers } };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.secure = location.protocol === 'https:';
  }
  if (env.VITE_PEER_PORT) opts.port = Number(env.VITE_PEER_PORT);
  if (env.VITE_PEER_PATH) opts.path = env.VITE_PEER_PATH;
  return opts;
}

/** Game ids that don't look like real invite ids use the in-browser two-tab transport. */
export function isLocalGame(gameId: string): boolean {
  return !gameId.startsWith('ej-') || new URLSearchParams(location.search).has('local');
}

export function randomId(len: number): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function newGameId(): string {
  return `ej-${randomId(8)}`;
}
