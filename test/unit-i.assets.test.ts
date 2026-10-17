/**
 * Unit I — the baseline art set holds its own shape.
 *
 * Every icon on this wall is generated (ADR-0002) and then post-processed, and both halves
 * fail quietly. The manifest can name a file nobody shipped; a generated PNG can arrive with
 * its ground still baked in. Neither breaks a build, a type check or a route — the wall comes
 * up, the icon renders, and it renders a white square on a tinted chore row.
 *
 * For the pre-reader the icon IS the interface: `PictureEventCard` draws an icon and a clock
 * face and NO title. So an icon that is subtly wrong is not a cosmetic defect on her screen,
 * it is the whole content of the row.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { EVENT_CATEGORIES } from '../src/calendar/classify.ts';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'assets/manifest.json'), 'utf8')) as {
  assets: { id: string; kind: string; category: string; rel_path: string; fallbackFor?: string }[];
};

interface Png {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  idat: Buffer;
}

/** Just enough PNG to answer the two questions that matter. Non-interlaced, 8-bit. */
function readPng(path: string): Png {
  const d = readFileSync(path);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat: Buffer[] = [];
  let i = 8; // past the signature
  while (i < d.length) {
    const len = d.readUInt32BE(i);
    const type = d.toString('ascii', i + 4, i + 8);
    const body = d.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8] ?? 0;
      colourType = body[9] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    i += 12 + len;
  }
  return { width, height, bitDepth, colourType, idat: Buffer.concat(idat) };
}

/**
 * The alpha bytes of the TOP scanline.
 *
 * One row is all this needs and it keeps the decoder honest: row 0's filter may reference the
 * row above (defined as zeros) and pixels to its left, so unfiltering it needs no loop over
 * the image. An icon whose ground was never cut fails here on the first pixel.
 */
function topRowAlpha(png: Png): number[] {
  const stride = png.width * 4;
  const raw = inflateSync(png.idat).subarray(0, stride + 1);
  const filter = raw[0];
  const row = Buffer.from(raw.subarray(1));
  // 0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth — with a zero row above, 2 is a no-op, and 3 and
  // 4 both collapse to Sub. Anything else is a PNG this reader was not written for.
  assert.ok(filter !== undefined && filter <= 4, 'unknown PNG filter type');
  if (filter === 1 || filter === 3 || filter === 4) {
    for (let x = 4; x < row.length; x += 1) {
      const left = row[x - 4] ?? 0;
      const here = row[x] ?? 0;
      row[x] = (here + (filter === 3 ? left >> 1 : left)) & 0xff;
    }
  }
  const alpha: number[] = [];
  for (let x = 3; x < row.length; x += 4) alpha.push(row[x] ?? 0);
  return alpha;
}

const icons = manifest.assets.filter((a) => a.kind === 'icon');

test('every asset the manifest declares is actually on disk', () => {
  // `registerBaselineAssets` skips a declared asset whose file is absent, silently — that is
  // deliberate (validated_at_utc must mean "this renders"), and it is why a typo in a
  // rel_path produces no error anywhere, just a category that quietly has no art.
  for (const a of manifest.assets) {
    assert.ok(existsSync(resolve(ROOT, 'assets', a.rel_path)), `missing ${a.rel_path}`);
  }
});

test('every icon is a 256x256 RGBA png with its ground cut away', () => {
  for (const icon of icons) {
    const png = readPng(resolve(ROOT, 'assets', icon.rel_path));
    assert.equal(png.width, 256, `${icon.rel_path} width`);
    assert.equal(png.height, 256, `${icon.rel_path} height`);
    assert.equal(png.bitDepth, 8, `${icon.rel_path} bit depth`);
    assert.equal(png.colourType, 6, `${icon.rel_path} must be RGBA — 6, not 2`);
    const alpha = topRowAlpha(png);
    assert.equal(alpha.length, 256, `${icon.rel_path} scanline`);
    const opaque = alpha.filter((a) => a !== 0).length;
    assert.equal(opaque, 0, `${icon.rel_path} has ${opaque} opaque px in its top row`);
  }
});

test('a fallback category is claimed by exactly one icon', () => {
  // Two icons claiming one category is not an error the schema catches — `INSERT ... ON
  // CONFLICT DO NOTHING` means whichever the manifest lists first wins, permanently and
  // invisibly, and the other icon is simply never drawn.
  const claimed = new Map<string, string>();
  for (const a of manifest.assets) {
    if (a.fallbackFor === undefined) continue;
    const already = claimed.get(a.fallbackFor);
    assert.equal(already, undefined, `${a.fallbackFor} claimed by both ${already} and ${a.id}`);
    claimed.set(a.fallbackFor, a.id);
  }
  assert.ok(claimed.has('_default'), 'the _default fallback is what makes resolveAsset total');
});

test('every event category the classifier can emit has art', () => {
  // Not a hard requirement of the design — `sync.ts` keeps the calendar page for any category
  // without art, precisely so vocabulary can ship ahead of illustration. But an unillustrated
  // category is INVISIBLE: the events classify correctly and draw the same glyph as everything
  // else, so nothing on the wall or in a log says the art is missing. This test is the thing
  // that says it. If a category is deliberately left undrawn, delete it from here with the
  // reason — do not let it rot silently.
  const illustrated = new Set(manifest.assets.map((a) => a.fallbackFor));
  const undrawn = EVENT_CATEGORIES.filter((c) => !illustrated.has(c));
  assert.deepEqual(undrawn, [], `event categories with no icon: ${undrawn.join(', ')}`);
});
