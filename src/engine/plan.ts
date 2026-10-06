import { buildMeld, roundDef, validateBookShape } from './books';
import { isWild } from './cards';
import { canReplaceWild, canTakeWildWithoutReplacement, insertIntoMeld, layOffOptions } from './melds';
import type { Card, Meld, PlanOp, PlayerId } from './types';

export const ERR = {
  layOffBookTurn: "You can't lay off on the turn you lay your book unless you go out.",
  layOffOpponentBookTurn: "On the turn you lay your book, you can only lay off onto your own melds.",
  take2BookTurn: "You can't take 2s on the turn you lay your book.",
  bookAlreadyLaid: "You've already laid your book this round.",
  layOffBeforeBook: 'You must lay your book before laying off.',
  take2BeforeBook: 'You must lay your book (on an earlier turn) before taking 2s.',
  keepOneCard: 'You must keep at least one card to discard.',
  mustDiscard: 'You must end your turn by discarding a card.',
  notInHand: "That card isn't in your hand.",
  noSuchMeld: "That meld isn't on the table.",
  cantLayOff: "That card doesn't fit on that meld.",
  chooseEnd: 'Choose which end of the run the card goes on.',
  notWildInMeld: "That card isn't a wild 2 in that meld.",
  take2Breaks: "That meld wouldn't be valid without the 2 — replace it with the card it represents instead.",
  wrongReplacement: "That card isn't the one the 2 represents.",
  firstTurnNoDraw: 'First turn — no draw, just discard.',
  alreadyDrew: "You've already drawn this turn.",
  drawFirst: 'Draw a card first.',
  notYourTurn: "It's not your turn.",
  discardEmpty: 'The discard pile is empty.',
  stockEmpty: 'The stock is empty — take from the discard pile instead.',
} as const;

/** Everything a turn plan needs; derivable from either GameState or a PlayerView. */
export interface PlanContext {
  player: PlayerId;
  round: number;
  hand: Card[];
  melds: Meld[];
  /** Whether this player laid their book on an EARLIER turn this round. */
  bookLaid: boolean;
  nextMeldId: number;
}

export interface PlanOutcome {
  hand: Card[];
  melds: Meld[];
  nextMeldId: number;
  bookLaidThisTurn: boolean;
  /** Set when `final` and the discard empties the hand. */
  wentOut: boolean;
  discarded: Card | null;
  /** Public events, for the move log. */
  events: PlanEvent[];
}

export type PlanEvent =
  | { kind: 'laidBook' }
  | { kind: 'laidOff'; card: Card }
  | { kind: 'took2'; card: Card }
  | { kind: 'replaced2'; card: Card; natural: Card };

export type PlanRunResult = { ok: true; outcome: PlanOutcome } | { ok: false; error: string; step: number };

/**
 * Run a staged turn plan step by step. With `discardId` set, also enforce the
 * end-of-plan rules (the final discard and the book-turn going-out rule);
 * without it, this is a live preview of a partial plan.
 */
export function runPlan(ctx: PlanContext, ops: PlanOp[], discardId?: string): PlanRunResult {
  let hand = [...ctx.hand];
  let melds = ctx.melds.map((m) => ({ ...m, cards: [...m.cards] }));
  let nextMeldId = ctx.nextMeldId;
  let bookLaid = ctx.bookLaid;
  let bookLaidThisTurn = false;
  let layOffsAfterBook = 0;
  const events: PlanEvent[] = [];

  // Taking or replacing 2s is never allowed on the book turn, wherever it
  // appears in the plan — even if it would let you go out.
  if (ops.some((o) => o.op === 'layBook') && ops.some((o) => o.op === 'take2' || o.op === 'replace2')) {
    const step = ops.findIndex((o) => o.op === 'take2' || o.op === 'replace2');
    return { ok: false, error: ERR.take2BookTurn, step };
  }

  const fail = (error: string, step: number): PlanRunResult => ({ ok: false, error, step });
  const takeFromHand = (id: string): Card | null => {
    const idx = hand.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    const [card] = hand.splice(idx, 1);
    return card;
  };
  const findMeld = (id: string) => melds.findIndex((m) => m.id === id);

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    switch (op.op) {
      case 'layBook': {
        if (bookLaid) return fail(ERR.bookAlreadyLaid, i);
        const def = roundDef(ctx.round);
        const allIds = op.melds.flatMap((m) => m.cards.map((c) => c.cardId));
        if (new Set(allIds).size !== allIds.length) return fail('Each card can only be used once.', i);
        const built: Meld[] = [];
        for (const spec of op.melds) {
          const cards: Card[] = [];
          for (const { cardId } of spec.cards) {
            const c = hand.find((h) => h.id === cardId);
            if (!c) return fail(ERR.notInHand, i);
            cards.push(c);
          }
          const req = def.melds.find((r) => r.kind === spec.kind);
          if (!req) return fail(`This round's book is exactly: ${def.description}.`, i);
          const res = buildMeld(spec, cards, ctx.player, `m${nextMeldId++}`, req.size);
          if ('error' in res) return fail(res.error, i);
          built.push(res.meld);
        }
        const shapeErr = validateBookShape(built, ctx.round);
        if (shapeErr) return fail(shapeErr, i);
        for (const id of allIds) takeFromHand(id);
        melds = [...melds, ...built];
        bookLaid = true;
        bookLaidThisTurn = true;
        events.push({ kind: 'laidBook' });
        break;
      }
      case 'layOff': {
        if (!bookLaid) return fail(ERR.layOffBeforeBook, i);
        const mi = findMeld(op.meldId);
        if (mi < 0) return fail(ERR.noSuchMeld, i);
        // Book turn: lay-offs (only allowed when going out) must go on your own melds.
        if (bookLaidThisTurn && melds[mi].owner !== ctx.player) return fail(ERR.layOffOpponentBookTurn, i);
        const card = hand.find((c) => c.id === op.cardId);
        if (!card) return fail(ERR.notInHand, i);
        const options = layOffOptions(melds[mi], card);
        if (options.length === 0) return fail(ERR.cantLayOff, i);
        let rep = op.rep;
        if (rep === undefined) {
          if (options.length > 1) return fail(ERR.chooseEnd, i);
          rep = options[0];
        } else if (!options.includes(rep)) {
          return fail(ERR.cantLayOff, i);
        }
        takeFromHand(card.id);
        melds[mi] = insertIntoMeld(melds[mi], { card, rep });
        if (bookLaidThisTurn) layOffsAfterBook++;
        events.push({ kind: 'laidOff', card });
        break;
      }
      case 'take2': {
        if (!bookLaid) return fail(ERR.take2BeforeBook, i);
        const mi = findMeld(op.meldId);
        if (mi < 0) return fail(ERR.noSuchMeld, i);
        const mc = melds[mi].cards.find((x) => x.card.id === op.cardId);
        if (!mc || !isWild(mc.card)) return fail(ERR.notWildInMeld, i);
        if (!canTakeWildWithoutReplacement(melds[mi], op.cardId)) return fail(ERR.take2Breaks, i);
        melds[mi] = { ...melds[mi], cards: melds[mi].cards.filter((x) => x.card.id !== op.cardId) };
        hand.push(mc.card);
        events.push({ kind: 'took2', card: mc.card });
        break;
      }
      case 'replace2': {
        if (!bookLaid) return fail(ERR.take2BeforeBook, i);
        const mi = findMeld(op.meldId);
        if (mi < 0) return fail(ERR.noSuchMeld, i);
        const mc = melds[mi].cards.find((x) => x.card.id === op.cardId);
        if (!mc || !isWild(mc.card)) return fail(ERR.notWildInMeld, i);
        const natural = hand.find((c) => c.id === op.naturalId);
        if (!natural) return fail(ERR.notInHand, i);
        if (!canReplaceWild(melds[mi], op.cardId, natural)) return fail(ERR.wrongReplacement, i);
        takeFromHand(natural.id);
        melds[mi] = {
          ...melds[mi],
          cards: melds[mi].cards.map((x) => (x.card.id === op.cardId ? { card: natural, rep: x.rep } : x)),
        };
        hand.push(mc.card);
        events.push({ kind: 'replaced2', card: mc.card, natural });
        break;
      }
    }
    if (hand.length === 0) return fail(ERR.keepOneCard, i);
  }

  let discarded: Card | null = null;
  let wentOut = false;
  if (discardId !== undefined) {
    discarded = takeFromHand(discardId);
    if (!discarded) return fail(ERR.notInHand, ops.length);
    wentOut = hand.length === 0;
    // Book turn: extra plays are only allowed if they let you go out.
    if (bookLaidThisTurn && layOffsAfterBook > 0 && !wentOut) return fail(ERR.layOffBookTurn, ops.length);
  }

  return { ok: true, outcome: { hand, melds, nextMeldId, bookLaidThisTurn, wentOut, discarded, events } };
}
