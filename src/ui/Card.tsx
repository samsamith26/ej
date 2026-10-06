import { isWild, rankLabel, SUIT_SYMBOLS, type Card } from '../engine';

const RED = new Set(['H', 'D']);

interface CardProps {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  /** Small tag in the corner, e.g. the card a wild represents. */
  badge?: string;
  note?: string;
  title?: string;
  small?: boolean;
}

/** A card face drawn with CSS: corner indices plus a large centre pip. */
export function CardFace({ card, selected, onClick, disabled, badge, note, title, small }: CardProps) {
  const cls = [
    'card',
    RED.has(card.suit) ? 'red' : 'black',
    isWild(card) ? 'wild' : '',
    selected ? 'selected' : '',
    onClick ? 'clickable' : '',
    small ? 'small' : '',
  ].join(' ');
  const label = rankLabel(card.rank);
  const suit = SUIT_SYMBOLS[card.suit];
  const content = (
    <>
      <span className="idx tl">
        {label}
        <br />
        {suit}
      </span>
      <span className="pip">{suit}</span>
      <span className="idx br">
        {label}
        <br />
        {suit}
      </span>
      {badge && <span className="badge">{badge}</span>}
      {note && <span className="note">{note}</span>}
    </>
  );
  const aria = `${label} of ${suit}${badge ? `, wild as ${badge}` : ''}`;
  return onClick ? (
    <button
      type="button"
      className={cls}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled} aria-pressed={selected} aria-label={aria} title={title}>
      {content}
    </button>
  ) : (
    <div className={cls} aria-label={aria} title={title}>
      {content}
    </div>
  );
}

export function CardBack({ small }: { small?: boolean }) {
  return <div className={`card back ${small ? 'small' : ''}`} aria-hidden="true" />;
}
