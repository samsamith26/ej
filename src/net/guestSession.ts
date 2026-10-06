import type { Action, PlayerView } from '../engine';
import { randomId } from './config';
import { msg } from './protocol';
import { joinGame, type Conn } from './transport';

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'waiting-host' | 'full';

export interface GuestSnapshot {
  status: ConnStatus;
  view: PlayerView | null;
  names: [string, string] | null;
}

const PING_MS = 3000;
const HOST_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 10_000];

/** Seat token, kept in localStorage so a reconnecting guest re-claims their seat. */
function playerToken(gameId: string): string {
  const key = `ej:guest:${gameId}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const t = randomId(16);
    localStorage.setItem(key, t);
    return t;
  } catch {
    return randomId(16);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Guest side: connects to the host, retries with backoff, and only ever sees redacted views. */
export class GuestSession {
  private snap: GuestSnapshot = { status: 'connecting', view: null, names: null };
  private conn: Conn | null = null;
  private destroyed = false;
  private token: string;

  constructor(
    private gameId: string,
    private name: string,
    private onChange: (s: GuestSnapshot) => void,
    private onError: (message: string) => void,
  ) {
    this.token = playerToken(gameId);
    void this.connectLoop();
  }

  destroy(): void {
    this.destroyed = true;
    this.conn?.close();
  }

  dispatch(action: Action): void {
    if (!this.conn) {
      this.onError('Not connected to the host.');
      return;
    }
    this.conn.send(msg({ type: 'action', action }));
  }

  private isFull(): boolean {
    return this.snap.status === 'full';
  }

  private set(p: Partial<GuestSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    this.onChange(this.snap);
  }

  private async connectLoop(): Promise<void> {
    let failures = 0;
    while (!this.destroyed && !this.isFull()) {
      let conn: Conn;
      try {
        conn = await joinGame(this.gameId);
      } catch {
        if (this.destroyed) return;
        failures++;
        this.set({ status: 'waiting-host' });
        await sleep(BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]);
        continue;
      }
      if (this.destroyed) {
        conn.close();
        return;
      }
      failures = 0;
      await this.runConnection(conn);
      if (!this.destroyed && !this.isFull()) this.set({ status: 'reconnecting' });
    }
  }

  /** Resolves when the connection closes. */
  private runConnection(conn: Conn): Promise<void> {
    return new Promise((resolve) => {
      this.conn = conn;
      let lastSeen = Date.now();
      const heartbeat = setInterval(() => {
        if (Date.now() - lastSeen > HOST_TIMEOUT_MS) conn.close();
        else conn.send(msg({ type: 'ping' }));
      }, PING_MS);

      conn.onMessage((m) => {
        lastSeen = Date.now();
        if (m.type === 'state') this.set({ status: 'connected', view: m.view, names: m.names });
        else if (m.type === 'error') {
          if (m.fatal) this.set({ status: 'full' });
          else this.onError(m.message);
        }
      });
      conn.onClose(() => {
        clearInterval(heartbeat);
        if (this.conn === conn) this.conn = null;
        resolve();
      });
      conn.send(msg({ type: 'hello', name: this.name, playerToken: this.token }));
    });
  }
}
