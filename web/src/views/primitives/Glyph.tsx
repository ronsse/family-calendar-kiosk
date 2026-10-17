/**
 * Unit H — the glyph set.  Shape is the channel that survives this panel.
 *
 * 225 nits behind etched glass turns "green vs amber" into "grey vs grey" at three
 * metres, and a five-year-old has not learned colour names anyway.  Every meaning
 * on this wall therefore carries a distinct SHAPE as well as a colour, and the
 * four state glyphs are exactly `StateTreatment.glyph` so a treatment maps to a
 * drawing with no translation step.
 *
 * All strokes are `strokeLinecap: round` at >= Unit G's stroke floor once scaled:
 * the 24-unit viewBox is drawn at 24px logical at the very smallest, so a stroke
 * of 2 units is never thinner than 2 logical px.
 */

import type { CSSProperties } from 'react';
import type { GlyphName } from '../contract.ts';
import { colour, strokePx } from '../../design/tokens.ts';
import { px } from './style.ts';

interface GlyphProps {
  name: GlyphName;
  sizePx: number;
  tone?: string;
  fill?: string;
  style?: CSSProperties;
}

const VIEW = 24;

export function Glyph({ name, sizePx, tone, fill, style }: GlyphProps) {
  const stroke = tone ?? colour.ink;
  const body = fill ?? 'none';
  return (
    <svg
      width={px(sizePx)}
      height={px(sizePx)}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="presentation"
      focusable="false"
      style={{ flex: '0 0 auto', display: 'block', ...style }}
    >
      <g
        stroke={stroke}
        strokeWidth={strokePx.medium}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={body}
      >
        {shapeFor(name, stroke)}
      </g>
    </svg>
  );
}

function shapeFor(name: GlyphName, stroke: string) {
  switch (name) {
    case 'empty-circle':
      return <circle cx="12" cy="12" r="8" fill="none" />;
    case 'hourglass':
      return (
        <>
          <path d="M7 4h10M7 20h10" />
          <path d="M8 4c0 4 4 5 4 8s-4 4-4 8" fill="none" />
          <path d="M16 4c0 4-4 5-4 8s4 4 4 8" fill="none" />
        </>
      );
    case 'check':
      return <path d="M5 13l4.5 4.5L19 7" fill="none" />;
    case 'crossed':
      return (
        <>
          <circle cx="12" cy="12" r="8" fill="none" />
          <path d="M7 17L17 7" />
        </>
      );
    case 'cross':
      // A bare X, and NOT `crossed` — that one is a circle with a stroke through it, and it
      // already means "someone else got it" on the chore board. Reusing it for "send back"
      // would put the same mark on a state and on an action. Asked for by name 2026-09-09:
      // "a red button with an x and a check mark."
      return <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" strokeWidth={3} fill="none" />;
    case 'minus':
    case 'plus':
      // The two halves of a stepper, and the ONLY place on this wall a number is changed by
      // tapping. Same stroke weight as `cross` so a minus and an X at the same size do not read
      // as different families of mark; the plus is the minus with its upright, so the pair is
      // unmistakably one control rather than two shapes that happen to sit together.
      return (
        <>
          <path d="M6 12h12" strokeWidth={3} fill="none" />
          {name === 'plus' ? <path d="M12 6v12" strokeWidth={3} fill="none" /> : null}
        </>
      );
    case 'back':
    case 'forward':
      // The calendar's pager: one chevron, mirrored. The same 3-unit stroke as the stepper's
      // marks, because these are the other place on the wall where a tap MOVES something
      // rather than choosing it, and the family should read as one.
      return (
        <path
          d={name === 'back' ? 'M14.5 5.5 8 12l6.5 6.5' : 'M9.5 5.5 16 12l-6.5 6.5'}
          strokeWidth={3}
          fill="none"
        />
      );
    case 'up':
    case 'down':
      // The pager's chevron turned on its side, for the Routines screen's reorder buttons —
      // the third place a tap moves something. Same stroke, same family.
      return (
        <path
          d={name === 'up' ? 'M5.5 14.5 12 8l6.5 6.5' : 'M5.5 9.5 12 16l6.5-6.5'}
          strokeWidth={3}
          fill="none"
        />
      );
    case 'star':
      return <path d="M12 3l2.8 5.9 6.2.9-4.5 4.5 1.1 6.4-5.6-3.1-5.6 3.1 1.1-6.4L3 9.8l6.2-.9z" fill={stroke} />;
    case 'moon':
      return <path d="M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5z" fill={stroke} />;
    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="4.5" fill={stroke} />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
        </>
      );
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" fill="none" />
          <path d="M12 7v5.5l3.5 2.5" fill="none" />
        </>
      );
    case 'gift':
      return (
        <>
          <rect x="3.5" y="9.5" width="17" height="11" rx="2" fill="none" />
          <path d="M3.5 13.5h17M12 9.5v11" />
          <path d="M12 9.5S9.5 3.5 7 5.5s5 4 5 4zM12 9.5s2.5-6 5-4-5 4-5 4z" fill="none" />
        </>
      );
    case 'alert':
      return (
        <>
          <path d="M12 4l8.5 15h-17z" fill="none" />
          <path d="M12 10v4" />
          <circle cx="12" cy="16.6" r="0.9" fill={stroke} stroke="none" />
        </>
      );
    case 'sync':
      return (
        <>
          <path d="M20 12a8 8 0 1 1-2.6-5.9" fill="none" />
          <path d="M20 4v4.5h-4.5" fill="none" />
        </>
      );
    case 'home':
      // A filled house. Solid, because this is the one control on the rail that is not a face
      // and it has to read as a DIFFERENT KIND of thing from three feet or three inches.
      return <path d="M12 3.2 2.5 11h2.7v9.8h5V15h3.6v5.8h5V11h2.7z" fill={stroke} />;
    case 'calendar':
      // A page with a ring binding. Deliberately not the event icon: this is a control.
      return (
        <>
          <path d="M4 6.5h16V20H4z" fill="none" stroke={stroke} strokeWidth={2} />
          <path d="M4 10.5h16" stroke={stroke} strokeWidth={2} />
          <path d="M8 3.5v4M16 3.5v4" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'grown-up':
      // A head and shoulders. The children are PHOTOGRAPHS in the rail; the adult door is a
      // silhouette, so a pre-reader pattern-matching on faces does not wander in here.
      return (
        <>
          <circle cx={12} cy={8} r={3.6} fill={stroke} />
          <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0z" fill={stroke} />
        </>
      );
    case 'picture':
      // A framed landscape — a hill and a sun inside a rectangle. It is the door to the picture
      // LIBRARY, so it has to read as a picture-of-a-picture and not as a photograph; the frame
      // is what does that, and it is why this is not simply the `sun` glyph on a box.
      return (
        <>
          <path d="M3.5 5.5h17v13h-17z" fill="none" stroke={stroke} strokeWidth={2} />
          <circle cx={8} cy={10} r={1.8} fill={stroke} stroke="none" />
          <path d="M3.5 16.5 9 11.5l4 3.5 3.5-3 4 3.5" fill="none" stroke={stroke} strokeWidth={2} />
        </>
      );
    case 'lots':
      // "more than you can count" — a heap, never a numeral.
      return (
        <>
          <circle cx="7" cy="16" r="3.4" fill={stroke} stroke="none" />
          <circle cx="14.5" cy="16" r="3.4" fill={stroke} stroke="none" />
          <circle cx="11" cy="8.6" r="3.4" fill={stroke} stroke="none" />
        </>
      );
    case 'unknown':
      return (
        <>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" />
          <circle cx="12" cy="12" r="2.6" fill={stroke} stroke="none" />
        </>
      );
    default: {
      const unreachable: never = name;
      throw new Error(`no drawing for glyph ${String(unreachable)}`);
    }
  }
}

/**
 * An analog dial.  This is how "when" reaches a pre-reader: hands on a face, no
 * digits anywhere.  She will not read the time off it at three; she WILL learn
 * that her swimming picture sits under a dial whose hands look like that.
 */
export function ClockFace({
  hourDeg,
  minuteDeg,
  sizePx,
  tone,
}: {
  hourDeg: number;
  minuteDeg: number;
  sizePx: number;
  tone?: string;
}) {
  const stroke = tone ?? colour.ink;
  return (
    <svg
      width={px(sizePx)}
      height={px(sizePx)}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="presentation"
      focusable="false"
      style={{ flex: '0 0 auto', display: 'block' }}
    >
      <circle cx="12" cy="12" r="9.5" fill={colour.surface} stroke={stroke} strokeWidth={strokePx.medium} />
      <g stroke={stroke} strokeWidth={strokePx.thick} strokeLinecap="round">
        <line x1="12" y1="12" x2="12" y2="7.4" transform={`rotate(${hourDeg} 12 12)`} />
        <line x1="12" y1="12" x2="12" y2="4.6" transform={`rotate(${minuteDeg} 12 12)`} strokeWidth={strokePx.medium} />
      </g>
      <circle cx="12" cy="12" r="1" fill={stroke} />
    </svg>
  );
}
