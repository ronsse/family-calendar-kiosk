/**
 * The state mark: a step's or a chore's state, as a STICKER (felt) or a BOX (gallery,
 * storybook), with the state's glyph inside it.
 *
 * The glyph is the channel that survives the panel (see `Glyph`); the mark around it is the
 * theme's card language — the one part of a row that says "this is what changes when you tap".
 * It is the same mark on a routine step and on a chore, so a child who has learned what a
 * ticked sticker means on her routine reads her jobs the same way.
 *
 * Everything comes from the treatment. The edge is the state's own edge and the ground is the
 * card's surface — except on a SOLID state (done), where the whole card is already the state's
 * fill, so the mark is drawn in the card's ink instead: a white ring and a white tick on green.
 */

import type { StateTreatment } from '../../design/tokens.ts';
import { colour, iconPx, radius, strokePx } from '../../design/tokens.ts';
import type { MarkForm } from '../logic/theme.ts';
import { Glyph } from './Glyph.tsx';
import { px } from './style.ts';

export function StateMark({
  treatment,
  shape,
  sizePx,
}: {
  treatment: StateTreatment;
  shape: MarkForm;
  sizePx: number;
}) {
  const solid = treatment.fillRole === 'solid';
  return (
    <span
      aria-hidden="true"
      data-state-mark={shape}
      style={{
        width: px(sizePx),
        height: px(sizePx),
        flex: '0 0 auto',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: shape === 'round' ? radius.pill : radius.sm,
        border: `${px(strokePx.medium)} solid ${solid ? treatment.ink : treatment.edge}`,
        background: solid ? 'transparent' : colour.surface,
      }}
    >
      {/* The glyph fills what the edge leaves, and never goes under the glyph set's 24 floor. */}
      <Glyph
        name={treatment.glyph}
        sizePx={Math.max(iconPx.xs, sizePx - 2 * strokePx.medium)}
        tone={treatment.ink}
      />
    </span>
  );
}
