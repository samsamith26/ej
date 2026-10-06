import { roundDef, TOTAL_ROUNDS } from './books';
import { fullDeck, handPoints } from './cards';
import { ERR, runPlan, type PlanContext } from './plan';
import { Rng } from './rng';
import type { Action, Card, GameState, LogEntry, PlayerId, PlayerView, RoundResult } from './types';

const MAX_LOG = 200;

export type ApplyResult = { state: GameState } | { error: string };

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function createGame(seed: number): GameState {
  const rng = new Rng(seed | 0);
  const firstDealer = rng.int(2) as PlayerId;
  const blank: GameState = {
    version: 2,
    rng: rng.state,
    round: 1,
    dealer: firstDealer,
    turn: other(firstDealer),
    phase: 'play',
    firstTurn: true,
    stock: [],
    discard: [],
    hands: [[], []],
    melds: [],
    bookLaid: [false, false],
    drawnIds: [],
    nextMeldId: 1,
    scores: [0, 0],
    history: [],
    lastRound: null,
    log: [],
  };
  return dealRound(blank, 1, firstDealer);
}

/** Fresh shuffled deck; dealer gets book+3, non-dealer book+4; flip one; non-dealer starts. */
export function dealRound(prev: GameState, round: number, dealer: PlayerId): GameState {
  const rng = new Rng(prev.rng);
  const deck = rng.shuffle(fullDeck());
  const size = roundDef(round).bookSize;
  const nonDealer = other(dealer);
  const hands: [Card[], Card[]] = [[], []];
  const want: Record<PlayerId, number> = { [dealer]: size + 3, [nonDealer]: size + 4 } as Record<PlayerId, number>;
  // Deal one at a time, non-dealer first, until both hands are full.
  let p: PlayerId = nonDealer;
  while (hands[0].length < want[0] || hands[1].length < want[1]) {
    if (hands[p].length < want[p]) hands[p].push(deck.pop()!);
    p = other(p);
  }
  const discard = [deck.pop()!];
  return {
    ...prev,
    rng: rng.state,
    round,
    dealer,
    turn: nonDealer,
    // The non-dealer holds the extra card, so their first turn skips the draw.
    phase: 'play',
    firstTurn: true,
    stock: deck,
    discard,
    hands,
    melds: [],
    bookLaid: [false, false],
    drawnIds: [],
    nextMeldId: 1,
    log: trimLog([...prev.log, { kind: 'roundStart', round, dealer }]),
  };
}

function trimLog(log: LogEntry[]): LogEntry[] {
  return log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log;
}

/**
 * When the stock is empty and a card is needed, shuffle the discard pile
 * (except its top card) into a new stock. Mutates `s`.
 */
function refillStock(s: GameState): void {
  if (s.stock.length > 0 || s.discard.length <= 1) return;
  const rng = new Rng(s.rng);
  const top = s.discard[s.discard.length - 1];
  s.stock = rng.shuffle(s.discard.slice(0, -1));
  s.discard = [top];
  s.rng = rng.state;
  s.log.push({ kind: 'reshuffled' });
}

/**
 * Can the player whose turn it is draw anything at all? The discard pile can
 * always be taken while it has a card, so this only fails when both piles are
 * empty — which can't happen right after a discard, but is kept as a guard.
 */
function drawPossible(s: GameState): boolean {
  return s.stock.length > 0 || s.discard.length > 0;
}

function endRound(s: GameState, winner: PlayerId | null): void {
  const bonus = winner === null ? 0 : roundDef(s.round).bonus;
  const loserCards = winner === null ? [] : [...s.hands[other(winner)]];
  const cardPoints = handPoints(loserCards);
  const points: [number, number] = [0, 0];
  if (winner !== null) points[winner] = cardPoints + bonus;
  s.scores = [s.scores[0] + points[0], s.scores[1] + points[1]];
  const result: RoundResult = {
    round: s.round,
    winner,
    reason: winner === null ? 'stock' : 'out',
    loserCards,
    cardPoints,
    bonus,
    points,
    totals: [...s.scores],
  };
  s.history = [...s.history, result];
  s.lastRound = result;
  s.log.push(winner === null ? { kind: 'stockOut' } : { kind: 'wentOut', player: winner, points: points[winner] });
  if (s.round >= TOTAL_ROUNDS) {
    s.phase = 'gameOver';
    const w = s.scores[0] === s.scores[1] ? null : s.scores[0] > s.scores[1] ? 0 : 1;
    s.log.push({ kind: 'gameOver', winner: w });
  } else {
    s.phase = 'roundOver';
  }
}

export function planContext(s: GameState, player: PlayerId): PlanContext {
  return {
    player,
    round: s.round,
    hand: s.hands[player],
    melds: s.melds,
    bookLaid: s.bookLaid[player],
    nextMeldId: s.nextMeldId,
  };
}

/**
 * The single entry point for all moves. Pure: returns a new state or an
 * error, never mutating the input.
 */
export function applyAction(state: GameState, player: PlayerId, action: Action): ApplyResult {
  const s: GameState = structuredClone(state);

  if (action.type === 'nextRound') {
    if (s.phase !== 'roundOver') return { error: 'The round is still in progress.' };
    return { state: dealRound(s, s.round + 1, other(s.dealer)) };
  }
  if (action.type === 'playAgain') {
    if (s.phase !== 'gameOver') return { error: 'The game is still in progress.' };
    const rng = new Rng(s.rng);
    const dealer = rng.int(2) as PlayerId;
    const reset: GameState = { ...s, rng: rng.state, scores: [0, 0], history: [], lastRound: null, log: [] };
    return { state: dealRound(reset, 1, dealer) };
  }

  if (s.phase === 'roundOver' || s.phase === 'gameOver') return { error: 'The round is over.' };
  if (s.turn !== player) return { error: ERR.notYourTurn };

  switch (action.type) {
    case 'drawStock': {
      if (s.phase !== 'draw') return { error: s.firstTurn ? ERR.firstTurnNoDraw : ERR.alreadyDrew };
      refillStock(s);
      if (s.stock.length === 0) {
        // Stock and the pile under the top discard are both empty: the
        // player must take the discard pile instead, if there is one.
        if (s.discard.length > 0) return { error: ERR.stockEmpty };
        endRound(s, null);
        return { state: s };
      }
      const card = s.stock.pop()!;
      s.hands[player].push(card);
      s.drawnIds = [card.id];
      s.phase = 'play';
      s.log.push({ kind: 'drewStock', player });
      s.log = trimLog(s.log);
      return { state: s };
    }
    case 'drawDiscard': {
      if (s.phase !== 'draw') return { error: s.firstTurn ? ERR.firstTurnNoDraw : ERR.alreadyDrew };
      if (s.discard.length === 0) return { error: ERR.discardEmpty };
      // Take the top two discards (just the one if that's all there is).
      // Nothing comes from the stock, so this never needs a reshuffle.
      const taken = s.discard.splice(-Math.min(2, s.discard.length));
      s.hands[player].push(...taken);
      s.drawnIds = taken.map((c) => c.id);
      s.phase = 'play';
      s.log.push({ kind: 'drewDiscard', player, cards: [...taken].reverse() });
      s.log = trimLog(s.log);
      return { state: s };
    }
    case 'commitTurn': {
      if (s.phase !== 'play') return { error: ERR.drawFirst };
      if (!action.discardId) return { error: ERR.mustDiscard };
      const res = runPlan(planContext(s, player), action.plan, action.discardId);
      if (!res.ok) return { error: res.error };
      const o = res.outcome;
      s.hands[player] = o.hand;
      s.melds = o.melds;
      s.nextMeldId = o.nextMeldId;
      if (o.bookLaidThisTurn) s.bookLaid[player] = true;
      s.discard.push(o.discarded!);
      for (const e of o.events) s.log.push({ ...e, player });
      s.log.push({ kind: 'discarded', player, card: o.discarded! });
      s.drawnIds = [];
      s.firstTurn = false;
      if (o.wentOut) {
        endRound(s, player);
      } else {
        s.turn = other(player);
        s.phase = 'draw';
        // If the next player can't draw even after a reshuffle, the round ends with no points.
        if (!drawPossible(s)) endRound(s, null);
      }
      s.log = trimLog(s.log);
      return { state: s };
    }
  }
}

/** Redacted view for one player: the opponent's hand is a count; the stock is a count. */
export function getPlayerView(s: GameState, you: PlayerId): PlayerView {
  const myTurnToDraw = s.phase === 'draw' && s.turn === you;
  return {
    you,
    round: s.round,
    dealer: s.dealer,
    turn: s.turn,
    phase: s.phase,
    firstTurn: s.firstTurn,
    hand: [...s.hands[you]],
    opponentHandCount: s.hands[other(you)].length,
    stockCount: s.stock.length,
    discardTopTwo: s.discard.slice(-2),
    discardCount: s.discard.length,
    canTakeDiscard: myTurnToDraw && s.discard.length > 0,
    melds: structuredClone(s.melds),
    bookLaid: [...s.bookLaid],
    drawnIds: s.turn === you ? [...s.drawnIds] : [],
    nextMeldId: s.nextMeldId,
    scores: [...s.scores],
    history: structuredClone(s.history),
    lastRound: structuredClone(s.lastRound),
    log: structuredClone(s.log),
  };
}

/** PlanContext for client-side previews, built from the redacted view. */
export function viewPlanContext(v: PlayerView): PlanContext {
  return {
    player: v.you,
    round: v.round,
    hand: v.hand,
    melds: v.melds,
    bookLaid: v.bookLaid[v.you],
    nextMeldId: v.nextMeldId,
  };
}
