import { DndContext, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  canReplaceWild,
  canTakeWildWithoutReplacement,
  cardName,
  cardPoints,
  ERR,
  isWild,
  layOffOptions,
  rankLabel,
  roundDef,
  ROUNDS,
  runPlan,
  SUIT_SYMBOLS,
  viewPlanContext,
  type Action,
  type BookMeldSpec,
  type Card,
  type Meld,
  type PlanOp,
  type PlayerId,
  type PlayerView,
} from '../engine';
import { BookBuilder, ChoiceDialog, type Choice } from './BookBuilder';
import { CardBack, CardFace } from './Card';
import { logText, meldTitle, wildBadge } from './describe';
import { loadOrder, orderHand, reconcileOrder, saveOrder, sortHand, type SavedOrder, type SortMode } from './handOrder';

interface Props {
  view: PlayerView;
  names: [string, string];
  dispatch: (a: Action) => void;
  conn: { tone: 'ok' | 'warn'; text: string };
  onError: (message: string) => void;
  /** localStorage key for this player's hand order in this game. */
  orderKey: string;
}

/** A hand card that can be dragged to reorder; plain clicks still reach the card. */
function SortableCard({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, transform, transition, listeners, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`hand-slot ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
    >
      {children}
    </div>
  );
}

export function GameTable({ view, names, dispatch, conn, onError, orderKey }: Props) {
  const me = view.you;
  const opp = (me === 0 ? 1 : 0) as PlayerId;
  const def = roundDef(view.round);
  const myTurn = view.turn === me;
  const planning = myTurn && view.phase === 'play';

  const [plan, setPlan] = useState<PlanOp[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [order, setOrder] = useState<SavedOrder>(() => loadOrder(orderKey));
  const [builderOpen, setBuilderOpen] = useState(false);
  const [choice, setChoice] = useState<{ title: string; choices: Choice[] } | null>(null);
  const [panel, setPanel] = useState<'scores' | 'log' | null>(null);

  // Any new state from the host (a draw, a committed turn, a new round) resets the staged plan.
  const stateKey = `${view.round}:${view.turn}:${view.phase}:${view.log.length}`;
  useEffect(() => {
    setPlan([]);
    setSelected([]);
    setChoice(null);
    setBuilderOpen(false);
  }, [stateKey]);

  // When the opponent takes from the discard pile, briefly show the taken
  // cards lifting off the pile. Keyed on the newest log entry so a re-sent
  // state (e.g. after a reconnect) doesn't replay it.
  const [taken, setTaken] = useState<{ key: string; cards: Card[] } | null>(null);
  const lastEntry = view.log[view.log.length - 1];
  const lastKey = `${view.log.length}:${JSON.stringify(lastEntry)}`;
  const seenKey = useRef(lastKey);
  const takenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (seenKey.current === lastKey) return;
    seenKey.current = lastKey;
    if (lastEntry?.kind === 'drewDiscard' && lastEntry.player !== me) {
      clearTimeout(takenTimer.current);
      setTaken({ key: lastKey, cards: lastEntry.cards });
      takenTimer.current = setTimeout(() => setTaken(null), 2400);
    }
  }, [lastKey, lastEntry, me]);
  useEffect(() => () => clearTimeout(takenTimer.current), []);

  const ctx = useMemo(() => viewPlanContext(view), [view]);
  const preview = useMemo(() => {
    const r = runPlan(ctx, plan);
    return r.ok ? r.outcome : null;
  }, [ctx, plan]);

  // ---- Hand order (client-side only, never sent to the host) --------------
  const baseHand = planning && preview ? preview.hand : view.hand;
  // Cards still in the committed hand keep their slot even while staged on the
  // table, so "Undo step" puts them back where they were.
  const keepIds = useMemo(() => new Set(view.hand.map((c) => c.id)), [view.hand]);
  const orderIds = useMemo(
    () => reconcileOrder(order.round === view.round ? order.ids : [], baseHand, keepIds),
    [order, view.round, baseHand, keepIds],
  );
  useEffect(() => {
    if (order.round !== view.round || order.ids.join() !== orderIds.join()) setOrder({ round: view.round, ids: orderIds });
  }, [order, orderIds, view.round]);
  useEffect(() => saveOrder(orderKey, order), [orderKey, order]);
  const hand = orderHand(baseHand, orderIds);

  /** Give the shown cards the order `shown`, leaving hidden (staged) ids in their slots. */
  const setShownOrder = (shown: string[]) => {
    const visible = new Set(shown);
    let i = 0;
    setOrder({ round: view.round, ids: orderIds.map((id) => (visible.has(id) ? shown[i++] : id)) });
  };
  const sortBy = (mode: SortMode) => setShownOrder(sortHand(hand, mode).map((c) => c.id));

  // Mouse: a drag starts after ~5px of movement, so a plain click still selects.
  // Touch: press and hold ~200ms to pick a card up, so taps select and swipes
  // scroll the hand; once dragging, dnd-kit blocks the page from scrolling.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const justDragged = useRef(false);
  const onDragStart = () => document.documentElement.classList.add('dragging');
  const onDragCancel = () => document.documentElement.classList.remove('dragging');
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    onDragCancel();
    // The browser may still fire a click on the dropped card; ignore it.
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    if (!over || active.id === over.id) return;
    const ids = hand.map((c) => c.id);
    setShownOrder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  const melds = planning && preview ? preview.melds : view.melds;
  const bookThisTurn = plan.some((o) => o.op === 'layBook');
  const bookLaid = view.bookLaid[me] || bookThisTurn;
  const layOffsAfterBook = bookThisTurn && plan.some((o) => o.op === 'layOff');
  const selectedCards = selected.map((id) => hand.find((c) => c.id === id)).filter((c): c is Card => !!c);
  const oneSelected = selectedCards.length === 1 ? selectedCards[0] : null;

  /** Stage a step after checking the whole plan so far still holds. */
  const addOp = (op: PlanOp): string | null => {
    const r = runPlan(ctx, [...plan, op]);
    if (!r.ok) {
      onError(r.error);
      return r.error;
    }
    setPlan([...plan, op]);
    setSelected([]);
    setChoice(null);
    return null;
  };

  const toggle = (id: string) => {
    if (justDragged.current) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  // ---- Clicks on the table -------------------------------------------------

  const clickMeld = (m: Meld) => {
    if (!planning || !oneSelected) return;
    const card = oneSelected;
    const options = layOffOptions(m, card);
    if (!bookLaid) return onError(ERR.layOffBeforeBook);
    if (bookThisTurn && m.owner !== me) return onError(ERR.layOffOpponentBookTurn);
    if (options.length === 0) return onError(ERR.cantLayOff);
    if (options.length === 1) return void addOp({ op: 'layOff', meldId: m.id, cardId: card.id, rep: options[0] });
    const sym = SUIT_SYMBOLS[m.suit!];
    setChoice({
      title: `Which end of the run does ${cardName(card)} go on?`,
      choices: options.map((rep) => ({
        label: `${rep < m.cards[0].rep ? 'Low end' : 'High end'}, as ${rankLabel(rep)}${sym}`,
        onPick: () => addOp({ op: 'layOff', meldId: m.id, cardId: card.id, rep }),
      })),
    });
  };

  const clickWild = (m: Meld, wild: Card) => {
    if (!planning) return;
    if (!bookLaid || bookThisTurn) return onError(bookThisTurn ? ERR.take2BookTurn : ERR.take2BeforeBook);
    const choices: Choice[] = [];
    if (canTakeWildWithoutReplacement(m, wild.id)) {
      choices.push({ label: 'Take the 2', onPick: () => addOp({ op: 'take2', meldId: m.id, cardId: wild.id }) });
    }
    for (const c of hand) {
      if (canReplaceWild(m, wild.id, c)) {
        choices.push({
          label: `Replace the 2 with ${cardName(c)}`,
          onPick: () => addOp({ op: 'replace2', meldId: m.id, cardId: wild.id, naturalId: c.id }),
        });
      }
    }
    if (choices.length === 0) return onError(ERR.take2Breaks);
    setChoice({ title: 'Take this 2', choices });
  };

  const draw = (type: 'drawStock' | 'drawDiscard') => {
    if (!myTurn) return onError(ERR.notYourTurn);
    dispatch({ type });
  };

  const discard = () => {
    if (!oneSelected) return;
    const r = runPlan(ctx, plan, oneSelected.id);
    if (!r.ok) return onError(r.error);
    dispatch({ type: 'commitTurn', plan, discardId: oneSelected.id });
  };

  const layBook = (melds: BookMeldSpec[]) => {
    const err = addOp({ op: 'layBook', melds });
    if (!err) setBuilderOpen(false);
    return err;
  };

  // ---- Status text ---------------------------------------------------------

  let status: string;
  if (!myTurn) status = `${names[opp]}’s turn — ${view.phase === 'draw' ? 'drawing' : 'playing'}`;
  else if (view.phase === 'draw') status = 'Your turn — draw one from the stock, or take the top two discards.';
  else if (view.firstTurn) status = 'First turn — no draw, just discard.';
  else status = 'Play cards if you like, then discard to end your turn.';

  let hint = '';
  if (planning && layOffsAfterBook) hint = 'You laid your book this turn: these lay-offs only count if your discard goes out.';
  else if (planning && bookThisTurn) hint = 'Book laid. You may lay off onto your own melds only if you go out this turn.';
  else if (planning && oneSelected && bookLaid) hint = 'Tap a meld to lay this card off, or discard it.';

  const discardWouldGoOut = !!oneSelected && hand.length === 1;
  const roundOver = view.phase === 'roundOver' || view.phase === 'gameOver';

  const byOwner = (owner: PlayerId) => melds.filter((m) => m.owner === owner);
  const [under, top] = view.discardTopTwo.length === 2 ? view.discardTopTwo : [null, view.discardTopTwo[0] ?? null];
  const takeCount = Math.min(2, view.discardCount);

  const canDrawStock = view.stockCount > 0 || view.discardCount > 1;
  const bookPill = (laid: boolean, staged = false) => (
    <span className={`pill ${laid ? 'on' : ''}`}>{laid ? 'Book laid' : staged ? 'Book staged' : 'No book yet'}</span>
  );
  const ownersWithMelds = ([opp, me] as PlayerId[]).filter((o) => byOwner(o).length > 0);
  const togglePanel = (p: 'scores' | 'log') => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className="table">
      <header className="topbar">
        <div className="brand" aria-hidden="true">
          EJ
        </div>
        <div className="round" title={`Round ${view.round} of 5. Book: ${def.description} (${def.bookSize} cards)`}>
          <strong>
            Round {view.round}
            <span className="lbl-long"> of 5</span>
            <span className="lbl-short">/5</span>
          </strong>
          <span className="book">
            Book: {def.description} <span className="muted">({def.bookSize} cards)</span>
          </span>
        </div>
        <div className={`conn ${conn.tone}`} title={conn.text} role="status">
          <span className="dot" />
          <span className="conn-text">{conn.text}</span>
        </div>
        {/* Phones: scores and the move log live in a drawer. */}
        <div className="panel-toggles">
          <button className={`btn ghost ${panel === 'scores' ? 'active' : ''}`} type="button" aria-expanded={panel === 'scores'} onClick={() => togglePanel('scores')}>
            Scores
          </button>
          <button className={`btn ghost ${panel === 'log' ? 'active' : ''}`} type="button" aria-expanded={panel === 'log'} onClick={() => togglePanel('log')}>
            Log
          </button>
        </div>
      </header>

      <div className="layout">
        <main className="play">
          <section className={`opponent ${!myTurn && !roundOver ? 'their-turn' : ''}`} aria-label="Opponent">
            <strong className="opp-name">{names[opp]}</strong>
            <span className="muted nowrap">
              {view.opponentHandCount} cards{view.dealer === opp ? ' · dealer' : ''}
            </span>
            {bookPill(view.bookLaid[opp])}
            {/* Phones: connection trouble shows here instead of the crowded top bar. */}
            {conn.tone === 'warn' && <span className="opp-conn">{conn.text}</span>}
            <div className="backs" aria-hidden="true">
              {Array.from({ length: Math.min(view.opponentHandCount, 14) }, (_, i) => (
                <CardBack key={i} small />
              ))}
            </div>
          </section>

          <section className="center">
            <div className="piles">
              <button
                type="button"
                className="pile"
                onClick={() => draw('drawStock')}
                disabled={!myTurn || roundOver}
                aria-label={`Stock, ${view.stockCount} cards. Draw one.`}
              >
                {view.stockCount > 0 ? <CardBack /> : <div className="card empty" />}
                <span className="pile-label">Stock · {view.stockCount}</span>
              </button>
              <button
                type="button"
                className="pile"
                onClick={() => draw('drawDiscard')}
                disabled={!myTurn || roundOver}
                aria-label={
                  takeCount === 0
                    ? 'Discard pile, empty.'
                    : `Discard pile. Take ${[top, under].filter((c): c is Card => !!c).map(cardName).join(' and ')}.`
                }
              >
                {/* The top two discards, fanned so you can see what you'd get. */}
                <span className="fan">
                  {under && (
                    <span className="fan-under">
                      <CardFace card={under} />
                    </span>
                  )}
                  {top ? (
                    <span className={`fan-top ${under ? '' : 'solo'}`}>
                      <CardFace card={top} />
                    </span>
                  ) : (
                    <div className="card empty" />
                  )}
                  {taken && (
                    <span className="taken" key={taken.key} aria-hidden="true">
                      {taken.cards.map((c) => (
                        <CardFace key={c.id} card={c} note="Taken" />
                      ))}
                    </span>
                  )}
                </span>
                <span className="pile-label">{takeCount === 0 ? 'Discard' : `Take ${takeCount}`}</span>
              </button>
            </div>

            <div className="melds">
              {ownersWithMelds.length === 0 && <p className="muted small">No melds on the table yet.</p>}
              {ownersWithMelds.map((owner) => (
                <div key={owner} className="meld-group">
                  <h3>
                    <span className="lbl-long">{owner === me ? 'Your melds' : `${names[opp]}’s melds`}</span>
                    <span className="lbl-short">{owner === me ? 'You' : names[opp]}</span>
                  </h3>
                  <div className="meld-row">
                    {byOwner(owner).map((m) => {
                      // On the book turn only your own melds are valid lay-off targets.
                      const target =
                        planning &&
                        !!oneSelected &&
                        bookLaid &&
                        (!bookThisTurn || m.owner === me) &&
                        layOffOptions(m, oneSelected).length > 0;
                      return (
                        <div
                          key={m.id}
                          className={`meld ${target ? 'target' : ''}`}
                          onClick={() => clickMeld(m)}
                          role={target ? 'button' : undefined}
                          tabIndex={target ? 0 : undefined}
                          onKeyDown={(e) => target && (e.key === 'Enter' || e.key === ' ') && clickMeld(m)}
                        >
                          <span className="meld-label">{meldTitle(m)}</span>
                          <div className="meld-cards">
                            {m.cards.map((mc) =>
                              isWild(mc.card) ? (
                                <CardFace
                                  key={mc.card.id}
                                  card={mc.card}
                                  small
                                  badge={wildBadge(m, mc.rep)}
                                  onClick={
                                    planning
                                      ? () => {
                                          clickWild(m, mc.card);
                                        }
                                      : undefined
                                  }
                                  disabled={planning && (!bookLaid || bookThisTurn)}
                                  title={bookThisTurn ? ERR.take2BookTurn : 'Take or replace this 2'}
                                />
                              ) : (
                                <CardFace key={mc.card.id} card={mc.card} small />
                              ),
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={`mine ${myTurn && !roundOver ? 'my-turn' : ''}`} aria-label="Your hand">
            <div className="status-row">
              <div className="status">
                <strong>{status}</strong>
                {hint && <span className="hint">{hint}</span>}
              </div>
              <div className="me-meta">
                <span className="muted nowrap">
                  {hand.length} cards{view.dealer === me ? ' · dealer' : ''}
                </span>
                {bookPill(view.bookLaid[me], bookThisTurn)}
              </div>
            </div>

            {/* Only the actions that are legal right now. */}
            <div className="action-bar" role="toolbar" aria-label="Actions">
              {myTurn && view.phase === 'draw' && (
                <>
                  {canDrawStock && (
                    <button className="btn primary" type="button" onClick={() => draw('drawStock')}>
                      <span className="lbl-long">Draw from stock</span>
                      <span className="lbl-short">Draw</span>
                    </button>
                  )}
                  {view.canTakeDiscard && (
                    <button className="btn" type="button" onClick={() => draw('drawDiscard')}>
                      Take {takeCount}
                    </button>
                  )}
                </>
              )}
              {planning && !bookLaid && (
                <button
                  className="btn"
                  type="button"
                  disabled={selected.length !== def.bookSize}
                  onClick={() => setBuilderOpen(true)}
                  title={`Select exactly ${def.bookSize} cards`}
                >
                  Lay book{' '}
                  <span className="count">
                    {selected.length}/{def.bookSize}
                  </span>
                </button>
              )}
              {planning && oneSelected && (
                <button className="btn primary" type="button" onClick={discard}>
                  <span className="lbl-long">{discardWouldGoOut ? 'Discard and go out' : 'Discard and end turn'}</span>
                  <span className="lbl-short">{discardWouldGoOut ? 'Go out' : 'Discard'}</span>
                </button>
              )}
              {planning && plan.length > 0 && (
                <>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setPlan(plan.slice(0, -1));
                      setSelected([]);
                    }}
                  >
                    Undo<span className="lbl-long"> step</span>
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setPlan([]);
                      setSelected([]);
                    }}
                  >
                    Reset<span className="lbl-long"> turn</span>
                  </button>
                </>
              )}
              <span className="sort-buttons" role="group" aria-label="Sort hand">
                <button className="btn ghost" type="button" aria-label="Sort by rank" onClick={() => sortBy('rank')}>
                  <span className="lbl-long">Sort by rank</span>
                  <span className="lbl-short">Rank</span>
                </button>
                <button className="btn ghost" type="button" aria-label="Sort by suit" onClick={() => sortBy('suit')}>
                  <span className="lbl-long">Sort by suit</span>
                  <span className="lbl-short">Suit</span>
                </button>
              </span>
            </div>

            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
              <SortableContext items={hand.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
                {/* --n lets CSS overlap the cards just enough to fit one row. */}
                <div className="hand" style={{ '--n': hand.length } as CSSProperties} title="Drag cards to reorder your hand">
                  {hand.map((c) => (
                    <SortableCard key={c.id} id={c.id}>
                      <CardFace
                        card={c}
                        selected={selected.includes(c.id)}
                        onClick={() => toggle(c.id)}
                        note={view.drawnIds.includes(c.id) ? 'Picked up' : undefined}
                      />
                    </SortableCard>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </section>
        </main>

        {panel && <div className="drawer-backdrop" onClick={() => setPanel(null)} />}
        <aside className={`side ${panel ? `open show-${panel}` : ''}`} aria-label="Scores and moves">
          <div className="drawer-head">
            <strong>{panel === 'log' ? 'Moves' : 'Scores'}</strong>
            <button className="btn ghost" type="button" onClick={() => setPanel(null)}>
              Close
            </button>
          </div>
          <Scoreboard view={view} names={names} />
          <section className="log" aria-label="Move log">
            <h3>Moves</h3>
            <ol>
              {[...view.log].reverse().slice(0, 60).map((e, i) => (
                <li key={view.log.length - i}>{logText(e, names)}</li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {builderOpen && <BookBuilder cards={selectedCards} round={view.round} onConfirm={layBook} onCancel={() => setBuilderOpen(false)} />}
      {choice && <ChoiceDialog title={choice.title} choices={choice.choices} onCancel={() => setChoice(null)} />}
      {roundOver && view.lastRound && <RoundSummary view={view} names={names} dispatch={dispatch} />}
    </div>
  );
}

function Scoreboard({ view, names }: { view: PlayerView; names: [string, string] }) {
  return (
    <section className="scores" aria-label="Scoreboard">
      <table>
        <thead>
          <tr>
            <th scope="col">Round</th>
            {([0, 1] as PlayerId[]).map((p) => (
              <th key={p} scope="col" className={view.turn === p && view.phase !== 'roundOver' && view.phase !== 'gameOver' ? 'turn' : ''}>
                {names[p]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROUNDS.map((r) => {
            const h = view.history.find((x) => x.round === r.round);
            return (
              <tr key={r.round} className={r.round === view.round ? 'current' : ''}>
                <th scope="row" title={r.description}>
                  {r.round}. <span className="muted">{r.description}</span>
                </th>
                <td>{h ? h.points[0] : ''}</td>
                <td>{h ? h.points[1] : ''}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{view.scores[0]}</td>
            <td>{view.scores[1]}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function RoundSummary({ view, names, dispatch }: { view: PlayerView; names: [string, string]; dispatch: (a: Action) => void }) {
  const r = view.lastRound!;
  const over = view.phase === 'gameOver';
  const loser = r.winner === null ? null : ((r.winner === 0 ? 1 : 0) as PlayerId);
  const [a, b] = view.scores;
  const final = a === b ? 'It’s a tie.' : `${names[a > b ? 0 : 1]} wins the game.`;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rs-title">
      <div className="modal">
        <h2 id="rs-title">{over ? final : `Round ${r.round} is over`}</h2>
        {r.winner === null ? (
          <p>The stock ran out, so no one scores this round.</p>
        ) : (
          <>
            <p>
              <strong>{names[r.winner]}</strong> went out. {names[loser!]} was left holding:
            </p>
            <div className="summary-cards">
              {r.loserCards.map((c) => (
                <CardFace key={c.id} card={c} small note={`${cardPoints(c)}`} />
              ))}
            </div>
            <table className="summary">
              <tbody>
                <tr>
                  <th scope="row">Cards left</th>
                  <td>{r.cardPoints}</td>
                </tr>
                <tr>
                  <th scope="row">Round {r.round} bonus</th>
                  <td>{r.bonus}</td>
                </tr>
                <tr>
                  <th scope="row">{names[r.winner]} scores</th>
                  <td>
                    <strong>{r.points[r.winner]}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        <p className="totals">
          {names[0]} <strong>{r.totals[0]}</strong> — {names[1]} <strong>{r.totals[1]}</strong>
        </p>
        <div className="row end">
          {over ? (
            <button className="btn primary" type="button" onClick={() => dispatch({ type: 'playAgain' })}>
              Play again
            </button>
          ) : (
            <button className="btn primary" type="button" onClick={() => dispatch({ type: 'nextRound' })}>
              Deal round {r.round + 1}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
