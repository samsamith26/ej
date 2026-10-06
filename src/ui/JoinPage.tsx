import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameTable } from './GameTable';
import { loadName, saveName, useGuestSession, useToasts } from './hooks';
import { BigCard, Toasts } from './Panel';

export function JoinPage() {
  const { gameId = '' } = useParams();
  const { toasts, push, dismiss } = useToasts();
  const [draft, setDraft] = useState(loadName);
  const [name, setName] = useState<string | null>(null);
  const { snap, dispatch } = useGuestSession(gameId, name, push);

  if (name === null) {
    const join = (e: FormEvent) => {
      e.preventDefault();
      if (!draft.trim()) return;
      saveName(draft.trim());
      setName(draft.trim());
    };
    return (
      <BigCard>
        <h1 className="title small">You’re invited to a game of EJ</h1>
        <form onSubmit={join} className="stack">
          <label className="field">
            <span>Your name</span>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={24} autoFocus placeholder="e.g. Sam" />
          </label>
          <button className="btn primary" type="submit" disabled={!draft.trim()}>
            Join game
          </button>
        </form>
      </BigCard>
    );
  }

  if (snap?.status === 'full') {
    return (
      <BigCard>
        <h1 className="title small">Game is full</h1>
        <p className="lede">Two players are already seated at this table.</p>
        <Link className="btn primary" to="/">
          Start your own game
        </Link>
      </BigCard>
    );
  }

  if (!snap?.view || !snap.names) {
    return (
      <BigCard>
        <h1 className="title small">{snap?.status === 'waiting-host' ? 'Waiting for host…' : 'Connecting…'}</h1>
        <p className="waiting">
          <span className="dot pulse" />
          {snap?.status === 'waiting-host'
            ? 'The host’s tab isn’t reachable yet. We’ll keep trying.'
            : 'Finding the table…'}
        </p>
        <Toasts toasts={toasts} dismiss={dismiss} />
      </BigCard>
    );
  }

  const conn =
    snap.status === 'connected'
      ? { tone: 'ok' as const, text: 'Connected to host' }
      : snap.status === 'waiting-host'
        ? { tone: 'warn' as const, text: 'Waiting for host…' }
        : { tone: 'warn' as const, text: 'Reconnecting…' };

  return (
    <>
      <GameTable orderKey={`ej:order:${gameId}:1`} view={snap.view} names={snap.names} dispatch={dispatch} conn={conn} onError={push} />
      <Toasts toasts={toasts} dismiss={dismiss} />
    </>
  );
}
