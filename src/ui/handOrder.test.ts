import { describe, expect, it } from 'vitest';
import { C } from '../engine/testUtils';
import { orderHand, reconcileOrder, sortHand } from './handOrder';

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe('hand order', () => {
  it('sorts by rank on first load', () => {
    expect(reconcileOrder([], C('KD', '3S', '2H', 'AC'), new Set())).toEqual(['3S', 'KD', 'AC', '2H']);
  });

  it('keeps a custom order and appends newly drawn cards at the right end', () => {
    const order = ['KD', '3S', 'AC'];
    expect(reconcileOrder(order, C('3S', 'AC', 'KD', '9H', '7C'), new Set())).toEqual(['KD', '3S', 'AC', '9H', '7C']);
  });

  it('drops cards that left the hand; the rest keep their order', () => {
    expect(reconcileOrder(['KD', '3S', 'AC', '9H'], C('3S', '9H', 'KD'), new Set())).toEqual(['KD', '3S', '9H']);
  });

  it('keeps the slot of a card staged on the table, so undo puts it back', () => {
    const order = reconcileOrder(['KD', '3S', 'AC'], C('KD', 'AC'), new Set(['3S']));
    expect(order).toEqual(['KD', '3S', 'AC']);
    expect(ids(orderHand(C('AC', '3S', 'KD'), order))).toEqual(['KD', '3S', 'AC']);
  });

  it('resorts a brand-new hand (new round)', () => {
    expect(reconcileOrder(['KD', '3S'], C('9H', '4C'), new Set())).toEqual(['4C', '9H']);
  });

  it('sort by suit groups suits with wilds last', () => {
    expect(ids(sortHand(C('2S', 'KH', '3S', 'AH'), 'suit'))).toEqual(['3S', 'KH', 'AH', '2S']);
  });
});
