import type { ReactNode } from 'react';
import type { Toast } from './hooks';

/** The oversized "playing card" used for the lobby, waiting room and join screens. */
export function BigCard({ children }: { children: ReactNode }) {
  return (
    <main className="lobby">
      <section className="bigcard">
        <span className="bigidx tl" aria-hidden="true">
          E<br />J
        </span>
        <span className="bigidx br" aria-hidden="true">
          E<br />J
        </span>
        <div className="bigcard-body">{children}</div>
      </section>
    </main>
  );
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className="toast" onClick={() => dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
