/**
 * Unit H — the search-and-find home screen.
 *
 * A full-bleed illustration in which each child can find THEMSELVES, and tap themselves to
 * open their own day. The operator's idea, and it is a better piece of design than the information
 * board it alternates with, for a reason the board cannot fix: a child walks up to this one.
 *
 * ## Full bleed, and why the chrome left
 *
 * It shipped (2026-08-26) inside the wall's flex body, which meant it inherited the 24px wall
 * padding, sat under a 56px header AND a 56px "next up" ribbon, and resolved its own `inset: 0`
 * against the body row rather than the wall. Measured on the panel: the picture got 960x~370
 * of a 960x540 screen and was framed in sand on all four sides. Two bars stacked above a
 * letterboxed image is not a home screen, it is a document viewer.
 *
 * So the scene is now hoisted OUT of the body and drawn against the wall itself, and the wall
 * drops its padding underneath it. Everything that used to sit above it either left or floats:
 *
 *   - **The clock and the date left.** They are chrome for a screen that is doing something
 *     else; a picture is not doing something else. Both are in the calendar view, one tap away,
 *     which is where somebody asking "what day is it" is already going.
 *   - **The "next up" ribbon left.** It was the adversarial panel's addition (H9) on the
 *     argument that the scene must never be information-free — and the operator overruled it
 *     2026-08-27, on the ground that today's events are what the calendar view is FOR. The
 *     panel's concern is not wrong, it is answered somewhere else: this screen's job is to be
 *     the door, and the door does not need to recite the day through it.
 *   - **The two destination buttons float**, over the art, in the corner. See `WallApp`.
 *
 * What did NOT leave is the stale label. A wall showing yesterday's data must say so on
 * whatever screen it is on, and that rule predates every layout it has had.
 *
 * ## Still gated, and the gate still fails closed
 *
 * `idleMode` decides between this and the information board, and it shows the board unless it
 * can prove the clock is right, we are outside every routine window, and nothing is overdue.
 * See timeTrust.ts — the inversion is the whole design, and removing the ribbon does not touch
 * it. At 6:00 AM on a school day this screen is not up.
 *
 * ## Regions are AUTHORED, never detected
 *
 * The scene is a raster. Where each child stands in it is a fact about that drawing, so it is
 * written down beside the drawing in `assets/scenes/<id>.json` as fractional rectangles, and
 * scales with the image by construction. Keyed by SLOT rather than by child id — an id is a
 * real name and would put one in an asset filename.
 *
 * ## This component no longer fetches, and that is the point
 *
 * It is HANDED a scene that has already been proven to have at least one placeable region.
 * Choosing has to happen upstream because it is a choice between scenes, and only the caller
 * can see more than one of them.
 *
 * As of 2026-09-08 the caller is the SERVER: `WallSnapshot.scene` carries the chosen picture
 * and its regions, so there is no fetch here and no manifest list in the bundle. That moved
 * because the old arrangement — a committed array of ids, first one wins — put "put a new
 * picture up" behind a redeploy, which is why the weekly cadence never happened.
 *
 * It matters that this reads as a promotion rather than a refactor. The old comment here said
 * a missing manifest was fine because "the rail is still the way to a child's day" — and the
 * rail LEFT this screen when it went full bleed. On the picture the picture is the navigation,
 * so a scene with no doors is not degraded delight, it is a dead end that looks like a working
 * screen. The degradation that survives is one step further out: no usable scene means the
 * information board, decided before this component is rendered at all.
 */

import type { Child, WallScene } from '../../../../src/types.ts';
import { radius } from '../../design/tokens.ts';
import { slotForChild } from '../logic/sceneFace.ts';
import { useWall } from '../../app/wallContext.ts';
import { orderedChildren } from '../logic/summary.ts';
import { dogDoorOpen } from '../logic/dog.ts';

export function SceneView({
  scene,
  onSelect,
  onDog,
  children,
}: {
  /** Already chosen and already known usable.  See `pickScene`. */
  scene: WallScene;
  onSelect: (childId: string) => void;
  /**
   * The Easter egg.  The dog is hidden in every picture and the finder writes down where it
   * found him (`scene.dog`); when it did not, there is no door and nothing is drawn.  Same
   * invisible-button treatment as the children, for the same reason: finding him is the game.
   */
  onDog?: () => void;
  /** The floating chrome, drawn over the art by the wall.  The scene does not choose it. */
  children?: React.ReactNode;
}) {
  const { snapshot } = useWall();

  const children_ = orderedChildren(snapshot.children);
  const bySlot = new Map<number, Child>();
  for (const child of children_) bySlot.set(slotForChild(child.sortOrder, children_.length), child);

  return (
    <div
      // The picture, for the panel audit's "floating" rule: anything with words drawn inside this
      // box must stand on a plate of its own, never on the art.
      data-backdrop=""
      style={{
        position: 'absolute',
        inset: 0,
        // Already a root-relative, encoded URL: `activeScene` builds it, for the same reason
        // the old client helper did — a quote in a hand-edited manifest would close this
        // declaration early, and the damage does not look like damage.
        backgroundImage: `url("${scene.image}")`,
        // `cover`, and now it means what it says: the box is the whole 960x540 wall rather
        // than a short body row, so the crop is a sliver off one axis instead of a third of
        // the picture. Nothing is drawn over the art, so nothing is lost behind chrome.
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        overflow: 'hidden',
      }}
    >
      {scene.regions.map((region) => {
        const child = bySlot.get(region.slot);
        if (child === undefined) return null;
        return (
          <div
            key={`${region.slot}-${String(region.x)}`}
            role="button"
            data-scene-tap=""
            tabIndex={0}
            onPointerDown={() => {
              onSelect(child.id);
            }}
            style={{
              position: 'absolute',
              left: `${String(region.x * 100)}%`,
              top: `${String(region.y * 100)}%`,
              width: `${String(region.w * 100)}%`,
              height: `${String(region.h * 100)}%`,
              // Invisible on purpose. Outlining where each child is standing would answer the
              // question the picture is asking. Finding yourself IS the interaction.
              background: 'transparent',
              borderRadius: radius.lg,
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
          />
        );
      })}
      {dogDoorOpen(scene.dog, snapshot.dog) && scene.dog !== null && onDog !== undefined && (
        <div
          role="button"
          data-scene-tap=""
          aria-label="the dog"
          tabIndex={0}
          onPointerDown={onDog}
          style={{
            position: 'absolute',
            left: `${String(scene.dog.x * 100)}%`,
            top: `${String(scene.dog.y * 100)}%`,
            width: `${String(scene.dog.w * 100)}%`,
            height: `${String(scene.dog.h * 100)}%`,
            background: 'transparent',
            borderRadius: radius.lg,
            cursor: 'pointer',
            touchAction: 'manipulation',
          }}
        />
      )}
      {children}
    </div>
  );
}
