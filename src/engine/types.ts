export type Suit = 'S' | 'H' | 'D' | 'C';
/** 1 = Ace, 11 = Jack, 12 = Queen, 13 = King. Natural 2s are always wild. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export type PlayerId = 0 | 1;

export interface Card {
  /** Unique within the single deck, e.g. "AS", "10H", "2C". */
  id: string;
  rank: Rank;
  suit: Suit;
}

export type MeldKind = 'set' | 'aces' | 'run';

export interface MeldCard {
  card: Card;
  /**
   * What this card stands for in the meld.
   * - set / aces: the represented rank (1..13, never 2).
   * - run: the position 1..14, where 1 is a low Ace and 14 a high Ace.
   * For natural cards this is implied by the card; for wild 2s it is the
   * explicit "represented card".
   */
  rep: number;
}

export interface Meld {
  id: string;
  owner: PlayerId;
  kind: MeldKind;
  /** Rank of a set / aces pair. */
  rank?: Rank;
  /** Suit of a run. */
  suit?: Suit;
  /** Minimum valid size (set 3, aces 2, run 4 or 7). */
  minSize: number;
  /** Runs are kept sorted by ascending position. */
  cards: MeldCard[];
}

/** draw → play (staged plan + discard, committed atomically). */
export type Phase = 'draw' | 'play' | 'roundOver' | 'gameOver';

export interface RoundResult {
  round: number;
  /** null when the round ended because the stock ran out. */
  winner: PlayerId | null;
  reason: 'out' | 'stock';
  /** The cards left in the loser's hand (empty when no one went out). */
  loserCards: Card[];
  cardPoints: number;
  bonus: number;
  points: [number, number];
  totals: [number, number];
}

export type LogEntry =
  | { kind: 'roundStart'; round: number; dealer: PlayerId }
  | { kind: 'drewStock'; player: PlayerId }
  /** `cards` are public: the 1 or 2 cards taken from the discard pile, top card first. */
  | { kind: 'drewDiscard'; player: PlayerId; cards: Card[] }
  | { kind: 'reshuffled' }
  | { kind: 'laidBook'; player: PlayerId }
  | { kind: 'laidOff'; player: PlayerId; card: Card }
  | { kind: 'took2'; player: PlayerId; card: Card }
  | { kind: 'replaced2'; player: PlayerId; card: Card; natural: Card }
  | { kind: 'discarded'; player: PlayerId; card: Card }
  | { kind: 'wentOut'; player: PlayerId; points: number }
  | { kind: 'stockOut' }
  | { kind: 'gameOver'; winner: PlayerId | null };

export interface GameState {
  version: 2;
  /** Serializable RNG state (mulberry32). */
  rng: number;
  round: number;
  dealer: PlayerId;
  turn: PlayerId;
  phase: Phase;
  /** True during the non-dealer's first turn of a round (draw is skipped). */
  firstTurn: boolean;
  /** Top of each pile is the LAST element. */
  stock: Card[];
  discard: Card[];
  hands: [Card[], Card[]];
  melds: Meld[];
  bookLaid: [boolean, boolean];
  /**
   * Cards drawn this turn (from the stock or the discard pile), so the UI can
   * badge them. Any of them may be discarded again on the same turn.
   */
  drawnIds: string[];
  nextMeldId: number;
  scores: [number, number];
  history: RoundResult[];
  lastRound: RoundResult | null;
  log: LogEntry[];
}

// ---- Turn plans -----------------------------------------------------------

export interface BookCardSpec {
  cardId: string;
  /** Optional explicit rep (run position / set rank) — needed for ambiguous wilds. */
  rep?: number;
}

export interface BookMeldSpec {
  kind: MeldKind;
  /** For an all-wild set: which rank the wilds represent. */
  rank?: Rank;
  /** For an all-wild run: which suit. */
  suit?: Suit;
  cards: BookCardSpec[];
}

export type PlanOp =
  | { op: 'layBook'; melds: BookMeldSpec[] }
  | { op: 'layOff'; meldId: string; cardId: string; rep?: number }
  | { op: 'take2'; meldId: string; cardId: string }
  | { op: 'replace2'; meldId: string; cardId: string; naturalId: string };

export type Action =
  | { type: 'drawStock' }
  | { type: 'drawDiscard' }
  | { type: 'commitTurn'; plan: PlanOp[]; discardId: string }
  | { type: 'nextRound' }
  | { type: 'playAgain' };

export interface PlayerView {
  you: PlayerId;
  round: number;
  dealer: PlayerId;
  turn: PlayerId;
  phase: Phase;
  firstTurn: boolean;
  hand: Card[];
  opponentHandCount: number;
  stockCount: number;
  /** The top two discards (or fewer), top card LAST. Deeper cards stay hidden. */
  discardTopTwo: Card[];
  discardCount: number;
  canTakeDiscard: boolean;
  melds: Meld[];
  bookLaid: [boolean, boolean];
  /** Cards you drew this turn; empty when it isn't your turn (never reveals the opponent's stock draw). */
  drawnIds: string[];
  nextMeldId: number;
  scores: [number, number];
  history: RoundResult[];
  lastRound: RoundResult | null;
  log: LogEntry[];
}
