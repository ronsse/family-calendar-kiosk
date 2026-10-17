/**
 * Changing the grown-up PIN from the wall (pass 2, #9): the PIN now, a new one, the new one again.
 *
 * The same pad as the door, three times. The PIN typed in the first step authorises the change.
 * The PIN the visit already holds does not, because the visit's PIN was typed by whoever opened
 * the portal, and a door left open must not also hand out a new lock. Nothing is checked until
 * the third step sends. A wrong current PIN then comes back from the server as `bad_pin`, and the
 * flow returns to step one saying so. The visit's own PIN is left alone, because it was right.
 *
 * Every check the client can make is made before the send, in words: a PIN of the wrong shape,
 * a new PIN equal to the old one, and two entries that disagree. The server checks the shape too
 * (`/^[0-9]{4,12}$/`). These are the same numbers, so the pad never offers a PIN the server
 * would refuse.
 */

import { MIN_PARENT_PIN_LENGTH } from '../../app/adminActions.ts';

/** The server's ceiling. The pad has no cap of its own, so it is checked here. */
export const MAX_PARENT_PIN_LENGTH = 12;

export type PinChangeStep = 'current' | 'fresh' | 'again';

export interface PinChangeState {
  readonly step: PinChangeStep;
  readonly current: string | null;
  readonly fresh: string | null;
  /** The sentence for why the last entry was not taken, or null. */
  readonly said: string | null;
}

export const PIN_CHANGE_WORDS = {
  row: 'Grown-up PIN',
  rowDetail: 'Opens this screen and approves claims.',
  open: 'Change',
  back: 'Back to Settings',
  headline: {
    current: 'Your PIN now',
    fresh: 'A new PIN',
    again: 'The new PIN again',
  },
  detail: {
    current: 'Type the PIN you use today.',
    fresh: `Four to ${String(MAX_PARENT_PIN_LENGTH)} digits.`,
    again: 'Once more, to be sure.',
  },
  tooLong: `That is more than ${String(MAX_PARENT_PIN_LENGTH)} digits. Try a shorter one.`,
  same: 'That is the PIN you have now. Pick a different one.',
  mismatch: 'Those two were different. Type the new PIN again.',
  wrongCurrent: 'That is not the PIN now. Try again.',
  done: 'PIN changed',
} as const;

export function startPinChange(): PinChangeState {
  return { step: 'current', current: null, fresh: null, said: null };
}

export function pinShapeOk(pin: string): boolean {
  return /^[0-9]+$/.test(pin) && pin.length >= MIN_PARENT_PIN_LENGTH && pin.length <= MAX_PARENT_PIN_LENGTH;
}

/**
 * One PIN entered on the pad. `send` is present only when the third step agrees with the second,
 * and then the state still holds both PINs until the caller reports how the send went.
 */
export function enterPin(
  state: PinChangeState,
  pin: string,
): { readonly state: PinChangeState; readonly send?: { readonly current: string; readonly fresh: string } } {
  switch (state.step) {
    case 'current':
      // The PIN now is whatever the household set, so its shape is not ours to judge. Only the
      // server can say whether it is right.
      return { state: { step: 'fresh', current: pin, fresh: null, said: null } };
    case 'fresh':
      if (!pinShapeOk(pin)) return { state: { ...state, said: PIN_CHANGE_WORDS.tooLong } };
      if (pin === state.current) return { state: { ...state, said: PIN_CHANGE_WORDS.same } };
      return { state: { ...state, step: 'again', fresh: pin, said: null } };
    case 'again':
      if (pin !== state.fresh) {
        return { state: { ...state, step: 'fresh', fresh: null, said: PIN_CHANGE_WORDS.mismatch } };
      }
      if (state.current === null) return { state: startPinChange() };
      return { state, send: { current: state.current, fresh: pin } };
  }
}

/** The server said the PIN typed first was wrong: start over, and say why. */
export function currentRefused(): PinChangeState {
  return { ...startPinChange(), said: PIN_CHANGE_WORDS.wrongCurrent };
}

/** How the send went, as the settings pane needs to know it. */
export type PinChangeOutcome = 'changed' | 'wrong_current' | 'failed';
