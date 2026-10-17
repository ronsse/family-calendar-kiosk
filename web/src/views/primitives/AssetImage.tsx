/**
 * Unit H — an image that cannot leave a hole.
 *
 * `AssetRef.url` is non-empty by contract: the fallback chain is walked at
 * snapshot time, so the render path can never miss (types.ts, H2 gap #1).  That
 * contract covers RESOLUTION.  It does not cover LOADING — the file can 404 after
 * a redeploy, the disk can be full, Chromium can evict a cache entry at 05:58.
 * For the pre-reader a missing picture is a blank screen, so this component always
 * draws something.
 *
 * `alt` is empty ON PURPOSE.  Chromium renders alt text in place of a broken
 * image, and a word appearing on the three-year-old's wall is exactly the failure
 * this project defines as a failure.  The replacement is a SHAPE.
 */

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AssetRef, SceneBox } from '../../../../src/types.ts';
import type { ChildAccent } from '../../design/tokens.ts';
import { colour, radius, strokePx } from '../../design/tokens.ts';
import { Glyph } from './Glyph.tsx';
import { cropStyle } from '../logic/sceneFace.ts';
import { px } from './style.ts';

interface AssetImageProps {
  asset: AssetRef;
  sizePx: number;
  style?: CSSProperties;
  /**
   * Show only this rectangle of the image, filling the box (2026-09-16, for the rail's
   * picture-faces).  `asset.url` is then a whole SCENE and the crop is one child's head in it;
   * see `logic/sceneFace.ts` for the arithmetic and for why a missing crop falls all the way
   * back to a cartoon avatar rather than guessing.
   *
   * This path has no `onError`: a background image cannot report a 404.  That is acceptable
   * only because the one thing ever cropped here is the picture already filling the wall
   * behind it — if it is missing, the rail's 64px circle is not the symptom anybody sees.
   */
  crop?: SceneBox | null | undefined;
}

export function AssetImage({ asset, sizePx, style, crop }: AssetImageProps) {
  // The URL that failed, not a boolean: a new snapshot with a new URL must get a
  // fresh attempt.  A latched `broken` flag would keep an icon dark for the months
  // this kiosk runs between reloads, long after the file came back.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const src = typeof asset?.url === 'string' ? asset.url : '';
  const broken = brokenUrl === src;
  const box: CSSProperties = {
    width: px(sizePx),
    height: px(sizePx),
    // Never larger than whatever is holding it. `sizePx` is a REQUEST, and a bordered parent's
    // content box may be smaller — the difference being the picture's own edges cut off. See
    // the note in `AccentFrame`: a 64px portrait inside a 64px ringed circle lost 3px on every
    // side, and 6px when the rail was pointing at that child. The inner <img> is
    // `object-fit: contain`, so a smaller box scales the picture rather than cropping it more.
    maxWidth: '100%',
    maxHeight: '100%',
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...style,
  };

  if (src.length === 0 || broken) {
    return (
      <span style={{ ...box, background: colour.surfaceSunken, borderRadius: radius.md }}>
        <Glyph name="unknown" sizePx={sizePx} tone={colour.borderStrong} />
      </span>
    );
  }

  if (crop != null) {
    return (
      <span
        style={{
          ...box,
          backgroundImage: `url("${src}")`,
          backgroundRepeat: 'no-repeat',
          ...cropStyle(crop),
          // The FRAME's corner, whatever it is: a circle in a round frame, and a square
          // portrait in gallery's square one rather than a circle sitting inside it.
          borderRadius: 'inherit',
        }}
      />
    );
  }

  return (
    <span style={box}>
      <img
        src={src}
        alt=""
        draggable={false}
        onError={() => setBrokenUrl(src)}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    </span>
  );
}

/**
 * The identity frame.  Unit G hands every child FOUR redundant channels; this
 * component carries two of them — the accent and the SHAPE — and the caller places
 * it in the child's fixed column, which is the third.  The avatar asset inside is
 * the fourth.  Colour alone never says whose card this is.
 */
export function AccentFrame({
  accent,
  sizePx,
  selected,
  shape,
  children,
}: {
  accent: ChildAccent;
  sizePx: number;
  selected: boolean;
  /** Round unless the theme hangs its portraits in square frames (gallery). */
  shape?: 'round' | 'square' | undefined;
  children: ReactNode;
}) {
  const base: CSSProperties = {
    width: px(sizePx),
    height: px(sizePx),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colour.surface,
    borderStyle: 'solid',
    borderColor: accent.solid,
    borderWidth: px(selected ? strokePx.focus : strokePx.medium),
    boxSizing: 'border-box',
    flex: '0 0 auto',
    overflow: 'hidden',
    // The ring eats into `sizePx`, so anything sized `sizePx` inside it is bigger than the
    // circle masking it and gets its edges trimmed. `tools/panel-audit.mjs` measured that on
    // the glass: a 64px frame has a 58px content box and held a 64px portrait, and a SELECTED
    // one has 52 and held the same 64 — so a child's face was cropped hardest exactly when
    // the rail was pointing at her. The avatars are deliberately cropped to their own accent
    // circle at generation time so the framing is identical by construction
    // (tools/backgrounds.md); trimming 3-6px off each edge at render undoes that.
    //
    // Padding rather than a computed inner size: `padding-box` is what `100%` on a child
    // resolves against, so the child shrinks to fit whatever ring this frame happens to have
    // and there is no second place holding the border width.
  };
  // ONE SHAPE FOR ALL THREE CHILDREN, since 2026-08-26: a circle, or — since 2026-10 — the
  // gallery theme's square frame, which is equally the same for every child. `accent.shape`
  // gave each child a different outline — circle, rounded square, shield — as a non-colour
  // identity channel, back when the avatars were three interchangeable geometric placeholders
  // and the frame was doing that work alone.
  //
  // The avatars are portraits now: three distinct faces, three hairstyles, three eye colours.
  // That is a far stronger channel than a polygon, and it makes the polygon's cost visible —
  // three different outlines in one rail read as three unrelated components rather than one
  // switcher. Identity is still carried without colour, by the portrait and by the fixed
  // position, which is what the rule in Unit G actually requires.
  base.borderRadius = shape === 'square' ? radius.sm : '50%';
  return <span style={base}>{children}</span>;
}
