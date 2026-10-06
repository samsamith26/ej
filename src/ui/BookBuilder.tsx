import { useMemo, useState } from 'react';
import {
  isWild,
  rankLabel,
  roundDef,
  runPlacements,
  suggestBookGroupings,
  SUIT_SYMBOLS,
  type BookMeldSpec,
  type Card,
  type Rank,
  type RunPlacement,
} from '../engine';
import { CardFace } from './Card';

interface Props {
  cards: Card[];
  round: number;
  /** Returns an error message if the engine rejects the book. */
  onConfirm: (melds: BookMeldSpec[]) => string | null;
  onCancel: () => void;
}

const SET_RANKS: Rank[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1];

function placementLabel(p: RunPlacement, cards: Card[]): string {
  const reps = cards.map((c) => p.reps[c.id]).sort((a, b) => a - b);
  const wilds = cards.filter(isWild).map((c) => rankLabel(p.reps[c.id])).sort();
  const sym = SUIT_SYMBOLS[p.suit];
  const span = `${rankLabel(reps[0])}${sym} to ${rankLabel(reps[reps.length - 1])}${sym}`;
  return wilds.length ? `${span} (2s as ${wilds.join(', ')})` : span;
}

/**
 * Groups the selected cards into this round's required melds. Pre-fills the
 * first grouping that could work; the player can move cards between melds and
 * pick wild assignments when they're ambiguous.
 */
export function BookBuilder({ cards, round, onConfirm, onCancel }: Props) {
  const def = roundDef(round);
  const [slotOf, setSlotOf] = useState<Record<string, number>>(() => {
    const g = suggestBookGroupings(cards, round)[0];
    const init: Record<string, number> = {};
    for (const c of cards) init[c.id] = g ? g.findIndex((ids) => ids.includes(c.id)) : -1;
    return init;
  });
  const [active, setActive] = useState(0);
  const [setRank, setSetRank] = useState<Record<number, Rank>>({});
  const [runChoice, setRunChoice] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  const groups = def.melds.map((_, i) => cards.filter((c) => slotOf[c.id] === i));
  const tray = cards.filter((c) => slotOf[c.id] === -1);
  const placements = useMemo(
    () => groups.map((g, i) => (def.melds[i].kind === 'run' && g.length === def.melds[i].size ? runPlacements(g) : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(slotOf)],
  );

  const move = (id: string) => {
    setError(null);
    setSlotOf((s) => ({ ...s, [id]: s[id] === -1 ? active : -1 }));
  };

  const confirm = () => {
    const specs: BookMeldSpec[] = def.melds.map((req, i) => {
      const g = groups[i];
      if (req.kind === 'run') {
        const p = placements[i][runChoice[i] ?? 0];
        if (!p) return { kind: 'run', cards: g.map((c) => ({ cardId: c.id })) };
        return { kind: 'run', suit: p.suit, cards: g.map((c) => ({ cardId: c.id, rep: p.reps[c.id] })) };
      }
      const allWild = g.every(isWild);
      return { kind: req.kind, rank: allWild && req.kind === 'set' ? setRank[i] : undefined, cards: g.map((c) => ({ cardId: c.id })) };
    });
    const err = onConfirm(specs);
    if (err) setError(err);
  };

  const ready = tray.length === 0 && groups.every((g, i) => g.length === def.melds[i].size);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="bb-title">
      <div className="modal wide">
        <h2 id="bb-title">Lay your book: {def.description}</h2>
        <p className="muted">Pick a meld, then tap cards to move them in or out of it.</p>
        <div className="bb-slots">
          {def.melds.map((req, i) => {
            const g = groups[i];
            const full = g.length === req.size;
            const opts = placements[i];
            return (
              <div
                key={i}
                className={`bb-slot ${active === i ? 'active' : ''}`}
                onClick={() => setActive(i)}
                role="group"
                aria-label={`Meld ${i + 1}`}
              >
                <div className="bb-head">
                  <span>{req.kind === 'set' ? '3-of-a-kind' : req.kind === 'aces' ? 'Pair of aces' : `Run of ${req.size}`}</span>
                  <span className="muted">
                    {g.length}/{req.size}
                  </span>
                </div>
                <div className="bb-cards">
                  {g.map((c) => (
                    <CardFace key={c.id} card={c} small onClick={() => move(c.id)} />
                  ))}
                </div>
                {req.kind === 'set' && full && g.every(isWild) && (
                  <label className="field inline">
                    <span>2s stand for</span>
                    <select value={setRank[i] ?? ''} onChange={(e) => setSetRank({ ...setRank, [i]: Number(e.target.value) as Rank })}>
                      <option value="" disabled>
                        choose a rank
                      </option>
                      {SET_RANKS.filter((r) => !(round === 1 && r === 1)).map((r) => (
                        <option key={r} value={r}>
                          {rankLabel(r)}s
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {req.kind === 'run' && full && opts.length > 1 && (
                  <label className="field inline">
                    <span>Run is</span>
                    <select value={runChoice[i] ?? 0} onChange={(e) => setRunChoice({ ...runChoice, [i]: Number(e.target.value) })}>
                      {opts.map((p, k) => (
                        <option key={k} value={k}>
                          {placementLabel(p, g)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {req.kind === 'run' && full && opts.length === 0 && <p className="error-text">These cards don’t make a run.</p>}
              </div>
            );
          })}
        </div>
        {tray.length > 0 && (
          <>
            <p className="muted">Not placed yet:</p>
            <div className="bb-cards tray">
              {tray.map((c) => (
                <CardFace key={c.id} card={c} small onClick={() => move(c.id)} />
              ))}
            </div>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="row end">
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" type="button" disabled={!ready} onClick={confirm}>
            Lay book
          </button>
        </div>
      </div>
    </div>
  );
}

export interface Choice {
  label: string;
  onPick: () => void;
}

export function ChoiceDialog({ title, choices, onCancel }: { title: string; choices: Choice[]; onCancel: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="stack">
          {choices.map((c) => (
            <button key={c.label} className="btn" type="button" onClick={c.onPick}>
              {c.label}
            </button>
          ))}
          <button className="btn ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
