import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUNDS } from '../engine';
import { newGameId } from '../net/config';
import { loadName, saveName } from './hooks';
import { BigCard } from './Panel';

export function Lobby() {
  const [name, setName] = useState(loadName);
  const navigate = useNavigate();

  const start = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    saveName(name.trim());
    navigate(`/host/${newGameId()}`);
  };

  return (
    <BigCard>
      <h1 className="title">EJ</h1>
      <p className="lede">A two-player rummy game over five rounds. Lay your book, then race to go out.</p>
      <form onSubmit={start} className="stack">
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoFocus placeholder="e.g. Alex" />
        </label>
        <button className="btn primary" type="submit" disabled={!name.trim()}>
          New game
        </button>
      </form>
      <details className="rules">
        <summary>The five books</summary>
        <ol>
          {ROUNDS.map((r) => (
            <li key={r.round}>
              {r.description} <span className="muted">({r.bookSize} cards, +{r.bonus} for going out)</span>
            </li>
          ))}
        </ol>
        <p className="muted">2s are wild. Draw one from the stock, or take the top two cards of the discard pile.</p>
      </details>
    </BigCard>
  );
}
