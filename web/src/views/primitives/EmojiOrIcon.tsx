/**
 * Unit H — an emoji where there is one, the drawn icon where there is not.
 *
 * ## Why both channels exist
 *
 * The house icons are a small, closed, hand-drawn set bound to `asset_fallback` categories —
 * eleven of them, deliberately, because each one has to be commissioned. That is what makes
 * them coherent, and it is also what makes them coarse: every countdown on this wall drew a
 * birthday cake, because three birthdays and "Winter holiday" all resolve to the one
 * `celebration` icon. The picture said nothing, which for the two children who cannot read the
 * label is the same as no picture at all.
 *
 * An emoji costs nothing to add, so it can be exactly as specific as the words allow. Where one
 * exists it is the better picture and it wins. Where one does not, the drawn icon is still
 * right and still there — this never degrades to nothing.
 *
 * ## Sized as an ICON, not as text
 *
 * It is handed the same `sizePx` the `AssetImage` would have taken, and set as a font size with
 * `lineHeight` from the token scale. An emoji left at the surrounding text size would be the
 * smallest thing on the card, in the slot that exists for the reader who has no other channel.
 *
 * `aria-hidden`, like every other glyph here: the label beside it is the accessible name, and a
 * screen reader announcing "party popper" over a child's birthday is noise.
 */

import type { CSSProperties } from 'react';
import type { AssetRef } from '../../../../src/types.ts';
import { cssTokens } from '../../design/tokens.ts';
import { AssetImage } from './AssetImage.tsx';
import { px } from './style.ts';

export function EmojiOrIcon({
  emoji,
  asset,
  sizePx,
  style,
}: {
  emoji: string | null | undefined;
  asset: AssetRef;
  sizePx: number;
  style?: CSSProperties;
}) {
  if (emoji === null || emoji === undefined || emoji.length === 0) {
    return style === undefined ? (
      <AssetImage asset={asset} sizePx={sizePx} />
    ) : (
      <AssetImage asset={asset} sizePx={sizePx} style={style} />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        fontSize: px(sizePx),
        lineHeight: cssTokens['--lh-tight'],
        flex: '0 0 auto',
        // A square box the size the icon would have been, so swapping channels cannot move
        // anything else on the card.
        width: px(sizePx),
        height: px(sizePx),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {emoji}
    </span>
  );
}
