import { describe, expect, it } from 'vitest';
import { applyAction, getPlayerView } from './game';
import { ERR } from './plan';
import { makeState, runMeld, setMeld } from './testUtils';
import type { Action, GameState, PlanOp } from './types';

const ok = (r: ReturnType<typeof applyAction>): GameState => {
  if ('error' in r) throw new Error(r.error);
  return r.state;
};
const commit = (plan: PlanOp[], discardId: string): Action => ({ type: 'commitTurn', plan, discardId });
const ids = (s: GameState, p: 0 | 1) => s.hands[p].map((c) => c.id).sort();

const r1Book: PlanOp = {
  op: 'layBook',
  melds: [
    { kind: 'set', cards: [{ cardId: '7H' }, { cardId: '7S' }, { cardId: '7D' }] },
    { kind: 'aces', cards: [{ cardId: 'AH' }, { cardId: 'AS' }] },
  ],
};

describe('laying the book', () => {
  it('accepts an exact book and leaves the turn otherwise unchanged', () => {
    const s = makeState({ hands: [['7H', '7S', '7D', 'AH', 'AS', '9D', 'KC'], ['5C']] });
    const after = ok(applyAction(s, 0, commit([r1Book], '9D')));
    expect(after.melds.map((m) => m.kind)).toEqual(['set', 'aces']);
    expect(after.bookLaid).toEqual([true, false]);
    expect(ids(after, 0)).toEqual(['KC']);
    expect(after.turn).toBe(1);
  });

  it('rejects an initial book with extra cards', () => {
    const s = makeState({ hands: [['7H', '7S', '7D', '7C', 'AH', 'AS', '9D'], ['5C']] });
    const bigSet: PlanOp = {
      op: 'layBook',
      melds: [
        { kind: 'set', cards: ['7H', '7S', '7D', '7C'].map((cardId) => ({ cardId })) },
        { kind: 'aces', cards: [{ cardId: 'AH' }, { cardId: 'AS' }] },
      ],
    };
    const r = applyAction(s, 0, commit([bigSet], '9D'));
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(/exactly/);
  });

  it('rejects a book missing a required meld', () => {
    const s = makeState({ hands: [['7H', '7S', '7D', 'AH', 'AS', '9D'], ['5C']] });
    const onlySet: PlanOp = { op: 'layBook', melds: [r1Book.op === 'layBook' ? r1Book.melds[0] : (null as never)] };
    expect(applyAction(s, 0, commit([onlySet], '9D'))).toHaveProperty('error');
  });

  it("round 1: the 3-of-a-kind can't be Aces", () => {
    const s = makeState({ hands: [['AH', 'AS', 'AD', '2C', '2S', '9D'], ['5C']] });
    const plan: PlanOp = {
      op: 'layBook',
      melds: [
        { kind: 'set', cards: [{ cardId: 'AH' }, { cardId: 'AS' }, { cardId: 'AD' }] },
        { kind: 'aces', cards: [{ cardId: '2C' }, { cardId: '2S' }] },
      ],
    };
    expect(applyAction(s, 0, commit([plan], '9D'))).toEqual({ error: 'In round 1 the 3-of-a-kind can’t be Aces.' });
  });

  it('round 2: the two sets must be different ranks', () => {
    const s = makeState({ round: 2, hands: [['7H', '7S', '7D', '7C', '2S', '2D', '9D'], ['5C']] });
    const plan: PlanOp = {
      op: 'layBook',
      melds: [
        { kind: 'set', cards: [{ cardId: '7H' }, { cardId: '7S' }, { cardId: '7D' }] },
        { kind: 'set', cards: [{ cardId: '7C' }, { cardId: '2S' }, { cardId: '2D' }] },
      ],
    };
    expect(applyAction(s, 0, commit([plan], '9D'))).toEqual({ error: 'The two 3-of-a-kinds must be different ranks.' });
  });

  it('round 4: two runs may share a suit', () => {
    const s = makeState({ round: 4, hands: [['3H', '4H', '5H', '6H', '9H', '10H', 'JH', 'QH', '8C', 'KD'], ['5C']] });
    const plan: PlanOp = {
      op: 'layBook',
      melds: [
        { kind: 'run', cards: ['3H', '4H', '5H', '6H'].map((cardId) => ({ cardId })) },
        { kind: 'run', cards: ['9H', '10H', 'JH', 'QH'].map((cardId) => ({ cardId })) },
      ],
    };
    expect(ok(applyAction(s, 0, commit([plan], '8C'))).melds).toHaveLength(2);
  });

  it('rejects laying the book twice in a round', () => {
    const s = makeState({ hands: [['7H', '7S', '7D', 'AH', 'AS', '9D'], ['5C']], bookLaid: [true, false] });
    expect(applyAction(s, 0, commit([r1Book], '9D'))).toEqual({ error: ERR.bookAlreadyLaid });
  });
});

describe('book turn restrictions', () => {
  it('rejects a lay-off onto own meld on the book turn when not going out', () => {
    const s = makeState({ hands: [['7H', '7S', '7D', 'AH', 'AS', '7C', '9D', 'KC'], ['5C']] });
    const plan: PlanOp[] = [r1Book, { op: 'layOff', meldId: 'm1', cardId: '7C' }];
    expect(applyAction(s, 0, commit(plan, '9D'))).toEqual({ error: ERR.layOffBookTurn });
  });

  it("rejects a lay-off onto the opponent's meld on the book turn when not going out", () => {
    const s = makeState({
      hands: [['7H', '7S', '7D', 'AH', 'AS', '10C', '9D', 'KC'], ['5C']],
      melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D'])],
    });
    const plan: PlanOp[] = [r1Book, { op: 'layOff', meldId: 'm1', cardId: '10C' }];
    expect(applyAction(s, 0, commit(plan, '9D'))).toEqual({ error: ERR.layOffOpponentBookTurn });
  });

  it("rejects a lay-off onto the opponent's meld on the book turn, even when going out", () => {
    const s = makeState({
      hands: [['7H', '7S', '7D', 'AH', 'AS', '10C', '9D'], ['5C']],
      melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D'])],
    });
    // Book → 10C onto the opponent's 10s → discard 9D would empty the hand.
    const plan: PlanOp[] = [r1Book, { op: 'layOff', meldId: 'm1', cardId: '10C' }];
    expect(applyAction(s, 0, commit(plan, '9D'))).toEqual({ error: ERR.layOffOpponentBookTurn });
  });

  it('accepts lay-offs onto own melds on the book turn that end in going out', () => {
    const s = makeState({
      hands: [['7H', '7S', '7D', 'AH', 'AS', '7C', '2D', 'AD', '9D'], ['5C', 'KD']],
      melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D'])],
    });
    // Book is m2 (7s) and m3 (aces); lay off onto both, then go out.
    const plan: PlanOp[] = [
      r1Book,
      { op: 'layOff', meldId: 'm2', cardId: '7C' },
      { op: 'layOff', meldId: 'm2', cardId: '2D' },
      { op: 'layOff', meldId: 'm3', cardId: 'AD' },
    ];
    const after = ok(applyAction(s, 0, commit(plan, '9D')));
    expect(after.phase).toBe('roundOver');
    expect(after.lastRound).toMatchObject({ winner: 0 });
    expect(after.melds.find((m) => m.id === 'm2')!.cards).toHaveLength(5);
  });

  it('accepts the same plan when it ends in going out using only cards from hand', () => {
    const s = makeState({ hands: [['7H', '7S', '7D', 'AH', 'AS', '7C', '9D'], ['5C', 'KD']] });
    const plan: PlanOp[] = [r1Book, { op: 'layOff', meldId: 'm1', cardId: '7C' }];
    const after = ok(applyAction(s, 0, commit(plan, '9D')));
    expect(after.hands[0]).toHaveLength(0);
    expect(after.phase).toBe('roundOver');
    expect(after.lastRound).toMatchObject({ winner: 0, cardPoints: 15, bonus: 10, points: [25, 0] });
  });

  it('rejects taking a 2 on the book turn, even if it would go out', () => {
    const s = makeState({
      hands: [['7H', '7S', '7D', 'AH', 'AS', '9D'], ['5C']],
      melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D', '2C'])],
    });
    // take 2 → lay book → lay the 2 off on the new set → discard 9D = would go out.
    const plan: PlanOp[] = [{ op: 'take2', meldId: 'm1', cardId: '2C' }, r1Book, { op: 'layOff', meldId: 'm2', cardId: '2C' }];
    expect(applyAction(s, 0, commit(plan, '9D'))).toEqual({ error: ERR.take2BookTurn });
    const after: PlanOp[] = [r1Book, { op: 'take2', meldId: 'm1', cardId: '2C' }, { op: 'layOff', meldId: 'm2', cardId: '2C' }];
    expect(applyAction(s, 0, commit(after, '9D'))).toEqual({ error: ERR.take2BookTurn });
  });

  it('rejects replacing a 2 on the book turn', () => {
    const s = makeState({
      round: 3,
      hands: [['7H', '7S', '7D', '4C', '5C', '6C', '8C', '5H', '9D'], ['5C']],
      melds: [runMeld('m1', 1, ['4H', '2C', '6H', '7H'], 4)],
    });
    const plan: PlanOp[] = [
      {
        op: 'layBook',
        melds: [
          { kind: 'set', cards: ['7H', '7S', '7D'].map((cardId) => ({ cardId })) },
          { kind: 'run', cards: ['4C', '5C', '6C', '8C'].map((cardId) => ({ cardId })) },
        ],
      },
      { op: 'replace2', meldId: 'm1', cardId: '2C', naturalId: '5H' },
    ];
    expect(applyAction(s, 0, commit(plan, '9D'))).toEqual({ error: ERR.take2BookTurn });
  });
});

describe('lay-offs', () => {
  it('rejects a lay-off before the book is laid', () => {
    const s = makeState({ hands: [['10C', '5D', '6D'], ['5C']], melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D'])] });
    expect(applyAction(s, 0, commit([{ op: 'layOff', meldId: 'm1', cardId: '10C' }], '5D'))).toEqual({
      error: ERR.layOffBeforeBook,
    });
  });

  it("on the turn after the book, lay-offs onto either player's melds are accepted", () => {
    const s = makeState({
      hands: [['10C', '7C', '5D', '6D'], ['5C']],
      melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D']), setMeld('m2', 0, 7, ['7H', '7S', '7D'])],
      bookLaid: [true, false],
    });
    const plan: PlanOp[] = [
      { op: 'layOff', meldId: 'm1', cardId: '10C' },
      { op: 'layOff', meldId: 'm2', cardId: '7C' },
    ];
    const after = ok(applyAction(s, 0, commit(plan, '5D')));
    expect(after.melds.map((m) => m.cards.length)).toEqual([4, 4]);
    expect(ids(after, 0)).toEqual(['6D']);
  });

  it("accepts a lay-off onto the opponent's meld", () => {
    const s = makeState({
      hands: [['10C', '5D', '6D'], ['5C']],
      melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D'])],
      bookLaid: [true, true],
    });
    const after = ok(applyAction(s, 0, commit([{ op: 'layOff', meldId: 'm1', cardId: '10C' }], '5D')));
    expect(after.melds[0].cards).toHaveLength(4);
    expect(after.melds[0].owner).toBe(1);
    expect(ids(after, 0)).toEqual(['6D']);
  });

  it('rejects a card that does not fit', () => {
    const s = makeState({ hands: [['9C', '5D', '6D'], ['5C']], melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D'])], bookLaid: [true, true] });
    expect(applyAction(s, 0, commit([{ op: 'layOff', meldId: 'm1', cardId: '9C' }], '5D'))).toEqual({ error: ERR.cantLayOff });
  });

  it('requires choosing an end for an ambiguous wild on a run', () => {
    const s = makeState({ round: 3, hands: [['2D', '5D', '6D'], ['5C']], melds: [runMeld('m1', 1, ['4H', '5H', '6H', '7H'], 4)], bookLaid: [true, true] });
    expect(applyAction(s, 0, commit([{ op: 'layOff', meldId: 'm1', cardId: '2D' }], '5D'))).toEqual({ error: ERR.chooseEnd });
    const after = ok(applyAction(s, 0, commit([{ op: 'layOff', meldId: 'm1', cardId: '2D', rep: 3 }], '5D')));
    expect(after.melds[0].cards.map((c) => c.rep)).toEqual([3, 4, 5, 6, 7]);
  });
});

describe('taking 2s', () => {
  const base = (melds: GameState['melds'], hand = ['5D', '6D']) =>
    makeState({ round: 3, hands: [hand, ['KC', 'AS']], melds, bookLaid: [true, true] });

  it('take a 2 from 10-10-10-2 with no replacement: OK', () => {
    const s = base([setMeld('m1', 1, 10, ['10S', '10H', '10D', '2C'])]);
    const after = ok(applyAction(s, 0, commit([{ op: 'take2', meldId: 'm1', cardId: '2C' }], '5D')));
    expect(ids(after, 0)).toEqual(['2C', '6D']);
    expect(after.melds[0].cards).toHaveLength(3);
  });

  it('take a 2 from 10-10-2 with no replacement: rejected', () => {
    const s = base([setMeld('m1', 1, 10, ['10S', '10H', '2C'])]);
    expect(applyAction(s, 0, commit([{ op: 'take2', meldId: 'm1', cardId: '2C' }], '5D'))).toEqual({ error: ERR.take2Breaks });
  });

  it('removing an interior run wild without replacement is rejected', () => {
    const s = base([runMeld('m1', 1, ['4H', '2C', '6H', '7H', '8H'], 4)]);
    expect(applyAction(s, 0, commit([{ op: 'take2', meldId: 'm1', cardId: '2C' }], '5D'))).toEqual({ error: ERR.take2Breaks });
  });

  it('an end wild can be taken if the run stays long enough', () => {
    const s = base([runMeld('m1', 1, ['4H', '5H', '6H', '7H', '2C'], 4)]);
    expect(ok(applyAction(s, 0, commit([{ op: 'take2', meldId: 'm1', cardId: '2C' }], '5D'))).melds[0].cards).toHaveLength(4);
  });

  it('replace an interior run wild with the correct natural card: OK', () => {
    const s = base([runMeld('m1', 1, ['4H', '2C', '6H', '7H'], 4)], ['5H', '9D']);
    const after = ok(applyAction(s, 0, commit([{ op: 'replace2', meldId: 'm1', cardId: '2C', naturalId: '5H' }], '9D')));
    expect(after.melds[0].cards.map((c) => c.card.id)).toEqual(['4H', '5H', '6H', '7H']);
    expect(ids(after, 0)).toEqual(['2C']);
  });

  it('replace with the wrong suit: rejected', () => {
    const s = base([runMeld('m1', 1, ['4H', '2C', '6H', '7H'], 4)], ['5S', '9D']);
    expect(applyAction(s, 0, commit([{ op: 'replace2', meldId: 'm1', cardId: '2C', naturalId: '5S' }], '9D'))).toEqual({
      error: ERR.wrongReplacement,
    });
  });

  it('on a later turn, take a 2 and use it to go out: OK', () => {
    const s = base([setMeld('m1', 1, 10, ['10S', '10H', '10D', '2C']), runMeld('m2', 0, ['4H', '5H', '6H', '7H'], 4)], ['9D']);
    const plan: PlanOp[] = [
      { op: 'take2', meldId: 'm1', cardId: '2C' },
      { op: 'layOff', meldId: 'm2', cardId: '2C', rep: 8 },
    ];
    const after = ok(applyAction(s, 0, commit(plan, '9D')));
    expect(after.phase).toBe('roundOver');
    expect(after.lastRound).toMatchObject({ winner: 0, points: [25 + 30, 0] });
  });

  it('a taken 2 may be the final discard', () => {
    const s = base([setMeld('m1', 1, 10, ['10S', '10H', '10D', '2C'])], ['9D', '8D']);
    const after = ok(applyAction(s, 0, commit([{ op: 'take2', meldId: 'm1', cardId: '2C' }], '2C')));
    expect(after.discard.at(-1)!.id).toBe('2C');
  });

  it('cannot take 2s before laying the book', () => {
    const s = makeState({ hands: [['5D', '6D'], ['KC']], melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D', '2C'])] });
    expect(applyAction(s, 0, commit([{ op: 'take2', meldId: 'm1', cardId: '2C' }], '5D'))).toEqual({ error: ERR.take2BeforeBook });
  });
});

describe('discard pickup', () => {
  it('with 2+ cards in the pile, takes exactly the top 2 and leaves the stock unchanged', () => {
    const s = makeState({ phase: 'draw', hands: [['5D', '6D'], ['KC']], stock: ['9C', '8C'], discard: ['3C', 'QH', 'KD'] });
    const after = ok(applyAction(s, 0, { type: 'drawDiscard' }));
    expect(ids(after, 0)).toEqual(['5D', '6D', 'KD', 'QH']);
    expect(after.discard.map((c) => c.id)).toEqual(['3C']);
    expect(after.stock.map((c) => c.id)).toEqual(['9C', '8C']);
    expect([...after.drawnIds].sort()).toEqual(['KD', 'QH']);
    // The log shows both cards to both players, top card first.
    expect(after.log.at(-1)).toMatchObject({ kind: 'drewDiscard', player: 0, cards: [{ id: 'KD' }, { id: 'QH' }] });
  });

  it('with exactly 1 card in the pile, takes just that card and leaves the stock unchanged', () => {
    const s = makeState({ phase: 'draw', hands: [['5D', '6D'], ['KC']], stock: ['9C', '8C'], discard: ['KD'] });
    const after = ok(applyAction(s, 0, { type: 'drawDiscard' }));
    expect(ids(after, 0)).toEqual(['5D', '6D', 'KD']);
    expect(after.discard).toHaveLength(0);
    expect(after.stock.map((c) => c.id)).toEqual(['9C', '8C']);
    expect(after.drawnIds).toEqual(['KD']);
  });

  it('does not depend on the stock: works with an empty stock', () => {
    const s = makeState({ phase: 'draw', hands: [['5D'], ['KC']], stock: [], discard: ['QH', 'KD'] });
    expect(getPlayerView(s, 0).canTakeDiscard).toBe(true);
    const after = ok(applyAction(s, 0, { type: 'drawDiscard' }));
    expect(ids(after, 0)).toEqual(['5D', 'KD', 'QH']);
    expect(after.log.some((e) => e.kind === 'reshuffled')).toBe(false);
  });

  it('is unavailable when the discard pile is empty', () => {
    const s = makeState({ phase: 'draw', hands: [['5D'], ['KC']], discard: [] });
    expect(applyAction(s, 0, { type: 'drawDiscard' })).toEqual({ error: ERR.discardEmpty });
    expect(getPlayerView(s, 0).canTakeDiscard).toBe(false);
  });

  it('discarding a picked-up card on the same turn is accepted', () => {
    for (const back of ['KD', 'QH']) {
      const s = makeState({ phase: 'draw', hands: [['5D', '6D'], ['KC']], discard: ['QH', 'KD'] });
      const after = ok(applyAction(s, 0, { type: 'drawDiscard' }));
      const done = ok(applyAction(after, 0, commit([], back)));
      expect(done.discard.at(-1)!.id).toBe(back);
      expect(ids(done, 0)).not.toContain(back);
      expect(done.turn).toBe(1);
      expect(done.drawnIds).toEqual([]);
    }
  });

  it("a stock draw is marked as drawn for you, but hidden from the opponent's view", () => {
    const s = makeState({ phase: 'draw', hands: [['5D'], ['KC']], stock: ['9C', '8C'], discard: ['3S'] });
    const after = ok(applyAction(s, 0, { type: 'drawStock' }));
    expect(after.drawnIds).toEqual(['8C']);
    expect(getPlayerView(after, 0).drawnIds).toEqual(['8C']);
    expect(getPlayerView(after, 1).drawnIds).toEqual([]);
    expect(JSON.stringify(getPlayerView(after, 1))).not.toContain('"8C"');
  });
});

describe('going out', () => {
  it('a plan that empties the hand without a discard is rejected', () => {
    const s = makeState({ hands: [['10C'], ['KC']], melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D'])], bookLaid: [true, true] });
    expect(applyAction(s, 0, commit([{ op: 'layOff', meldId: 'm1', cardId: '10C' }], '10C'))).toEqual({ error: ERR.keepOneCard });
    expect(applyAction(s, 0, commit([], ''))).toEqual({ error: ERR.mustDiscard });
  });

  it('scores the opponent hand (A = 15, 2 = 20) plus the round bonus', () => {
    const s = makeState({
      round: 3,
      hands: [['10C', '9D'], ['AS', '2H', 'KC', '5D']],
      melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D'])],
      bookLaid: [true, true],
      scores: [40, 15],
    });
    const after = ok(applyAction(s, 0, commit([{ op: 'layOff', meldId: 'm1', cardId: '10C' }], '9D')));
    expect(after.lastRound).toMatchObject({ winner: 0, reason: 'out', cardPoints: 50, bonus: 30, points: [80, 0], totals: [120, 15] });
    expect(after.scores).toEqual([120, 15]);
    expect(after.history).toHaveLength(1);
  });

  it('after round 5, the game is over', () => {
    const s = makeState({ round: 5, hands: [['9D'], ['KC']], bookLaid: [true, true] });
    const after = ok(applyAction(s, 0, commit([], '9D')));
    expect(after.phase).toBe('gameOver');
    expect(after.scores).toEqual([60, 0]);
    const again = ok(applyAction(after, 1, { type: 'playAgain' }));
    expect(again.round).toBe(1);
    expect(again.scores).toEqual([0, 0]);
    expect(again.history).toEqual([]);
  });
});

describe('stock exhaustion', () => {
  it('reshuffles the discard pile into the stock, keeping the top discard', () => {
    const s = makeState({ phase: 'draw', hands: [['5D'], ['KC']], stock: [], discard: ['3C', '4C', '5C', 'KD'] });
    const after = ok(applyAction(s, 0, { type: 'drawStock' }));
    expect(after.discard.map((c) => c.id)).toEqual(['KD']);
    expect(after.stock).toHaveLength(2);
    expect(after.hands[0]).toHaveLength(2);
    expect([...after.stock, ...after.hands[0]].map((c) => c.id).sort()).toEqual(['3C', '4C', '5C', '5D']);
    expect(after.log.some((e) => e.kind === 'reshuffled')).toBe(true);
  });

  it('with the stock and the pile under the top discard empty, a stock draw is refused but the discard can be taken', () => {
    const s = makeState({ phase: 'draw', hands: [['5D'], ['KC']], stock: [], discard: ['KD'] });
    expect(applyAction(s, 0, { type: 'drawStock' })).toEqual({ error: ERR.stockEmpty });
    expect(ids(ok(applyAction(s, 0, { type: 'drawDiscard' })), 0)).toEqual(['5D', 'KD']);
  });

  it('ends the round with no points when no draw at all is possible (both piles empty)', () => {
    const s = makeState({ phase: 'draw', hands: [['5D', '6D'], ['KC']], stock: [], discard: [], scores: [10, 20] });
    const after = ok(applyAction(s, 0, { type: 'drawStock' }));
    expect(after.phase).toBe('roundOver');
    expect(after.lastRound).toMatchObject({ winner: null, reason: 'stock', points: [0, 0] });
    expect(after.scores).toEqual([10, 20]);
  });
});

describe('atomicity', () => {
  it('a failing plan leaves the state unchanged', () => {
    const s = makeState({ hands: [['10C', '9C', '5D'], ['KC']], melds: [setMeld('m1', 1, 10, ['10S', '10H', '10D'])], bookLaid: [true, true] });
    const snapshot = structuredClone(s);
    const r = applyAction(s, 0, commit([{ op: 'layOff', meldId: 'm1', cardId: '10C' }, { op: 'layOff', meldId: 'm1', cardId: '9C' }], '5D'));
    expect(r).toHaveProperty('error');
    expect(s).toEqual(snapshot);
  });
});
