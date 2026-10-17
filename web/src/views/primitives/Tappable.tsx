/**
 * Unit H — one tappable surface for every band.
 *
 * Not `<button disabled>`: a disabled button greys out and stops responding, and a
 * child who taps a card that has gone quiet taps it harder, then taps its
 * neighbour.  A non-interactive card renders as a plain block that simply is not a
 * control, keeping its full contrast and its full size — the difference the child
 * sees is the state glyph, not a dimmed rectangle.
 */

import type { CSSProperties, ReactNode } from 'react';

/**
 * Marks a probe or an audit can find a control by — `data-grownup-nav`, `data-grownup-leave`.
 * Only `data-` names: this is a hook for tools, never a way to smuggle behaviour onto a control.
 */
export type DataMarks = Readonly<Record<`data-${string}`, string>>;

export function Tappable({
  enabled,
  onTap,
  style,
  children,
  data,
  label,
}: {
  enabled: boolean;
  onTap: () => void;
  style: CSSProperties;
  children: ReactNode;
  data?: DataMarks | undefined;
  /** The control's name for a reader that cannot see its glyph — a key drawn as a shape alone. */
  label?: string | undefined;
}) {
  if (!enabled) {
    return (
      <div {...data} style={{ ...style, cursor: 'default' }}>
        {children}
      </div>
    );
  }
  return (
    <button type="button" {...data} aria-label={label} onClick={onTap} style={style}>
      {children}
    </button>
  );
}
