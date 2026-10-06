import Peer, { type DataConnection } from 'peerjs';
import { isLocalGame, peerOptions, randomId } from './config';
import { isMessage, type Message } from './protocol';

/** One host↔guest link. */
export interface Conn {
  send(m: Message): void;
  close(): void;
  onMessage(cb: (m: Message) => void): void;
  onClose(cb: () => void): void;
}

export type HostStatus = 'starting' | 'ready' | 'retrying' | 'error';

export interface HostEndpoint {
  destroy(): void;
}

export interface HostHandlers {
  onConnection(c: Conn): void;
  onStatus(s: HostStatus, detail?: string): void;
}

/** Listen for guests on `gameId` (PeerJS, or BroadcastChannel for local two-tab games). */
export function hostGame(gameId: string, h: HostHandlers): HostEndpoint {
  return isLocalGame(gameId) ? localHost(gameId, h) : peerHost(gameId, h);
}

/** Connect to the host; rejects if the host can't be reached within `timeoutMs`. */
export function joinGame(gameId: string, timeoutMs = 8000): Promise<Conn> {
  return isLocalGame(gameId) ? localJoin(gameId, timeoutMs) : peerJoin(gameId, timeoutMs);
}

// ---- Shared Conn plumbing ---------------------------------------------------

function makeConn(sendRaw: (m: Message) => void, closeRaw: () => void) {
  const msgCbs: ((m: Message) => void)[] = [];
  const closeCbs: (() => void)[] = [];
  let closed = false;
  const conn: Conn = {
    send: (m) => {
      if (!closed) sendRaw(m);
    },
    close: () => {
      if (closed) return;
      closed = true;
      closeRaw();
      closeCbs.forEach((cb) => cb());
    },
    onMessage: (cb) => msgCbs.push(cb),
    onClose: (cb) => closeCbs.push(cb),
  };
  return {
    conn,
    deliver: (data: unknown) => {
      if (!closed && isMessage(data)) msgCbs.forEach((cb) => cb(data));
    },
    remoteClosed: () => {
      if (closed) return;
      closed = true;
      closeCbs.forEach((cb) => cb());
    },
  };
}

// ---- PeerJS -----------------------------------------------------------------

function wrapDataConnection(dc: DataConnection): Conn {
  const { conn, deliver, remoteClosed } = makeConn(
    (m) => void dc.send(m),
    () => dc.close(),
  );
  dc.on('data', deliver);
  dc.on('close', remoteClosed);
  dc.on('error', remoteClosed);
  return conn;
}

function peerHost(gameId: string, h: HostHandlers): HostEndpoint {
  let peer: Peer | null = null;
  let destroyed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const start = () => {
    h.onStatus('starting');
    const p = new Peer(gameId, peerOptions());
    peer = p;
    p.on('open', () => h.onStatus('ready'));
    p.on('connection', (dc) => dc.on('open', () => h.onConnection(wrapDataConnection(dc))));
    p.on('disconnected', () => {
      // Lost the signaling server; existing data channels keep working.
      if (!destroyed && !p.destroyed) setTimeout(() => !p.destroyed && p.reconnect(), 2000);
    });
    p.on('error', (err) => {
      if (destroyed) return;
      // After a refresh the signaling server may still hold our old id for a
      // few seconds, so keep retrying with the same id.
      const retriable = ['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'];
      if (retriable.includes(err.type)) {
        h.onStatus('retrying', err.type === 'unavailable-id' ? 'Reclaiming game id…' : 'Reconnecting to signaling server…');
        p.destroy();
        retryTimer = setTimeout(start, 3000);
      } else if (err.type !== 'peer-unavailable') {
        h.onStatus('error', err.message);
      }
    });
  };
  start();

  return {
    destroy: () => {
      destroyed = true;
      clearTimeout(retryTimer);
      peer?.destroy();
    },
  };
}

function peerJoin(gameId: string, timeoutMs: number): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let settled = false;
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    peer.on('error', (err) => fail(err.type));
    peer.on('open', () => {
      const dc = peer.connect(gameId, { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const conn = wrapDataConnection(dc);
        // Tear down our peer once the link is gone; each retry makes a fresh one.
        conn.onClose(() => peer.destroy());
        resolve(conn);
      });
      dc.on('error', () => fail('connection-error'));
    });
  });
}

// ---- Local (two tabs, same browser) -----------------------------------------

type LocalPacket =
  | { t: 'connect'; cid: string }
  | { t: 'accept'; cid: string }
  | { t: 'msg'; cid: string; to: 'host' | 'guest'; m: unknown }
  | { t: 'close'; cid: string; to: 'host' | 'guest' };

const channelName = (gameId: string) => `ej-local-${gameId}`;

function localHost(gameId: string, h: HostHandlers): HostEndpoint {
  const ch = new BroadcastChannel(channelName(gameId));
  const conns = new Map<string, ReturnType<typeof makeConn>>();
  const post = (p: LocalPacket) => ch.postMessage(p);

  ch.onmessage = (e: MessageEvent<LocalPacket>) => {
    const p = e.data;
    if (p.t === 'connect') {
      const link = makeConn(
        (m) => post({ t: 'msg', cid: p.cid, to: 'guest', m }),
        () => {
          post({ t: 'close', cid: p.cid, to: 'guest' });
          conns.delete(p.cid);
        },
      );
      conns.set(p.cid, link);
      post({ t: 'accept', cid: p.cid });
      h.onConnection(link.conn);
    } else if (p.t === 'msg' && p.to === 'host') {
      conns.get(p.cid)?.deliver(p.m);
    } else if (p.t === 'close' && p.to === 'host') {
      conns.get(p.cid)?.remoteClosed();
      conns.delete(p.cid);
    }
  };
  const onUnload = () => conns.forEach((_, cid) => post({ t: 'close', cid, to: 'guest' }));
  window.addEventListener('beforeunload', onUnload);
  queueMicrotask(() => h.onStatus('ready'));

  return {
    destroy: () => {
      onUnload();
      window.removeEventListener('beforeunload', onUnload);
      ch.close();
    },
  };
}

function localJoin(gameId: string, timeoutMs: number): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(channelName(gameId));
    const cid = randomId(10);
    const post = (p: LocalPacket) => ch.postMessage(p);
    const onUnload = () => post({ t: 'close', cid, to: 'host' });
    const cleanup = () => {
      window.removeEventListener('beforeunload', onUnload);
      ch.close();
    };
    const link = makeConn(
      (m) => post({ t: 'msg', cid, to: 'host', m }),
      () => post({ t: 'close', cid, to: 'host' }),
    );
    link.conn.onClose(cleanup);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, Math.min(timeoutMs, 2000));

    ch.onmessage = (e: MessageEvent<LocalPacket>) => {
      const p = e.data;
      if (p.cid !== cid) return;
      if (p.t === 'accept') {
        clearTimeout(timer);
        window.addEventListener('beforeunload', onUnload);
        resolve(link.conn);
      } else if (p.t === 'msg' && p.to === 'guest') {
        link.deliver(p.m);
      } else if (p.t === 'close' && p.to === 'guest') {
        link.remoteClosed();
      }
    };
    post({ t: 'connect', cid });
  });
}
