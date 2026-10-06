import type { Card, Rank, Suit } from './types';

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

const RANK_LABELS: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAMES: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

/** Label for a rank or run position (14 = high Ace). */
export function rankLabel(r: number): string {
  return RANK_LABELS[r] ?? String(r);
}

export function isWild(card: Card): boolean {
  return card.rank === 2;
}

export function makeCard(rank: Rank, suit: Suit): Card {
  return { id: `${rankLabel(rank)}${suit}`, rank, suit };
}

/** Parse an id such as "10H", "AS", "2C". */
export function cardFromId(id: string): Card {
  const suit = id.slice(-1) as Suit;
  const label = id.slice(0, -1);
  const rank = ({ A: 1, J: 11, Q: 12, K: 13 } as Record<string, number>)[label] ?? Number(label);
  if (!SUITS.includes(suit) || !(rank >= 1 && rank <= 13)) throw new Error(`Bad card id ${id}`);
  return makeCard(rank as Rank, suit);
}

export function fullDeck(): Card[] {
  return SUITS.flatMap((s) => RANKS.map((r) => makeCard(r, s)));
}

/** 3–9 = 5, 10/J/Q/K = 10, Ace = 15, 2 = 20. */
export function cardPoints(card: Card): number {
  if (card.rank === 2) return 20;
  if (card.rank === 1) return 15;
  if (card.rank >= 10) return 10;
  return 5;
}

export function handPoints(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + cardPoints(c), 0);
}

export function cardName(card: Card): string {
  return `${rankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}
