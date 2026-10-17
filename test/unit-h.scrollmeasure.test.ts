/**
 * Unit H — a scroll column speaks only when a measurement CHANGES.
 *
 * `ScrollColumn` measures after every render. On 2026-10-11 it handed every measurement to
 * React, and switching children on a throwaway wall ended in React #185 ("Maximum update depth
 * exceeded") with every number constant through the fifty renders before the throw: a
 * low-priority resize update was pending, React replayed the urgent ones from the hook's base,
 * and `was => same ? was : next` returned a fresh object on every replay. The column now asks
 * React for something only when the answer differs from what it last asked for, and these tests
 * drive that rule the way the column does — the same box, read again and again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  measureLatch,
  NO_EDGES,
  rowsHeightPx,
  scrollEdges,
  type ScrollBoxNumbers,
} from '../web/src/views/logic/scrollMeasure.ts';

const box = (scrollTop: number, clientHeight: number, scrollHeight: number): ScrollBoxNumbers => ({
  scrollTop,
  clientHeight,
  scrollHeight,
});

const FITS = box(0, 256, 256);
const OVERFLOWS = box(0, 256, 304);
const AT_THE_END = box(48, 256, 304);

test('the same box read fifty times after a change is news exactly once', () => {
  // The shape of the crash: a commit, a layout effect, the same numbers, again and again.
  const latch = measureLatch();
  const sink = () => {};
  let heights = 0;
  let edges = 0;
  for (let i = 0; i < 50; i++) {
    const news = latch.read(OVERFLOWS, 0, sink);
    if (news.heightPx !== null) heights++;
    if (news.edges !== null) edges++;
  }
  assert.equal(heights, 1);
  assert.equal(edges, 1);
});

test('a list that fits says nothing about its edges on the first read', () => {
  // The column's state starts at NO_EDGES, so a list that fits has nothing to set at mount.
  const news = measureLatch().read(FITS, 0, undefined);
  assert.equal(news.edges, null);
  assert.equal(news.heightPx, null);
});

test('each change of edges is said once, in order, and only the change', () => {
  const latch = measureLatch();
  assert.deepEqual(latch.read(OVERFLOWS, 0, undefined).edges, { above: false, below: true });
  assert.equal(latch.read(OVERFLOWS, 0, undefined).edges, null);
  assert.deepEqual(latch.read(AT_THE_END, 0, undefined).edges, { above: true, below: false });
  assert.equal(latch.read(AT_THE_END, 0, undefined).edges, null);
  assert.deepEqual(latch.read(FITS, 0, undefined).edges, NO_EDGES);
  assert.equal(latch.read(FITS, 0, undefined).edges, null);
});

test('the height is told on the first read, then only when it moves', () => {
  const latch = measureLatch();
  const sink = () => {};
  assert.equal(latch.read(OVERFLOWS, 0, sink).heightPx, 256);
  assert.equal(latch.read(OVERFLOWS, 0, sink).heightPx, null);
  // Scrolling moves the edges, not the box: the rows' height is not news.
  assert.equal(latch.read(AT_THE_END, 0, sink).heightPx, null);
  // A child whose band leaves a shorter pane: news.
  assert.equal(latch.read(box(0, 224, 304), 0, sink).heightPx, 224);
  assert.equal(latch.read(box(0, 224, 304), 0, sink).heightPx, null);
});

test('a new listener hears an unchanged height; no listener hears nothing', () => {
  const latch = measureLatch();
  const first = () => {};
  const second = () => {};
  assert.equal(latch.read(OVERFLOWS, 0, undefined).heightPx, null);
  assert.equal(latch.read(OVERFLOWS, 0, first).heightPx, 256);
  assert.equal(latch.read(OVERFLOWS, 0, second).heightPx, 256);
  assert.equal(latch.read(OVERFLOWS, 0, second).heightPx, null);
});

test('the rows get the box less its padding, and padding changes are news', () => {
  assert.equal(rowsHeightPx(box(0, 256, 256), 4), 248);
  const latch = measureLatch();
  const sink = () => {};
  assert.equal(latch.read(FITS, 4, sink).heightPx, 248);
  assert.equal(latch.read(FITS, 0, sink).heightPx, 256);
});

test('a pixel of slack each way: sub-pixel layout draws no cue', () => {
  assert.deepEqual(scrollEdges(box(0, 256, 257)), NO_EDGES);
  assert.deepEqual(scrollEdges(box(1, 256, 258)), NO_EDGES);
  assert.deepEqual(scrollEdges(box(2, 256, 300)), { above: true, below: true });
});

test('two columns keep two memories', () => {
  const a = measureLatch();
  const b = measureLatch();
  assert.notEqual(a.read(OVERFLOWS, 0, undefined).edges, null);
  assert.notEqual(b.read(OVERFLOWS, 0, undefined).edges, null);
});
