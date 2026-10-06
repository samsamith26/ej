import { describe, expect, it } from 'vitest';
import { buildMeld, suggestBookGroupings } from './books';
import { layOffOptions, runPlacements, validateMeld } from './melds';
import { C, runMeld, setMeld } from './testUtils';
import type { BookMeldSpec, Meld } from './types';

function build(spec: Omit<BookMeldSpec, 'cards'> & { cards: (string | [string, number])[] }, minSize = 3) {
  const cardSpecs = spec.cards.map((c) => (typeof c === 'string' ? { cardId: c } : { cardId: c[0], rep: c[1] }));
  return buildMeld({ ...spec, cards: cardSpecs }, C(...cardSpecs.map((c) => c.cardId)), 0, 'm1', minSize);
}
const meldOf = (r: ReturnType<typeof build>): Meld => {
  if ('error' in r) throw new Error(r.error);
  return r.meld;
};

describe('sets', () => {
  it('accepts a natural set', () => {
    expect(meldOf(build({ kind: 'set', cards: ['7H', '7S', '7D'] })).rank).toBe(7);
  });
  it('accepts a set with wilds; wilds represent the set rank', () => {
    const m = meldOf(build({ kind: 'set', cards: ['7H', '2S', '2D'] }));
    expect(m.cards.map((c) => c.rep)).toEqual([7, 7, 7]);
  });
  it('rejects mixed ranks', () => {
    expect(build({ kind: 'set', cards: ['7H', '8S', '7D'] })).toHaveProperty('error');
  });
  it('all-wild set needs a chosen rank', () => {
    expect(build({ kind: 'set', cards: ['2H', '2S', '2D'] })).toEqual({ error: 'Choose which rank the wild 2s represent.' });
    expect(meldOf(build({ kind: 'set', rank: 9, cards: ['2H', '2S', '2D'] })).rank).toBe(9);
  });
  it('a set cannot represent 2s', () => {
    expect(build({ kind: 'set', rank: 2, cards: ['2H', '2S', '2D'] })).toHaveProperty('error');
  });
  it('rejects a set that is too short', () => {
    expect(build({ kind: 'set', cards: ['7H', '7S'] })).toHaveProperty('error');
  });
});

describe('aces pair', () => {
  it('accepts A-A, A-2 and 2-2', () => {
    for (const cards of [['AH', 'AS'], ['AH', '2S'], ['2H', '2S']]) {
      expect(meldOf(build({ kind: 'aces', cards }, 2)).rank).toBe(1);
    }
  });
  it('rejects non-aces', () => {
    expect(build({ kind: 'aces', cards: ['AH', 'KS'] }, 2)).toHaveProperty('error');
  });
});

describe('runs', () => {
  it('ace low: A-2-3-4 (the 2 is a wild representing 2)', () => {
    const m = meldOf(build({ kind: 'run', cards: ['AH', '2H', '3H', '4H'] }, 4));
    expect(m.cards.map((c) => [c.card.id, c.rep])).toEqual([['AH', 1], ['2H', 2], ['3H', 3], ['4H', 4]]);
  });
  it('ace low with an off-suit 2 as the wild', () => {
    expect(meldOf(build({ kind: 'run', cards: ['AH', '2C', '3H', '4H'] }, 4)).suit).toBe('H');
  });
  it('ace high: J-Q-K-A', () => {
    const m = meldOf(build({ kind: 'run', cards: ['JS', 'QS', 'KS', 'AS'] }, 4));
    expect(m.cards.at(-1)).toMatchObject({ rep: 14 });
  });
  it('rejects wrap-around K-A-2-3', () => {
    expect(build({ kind: 'run', cards: ['KH', 'AH', '2H', '3H'] }, 4)).toHaveProperty('error');
    expect(build({ kind: 'run', cards: ['QH', 'KH', 'AH', '3H'] }, 4)).toHaveProperty('error');
  });
  it('rejects mixed suits', () => {
    expect(build({ kind: 'run', cards: ['4H', '5H', '6S', '7H'] }, 4)).toEqual({ error: 'A run must be all one suit.' });
  });
  it('rejects gaps', () => {
    expect(build({ kind: 'run', cards: ['4H', '5H', '7H', '8H'] }, 4)).toHaveProperty('error');
  });
  it('fills an interior gap with a wild automatically', () => {
    const m = meldOf(build({ kind: 'run', cards: ['4H', '5H', '2C', '7H'] }, 4));
    expect(m.cards.find((c) => c.card.id === '2C')!.rep).toBe(6);
  });
  it('asks when an end wild is ambiguous, accepts an explicit choice', () => {
    expect(build({ kind: 'run', cards: ['5H', '6H', '7H', '2C'] }, 4)).toEqual({ error: 'Choose where the wild 2s go in the run.' });
    const m = meldOf(build({ kind: 'run', cards: ['5H', '6H', '7H', ['2C', 8]] }, 4));
    expect(m.cards.map((c) => c.rep)).toEqual([5, 6, 7, 8]);
  });
  it('all-wild run needs suit and positions', () => {
    expect(build({ kind: 'run', cards: ['2C', '2D', '2H', '2S'] }, 4)).toHaveProperty('error');
    const m = meldOf(build({ kind: 'run', suit: 'D', cards: [['2C', 9], ['2D', 10], ['2H', 11], ['2S', 12]] }, 4));
    expect(m.suit).toBe('D');
  });
  it('runPlacements enumerates the two ends for a trailing wild', () => {
    expect(runPlacements(C('5H', '6H', '7H', '2C')).map((p) => p.reps['2C'])).toEqual([4, 8]);
  });
  it('validateMeld rejects a run longer than 13 (would wrap)', () => {
    const ids = ['AH', '2C', '3H', '4H', '5H', '6H', '7H', '8H', '9H', '10H', 'JH', 'QH', 'KH'];
    const m = runMeld('m1', 0, ids, 1);
    expect(validateMeld(m)).toBeNull();
    expect(layOffOptions(m, C('2D')[0])).toEqual([]);
  });
});

describe('lay-off options', () => {
  it('sets accept same rank or wilds', () => {
    const m = setMeld('m1', 0, 10, ['10H', '10S', '10D']);
    expect(layOffOptions(m, C('10C')[0])).toEqual([10]);
    expect(layOffOptions(m, C('2C')[0])).toEqual([10]);
    expect(layOffOptions(m, C('9C')[0])).toEqual([]);
  });
  it('runs extend at either end; ace respects high/low with no wrap', () => {
    const low = runMeld('m1', 0, ['2H', '3H', '4H', '5H'], 2);
    expect(layOffOptions(low, C('AH')[0])).toEqual([1]);
    expect(layOffOptions(low, C('6H')[0])).toEqual([6]);
    expect(layOffOptions(low, C('6S')[0])).toEqual([]);
    expect(layOffOptions(low, C('2C')[0])).toEqual([1, 6]);
    const high = runMeld('m2', 0, ['JH', 'QH', 'KH', 'AH'], 11);
    expect(layOffOptions(high, C('2C')[0])).toEqual([10]); // nothing above a high ace
  });
});

describe('book grouping suggestions', () => {
  it('splits a round-3 book into a set and a run', () => {
    const g = suggestBookGroupings(C('7H', '7S', '7D', '4C', '5C', '6C', '2H'), 3);
    expect(g).toContainEqual([['7D', '7H', '7S'], ['2H', '4C', '5C', '6C']]);
  });
});
