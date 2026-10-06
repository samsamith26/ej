import { isWild, SUITS } from './cards';
import type { Card, Meld, MeldCard, Suit } from './types';

/** Longest possible run: A-low..K or 2..A-high (no wrap, so Ace can't be both). */
export const MAX_RUN = 13;

/** Positions a natural card can occupy in a run. Ace is low (1) or high (14). */
export function runPositions(card: Card): number[] {
  return card.rank === 1 ? [1, 14] : [card.rank];
}

/** Returns an error message, or null if the meld is valid. */
export function validateMeld(m: Meld): string | null {
  if (m.cards.length < m.minSize) {
    return `A ${meldLabel(m.kind).toLowerCase()} needs at least ${m.minSize} cards.`;
  }
  if (m.kind === 'set' || m.kind === 'aces') {
    const rank = m.rank;
    if (rank === undefined) return 'A set needs a rank.';
    if (rank === 2) return "2s are wild — a set can't be made of 2s.";
    if (m.kind === 'aces' && rank !== 1) return 'The aces pair must be Aces.';
    for (const { card, rep } of m.cards) {
      if (rep !== rank) return 'Every card in a set must represent its rank.';
      if (!isWild(card) && card.rank !== rank) return 'A set must be all the same rank.';
    }
    return null;
  }
  // Run
  if (!m.suit) return 'A run needs a suit.';
  if (m.cards.length > MAX_RUN) return "A run can't wrap around (K-A-2).";
  for (let i = 0; i < m.cards.length; i++) {
    const { card, rep } = m.cards[i];
    if (rep < 1 || rep > 14) return 'Bad run position.';
    if (i > 0 && rep !== m.cards[i - 1].rep + 1) return 'A run must be consecutive.';
    if (!isWild(card)) {
      if (card.suit !== m.suit) return 'A run must be all one suit.';
      if (!runPositions(card).includes(rep)) return 'A run must be consecutive.';
    }
  }
  return null;
}

export function meldLabel(kind: Meld['kind']): string {
  return kind === 'set' ? 'Set' : kind === 'aces' ? 'Aces' : 'Run';
}

export interface RunPlacement {
  suit: Suit;
  /** card id → run position */
  reps: Record<string, number>;
}

/**
 * Every way the given cards can form one run (each wild gets a position).
 * Wilds are interchangeable, so they're assigned to the free slots in id
 * order — one placement per distinct (suit, span).
 */
export function runPlacements(cards: Card[], suitHint?: Suit): RunPlacement[] {
  const n = cards.length;
  if (n === 0 || n > MAX_RUN) return [];
  const naturals = cards.filter((c) => !isWild(c));
  const wilds = cards.filter(isWild).sort((a, b) => a.id.localeCompare(b.id));
  const naturalSuits = [...new Set(naturals.map((c) => c.suit))];
  if (naturalSuits.length > 1) return [];
  let suits = naturalSuits.length ? naturalSuits : SUITS;
  if (suitHint) suits = suits.filter((s) => s === suitHint);

  const out: RunPlacement[] = [];
  for (const suit of suits) {
    for (let start = 1; start + n - 1 <= 14; start++) {
      const end = start + n - 1;
      const reps: Record<string, number> = {};
      const used = new Set<number>();
      let ok = true;
      for (const c of naturals) {
        // At most one position fits, since n <= 13 means a span can't hold both 1 and 14.
        const p = runPositions(c).find((x) => x >= start && x <= end);
        if (p === undefined || used.has(p)) {
          ok = false;
          break;
        }
        reps[c.id] = p;
        used.add(p);
      }
      if (!ok) continue;
      let w = 0;
      for (let p = start; p <= end; p++) if (!used.has(p)) reps[wilds[w++].id] = p;
      out.push({ suit, reps });
    }
  }
  return out;
}

/** Valid `rep` values for laying `card` off on `meld` (empty if it can't go there). */
export function layOffOptions(meld: Meld, card: Card): number[] {
  if (meld.kind !== 'run') {
    return isWild(card) || card.rank === meld.rank ? [meld.rank!] : [];
  }
  if (meld.cards.length + 1 > MAX_RUN) return [];
  const lo = meld.cards[0].rep - 1;
  const hi = meld.cards[meld.cards.length - 1].rep + 1;
  const ends = [lo, hi].filter((p) => p >= 1 && p <= 14);
  if (isWild(card)) return ends;
  if (card.suit !== meld.suit) return [];
  return ends.filter((p) => runPositions(card).includes(p));
}

export function insertIntoMeld(meld: Meld, mc: MeldCard): Meld {
  const cards = [...meld.cards, mc];
  if (meld.kind === 'run') cards.sort((a, b) => a.rep - b.rep);
  return { ...meld, cards };
}

/**
 * Can this wild be removed with no replacement? Sets/aces must stay at or
 * above their minimum size; runs may only lose an END wild (removing an
 * interior one would break the sequence) and must stay at minimum length.
 */
export function canTakeWildWithoutReplacement(meld: Meld, cardId: string): boolean {
  const idx = meld.cards.findIndex((mc) => mc.card.id === cardId);
  if (idx < 0 || !isWild(meld.cards[idx].card)) return false;
  if (meld.cards.length - 1 < meld.minSize) return false;
  if (meld.kind === 'run') return idx === 0 || idx === meld.cards.length - 1;
  return true;
}

/** Can `natural` replace the wild `cardId` in this meld (i.e. it's the card the wild represents)? */
export function canReplaceWild(meld: Meld, cardId: string, natural: Card): boolean {
  const mc = meld.cards.find((x) => x.card.id === cardId);
  if (!mc || !isWild(mc.card) || isWild(natural)) return false;
  if (meld.kind === 'run') return natural.suit === meld.suit && runPositions(natural).includes(mc.rep);
  return natural.rank === meld.rank;
}
