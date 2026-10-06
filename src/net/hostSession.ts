import { applyAction, createGame, getPlayerView, type Action, type GameState, type PlayerId, type PlayerView } from '../engine';
import { msg, type Message } from './protocol';
import { hostGame, type Conn, type HostEndpoint, type HostStatus } from './transport';

/** The host is always seat 0; the guest is seat 1. */
const HOST: PlayerId = 0;
const GUEST: PlayerId = 1;
const GUEST_TIMEOUT_MS = 10_000;

export type GuestStatus = 'waiting' | 'connected' | 'disconnected';

export interface HostSnapshot {
  view: PlayerView;
  names: [string, string];
  guestSeated: boolean;
  guestStatus: GuestStatus;
  hostStatus: HostStatus;
  hostDetail?: string;
}

interface Saved {
  state: GameState;
  names: [string, string];
  guestToken: string | null;
}

const storageKey = (gameId: string) => `ej:host:${gameId}`;

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] | 0;
}

/**
 * The authoritative game server, running in the host's tab. Every action —
 * the host's own included — goes through `applyAction`; after each change the
 * full state is saved to localStorage and each player gets a redacted view.
 */
export class HostSession {
  private saved: Saved;
  private conn: Conn | null = null;
  private lastSeen = 0;
  private hostStatus: HostStatus = 'starting';
  private hostDetail?: string;
  private endpoint: HostEndpoint;
  private liveness: ReturnType<typeof setInterval>;

  constructor(
    private gameId: string,
    hostName: string,
    private onChange: (s: HostSnapshot) => void,
    private onError: (message: string) => void,
  ) {
    // A restored game keeps the host name it started with (the saved name in
    // localStorage may since have been changed, e.g. by a join tab in two-tab testing).
    this.saved = this.load() ?? { state: createGame(randomSeed()), names: [hostName, 'Opponent'], guestToken: null };
    this.save();

    this.endpoint = hostGame(gameId, {
      onConnection: (c) => this.handleConnection(c),
      onStatus: (s, detail) => {
        this.hostStatus = s;
        this.hostDetail = detail;
        this.emit();
      },
    });
    this.liveness = setInterval(() => {
      if (this.conn && Date.now() - this.lastSeen > GUEST_TIMEOUT_MS) this.conn.close();
    }, 2000);
    this.emit();
  }

  destroy(): void {
    clearInterval(this.liveness);
    this.conn?.close();
    this.endpoint.destroy();
  }

  /** The host's own moves use the same validated path as the guest's. */
  dispatch(action: Action): void {
    this.apply(HOST, action);
  }

  private apply(player: PlayerId, action: Action): string | null {
    const res = applyAction(this.saved.state, player, action);
    if ('error' in res) {
      if (player === HOST) this.onError(res.error);
      return res.error;
    }
    this.saved.state = res.state;
    this.save();
    this.broadcast();
    return null;
  }

  private handleConnection(c: Conn): void {
    let seated = false;
    c.onMessage((m: Message) => {
      if (c === this.conn) this.lastSeen = Date.now();
      switch (m.type) {
        case 'hello': {
          const { guestToken } = this.saved;
          if (guestToken !== null && guestToken !== m.playerToken) {
            c.send(msg({ type: 'error', message: 'Game is full', fatal: true }));
            setTimeout(() => c.close(), 500);
            return;
          }
          // New guest takes the seat, or a returning guest reclaims it.
          if (this.conn && this.conn !== c) this.conn.close();
          this.saved.guestToken = m.playerToken;
          this.saved.names[1] = m.name.trim().slice(0, 24) || 'Opponent';
          this.conn = c;
          this.lastSeen = Date.now();
          seated = true;
          this.save();
          this.broadcast();
          return;
        }
        case 'ping':
          c.send(msg({ type: 'pong' }));
          return;
        case 'action': {
          if (!seated || c !== this.conn) return;
          const err = this.apply(GUEST, m.action);
          if (err) c.send(msg({ type: 'error', message: err }));
          return;
        }
        default:
          return;
      }
    });
    c.onClose(() => {
      if (c === this.conn) {
        this.conn = null;
        this.emit();
      }
    });
  }

  private broadcast(): void {
    this.conn?.send(msg({ type: 'state', view: getPlayerView(this.saved.state, GUEST), names: this.saved.names }));
    this.emit();
  }

  private emit(): void {
    const seated = this.saved.guestToken !== null;
    this.onChange({
      view: getPlayerView(this.saved.state, HOST),
      names: [...this.saved.names],
      guestSeated: seated,
      guestStatus: this.conn ? 'connected' : seated ? 'disconnected' : 'waiting',
      hostStatus: this.hostStatus,
      hostDetail: this.hostDetail,
    });
  }

  private load(): Saved | null {
    try {
      const raw = localStorage.getItem(storageKey(this.gameId));
      if (!raw) return null;
      const s = JSON.parse(raw) as Saved;
      return s.state?.version === 2 ? s : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(storageKey(this.gameId), JSON.stringify(this.saved));
    } catch {
      // Storage full or blocked: the game still works, it just won't survive a refresh.
    }
  }
}
