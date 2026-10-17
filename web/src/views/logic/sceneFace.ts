/**
 * The rail's face, cropped out of the picture that is on the wall.
 *
 * Asked for 2026-09-16: *"make the rail faces change with the picture, because that would allow
 * us to do more complicated things — have people far in the distance and be easy to find."*
 * That is exactly right, and it is the direction the whole scene mechanic was missing. A child
 * finds herself in the picture and taps herself; until now the reference she matched against was
 * a cartoon portrait that looks nothing like the figure in a photoreal or a pencil scene. Show
 * her the head she is actually wearing this week and the match becomes trivial — which is what
 * buys the picture permission to put her further away, smaller, or in a crowd.
 *
 * NO NEW ASSET AND NO NEW REQUEST. The scene image is already downloaded and already on the
 * glass; this is the same file, positioned. `head` comes from the finder in the same vision
 * call that locates the tap targets (`tools/scene-regions.py`), so a scene costs exactly what
 * it cost before.
 *
 * THE FALLBACK IS THE POINT. `head` is absent on every manifest written before this date, is
 * dropped by the finder's own validator when it looks like a body rather than a head, and is
 * dropped again here for any child the picture does not contain. Every one of those returns
 * null and the rail keeps her cartoon avatar. A wrong crop — another child's head, or a
 * full-length figure in a 64px circle — is worse than no crop at all, because the rail is how
 * a three-year-old reaches her own screen.
 */

import type { SceneBox, WallScene } from '../../../../src/types.ts';

/**
 * Where to put a background image so that `box` fills the element.
 *
 * The percentage-position formula is the non-obvious part and it is why this is a tested
 * function rather than four numbers inside a component. `background-position: X%` does NOT mean
 * "X% from the left of the image" — it aligns the X% point OF THE IMAGE with the X% point of
 * the box, so the divisor is `1 - w`, not 1. Getting that wrong yields a crop that is subtly
 * off-centre and drifts further the smaller the box gets, which on a 64px rail face reads as
 * "the finder's boxes are bad" rather than as an arithmetic error.
 *
 * A box that fills the whole width or height has no room to slide, and the formula divides by
 * zero; that lands on 0 rather than NaN.
 */
export function cropStyle(box: SceneBox): {
  readonly backgroundSize: string;
  readonly backgroundPosition: string;
} {
  const pct = (n: number) => `${String(Math.round(n * 10000) / 100)}%`;
  const slide = (start: number, extent: number) => (extent >= 1 ? 0 : start / (1 - extent));
  return {
    backgroundSize: `${pct(1 / box.w)} ${pct(1 / box.h)}`,
    backgroundPosition: `${pct(slide(box.x, box.w))} ${pct(slide(box.y, box.h))}`,
  };
}

/**
 * Scenes are 16:9 by contract — `gen-scene.py` draws nothing else, and the wall renders them
 * full-bleed at 960x540.  Needed here because the head box is in FRACTIONS of the image, and a
 * fraction is not a shape: 0.07 wide by 0.07 tall is a wide rectangle on a 16:9 picture.
 */
export const SCENE_ASPECT = 16 / 9;

/**
 * The smallest SQUARE (in pixels, not in fractions) that contains `box`, centred on it and
 * slid back inside the picture if it would hang over an edge.
 *
 * Without this the rail stretched the crop. `backgroundSize` sets the two axes independently,
 * so handing it a 131x76px head box and a round 64px frame fills the frame by scaling the
 * width and the height by different factors — the face comes out squashed, and the failure
 * looks like a bad box from the finder rather than a missing conversion. Measured on the panel
 * 2026-09-16: the middle child's head arrived as a letterbox and lost her chin.
 *
 * Clamped rather than shrunk at the edges: a head at the very top of the picture keeps its
 * proportions and simply includes a little more below it, which is what a portrait crop wants.
 */
/**
 * How much bigger than the head box the rail's crop is.
 *
 * The finder's head box is tight — hairline to chin — and a tight box has to be CENTRED well
 * or the face sits off to one side of a 64px circle, which is what the household saw on
 * 2026-09-16. The fix is not better centring, which would mean asking a vision model for more
 * precision than it reliably has; it is a crop with slack in it. At 1.7 the circle holds the
 * head and the shoulders, the face lands comfortably inside it, and a box that is off by a
 * tenth of its own width stops being visible at all.
 *
 * It also makes the rail read as a portrait rather than a cut-out, which is what the cartoon
 * avatars it sits beside look like.
 */
export const FACE_PADDING = 1.7;

export function squareOnScene(box: SceneBox): SceneBox {
  // Work in "height fractions" — multiply a width fraction by the aspect and the two axes are
  // comparable, because one unit means the same number of pixels on each.
  const side = Math.min(1, Math.max(box.h, box.w * SCENE_ASPECT) * FACE_PADDING);
  const w = Math.min(1, side / SCENE_ASPECT);
  const clamp = (start: number, extent: number) => Math.min(Math.max(start, 0), 1 - extent);
  return {
    x: clamp(box.x + box.w / 2 - w / 2, w),
    y: clamp(box.y + box.h / 2 - side / 2, side),
    w,
    h: side,
  };
}

/**
 * Which region in the manifest is this child's.
 *
 * `sortOrder` is 1-based and the finder writes slots `(1, 2, 0)` — `SLOTS` in
 * `tools/scene-regions.py` — so the join wraps. It lived inside `SceneView` as a bare
 * expression until 2026-09-16, when the rail needed the same answer, wrote `slot === sortOrder`
 * instead, and silently lost the THIRD child: two faces came from the picture and the youngest
 * kept his cartoon, which looks like the finder missing him rather than a join being wrong.
 * One definition, both callers.
 */
export function slotForChild(sortOrder: number, childCount: number): number {
  return sortOrder % Math.max(1, childCount);
}

export interface SceneFace {
  /** Root-relative, already encoded — it goes straight into a CSS `url("…")`. */
  readonly image: string;
  readonly head: SceneBox;
}

/**
 * This child's head in the picture on the wall, or null to keep her cartoon avatar.
 *
 * Joined through `slotForChild`, the same wrap the tap regions use, so the rail and the picture
 * can never disagree about who is who.
 */
export function sceneFace(
  scene: WallScene | null,
  sortOrder: number,
  childCount: number,
): SceneFace | null {
  if (scene === null) return null;
  const slot = slotForChild(sortOrder, childCount);
  const region = scene.regions.find((r) => r.slot === slot);
  const head = region?.head;
  if (head === undefined || head === null) return null;
  // A degenerate rectangle would divide the whole picture into the circle. Cheap to refuse.
  if (!(head.w > 0) || !(head.h > 0)) return null;
  return { image: scene.image, head: squareOnScene(head) };
}
