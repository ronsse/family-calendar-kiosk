/**
 * The week's picture, showing through underneath every page.
 *
 * ## What changed, 2026-09-03, and what did not
 *
 * This was a 208px illustrated band along the bottom of the IDLE board and nowhere else. The
 * household asked for the opposite: *"the foreground picture, which is the default landing
 * area — that picture should be used underneath all of the other pages... used as a default
 * background for that week, and everything else overlaid on top of it."*
 *
 * So it is now the SAME scene the idle screen shows, full-bleed, behind every view. One
 * picture a week, one wall.
 *
 * **The old warning was not wrong and it is not ignored — it is answered.** The reasoning
 * against full-bleed art was: *"the panel is 225 nits behind anti-glare etched glass and is
 * read by a three-year-old from across a room. Full-bleed art under text is the single easiest
 * way to lose that, and no amount of scrim tuning makes it safe."* Two things make it safe
 * here, and neither is scrim tuning alone:
 *
 *   1. **Every card that can overlap it is already OPAQUE.** That was true when the band was
 *      written and is why the band could sit under the board at all. Text never meets the art;
 *      it meets a card, and the card meets the art.
 *   2. **Anything else stands on a plate.** A word or a glyph that is not on a card — a section
 *      door, a running head, the rail's house — gets an opaque plate in the theme's card
 *      language (views/logic/plate.ts). Rule 9 of `tools/panel-audit.mjs` ("floating") fails
 *      any that does not, and this element's `data-backdrop` is how it knows where the picture
 *      is.
 *
 * WHAT THE AUDIT CANNOT SEE, and this file used to claim it could: its contrast rule walks a
 * text's ANCESTORS for the colour behind it, and this picture is a SIBLING of the page. So it
 * graded words floating over the art against the wall root's plain ground, and passed them —
 * which is how three floating controls survived a full audit (2026-10-11). The scrim is
 * therefore a taste, not a contrast guarantee; the guarantee is point 2.
 *
 * The scene ALSO carries a warm veil, not just a pale one. A flat wash of the page's sand
 * would grey the illustration into mud; blending toward the ground the cards already sit on
 * keeps the palette coherent, which is the same reason the band's art was drawn on sand rather
 * than white.
 *
 * ## Degrading
 *
 * `image` is `null` whenever there is no usable scene — the pool is empty, a manifest is
 * malformed, the candidates have not loaded yet. Then this renders the plain ground and the
 * wall looks exactly as it did before any of this, which is the same fail-safe `pickScene`
 * gives the idle screen. A missing picture must never cost the board.
 */

import { colour, layoutPx } from '../design/tokens.ts';
import { backdropUrl } from '../views/logic/backdrop.ts';
import { px } from '../views/primitives/style.ts';

export interface WallBackdropProps {
  /**
   * The week's picture as a ROOT-RELATIVE, already-encoded URL — `/scenes/autumn-forest.jpg`.
   * That is exactly what `WallSnapshot.scene.image` carries. `null` renders plain ground.
   *
   * It used to be a bare `scenes/autumn-forest.jpg` and this component added the leading
   * slash. When scene selection moved to the server on 2026-09-08 the value gained its own
   * slash and the prefix stayed, so every page asked for `//scenes/…` — a PROTOCOL-RELATIVE
   * url, which the browser resolved to `http://scenes/autumn-forest.jpg` and tried to fetch
   * from a host called `scenes`. It failed silently, the way a background image always does:
   * no error, no broken-image icon, just a wall that looked exactly like the plain ground it
   * falls back to. `backdropUrl` exists so there is one place that answers this, and a test
   * that asserts a double slash can never be built again.  See views/logic/backdrop.ts.
   */
  image?: string | null | undefined;
}

/**
 * How much of the page's own ground is laid over the art.
 *
 * 0 is the raw illustration and 1 is the plain wall. This is a BACKGROUND — the picture gets to
 * be a picture on the idle screen, where nothing is laid over it — so the value is high; its
 * job here is to say which week it is, not to compete with a chore board.
 *
 * 0.86 -> 0.79 on 2026-09-03: *"that white filter could be maybe half again as transparent."*
 * 14% of the art through, then 21%.
 *
 * 0.79 -> 0.70 on 2026-09-09: *"let's make the glass a little more transparent."* Now 30%.
 * Worth recording what happened in between, because it makes this the first honest reading of
 * the setting: from 2026-09-08 until that morning the backdrop was not drawing AT ALL — a
 * double slash made its url protocol-relative and the image silently 404'd. So 0.79 was last
 * judged against a build that showed nothing, and this is the first value anybody has actually
 * seen.
 *
 * It is a TASTE, not a contrast figure: nothing that carries words is allowed to depend on it
 * (see the plates, above), so lowering it changes how much of the picture shows and nothing
 * about whether the wall can be read. The panel audit does not measure text through it — it
 * cannot see this element from a text's ancestors — so do not read a green audit as evidence
 * about this number.
 */
export const BACKDROP_SCRIM = 0.7;

export function WallBackdrop({ image }: WallBackdropProps = {}) {
  const common = {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    // Behind every pane, and non-interactive: a tap that lands on the sky must reach whatever
    // is underneath rather than being swallowed by decoration.
    pointerEvents: 'none',
  } as const;

  // Decoration, and announced as such: there is nothing here a screen reader needs, and the
  // wall's actual content is all in the DOM above it.
  if (image == null || image.length === 0) {
    return <div aria-hidden="true" data-backdrop="" style={{ ...common, background: colour.bg }} />;
  }

  return (
    <div aria-hidden="true" data-backdrop="" style={{ ...common, background: colour.bg }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url("${backdropUrl(image)}")`,
          // `cover`, unlike the old band. The source is a 16:9 scene against a 16:9 wall, so
          // there is nothing to crop and nothing to letterbox — the two agree by construction,
          // which is why gen-scene.py cuts to exactly 1920x1080.
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, background: colour.bg, opacity: BACKDROP_SCRIM }} />
    </div>
  );
}

/** Kept for the one place that still wants the old bottom-band geometry. */
export const BACKDROP_BAND_HEIGHT = layoutPx.backdropHeight;
