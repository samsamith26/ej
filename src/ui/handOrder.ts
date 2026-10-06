import { isWild, SUITS, type Card } from '../engine';

// Hand order is purely client-side display state: never sent to the host.

export type SortMode = 'rank' | 'suit';

// Ace sorts high in hands; 2s (wild) go at the end.
const rankOrder = (c: Card) => (c.rank === 2 ? 20 : c.rank === 1 ? 14 : c.rank);
const suitIdx = (c: Card) => SUITS.indexOf(c.suit);

export function sortHand(hand: Card[], mode: SortMode): Card[] {
  return [...hand].sort((a, b) =>
    mode === 'rank'
      ? rankOrder(a) - rankOrder(b) || suitIdx(a) - suitIdx(b)
      : (isWild(a) ? 1 : 0) - (isWild(b) ? 1 : 0) || suitIdx(a) - suitIdx(b) || rankOrder(a) - rankOrder(b),
  );
}

/**
 * Bring a saved order up to date with the cards actually in hand:
 * - ids in `keep` stay in the order (even if not shown right now — e.g. a card
 *   staged onto a meld comes back to its old spot on "Undo step");
 * - other ids are dropped, so the remaining cards keep their relative order;
 * - cards in hand but not in the order are appended at the right end;
 * - if none of the hand is in the order (first load, new round), sort by rank.
 */
export function reconcileOrder(order: string[], hand: Card[], keep: Set<string>): string[] {
  const inHand = new Set(hand.map((c) => c.id));
  if (hand.length > 0 && !order.some((id) => inHand.has(id))) {
    return sortHand(hand, 'rank').map((c) => c.id);
  }
  const kept = order.filter((id) => keep.has(id) || inHand.has(id));
  const known = new Set(kept);
  return [...kept, ...hand.filter((c) => !known.has(c.id)).map((c) => c.id)];
}

/** The hand's cards in display order. */
export function orderHand(hand: Card[], order: string[]): Card[] {
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...hand].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity));
}

/**
 * Saved with the round it belongs to: every round deals from the same deck,
 * so card ids repeat, and an old round's order must not leak into a new deal.
 */
export interface SavedOrder {
  round: number;
  ids: string[];
}

export function loadOrder(key: string): SavedOrder {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as Partial<SavedOrder>) : null;
    if (parsed && typeof parsed.round === 'number' && Array.isArray(parsed.ids)) {
      return { round: parsed.round, ids: parsed.ids.filter((x): x is string => typeof x === 'string') };
    }
  } catch {
    // Fall through to an empty order.
  }
  return { round: 0, ids: [] };
}

export function saveOrder(key: string, order: SavedOrder): void {
  try {
    localStorage.setItem(key, JSON.stringify(order));
  } catch {
    // Not critical: the order just won't survive a refresh.
  }
}
