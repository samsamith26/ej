import { describe, expect, it } from 'vitest';
import { ROUNDS } from './books';
import { applyAction, createGame, dealRound, getPlayerView, other } from './game';
import { ERR } from './plan';
import type { GameState, PlayerId } from './types';

const ok = (r: ReturnType<typeof applyAction>): GameState => {
  if ('error' in r) throw new Error(r.error);
  return r.state;
};

describe('dealing', () => {
  for (const def of ROUNDS) {
    for (const dealer of [0, 1] as PlayerId[]) {
      it(`round ${def.round}, dealer ${dealer}: dealer gets ${def.bookSize + 3}, non-dealer ${def.bookSize + 4}`, () => {
        const s = dealRound(createGame(7), def.round, dealer);
        expect(s.hands[dealer]).toHaveLength(def.bookSize + 3);
        expect(s.hands[other(dealer)]).toHaveLength(def.bookSize + 4);
        expect(s.discard).toHaveLength(1);
        expect(s.stock.length + s.discard.length + s.hands[0].length + s.hands[1].length).toBe(52);
        // Non-dealer goes first, straight into PLAY.
        expect(s.turn).toBe(other(dealer));
        expect(s.phase).toBe('play');
        expect(s.firstTurn).toBe(true);
      });
    }
  }

  it('picks the first dealer randomly (seeded)', () => {
    const dealers = new Set(Array.from({ length: 20 }, (_, i) => createGame(i).dealer));
    expect(dealers).toEqual(new Set([0, 1]));
  });

  it('is deterministic for a given seed', () => {
    expect(createGame(42)).toEqual(createGame(42));
  });

  it('alternates the dealer each round', () => {
    let s = createGame(3);
    const first = s.dealer;
    for (let r = 2; r <= 5; r++) {
      s = ok(applyAction({ ...s, phase: 'roundOver' }, 0, { type: 'nextRound' }));
      expect(s.round).toBe(r);
      expect(s.dealer).toBe(r % 2 === 0 ? other(first) : first);
      expect(s.turn).toBe(other(s.dealer));
    }
  });
});

describe("non-dealer's first turn", () => {
  it('rejects drawing, accepts discarding without drawing', () => {
    const s = createGame(11);
    const nd = s.turn;
    expect(applyAction(s, nd, { type: 'drawStock' })).toEqual({ error: ERR.firstTurnNoDraw });
    expect(applyAction(s, nd, { type: 'drawDiscard' })).toEqual({ error: ERR.firstTurnNoDraw });
    const after = ok(applyAction(s, nd, { type: 'commitTurn', plan: [], discardId: s.hands[nd][0].id }));
    expect(after.hands[nd]).toHaveLength(s.hands[nd].length - 1);
    expect(after.turn).toBe(s.dealer);
    expect(after.phase).toBe('draw');
    expect(after.firstTurn).toBe(false);
  });

  it("the dealer's first turn requires a draw", () => {
    const s0 = createGame(11);
    const s = ok(applyAction(s0, s0.turn, { type: 'commitTurn', plan: [], discardId: s0.hands[s0.turn][0].id }));
    const d = s.dealer;
    expect(applyAction(s, d, { type: 'commitTurn', plan: [], discardId: s.hands[d][0].id })).toEqual({ error: ERR.drawFirst });
    const drawn = ok(applyAction(s, d, { type: 'drawStock' }));
    expect(drawn.hands[d]).toHaveLength(s.hands[d].length + 1);
    expect(applyAction(drawn, d, { type: 'drawStock' })).toEqual({ error: ERR.alreadyDrew });
  });

  it('rejects moves out of turn', () => {
    const s = createGame(5);
    expect(applyAction(s, s.dealer, { type: 'commitTurn', plan: [], discardId: s.hands[s.dealer][0].id })).toEqual({
      error: ERR.notYourTurn,
    });
  });
});

describe('redaction', () => {
  it("getPlayerView never leaks the opponent's cards or the stock order", () => {
    const s = createGame(99);
    for (const me of [0, 1] as PlayerId[]) {
      const view = getPlayerView(s, me);
      const json = JSON.stringify(view);
      expect(view).not.toHaveProperty('stock');
      expect(view).not.toHaveProperty('hands');
      expect(view).not.toHaveProperty('rng');
      for (const c of s.hands[other(me)]) expect(json).not.toContain(`"${c.id}"`);
      for (const c of s.stock) expect(json).not.toContain(`"${c.id}"`);
      expect(view.opponentHandCount).toBe(s.hands[other(me)].length);
      expect(view.stockCount).toBe(s.stock.length);
      expect(view.hand.map((c) => c.id)).toEqual(s.hands[me].map((c) => c.id));
    }
  });

  it('only shows the top two cards of the discard pile', () => {
    const s = createGame(99);
    s.discard = [s.stock.pop()!, s.stock.pop()!, ...s.discard];
    const view = getPlayerView(s, 0);
    expect(JSON.stringify(view)).not.toContain(`"${s.discard[0].id}"`);
    expect(view.discardTopTwo.map((c) => c.id)).toEqual([s.discard[1].id, s.discard[2].id]);
  });
});
