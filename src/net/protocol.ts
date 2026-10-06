import type { Action, PlayerView } from '../engine';

export const PROTOCOL_VERSION = 1;

/** Messages exchanged between host and guest. Every message carries the protocol version. */
export type Message =
  | { v: 1; type: 'hello'; name: string; playerToken: string }
  | { v: 1; type: 'action'; action: Action }
  | { v: 1; type: 'state'; view: PlayerView; names: [string, string] }
  /** `fatal` errors (e.g. "Game is full") end the session; others are toasts. */
  | { v: 1; type: 'error'; message: string; fatal?: boolean }
  | { v: 1; type: 'ping' }
  | { v: 1; type: 'pong' };

type Body<T> = T extends unknown ? Omit<T, 'v'> : never;

export function msg(m: Body<Message>): Message {
  return { v: PROTOCOL_VERSION, ...m } as Message;
}

const TYPES = new Set(['hello', 'action', 'state', 'error', 'ping', 'pong']);

export function isMessage(x: unknown): x is Message {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return o.v === PROTOCOL_VERSION && typeof o.type === 'string' && TYPES.has(o.type);
}
