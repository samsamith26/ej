import { cardName, meldLabel, rankLabel, SUIT_SYMBOLS, type LogEntry, type Meld } from '../engine';

export function logText(e: LogEntry, names: [string, string]): string {
  const n = (p: 0 | 1) => names[p];
  switch (e.kind) {
    case 'roundStart':
      return `Round ${e.round} — ${n(e.dealer)} deals`;
    case 'drewStock':
      return `${n(e.player)} drew from the stock`;
    case 'drewDiscard':
      return e.cards.length === 1
        ? `${n(e.player)} picked up the top discard: ${cardName(e.cards[0])}`
        : `${n(e.player)} picked up the top ${e.cards.length} discards: ${e.cards.map(cardName).join(', ')}`;
    case 'reshuffled':
      return 'The discard pile was shuffled into a new stock';
    case 'laidBook':
      return `${n(e.player)} laid their book`;
    case 'laidOff':
      return `${n(e.player)} laid off ${cardName(e.card)}`;
    case 'took2':
      return `${n(e.player)} took a 2 from the table`;
    case 'replaced2':
      return `${n(e.player)} replaced a 2 with ${cardName(e.natural)}`;
    case 'discarded':
      return `${n(e.player)} discarded ${cardName(e.card)}`;
    case 'wentOut':
      return `${n(e.player)} went out for ${e.points} points`;
    case 'stockOut':
      return 'The stock ran out — no points this round';
    case 'gameOver':
      return e.winner === null ? 'Game over — it’s a tie' : `Game over — ${n(e.winner)} wins`;
  }
}

export function meldTitle(m: Meld): string {
  if (m.kind === 'run') return `Run ${SUIT_SYMBOLS[m.suit!]}`;
  if (m.kind === 'aces') return 'Aces';
  return `${meldLabel(m.kind)} of ${rankLabel(m.rank!)}s`;
}

/** What a wild stands for, shown as a small badge. */
export function wildBadge(m: Meld, rep: number): string {
  return m.kind === 'run' ? `${rankLabel(rep)}${SUIT_SYMBOLS[m.suit!]}` : rankLabel(rep);
}
