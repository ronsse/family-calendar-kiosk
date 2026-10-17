/**
 * Unit H acceptance, part 1: the properties that must hold across the SOURCE, not
 * just at runtime.
 *
 * H2 Q3 specified an ESLint rule banning `if (band ===` / `switch (band)` outside
 * the renderer provider — that is the mechanism that stops the three renderings
 * from silently drifting apart as features land.  No ESLint is installed in this
 * repo and this unit may not add one, so the same guarantee is implemented here.
 *
 * Every scanner in this file is checked against a SYNTHETIC violation first.  A
 * source scan that has quietly stopped matching anything is worse than no scan: it
 * reports green forever.  The picture-band scanners are also checked against the
 * emergent band, which really does contain the things the picture band may not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReadingBand } from '../src/types.ts';
import { RENDERER_NAMES } from '../web/src/views/contract.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCAN_DIRS = ['web/src/views', 'web/src/app'];
const ALL_BANDS: readonly ReadingBand[] = ['picture', 'emergent', 'fluent'];

// ---------------------------------------------------------------------------
// Reading the sources
// ---------------------------------------------------------------------------

interface SourceFile {
  rel: string;
  code: string;
}

/**
 * Comments are stripped before every scan.  The rules are about CODE: a doc
 * comment that has to explain why band branching is banned would otherwise trip
 * the ban it is documenting.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i] ?? '';
    const next = src[i + 1] ?? '';
    if (quote !== null) {
      out += c;
      if (c === '\\') {
        out += next;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function readSources(): SourceFile[] {
  const files: SourceFile[] = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    for (const entry of readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
        (entry as unknown as { path: string }).path;
      const full = path.join(parent, entry.name);
      files.push({ rel: path.relative(ROOT, full), code: stripComments(readFileSync(full, 'utf8')) });
    }
  }
  return files;
}

const SOURCES = readSources();

function read(rel: string): string {
  return stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
}

test('the scan actually found the view layer', () => {
  assert.ok(SOURCES.length >= 20, `expected the whole view layer, found ${String(SOURCES.length)} files`);
  for (const name of ['web/src/views/bands/picture.tsx', 'web/src/app/WallApp.tsx']) {
    assert.ok(
      SOURCES.some((f) => f.rel === name),
      `${name} must be in the scan set`,
    );
  }
});

// ---------------------------------------------------------------------------
// 1. The branch happens exactly once (H2 Q3)
// ---------------------------------------------------------------------------

const BRANCH_PATTERNS: readonly { re: RegExp; why: string }[] = [
  { re: /\bband\s*(===|!==)/, why: 'comparing a band' },
  { re: /switch\s*\(\s*\w*[Bb]and\s*\)/, why: 'switching on a band' },
  { re: /(===|!==)\s*['"](picture|emergent|fluent)['"]/, why: 'comparing against a band literal' },
  { re: /['"](picture|emergent|fluent)['"]\s*(===|!==)/, why: 'comparing against a band literal' },
];

function bandBranches(code: string): string[] {
  const hits: string[] = [];
  for (const line of code.split('\n')) {
    for (const { re, why } of BRANCH_PATTERNS) {
      if (re.test(line)) hits.push(`${why}: ${line.trim()}`);
    }
  }
  return hits;
}

test('the band-branch scanner catches a real violation (control)', () => {
  assert.ok(bandBranches(`if (band === 'picture') { render(); }`).length >= 1);
  assert.ok(bandBranches('switch (band) { case 1: }').length >= 1);
  assert.ok(bandBranches(`const x = readingBand !== 'fluent';`).length >= 1);
  assert.deepEqual(bandBranches('const t = bandTypography[band];'), [], 'a keyed lookup is not a branch');
});

test('no band branching anywhere outside the renderer provider', () => {
  const provider = 'web/src/views/bands/registry.tsx';
  for (const file of SOURCES) {
    if (file.rel === provider) continue;
    assert.deepEqual(bandBranches(file.code), [], `band branching in ${file.rel}`);
  }
});

test('the provider itself branches by LOOKUP, not by comparison', () => {
  // Stronger than the rule H2 asked for: even the one file allowed to branch does
  // not, so a fourth ReadingBand is a compile error in Record<ReadingBand, …>
  // rather than a case somebody forgot to add.
  const provider = read('web/src/views/bands/registry.tsx');
  assert.deepEqual(bandBranches(provider), []);
  assert.match(provider, /Record<ReadingBand, RendererSet>/);
});

// ---------------------------------------------------------------------------
// 2. The registry is exhaustive
// ---------------------------------------------------------------------------

/** The top-level keys of the object literal that follows `opener`. */
function objectKeys(code: string, opener: RegExp): string[] {
  const start = code.search(opener);
  assert.notEqual(start, -1, `could not find ${String(opener)}`);
  const from = code.indexOf('{', start);
  let depth = 0;
  let end = from;
  for (let i = from; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = code.slice(from, end);
  return [...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1] ?? '');
}

test('every band implements every renderer in BandRenderers', () => {
  const expected = [...RENDERER_NAMES].sort();
  assert.equal(expected.length, 7, 'the frozen contract has seven leaves');
  for (const band of ALL_BANDS) {
    const code = read(`web/src/views/bands/${band}.tsx`);
    const keys = objectKeys(code, new RegExp(`export const ${band}Renderers: RendererSet =`)).sort();
    assert.deepEqual(keys, expected, `${band} band is missing a renderer`);
  }
});

test('the registry maps every ReadingBand', () => {
  const code = read('web/src/views/bands/registry.tsx');
  const keys = objectKeys(code, /const REGISTRY = /).sort();
  assert.deepEqual(keys, [...ALL_BANDS].sort());
  assert.match(code, /satisfies BandRendererRegistry<AnyRenderer>/);
});

test('a crash falls back to the PICTURE band, and then to something inert', () => {
  const code = read('web/src/views/bands/registry.tsx');
  // Two nested boundaries: real leaf -> picture leaf -> inert block.
  assert.equal((code.match(/RendererErrorBoundary/g) ?? []).length >= 3, true);
  assert.match(code, /registry\[FALLBACK_BAND\]/);
  assert.match(code, /<InertBlock \/>/);
  const idle = read('web/src/views/logic/idle.ts');
  assert.match(idle, /FALLBACK_BAND: ReadingBand = BAND_ORDER\[0\]/);
});

// ---------------------------------------------------------------------------
// 3. Tokens only — no raw colours, no raw pixel values
// ---------------------------------------------------------------------------

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RAW_PX = /\b\d+(\.\d+)?px\b/;
/** Opacity, weight and line-height are design values too, and all three are tokens. */
const RAW_STYLE_NUMBER = /\b(opacity|lineHeight|fontWeight|letterSpacing|fontSize):\s*[0-9.]/;

function tokenViolations(code: string): string[] {
  const hits: string[] = [];
  for (const line of code.split('\n')) {
    if (HEX.test(line)) hits.push(`raw colour: ${line.trim()}`);
    if (RAW_PX.test(line)) hits.push(`raw px: ${line.trim()}`);
    if (RAW_STYLE_NUMBER.test(line)) hits.push(`raw style number: ${line.trim()}`);
  }
  return hits;
}

test('the token scanner catches a real violation (control)', () => {
  assert.equal(tokenViolations("  background: '#ff0000',").length, 1);
  assert.equal(tokenViolations("  fontSize: '18px',").length, 1);
  assert.equal(tokenViolations('  opacity: 0.9,').length, 1);
  assert.equal(tokenViolations('  lineHeight: 1.25,').length, 1);
  assert.equal(tokenViolations('  fontSize: px(fontSizePx.body),').length, 0);
  assert.equal(tokenViolations('  gap: px(spacePx.tapGap),').length, 0);
  assert.equal(tokenViolations('  opacity: treatment.opacity,').length, 0);
});

test('no renderer hardcodes a colour or a size — every value comes from unit G', () => {
  for (const file of SOURCES) {
    assert.deepEqual(tokenViolations(file.code), [], `hardcoded design value in ${file.rel}`);
  }
});

// ---------------------------------------------------------------------------
// 4. The picture band shows NO text
// ---------------------------------------------------------------------------

/** Fields that put words or numerals on the screen. */
const TEXT_FIELDS = [
  'labelShort',
  'labelFull',
  'title',
  'displayName',
  'points',
  'sleepsRemaining',
  'cashText',
  'streakDays',
  'timeText',
  'stateWordShort',
  'stateWordFull',
  'doneAtText',
  'targetDateText',
  'primaryTextPx',
  'secondaryTextPx',
  'numeralTextPx',
  'statusTextPx',
  // A fitted routine step's label size (logic/routineFit.ts) — null for this band, and the
  // picture leaf must not so much as read it.
  'labelPx',
];

/** Mechanisms that render text, regardless of which field they were handed. */
const TEXT_MECHANISMS = [/\bString\(/, /\btruncateWords\b/, /\bbandLabel\b/, /\bfirstName\b/, /\btext\(/];

function textReferences(code: string): string[] {
  const hits: string[] = [];
  for (const field of TEXT_FIELDS) {
    if (new RegExp(`\\b${field}\\b`).test(code)) hits.push(`field ${field}`);
  }
  for (const re of TEXT_MECHANISMS) {
    if (re.test(code)) hits.push(`mechanism ${String(re)}`);
  }
  return hits;
}

test('the no-text scanner catches a real violation (control)', () => {
  assert.ok(textReferences('const s = props.labelShort;').includes('field labelShort'));
  assert.ok(textReferences('<span>{String(points)}</span>').length >= 2);
  assert.deepEqual(textReferences('<AssetImage asset={icon} sizePx={TYPO.primaryIconPx} />'), []);
});

test('the picture band references no text-bearing field and no text mechanism', () => {
  const picture = read('web/src/views/bands/picture.tsx');
  assert.deepEqual(
    textReferences(picture),
    [],
    'a three-year-old who sees a word has been failed by the design',
  );
});

test('the scanner is not vacuous: the reading bands DO reference those fields', () => {
  const emergent = textReferences(read('web/src/views/bands/emergent.tsx'));
  const fluent = textReferences(read('web/src/views/bands/fluent.tsx'));
  // The emergent band reads labelFull from 2026-09-09 — see bandTypography.emergent. What has
  // NOT changed is that its words go through the cap: the point was never that she gets less
  // text, it was that she gets a real instruction rather than a stub of one.
  assert.ok(emergent.includes('field labelFull'), 'the emergent band reads labelFull');
  assert.ok(fluent.includes('field labelFull'), 'the fluent band reads labelFull');
  const picture = textReferences(read('web/src/views/bands/picture.tsx'));
  assert.ok(!picture.includes('field labelFull'), 'the picture band reads no words at all');
  assert.ok(!picture.includes('field labelShort'), 'and not the short ones either');
});

test('the picture band imports nothing that formats words', () => {
  const picture = read('web/src/views/bands/picture.tsx');
  assert.ok(!/from '\.\.\/logic\/labels\.ts'/.test(picture));
  assert.ok(!/from '\.\.\/logic\/words\.ts'/.test(picture));
  // It may still import style helpers, but not the typography one.
  assert.ok(!/\btext\b\s*(,|\})/.test(picture.split('\n').filter((l) => l.includes("primitives/style.ts")).join('\n')));
});

// ---------------------------------------------------------------------------
// 4b. The physical floors: tap targets, type size, and images that fail to load
// ---------------------------------------------------------------------------

test('every tap target is sized from the band, never from a number somebody picked', () => {
  // 64 logical px is the floor and the bands only go up from there.  A literal
  // here would be a target sized for an adult finger on a laptop.
  //
  // `navTapPx` joined `minTapPx` on 2026-08-25: the child bar is navigation rather than
  // content and needs its own floor, because at card sizes it took 177 of the wall's 540
  // vertical px and clipped the day underneath. Both are band tokens, which is what this
  // test is actually protecting — the rule is "from the scale", not "from one entry in it".
  const FROM_THE_BAND = new Set(['TYPO.minTapPx', 'TYPO.navTapPx']);
  for (const band of ALL_BANDS) {
    const code = read(`web/src/views/bands/${band}.tsx`);
    const calls = [...code.matchAll(/tapTarget\(([^,)]*)/g)].map((m) => (m[1] ?? '').trim());
    assert.ok(calls.length > 0, `${band} band has no tap targets at all`);
    for (const arg of calls) {
      assert.ok(FROM_THE_BAND.has(arg), `${band} band sized a tap target as ${arg}`);
    }
    assert.ok(
      calls.includes('TYPO.navTapPx'),
      `${band} band must size its child-bar avatar from navTapPx`,
    );
  }
});

test('no type size is a literal — every one comes from the scale', () => {
  for (const file of SOURCES) {
    assert.ok(!/\btext\(\s*\d/.test(file.code), `${file.rel} sets a font size by hand`);
  }
});

test('an image that fails to load draws a shape, and never alt text', () => {
  // AssetRef.url is non-empty by contract — that covers RESOLUTION, not LOADING.
  // Chromium renders alt text in place of a broken image, and a word on the
  // three-year-old's wall is the failure this project defines as a failure.
  const img = read('web/src/views/primitives/AssetImage.tsx');
  assert.match(img, /onError=/);
  assert.match(img, /alt=""/);
  assert.ok(!/alt="[^"]+"/.test(img), 'alt text must stay empty');
  assert.match(img, /src\.length === 0/, 'an empty url is handled without waiting for onError');
});

// ---------------------------------------------------------------------------
// 5. Time-box state is never taken from the server
// ---------------------------------------------------------------------------

test('nothing in the view layer reads a server-side locked/open flag', () => {
  for (const file of SOURCES) {
    assert.ok(!/\blocked\b/.test(file.code), `${file.rel} refers to a locked flag`);
    assert.ok(
      !/\.isOpen\b/.test(file.code),
      `${file.rel} reads an open flag instead of computing the box from the clock`,
    );
  }
  const timebox = read('web/src/views/logic/timebox.ts');
  assert.match(timebox, /blocksInteraction: false/);
});

test('no local date is ever derived from toISOString()', () => {
  for (const file of SOURCES) {
    assert.ok(
      !/toISOString\(\)\s*\.slice/.test(file.code),
      `${file.rel} slices an ISO string — that is the UTC date, and it rolls over at dinner`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. Selection state never leaves memory
// ---------------------------------------------------------------------------

test('activeChild and band are never persisted', () => {
  for (const file of SOURCES) {
    assert.ok(!/localStorage/.test(file.code), `${file.rel} touches localStorage`);
    assert.ok(!/sessionStorage/.test(file.code), `${file.rel} touches sessionStorage`);
    assert.ok(!/document\.cookie/.test(file.code), `${file.rel} touches cookies`);
  }
});
