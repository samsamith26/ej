// Helpers for building precise game states in unit tests.
import { cardFromId } from './cards';
import { runPositions } from './melds';
import type { Card, GameState, Meld, Phase, PlayerId, Rank } from './types';

export const C = (...ids: string[]): Card[] => ids.map(cardFromId);

export function setMeld(id: string, owner: PlayerId, rank: Rank, ids: string[], minSize = 3): Meld {
  return { id, owner, kind: rank === 1 && minSize === 2 ? 'aces' : 'set', rank, minSize, cards: C(...ids).map((card) => ({ card, rep: rank })) };
}

/** Run whose cards occupy consecutive positions starting at `start`. */
export function runMeld(id: string, owner: PlayerId, ids: string[], start: number, minSize = 4): Meld {
  const cards = C(...ids);
  const suit = cards.find((c) => c.rank !== 2)!.suit;
  cards.forEach((c, i) => {
    if (c.rank !== 2 && !runPositions(c).includes(start + i)) throw new Error(`bad fixture ${c.id}`);
  });
  return { id, owner, kind: 'run', suit, minSize, cards: cards.map((card, i) => ({ card, rep: start + i })) };
}

export interface Fixture {
  round?: number;
  turn?: PlayerId;
  dealer?: PlayerId;
  phase?: Phase;
  firstTurn?: boolean;
  hands: [string[], string[]];
  stock?: string[];
  discard?: string[];
  melds?: Meld[];
  bookLaid?: [boolean, boolean];
  drawnIds?: string[];
  scores?: [number, number];
}

export function makeState(f: Fixture): GameState {
  const melds = f.melds ?? [];
  return {
    version: 2,
    rng: 12345,
    round: f.round ?? 1,
    dealer: f.dealer ?? 1,
    turn: f.turn ?? 0,
    phase: f.phase ?? 'play',
    firstTurn: f.firstTurn ?? false,
    stock: C(...(f.stock ?? ['9C', '8C', '7C', '6C'])),
    discard: C(...(f.discard ?? ['3S'])),
    hands: [C(...f.hands[0]), C(...f.hands[1])],
    melds,
    bookLaid: f.bookLaid ?? [false, false],
    drawnIds: f.drawnIds ?? [],
    nextMeldId: melds.length + 1,
    scores: f.scores ?? [0, 0],
    history: [],
    lastRound: null,
    log: [],
  };
}
