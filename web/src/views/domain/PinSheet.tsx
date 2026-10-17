/**
 * Unit H — the PIN pad: the door to the grown-up portal, and the key to one retirement.
 *
 * Two callers, one pad.  The grown-up portal (ApprovalsView) puts it up as its DOOR: the
 * queue, the chores, the money and the settings are drawn only once a PIN is held, and the
 * portal's first read — the settings, which every request already checks — is what turns a
 * wrong one back to this pad.  There is no verify route and there does not need to be.  The
 * picture catalog (ScenesView) puts it up for exactly one action, retiring a picture, when no
 * PIN is held; putting a picture up never asks.
 *
 * The SERVER still holds no session — `requireParentPin` is per request (docs/api.md §Auth) —
 * so a PIN entered here is kept for the VISIT, in WallApp's React state (app/grownupVisit.ts),
 * and sent with every request the visit makes.  It is never written down, and leaving the
 * portal forgets it.  The wall is a panel three children and every guest can reach; a session
 * is a credential left lying on it.
 *
 * The digits live in THIS component until they are spent, and do not survive the tap that
 * spends them: `submit` hands the string to its caller and clears the buffer in the same
 * breath.  A wrong PIN leaves the pad up with an empty buffer and one calm sentence — never a
 * count of attempts, never a warning, because a five-year-old is standing at the adult's elbow
 * watching.  The server has no lockout either, and for the same reason: a child mashing the
 * pad must not be able to turn a nuisance into an outage (src/http/auth.ts).
 *
 * It is a PAD rather than a text field on purpose.  Pi OS Lite runs labwc with no on-screen
 * keyboard, so an `<input>` on this wall is a box nobody can type into.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  colour,
  cssTokens,
  fontSizePx,
  iconPx,
  radius,
  spacePx,
  stateTreatments,
  strokePx,
} from '../../design/tokens.ts';
import { MIN_PARENT_PIN_LENGTH } from '../../app/adminActions.ts';
import { useBandTypography } from '../bands/registry.tsx';
import type { GlyphName } from '../contract.ts';
import { Glyph } from '../primitives/Glyph.tsx';
import { Tappable, type DataMarks } from '../primitives/Tappable.tsx';
import { numeralText, px, tapTarget, text } from '../primitives/style.ts';

const CANCEL_WORD = 'Go back';
const MASK_MARK = '•';

/** Three across, so the pad is 3 tap targets and 2 gaps wide whatever the band's floor is. */
const DIGIT_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];
const ZERO_DIGIT = '0';

/**
 * The way out, and where it goes.  A pad raised over one action steps back to the screen it
 * covers ("Go back"); the portal's door leaves the portal altogether ("Back to the wall"), and
 * says so, because behind a door there is nothing to step back to.
 */
export interface PinSheetExit {
  word: string;
  glyph: GlyphName;
  /** The full width of the column — the door's one other control, so it may be big. */
  wide: boolean;
  marks?: DataMarks | undefined;
}

const STEP_BACK: PinSheetExit = { word: CANCEL_WORD, glyph: 'back', wide: false };

export interface PinSheetProps {
  /** The verb, in the same words the row's button used — or the door's own name. */
  headline: string;
  /** What is being decided — the deed, whose it is, and what it pays. */
  detail: string;
  /** A request is away.  The pad goes inert rather than queueing a second one. */
  busy: boolean;
  /** Already worded by `REFUSAL_WORDS`; null or empty says nothing at all. */
  refusal: string | null;
  /** Handed the PIN.  The caller decides how long it lives; this sheet keeps nothing. */
  onSubmit: (parentPin: string) => void;
  onCancel: () => void;
  exit?: PinSheetExit | undefined;
  /**
   * What the sheet is painted on.  Opaque by default, because over a screen it must hide the
   * rows behind it; a door already drawn as a card passes `transparent` and lets the card show.
   */
  ground?: string | undefined;
}

export function PinSheet({
  headline,
  detail,
  busy,
  refusal,
  onSubmit,
  onCancel,
  exit = STEP_BACK,
  ground = colour.bg,
}: PinSheetProps) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.small;
  const NUMERAL_TEXT = TYPO.numeralTextPx ?? fontSizePx.sectionTitle;

  const [digits, setDigits] = useState('');
  const ready = digits.length >= MIN_PARENT_PIN_LENGTH && !busy;

  function press(digit: string): void {
    if (busy) return;
    setDigits((current) => current + digit);
  }

  function submit(): void {
    if (!ready) return;
    // Cleared BEFORE the handoff, not after: nothing awaits in between, nothing can throw
    // in between, and the buffer is already empty by the time anybody could look again.
    const parentPin = digits;
    setDigits('');
    onSubmit(parentPin);
  }

  const said = refusal ?? '';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'stretch',
        gap: px(spacePx.lg),
        padding: px(spacePx.md),
        // Opaque over a screen, and covering the whole pane. One decision at a time on a wall:
        // leaving the queue visible behind this only invites an adult to aim at the next row
        // mid-PIN.
        background: ground,
        borderRadius: radius.lg,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* WHAT IS BEING DECIDED, then the entry, then the way out. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(spacePx.sm),
          flex: 1,
          minWidth: 0,
        }}
      >
        <span style={text(PRIMARY_TEXT, { wrap: true, lines: 2 })}>{headline}</span>
        {/*
          The row, restated. A mis-tap on a queue of near-identical rows is the likeliest
          mistake this screen can produce, and this line is where it gets caught — before a
          PIN is spent, rather than after a ledger entry exists.
        */}
        <span style={text(SECONDARY_TEXT, { muted: true, wrap: true, lines: 2 })}>{detail}</span>

        {/*
          A well, not a line. Masked, because a child is standing right here — and a count of
          marks is all the feedback a pad owes anybody. A well with no marks keeps its height,
          so the first digit does not move the pad's other controls.
        */}
        <span
          style={{
            ...numeralText(NUMERAL_TEXT, colour.ink),
            display: 'flex',
            alignItems: 'center',
            background: colour.surfaceSunken,
            borderRadius: radius.md,
            padding: px(spacePx.xs),
            minWidth: 0,
            minHeight: px(TYPO.minTapPx),
            boxSizing: 'border-box',
          }}
        >
          {MASK_MARK.repeat(digits.length)}
        </span>

        {/*
          One calm sentence, chosen by CODE upstream. It is empty for the codes the contract
          says to render nothing for, and an empty span is nothing.
        */}
        {said.length === 0 ? null : (
          <span style={text(SECONDARY_TEXT, { wrap: true, lines: 2 })}>{said}</span>
        )}

        {/*
          The way out wears `back`, a left-pointing arrow, and its words. The pad's clear key
          owns `crossed`, and two different meanings drawn as the same mark a hand's width
          apart is the failure Unit G's redundant channels exist to prevent.
        */}
        <Tappable
          enabled={!busy}
          onTap={onCancel}
          data={exit.marks}
          style={tapTarget(TYPO.minTapPx, {
            marginTop: 'auto',
            alignSelf: exit.wide ? 'stretch' : 'flex-start',
            gap: px(spacePx.xs),
            padding: `${px(spacePx.xxs)} ${px(spacePx.md)}`,
            background: colour.surface,
            border: `${px(strokePx.medium)} solid ${colour.borderStrong}`,
            borderRadius: radius.pill,
          })}
        >
          <Glyph name={exit.glyph} sizePx={iconPx.sm} tone={colour.ink} />
          <span style={text(PRIMARY_TEXT)}>{exit.word}</span>
        </Tappable>
      </div>

      {/*
        THE PAD. Three of the band's tap floor across, four down, on the mandatory dead
        space: 3x64 + 2x16 = 224 wide and 4x64 + 3x16 = 304 tall, inside a pane with 412.
      */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(spacePx.tapGap),
          flex: '0 0 auto',
          alignSelf: 'center',
        }}
      >
        {DIGIT_ROWS.map((row) => (
          <div key={row.join('')} style={{ display: 'flex', gap: px(spacePx.tapGap) }}>
            {row.map((digit) => (
              <PadKey
                key={digit}
                mark={digit}
                enabled={!busy}
                onTap={() => {
                  press(digit);
                }}
              >
                <span style={numeralText(NUMERAL_TEXT, colour.ink)}>{digit}</span>
              </PadKey>
            ))}
          </div>
        ))}
        <div style={{ display: 'flex', gap: px(spacePx.tapGap) }}>
          {/*
            CLEAR, not backspace. One glyph, one meaning, and starting a four-digit PIN over
            costs three taps at most — where a backspace an adult has to hit twice in a row
            is exactly what produces a wrong PIN in front of the children.
          */}
          <PadKey
            mark="clear"
            enabled={!busy && digits.length > 0}
            onTap={() => {
              setDigits('');
            }}
          >
            <Glyph name="crossed" sizePx={iconPx.sm} tone={colour.inkMuted} />
          </PadKey>
          <PadKey
            mark={ZERO_DIGIT}
            enabled={!busy}
            onTap={() => {
              press(ZERO_DIGIT);
            }}
          >
            <span style={numeralText(NUMERAL_TEXT, colour.ink)}>{ZERO_DIGIT}</span>
          </PadKey>
          {/*
            The one control on this wall allowed to dim. Tappable's rule — never grey a
            control out, a child only taps harder — was written about a CHILD'S card, where
            the tap is the whole interaction. Here an adult needs to know the pad is not
            listening yet, and a key that silently swallows four taps is worse than one that
            says why. It keeps its full size and its full shape either way.
          */}
          <PadKey
            mark="check"
            enabled={ready}
            onTap={submit}
            fill={stateTreatments.approved.fill}
            edge={stateTreatments.approved.edge}
            dim={!ready}
          >
            <Glyph
              name={busy ? 'hourglass' : 'check'}
              sizePx={iconPx.sm}
              tone={stateTreatments.approved.ink}
            />
          </PadKey>
        </div>
      </div>
    </div>
  );
}

/**
 * One key.  Sized from the band's tap floor and nothing else, so the pad is as forgiving as
 * every other target on the wall.  `mark` is `data-pin-key` — the digit, `clear` or `check` —
 * so the audit and the probes press keys by what they are rather than where they sit.
 */
function PadKey({
  mark,
  enabled,
  onTap,
  fill,
  edge,
  dim,
  children,
}: {
  mark: string;
  enabled: boolean;
  onTap: () => void;
  fill?: string | undefined;
  edge?: string | undefined;
  dim?: boolean | undefined;
  children: ReactNode;
}) {
  const TYPO = useBandTypography();
  return (
    <Tappable
      enabled={enabled}
      onTap={onTap}
      data={{ 'data-pin-key': mark }}
      style={tapTarget(TYPO.minTapPx, {
        width: px(TYPO.minTapPx),
        height: px(TYPO.minTapPx),
        padding: px(spacePx.none),
        background: fill ?? colour.surface,
        border: `${px(strokePx.medium)} solid ${edge ?? colour.border}`,
        borderRadius: radius.md,
        ...(dim === true ? { opacity: cssTokens['--o-disabled'] } : {}),
      })}
    >
      {children}
    </Tappable>
  );
}
