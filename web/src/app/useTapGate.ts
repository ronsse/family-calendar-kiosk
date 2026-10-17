/**
 * Unit H — the tap gate, wired to React and to timers.
 *
 * Thin on purpose: every rule lives in the pure reducer in
 * `views/logic/tap.ts`, which is where they are tested.  This adds only the
 * scheduling — hold the request for the undo window, then send — and a mirror ref
 * so a tap can be judged synchronously against the state the previous tap left.
 *
 * One gate instance serves every target on screen, keyed by a string, so the
 * debounce and in-flight rules exist ONCE rather than per component (H2 Q3).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONFIRM_MS,
  IDLE_TAP_GATE,
  UNDO_MS,
  isUndoable,
  tapGate,
  tapValue,
  type TapGateEvent,
  type TapGateState,
} from '../views/logic/tap.ts';

export interface TapGate {
  /**
   * Register a tap.  `run` is called only if the undo window elapses untouched.
   *
   * `confirm` opts this control into asking twice — the first tap only shows a ring. Used by
   * routine steps, deliberately not by chore claims (a false claim is caught at approval, so
   * the second tap would buy nothing and cost every child two taps per step every morning).
   */
  tap: (key: string, next: boolean, run: () => Promise<unknown>, confirm?: boolean) => void;
  /** What to draw for `key`: the local guess if one is held, else the server's. */
  value: (key: string, serverValue: boolean) => boolean;
  /** True while the undo window is open. */
  undoPending: (key: string) => boolean;
  /** True while a confirm-mode control is showing its ring, waiting for the second tap. */
  confirmPending: (key: string) => boolean;
  /** Called when a fresh snapshot lands, so stale optimism is dropped. */
  sync: (entries: Iterable<readonly [string, boolean]>) => void;
}

export function useTapGate(): TapGate {
  const [, force] = useState(0);
  const statesRef = useRef<Map<string, TapGateState>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers.values()) clearTimeout(id);
      timers.clear();
    };
  }, []);

  const apply = useCallback((key: string, event: TapGateEvent): TapGateState => {
    const before = statesRef.current.get(key) ?? IDLE_TAP_GATE;
    const after = tapGate(before, event);
    if (after !== before) {
      statesRef.current.set(key, after);
      force((n) => n + 1);
    }
    return after;
  }, []);

  const tap = useCallback(
    (key: string, next: boolean, run: () => Promise<unknown>, confirm = false) => {
      const before = statesRef.current.get(key) ?? IDLE_TAP_GATE;
      const after = apply(key, { type: 'tap', atMs: Date.now(), next, confirm });
      const timers = timersRef.current;

      if (after.phase === 'pending') {
        // First tap on a confirm control: nothing is sent and nothing is applied. Schedule the
        // ring's decay so an unanswered tap leaves no trace, rather than sitting armed until
        // somebody happens to touch the glass again hours later.
        const stale = timers.get(key);
        if (stale !== undefined) clearTimeout(stale);
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            apply(key, { type: 'expire', atMs: Date.now() });
          }, CONFIRM_MS),
        );
        return;
      }

      if (before.phase === 'armed' && after.phase !== 'armed') {
        // Undone inside the window: nothing was ever sent, so nothing to cancel
        // beyond the timer itself.
        const pending = timers.get(key);
        if (pending !== undefined) clearTimeout(pending);
        timers.delete(key);
        return;
      }
      if (after.phase !== 'armed' || after === before) return;

      const pending = timers.get(key);
      if (pending !== undefined) clearTimeout(pending);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          const committed = apply(key, { type: 'commit', atMs: Date.now() });
          if (committed.phase !== 'sending') return;
          void run().then(
            () => apply(key, { type: 'settled', atMs: Date.now() }),
            () => apply(key, { type: 'failed', atMs: Date.now() }),
          );
        }, UNDO_MS),
      );
    },
    [apply],
  );

  const sync = useCallback(
    (entries: Iterable<readonly [string, boolean]>) => {
      const atMs = Date.now();
      for (const [key, value] of entries) {
        if (statesRef.current.has(key)) apply(key, { type: 'sync', atMs, value });
      }
    },
    [apply],
  );

  const value = useCallback(
    (key: string, serverValue: boolean) => tapValue(statesRef.current.get(key), serverValue),
    [],
  );
  const undoPending = useCallback((key: string) => isUndoable(statesRef.current.get(key)), []);
  const confirmPending = useCallback(
    (key: string) => (statesRef.current.get(key)?.phase ?? 'idle') === 'pending',
    [],
  );

  // Stable identity: the gate lands in a context value, and a new object every
  // render would re-render every card on this wall four times a minute for months.
  return useMemo(
    () => ({ tap, sync, value, undoPending, confirmPending }),
    [tap, sync, value, undoPending, confirmPending],
  );
}
