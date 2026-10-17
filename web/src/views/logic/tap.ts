/**
 * Unit H — the tap gate.  One state machine, used by every tappable leaf.
 *
 * Capacitive glass, a three-year-old, and a wall that runs for months.  Four
 * things have to be true at once:
 *
 * 1. **A bounce is not a second tap.**  Two contacts inside `DEBOUNCE_MS` are one
 *    intent.  (`--dur-settle`, 260 ms.)
 * 2. **A mis-tap is undoable locally.**  The tap is applied optimistically and the
 *    request is held for `UNDO_MS` (`--dur-undo`, 2 s, the H2 Q1 graft).  A
 *    deliberate second tap inside that window cancels it and NOTHING is sent — no
 *    server revoke, no adult, no PIN.
 * 3. **An in-flight action swallows further taps.**  Otherwise an impatient child
 *    fires five claims at a race-y endpoint.
 * 4. **The optimistic value expires.**  If the server never confirms within
 *    `OPTIMISTIC_MAX_MS`, the local guess is dropped and the wall shows the truth.
 *    A wall that lies quietly is worse than a wall that flickers once.
 *
 * 5. **Some controls ask twice.**  A routine step is `confirm: true`: the first tap ARMS a
 *    visible ring and changes nothing, and only a second tap inside `CONFIRM_MS` applies it.
 *    Opt-in per control, because it is a real tax — every step of every morning routine now
 *    costs two taps — and it is only worth paying where a stray finger can act as somebody
 *    else.  Chore claims do not use it: a false claim is already caught at approval, so the
 *    tax would buy nothing.
 *
 * Pure and clock-injected, so all five are tested without a browser.
 */

import { durationMs } from '../../design/tokens.ts';

/** Two contacts closer together than this are one intent, not two. */
export const DEBOUNCE_MS = durationMs.settle;
/** The local undo window.  Nothing is sent until it elapses. */
export const UNDO_MS = durationMs.undo;
/**
 * How long an unconfirmed optimistic value may stay on the wall.  Derived from the
 * undo window rather than invented, so there is no second magic number to drift.
 */
export const OPTIMISTIC_MAX_MS = durationMs.undo * 5;
/**
 * How long a confirm-mode control stays armed waiting for its second tap.
 *
 * Twice the undo window. Long enough that a three-year-old aiming at a 96px target can land
 * two deliberate taps without hurrying; short enough that two unrelated brushes minutes apart
 * do not pair into a completion. Derived rather than invented, so there is no third magic
 * duration to drift out of step with the other two.
 */
export const CONFIRM_MS = durationMs.undo * 2;

/**
 * `pending` is the confirm-mode waiting room: a first tap landed, NOTHING has been applied,
 * and the control is showing a ring. It decays back to `idle` on its own.
 */
export type TapPhase = 'idle' | 'pending' | 'armed' | 'sending' | 'failed';

export interface TapGateState {
  readonly phase: TapPhase;
  /** What the wall should show now.  `null` means "show the server's value". */
  readonly optimistic: boolean | null;
  readonly armedAtMs: number | null;
  readonly lastTapAtMs: number | null;
  /** When the optimistic value stops being allowed to outlive the server's. */
  readonly optimisticUntilMs: number | null;
}

export const IDLE_TAP_GATE: TapGateState = {
  phase: 'idle',
  optimistic: null,
  armedAtMs: null,
  lastTapAtMs: null,
  optimisticUntilMs: null,
};

export type TapGateEvent =
  /**
   * A finger landed.  `next` is the value the tap would produce.
   *
   * `confirm` opts this control into asking twice.  It is on the EVENT rather than in the
   * state because the state machine is shared by every tappable leaf and a control's mode is
   * a property of the control, not of the tap history.
   */
  | { type: 'tap'; atMs: number; next: boolean; confirm?: boolean }
  /** The confirm ring timed out with no second tap. */
  | { type: 'expire'; atMs: number }
  /** The undo window elapsed; send it. */
  | { type: 'commit'; atMs: number }
  /** The request resolved. */
  | { type: 'settled'; atMs: number }
  /** The request failed — revert, and let the child try again. */
  | { type: 'failed'; atMs: number }
  /** A fresh snapshot arrived carrying the server's value for this target. */
  | { type: 'sync'; atMs: number; value: boolean };

export function tapGate(state: TapGateState, event: TapGateEvent): TapGateState {
  switch (event.type) {
    case 'tap': {
      if (state.phase === 'sending') return state; // in flight: swallow
      const since = state.lastTapAtMs === null ? Infinity : event.atMs - state.lastTapAtMs;
      if (since < DEBOUNCE_MS) return state; // bounce

      if (state.phase === 'pending') {
        // The second tap. Past the ring, and from here it behaves exactly as an ordinary
        // control does — optimistic value, undo window, the lot. Confirming and undoing stay
        // separate gestures rather than the same one meaning two things.
        if (event.atMs - (state.armedAtMs ?? event.atMs) > CONFIRM_MS) {
          return { phase: 'pending', optimistic: null, armedAtMs: event.atMs,
                   lastTapAtMs: event.atMs, optimisticUntilMs: null };
        }
        return {
          phase: 'armed',
          optimistic: event.next,
          armedAtMs: event.atMs,
          lastTapAtMs: event.atMs,
          optimisticUntilMs: null,
        };
      }

      if (event.confirm === true && state.phase !== 'armed') {
        // First tap on a confirm-mode control: show the ring, change NOTHING. A stray brush
        // that is never followed up leaves no trace at all, which is the whole point.
        return {
          phase: 'pending',
          optimistic: null,
          armedAtMs: event.atMs,
          lastTapAtMs: event.atMs,
          optimisticUntilMs: null,
        };
      }

      if (state.phase === 'armed') {
        // A deliberate second tap inside the undo window cancels it outright.
        return { ...IDLE_TAP_GATE, lastTapAtMs: event.atMs };
      }
      return {
        phase: 'armed',
        optimistic: event.next,
        armedAtMs: event.atMs,
        lastTapAtMs: event.atMs,
        optimisticUntilMs: null,
      };
    }
    case 'expire': {
      if (state.phase !== 'pending' || state.armedAtMs === null) return state;
      if (event.atMs - state.armedAtMs < CONFIRM_MS) return state;
      return { ...IDLE_TAP_GATE, lastTapAtMs: state.lastTapAtMs };
    }
    case 'commit': {
      if (state.phase !== 'armed' || state.armedAtMs === null) return state;
      if (event.atMs - state.armedAtMs < UNDO_MS) return state; // too early to send
      return { ...state, phase: 'sending' };
    }
    case 'settled': {
      if (state.phase !== 'sending') return state;
      // Hold the optimistic value until the snapshot catches up — but not forever.
      return { ...state, phase: 'idle', optimisticUntilMs: event.atMs + OPTIMISTIC_MAX_MS };
    }
    case 'failed': {
      if (state.phase !== 'sending') return state;
      return { ...IDLE_TAP_GATE, phase: 'failed', lastTapAtMs: state.lastTapAtMs };
    }
    case 'sync': {
      if (state.optimistic === null) return state;
      if (state.phase === 'armed' || state.phase === 'sending') return state;
      const agreed = state.optimistic === event.value;
      const expired =
        state.optimisticUntilMs !== null && event.atMs >= state.optimisticUntilMs;
      if (!agreed && !expired) return state;
      return { ...IDLE_TAP_GATE, phase: state.phase, lastTapAtMs: state.lastTapAtMs };
    }
    default: {
      const unreachable: never = event;
      throw new Error(`unhandled tap event ${JSON.stringify(unreachable)}`);
    }
  }
}

/** What to draw: the local guess while one is held, otherwise the server's value. */
export function tapValue(state: TapGateState | undefined, serverValue: boolean): boolean {
  return state?.optimistic ?? serverValue;
}

/** True while the undo window is open — the leaf draws the "tap again to undo" mark. */
export function isUndoable(state: TapGateState | undefined): boolean {
  return state?.phase === 'armed';
}

// ---------------------------------------------------------------------------
// Target keys.  One namespace, so two surfaces can never share a gate by accident.
// ---------------------------------------------------------------------------

export const stepKey = (runStepId: number): string => `step:${String(runStepId)}`;
export const choreKey = (assignmentId: number): string => `chore:${String(assignmentId)}`;
export const redemptionKey = (childId: string): string => `cash:${childId}`;
