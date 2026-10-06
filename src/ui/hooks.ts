import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action } from '../engine';
import { GuestSession, type GuestSnapshot } from '../net/guestSession';
import { HostSession, type HostSnapshot } from '../net/hostSession';

const NAME_KEY = 'ej:name';

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not critical.
  }
}

export interface Toast {
  id: number;
  text: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, dismiss };
}

export function useHostSession(gameId: string, name: string, onError: (m: string) => void) {
  const [snap, setSnap] = useState<HostSnapshot | null>(null);
  const session = useRef<HostSession | null>(null);
  const errRef = useRef(onError);
  errRef.current = onError;
  useEffect(() => {
    const s = new HostSession(gameId, name, setSnap, (m) => errRef.current(m));
    session.current = s;
    return () => s.destroy();
    // The name is read once at start; changing it mid-game isn't supported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);
  const dispatch = useCallback((a: Action) => session.current?.dispatch(a), []);
  return { snap, dispatch };
}

export function useGuestSession(gameId: string, name: string | null, onError: (m: string) => void) {
  const [snap, setSnap] = useState<GuestSnapshot | null>(null);
  const session = useRef<GuestSession | null>(null);
  const errRef = useRef(onError);
  errRef.current = onError;
  useEffect(() => {
    if (name === null) return undefined;
    const s = new GuestSession(gameId, name, setSnap, (m) => errRef.current(m));
    session.current = s;
    return () => s.destroy();
  }, [gameId, name]);
  const dispatch = useCallback((a: Action) => session.current?.dispatch(a), []);
  return { snap, dispatch };
}
