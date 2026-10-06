import { isWild } from './cards';
import { runPlacements, validateMeld } from './melds';
import type { BookMeldSpec, Card, Meld, MeldKind, PlayerId, Rank } from './types';

export interface MeldReq {
  kind: MeldKind;
  size: number;
}

export interface RoundDef {
  round: number;
  description: string;
  melds: MeldReq[];
  bookSize: number;
  bonus: number;
}

export const ROUNDS: RoundDef[] = [
  { round: 1, description: '3-of-a-kind + 2 aces', melds: [{ kind: 'set', size: 3 }, { kind: 'aces', size: 2 }], bookSize: 5, bonus: 10 },
  { round: 2, description: 'Two 3-of-a-kinds', melds: [{ kind: 'set', size: 3 }, { kind: 'set', size: 3 }], bookSize: 6, bonus: 20 },
  { round: 3, description: '3-of-a-kind + run of 4', melds: [{ kind: 'set', size: 3 }, { kind: 'run', size: 4 }], bookSize: 7, bonus: 30 },
  { round: 4, description: 'Two runs of 4', melds: [{ kind: 'run', size: 4 }, { kind: 'run', size: 4 }], bookSize: 8, bonus: 40 },
  { round: 5, description: 'One run of 7', melds: [{ kind: 'run', size: 7 }], bookSize: 7, bonus: 50 },
];

export const TOTAL_ROUNDS = ROUNDS.length;

export function roundDef(round: number): RoundDef {
  return ROUNDS[round - 1];
}

/** The run length required this round (4, or 7 in round 5). */
export function runSize(round: number): number {
  return roundDef(round).melds.find((m) => m.kind === 'run')?.size ?? 4;
}

/**
 * Turn one meld spec from the client into a concrete Meld. The spec may
 * omit reps for unambiguous cards; ambiguous wilds must be specified.
 */
export function buildMeld(
  spec: BookMeldSpec,
  cards: Card[],
  owner: PlayerId,
  id: string,
  minSize: number,
): { meld: Meld } | { error: string } {
  const repOf = new Map(spec.cards.filter((c) => c.rep !== undefined).map((c) => [c.cardId, c.rep!]));
  const naturals = cards.filter((c) => !isWild(c));

  if (spec.kind === 'set' || spec.kind === 'aces') {
    // An all-wild set takes its rank from the spec (or from an explicit rep).
    const rank: Rank | undefined =
      spec.kind === 'aces' ? 1 : (naturals[0]?.rank ?? spec.rank ?? ([...repOf.values()][0] as Rank | undefined));
    if (rank === undefined) return { error: 'Choose which rank the wild 2s represent.' };
    if (spec.kind === 'aces' && naturals.some((c) => c.rank !== 1)) return { error: 'The aces pair must be Aces (or wild 2s).' };
    if (naturals.some((c) => c.rank !== rank)) return { error: 'A set must be all the same rank.' };
    if (spec.rank !== undefined && spec.rank !== rank) return { error: 'A set must be all the same rank.' };
    for (const r of repOf.values()) if (r !== rank) return { error: 'A wild in a set must represent the set’s rank.' };
    const meld: Meld = { id, owner, kind: spec.kind, rank, minSize, cards: cards.map((card) => ({ card, rep: rank! })) };
    const err = validateMeld(meld);
    return err ? { error: err } : { meld };
  }

  // Run: find the placements consistent with whatever reps the client gave.
  if (new Set(naturals.map((c) => c.suit)).size > 1) return { error: 'A run must be all one suit.' };
  const wildIds = cards.filter(isWild).map((c) => c.id);
  const matches = runPlacements(cards, spec.suit).flatMap((p) => {
    for (const c of naturals) if (repOf.has(c.id) && repOf.get(c.id) !== p.reps[c.id]) return [];
    // Wilds are interchangeable: the given wild reps must be a subset of the
    // placement's wild slots; unspecified wilds fill the rest in order.
    const slots = wildIds.map((w) => p.reps[w]).sort((a, b) => a - b);
    const reps = { ...p.reps };
    const free = new Set(slots);
    for (const w of wildIds) {
      const r = repOf.get(w);
      if (r === undefined) continue;
      if (!free.has(r)) return [];
      free.delete(r);
      reps[w] = r;
    }
    const rest = [...free].sort((a, b) => a - b);
    for (const w of wildIds) if (!repOf.has(w)) reps[w] = rest.shift()!;
    return [{ suit: p.suit, reps }];
  });
  if (matches.length === 0) return { error: 'Those cards don’t form a run (consecutive, same suit, no wrap-around).' };
  if (matches.length > 1) return { error: 'Choose where the wild 2s go in the run.' };
  const { suit, reps } = matches[0];
  const meld: Meld = {
    id,
    owner,
    kind: 'run',
    suit,
    minSize,
    cards: cards.map((card) => ({ card, rep: reps[card.id] })).sort((a, b) => a.rep - b.rep),
  };
  const err = validateMeld(meld);
  return err ? { error: err } : { meld };
}

/**
 * Check that the built melds are EXACTLY this round's book: the right meld
 * kinds at exactly their minimum sizes, plus the per-round extras
 * (round 1's set can't be Aces; round 2's two sets must differ in rank).
 */
export function validateBookShape(melds: Meld[], round: number): string | null {
  const def = roundDef(round);
  const want = [...def.melds].map((m) => `${m.kind}:${m.size}`).sort();
  const got = melds.map((m) => `${m.kind}:${m.cards.length}`).sort();
  if (want.join() !== got.join()) {
    return `This round's book is exactly: ${def.description} (${def.bookSize} cards, no extras).`;
  }
  if (round === 1 && melds.some((m) => m.kind === 'set' && m.rank === 1)) {
    return 'In round 1 the 3-of-a-kind can’t be Aces.';
  }
  if (round === 2 && melds[0].rank === melds[1].rank) {
    return 'The two 3-of-a-kinds must be different ranks.';
  }
  return null;
}

/**
 * UI helper: all ways to split `cards` into this round's required melds.
 * Returns groupings of card ids, one array per required meld (in ROUNDS order).
 * Cheap: books have at most 8 cards.
 */
export function suggestBookGroupings(cards: Card[], round: number): string[][][] {
  const def = roundDef(round);
  if (cards.length !== def.bookSize) return [];
  const results: string[][][] = [];
  const seen = new Set<string>();
  const recurse = (remaining: Card[], reqIdx: number, acc: Card[][]) => {
    if (reqIdx === def.melds.length) {
      if (remaining.length === 0 && groupingCouldWork(acc, def, round)) {
        const ids = acc.map((g) => g.map((c) => c.id).sort());
        const key = JSON.stringify(ids);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(ids);
        }
      }
      return;
    }
    const size = def.melds[reqIdx].size;
    for (const combo of combinations(remaining, size)) {
      const ids = new Set(combo.map((c) => c.id));
      recurse(remaining.filter((c) => !ids.has(c.id)), reqIdx + 1, [...acc, combo]);
    }
  };
  recurse(cards, 0, []);
  return results;
}

function groupingCouldWork(groups: Card[][], def: RoundDef, round: number): boolean {
  const melds: Meld[] = [];
  for (let i = 0; i < groups.length; i++) {
    const req = def.melds[i];
    const g = groups[i];
    if (req.kind === 'run') {
      const p = runPlacements(g)[0];
      if (!p) return false;
      melds.push({ id: '', owner: 0, kind: 'run', suit: p.suit, minSize: req.size, cards: g.map((card) => ({ card, rep: p.reps[card.id] })) });
    } else {
      const nat = g.filter((c) => !isWild(c));
      const ranks = new Set(nat.map((c) => c.rank));
      if (ranks.size > 1) return false;
      if (req.kind === 'aces' && nat.some((c) => c.rank !== 1)) return false;
      // All-wild set: rank is chosen later; use a placeholder that never clashes.
      const rank = (nat[0]?.rank ?? (100 + i)) as Rank;
      melds.push({ id: '', owner: 0, kind: req.kind, rank, minSize: req.size, cards: g.map((card) => ({ card, rep: rank })) });
    }
  }
  return validateBookShape(melds, round) === null;
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < items.length; i++) yield* combinations(items, k, i + 1, [...acc, items[i]]);
}
