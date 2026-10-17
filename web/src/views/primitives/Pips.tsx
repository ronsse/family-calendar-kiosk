/**
 * Unit H — quantity as marks.
 *
 * The row is capped by the band's `maxPips`; past that the "lots" heap replaces the
 * count entirely, because a row of fourteen dots is no more countable to a
 * three-year-old than the numeral 14 is.
 *
 * Filled and hollow marks differ in FILL, not only in colour, so the pair survives
 * both the panel and a dichromat.
 */

import type { CSSProperties } from 'react';
import type { PipSpec } from '../logic/pips.ts';
import { colour, spacePx, strokePx } from '../../design/tokens.ts';
import { Glyph } from './Glyph.tsx';
import { px } from './style.ts';

interface PipsProps {
  spec: PipSpec;
  sizePx: number;
  tone?: string;
  style?: CSSProperties;
}

export function Pips({ spec, sizePx, tone, style }: PipsProps) {
  const ink = tone ?? colour.ink;
  // Overflow is drawn AFTER the marks, not instead of them: "five and then some"
  // still tells a pre-reader more than a heap alone.  Only a quantity with no
  // countable part at all collapses to the heap by itself.
  if (spec.filled + spec.empty === 0) {
    return spec.overflow ? <Glyph name="lots" sizePx={sizePx} tone={ink} /> : null;
  }
  const marks: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: px(spacePx.xxs),
    flexWrap: 'wrap',
    ...style,
  };
  return (
    <span style={marks}>
      {Array.from({ length: spec.filled }, (_, i) => (
        <Pip key={`f${String(i)}`} sizePx={sizePx} tone={ink} filled />
      ))}
      {Array.from({ length: spec.empty }, (_, i) => (
        <Pip key={`e${String(i)}`} sizePx={sizePx} tone={ink} filled={false} />
      ))}
      {spec.overflow ? <Glyph name="lots" sizePx={sizePx} tone={ink} /> : null}
    </span>
  );
}

function Pip({ sizePx, tone, filled }: { sizePx: number; tone: string; filled: boolean }) {
  return (
    <span
      style={{
        width: px(sizePx),
        height: px(sizePx),
        borderRadius: '50%',
        flex: '0 0 auto',
        background: filled ? tone : colour.surface,
        border: `${px(strokePx.medium)} solid ${tone}`,
        boxSizing: 'border-box',
      }}
    />
  );
}

/** Sleeps, drawn as moons.  Same shape as a pip row, different mark. */
export function MoonPips({ spec, sizePx, tone }: PipsProps) {
  const ink = tone ?? colour.ink;
  if (spec.overflow) return <Glyph name="lots" sizePx={sizePx} tone={ink} />;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.xxs), flexWrap: 'wrap' }}>
      {Array.from({ length: Math.max(spec.filled, 0) }, (_, i) => (
        <Glyph key={`m${String(i)}`} name="moon" sizePx={sizePx} tone={ink} />
      ))}
    </span>
  );
}
