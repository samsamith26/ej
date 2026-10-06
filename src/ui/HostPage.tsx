import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { isLocalGame } from '../net/config';
import { GameTable } from './GameTable';
import { loadName, useHostSession, useToasts } from './hooks';
import { BigCard, Toasts } from './Panel';

export function HostPage() {
  const { gameId = '' } = useParams();
  const { toasts, push, dismiss } = useToasts();
  const [name] = useState(() => loadName() || 'Player 1');
  const { snap, dispatch } = useHostSession(gameId, name, push);
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/join/${gameId}`;

  if (!snap) return null;

  if (!snap.guestSeated) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        push('Couldn’t copy — select the link and copy it manually.');
      }
    };
    return (
      <BigCard>
        <h1 className="title small">Your table is ready</h1>
        <p className="lede">Send this link to your opponent. The game starts as soon as they join.</p>
        <div className="invite">
          <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button className="btn primary" type="button" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <p className="waiting">
          <span className="dot pulse" />
          {snap.hostStatus === 'ready'
            ? 'Waiting for opponent…'
            : snap.hostStatus === 'error'
              ? `Connection problem: ${snap.hostDetail ?? 'unknown error'}`
              : (snap.hostDetail ?? 'Opening the table…')}
        </p>
        {isLocalGame(gameId) && (
          <p className="muted">
            Local test game: open <a href={`/join/${gameId}`} target="_blank" rel="noreferrer">/join/{gameId}</a> in another tab.
          </p>
        )}
        <p className="muted">Keep this tab open — your browser is the game server.</p>
        <Toasts toasts={toasts} dismiss={dismiss} />
      </BigCard>
    );
  }

  const conn =
    snap.guestStatus === 'connected'
      ? { tone: 'ok' as const, text: 'Opponent connected' }
      : { tone: 'warn' as const, text: 'Opponent disconnected — waiting for them to reconnect' };

  return (
    <>
      <GameTable orderKey={`ej:order:${gameId}:0`} view={snap.view} names={snap.names} dispatch={dispatch} conn={conn} onError={push} />
      <Toasts toasts={toasts} dismiss={dismiss} />
    </>
  );
}
