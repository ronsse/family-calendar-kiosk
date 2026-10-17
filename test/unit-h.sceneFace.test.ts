/**
 * Unit H — the rail's face, cropped out of the picture on the wall.
 *
 * The arithmetic is the whole test. `background-position: X%` aligns the X% point OF THE IMAGE
 * with the X% point of the box, so the divisor is `1 - w` and not 1 — a mistake that yields a
 * crop which is plausible, slightly off, and worse the smaller the box gets. On a 64px rail
 * face that reads as the finder producing bad boxes rather than as a division.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACE_PADDING, SCENE_ASPECT, cropStyle, sceneFace, slotForChild, squareOnScene } from '../web/src/views/logic/sceneFace.ts';
import type { WallScene } from '../src/types.ts';

const HEAD = { x: 0.2, y: 0.1, w: 0.1, h: 0.2 };

function scene(over: Partial<WallScene> = {}): WallScene {
  return {
    id: 's',
    image: '/scenes/s.jpg',
    dog: null,
    regions: [
      // Slots are `SLOTS = (1, 2, 0)` from the finder: child 3 is slot 0, not slot 3.
      { slot: 1, x: 0.1, y: 0.05, w: 0.2, h: 0.5, head: HEAD },
      { slot: 2, x: 0.4, y: 0.05, w: 0.2, h: 0.5, head: null },
      { slot: 0, x: 0.7, y: 0.05, w: 0.2, h: 0.5, head: HEAD },
    ],
    ...over,
  };
}

test('the box is scaled up by its own size and slid by the 1-minus-extent rule', () => {
  // A head a tenth of the width must blow the image up 10x; to show the slice starting a fifth
  // in, the image's 22.22% point sits at the box's left edge — 0.2 / (1 - 0.1).
  assert.deepEqual(cropStyle(HEAD), {
    backgroundSize: '1000% 500%',
    backgroundPosition: '22.22% 12.5%',
  });
});

test('the ends are the ends, and a full-width box does not divide by zero', () => {
  assert.equal(cropStyle({ x: 0, y: 0, w: 0.25, h: 0.25 }).backgroundPosition, '0% 0%');
  // A box flush against the right edge: 0.75 / (1 - 0.25) is exactly 1.
  assert.equal(cropStyle({ x: 0.75, y: 0.75, w: 0.25, h: 0.25 }).backgroundPosition, '100% 100%');
  assert.equal(cropStyle({ x: 0, y: 0.5, w: 1, h: 0.5 }).backgroundPosition, '0% 100%');
});

test('the crop is squared in PIXELS before it reaches a round frame', () => {
  // A letterbox head — wide and short, which is what the finder returned for the middle child
  // on campsite. The square must grow the HEIGHT to match the width in pixels, not the other
  // way round, and stay centred on the same face.
  const wide = squareOnScene({ x: 0.3, y: 0.4, w: 0.1, h: 0.05 });
  assert.equal(Math.round(wide.h * 1000) / 1000, Math.round(wide.w * SCENE_ASPECT * 1000) / 1000);
  // And it has slack in it, so a head box that is off-centre is still a centred face.
  assert.equal(Math.round(wide.h * 1000) / 1000, Math.round(0.1 * SCENE_ASPECT * FACE_PADDING * 1000) / 1000);
  assert.equal(Math.round((wide.x + wide.w / 2) * 1000) / 1000, 0.35, 'same centre');
  assert.equal(Math.round((wide.y + wide.h / 2) * 1000) / 1000, 0.425, 'same centre');
  // A tall head grows sideways instead.
  const tall = squareOnScene({ x: 0.3, y: 0.3, w: 0.02, h: 0.3 });
  assert.equal(Math.round(tall.h * 1000) / 1000, Math.round(0.3 * FACE_PADDING * 1000) / 1000);
  assert.ok(tall.w > 0.02);
  // Against an edge it slides in rather than distorting.
  const edge = squareOnScene({ x: 0, y: 0, w: 0.1, h: 0.02 });
  assert.equal(edge.x, 0);
  assert.equal(edge.y, 0);
});

test('a child with a head box gets the picture; everyone else keeps their cartoon', () => {
  assert.deepEqual(sceneFace(scene(), 1, 3), {
    image: '/scenes/s.jpg',
    head: squareOnScene(HEAD),
  });
  // Explicitly null (the finder looked and refused it) and absent (a manifest written before
  // head boxes existed) are the same answer: fall back, never guess.
  assert.equal(sceneFace(scene(), 2, 3), null);
  // The youngest is slot 0, and joining on the bare sortOrder lost him for one deploy.
  assert.deepEqual(sceneFace(scene(), 3, 3), {
    image: '/scenes/s.jpg',
    head: squareOnScene(HEAD),
  });
  // A household bigger than the picture: slot 4 is not in a three-region manifest, so that
  // child keeps her cartoon. (The join is a modulo, so with THREE children every sortOrder
  // lands on a real slot — the out-of-picture case needs a household the picture never drew.)
  assert.equal(sceneFace(scene(), 4, 5), null, 'a child the picture does not contain');
  assert.equal(sceneFace(null, 1, 3), null, 'no picture up at all');
});

test('a degenerate rectangle is refused rather than magnified into the circle', () => {
  const flat = scene({
    regions: [{ slot: 1, x: 0, y: 0, w: 0.2, h: 0.5, head: { x: 0.2, y: 0.1, w: 0, h: 0.2 } }],
  });
  assert.equal(sceneFace(flat, 1, 3), null);
});

test('the slot join wraps, and it is the only definition of that wrap', () => {
  assert.deepEqual([1, 2, 3].map((n) => slotForChild(n, 3)), [1, 2, 0]);
  assert.equal(slotForChild(1, 0), 0, 'no children is not a division by zero');
});
