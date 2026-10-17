/**
 * Unit B — what an event is about, and the far more important question of when to say nothing.
 *
 * Almost every test here is about a WRONG answer rather than a missing one. The classifier's
 * output is a picture drawn beside an event title on a wall two of the three children cannot
 * read, so they have no way to notice that the picture disagrees with the words. A generic
 * calendar page says "an event"; a birthday cake on a dentist appointment says something
 * false, confidently, to the reader least able to catch it.
 *
 * So the bar is not coverage. Measured against the household's own promoted generation on
 * 2026-08-27 this table classified 22 of 47 events, and of the 25 it declined, 24 contained
 * none of ~70 candidate generic words — the tail is names and places, not missing vocabulary.
 * That measurement is what stopped the table growing, and it is why the tests below spend
 * their effort on the boundary rather than on the hit rate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classifierWords,
  classifyEventTitle,
  EVENT_CATEGORIES,
  words,
} from '../src/calendar/classify.ts';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { fallbackCategories } from '../src/db/repo.ts';
import { listPromotedEvents, openSyncRun, stageAndPromote } from '../src/calendar/sync.ts';
import type { FetchedEvent } from '../src/calendar/CalendarSource.ts';
import type { LocalDate } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Word boundaries — the whole reason this is not a substring search
// ---------------------------------------------------------------------------

test('a keyword inside a longer word does NOT fire', () => {
  // Every one of these is a real word containing a real vocabulary entry. A naive
  // `title.includes(word)` classifier gets all six wrong, and gets them wrong in the
  // confident direction: a music note beside "Bandage supplies" is not a near miss.
  const traps: [string, string][] = [
    ['Bandages restock', 'band'],
    ['Skills assessment', 'ski'],
    ['Sparkle craft night', 'park'],
    ['Fairy costume fitting', 'fair'],
    ['Striped shirt day', 'trip'],
    ['Tracking the delivery', 'track'],
  ];
  for (const [title, trapped] of traps) {
    assert.ok(classifierWords().includes(trapped), `${trapped} must still be in the table`);
    assert.equal(classifyEventTitle(title), null, `${title} must not match "${trapped}"`);
  }
});

test('punctuation, case and joiners are all word boundaries', () => {
  for (const title of ['SOCCER', 'soccer@6', 'Soccer-practice', 'Soccer (away)', '  soccer  ']) {
    assert.equal(classifyEventTitle(title), 'sport', title);
  }
});

test('the tokeniser drops everything that is not a letter or digit', () => {
  assert.deepEqual(words("Dad's swim-meet #2 @ 6:30"), ['dad', 's', 'swim', 'meet', '2', '6', '30']);
  assert.deepEqual(words('   '), []);
  assert.deepEqual(words(''), []);
});

// ---------------------------------------------------------------------------
// Which rule wins
// ---------------------------------------------------------------------------

test('the longest phrase at a position beats a shorter one inside it', () => {
  // Without this, "field trip" is travel and "play date" is whatever `play` means. Both are
  // school-newsletter phrases where the pair means something the halves do not.
  assert.equal(classifyEventTitle('Field trip'), 'school');
  assert.equal(classifyEventTitle('Trip to the coast'), 'travel');
  assert.equal(classifyEventTitle('Play date at the park'), 'outing');
});

test('the earliest matching word in the title wins', () => {
  // "Birthday dinner" is a birthday. The rule is title order rather than a priority table,
  // because a priority table is a second thing that has to stay true — and it happens to
  // match how people write these: the reason for the entry goes first, the logistics after.
  assert.equal(classifyEventTitle('Birthday dinner'), 'celebration');
  assert.equal(classifyEventTitle('School swim gala'), 'school');
  // And the honest converse, recorded rather than hidden: reverse the words and the answer
  // reverses too. "Dinner for a birthday" is read as a meal. That is a real limitation of an
  // order rule and it is accepted, because the alternative failure — a ranking table that
  // disagrees with the words on screen — is invisible instead of merely wrong.
  assert.equal(classifyEventTitle('Dinner for her birthday'), 'kitchen');
});

// ---------------------------------------------------------------------------
// Declining is the common answer and must stay cheap
// ---------------------------------------------------------------------------

test('dance is NOT sport — the defect the panel found and the probe could not', () => {
  // `sport` shipped with a soccer ball, and every one of the household's 18 sport events was
  // dance. The offline probe reported the CATEGORY and so reported success; the panel showed
  // a soccer ball where a dance class was, on the pre-reader's screen, which draws the icon
  // and no title at all. Splitting the category is what fixed it.
  assert.equal(classifyEventTitle('Dance'), 'dance');
  assert.equal(classifyEventTitle('Ballet class'), 'dance');
  // And the split stops there. A ball is about as close to a universal sport pictogram as an
  // object gets, so swimming drawn as a ball is a loose fit rather than a wrong one — dance
  // earned its own category by being the entirety of the other one, not by being unlike it.
  assert.equal(classifyEventTitle('Gymnastics'), 'sport');
  assert.equal(classifyEventTitle('Swim'), 'sport');
});

test('an unclassifiable title returns null rather than a guess', () => {
  for (const title of ['', 'Sam', 'Out of office', 'TBD', '???', 'Working Location']) {
    assert.equal(classifyEventTitle(title), null, title);
  }
});

test('a title made of a prototype key classifies as null, not as Object', () => {
  // Found in review. With a plain object as the table, `WORDS['constructor']` is a FUNCTION
  // rather than undefined, so "Constructor meeting" returned `Object` — a value that is not an
  // EventCategory at all, from a function typed as returning one. `constructor` is the only
  // prototype key that survives the tokeniser: `toString` and `hasOwnProperty` are lowercased
  // into nothing, `__proto__` loses its underscores. A Map has no inherited keys.
  for (const title of ['constructor', 'Constructor meeting', 'toString', '__proto__', 'valueOf']) {
    assert.equal(classifyEventTitle(title), null, title);
  }
});

test('the words this table deliberately does NOT know are still unknown', () => {
  // Each of these was considered and rejected as ambiguous; the reasoning is in the module
  // header. This test exists so that re-adding one is a deliberate act with a failing test
  // attached, rather than a plausible-looking one-line commit.
  for (const word of ['class', 'practice', 'party', 'game', 'match', 'pickup', 'meeting']) {
    assert.ok(!classifierWords().includes(word), `"${word}" was rejected on purpose`);
    assert.equal(classifyEventTitle(`The ${word}`), null, `"${word}" must not classify alone`);
  }
});

// ---------------------------------------------------------------------------
// The vocabulary holds itself to its own rules
// ---------------------------------------------------------------------------

test('every word maps to a declared category, and every category has a word', () => {
  const declared = new Set<string>(EVENT_CATEGORIES);
  const reached = new Set<string>();
  for (const word of classifierWords()) {
    const category = classifyEventTitle(word);
    assert.ok(category !== null, `"${word}" is in the table but classifies as null`);
    assert.ok(declared.has(category), `"${word}" maps to undeclared category "${category}"`);
    reached.add(category);
  }
  // A category no word reaches is dead vocabulary — the same shape as the `stepTileMinPx`
  // token that was defined per band and referenced nowhere.
  assert.deepEqual([...declared].filter((c) => !reached.has(c)), []);
});

test('every word is lowercase and survives its own tokeniser', () => {
  for (const word of classifierWords()) {
    assert.equal(word, word.toLowerCase(), word);
    // A key the tokeniser would never produce can never match anything. Phrases are joined
    // with single spaces, which is exactly what `words().join(' ')` yields.
    assert.equal(words(word).join(' '), word, `"${word}" is unreachable from any title`);
  }
});

// ---------------------------------------------------------------------------
// End to end, through the guard that lets vocabulary ship ahead of art
// ---------------------------------------------------------------------------

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'classify-'));
  const db = openDatabase({ path: join(dir, 'wall.db') });
  migrate(db);
  seedDev(db);
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function allDay(uid: string, title: string): FetchedEvent {
  return {
    externalUid: uid,
    title,
    when: { kind: 'allDay', startDate: '2026-03-02' as LocalDate, endDate: '2026-03-03' as LocalDate },
  };
}

test('a classified event gets the category icon; an unclassified one keeps the calendar page', () => {
  const { db, cleanup } = freshDb();
  try {
    const run = openSyncRun(db, 'cs-family');
    stageAndPromote(db, 'cs-family', run, [
      allDay('u-school', 'School photos'),
      allDay('u-cake', 'Birthday'),
      allDay('u-plain', 'Sam'),
    ]);
    const byUid = new Map(
      listPromotedEvents(db, { sourceId: 'cs-family' }).map((e) => [e.title, e.icon]),
    );
    assert.equal(byUid.get('School photos')?.assetId, 'ico-bag');
    assert.equal(byUid.get('Birthday')?.assetId, 'ico-cake');
    assert.equal(byUid.get('Sam')?.assetId, 'ico-cal');
  } finally {
    cleanup();
  }
});

test('a category with NO art keeps the calendar page and never falls to the question mark', () => {
  // This is the property that lets the vocabulary name a category before anybody has drawn
  // it. `sport` is the household's largest category — 18 of 47 events — and the dev seed has
  // no sport icon, so without the `fallbackCategories` guard in `sync.ts` these events would
  // walk the chain past `calendar` and land on `ico-fallback`: a downgrade, shipped as a
  // feature, on more than a third of the wall's events.
  const { db, cleanup } = freshDb();
  try {
    assert.ok(!fallbackCategories(db).has('sport'), 'the dev seed must not illustrate sport');
    const run = openSyncRun(db, 'cs-family');
    stageAndPromote(db, 'cs-family', run, [allDay('u-sport', 'Soccer')]);
    const [event] = listPromotedEvents(db, { sourceId: 'cs-family' });
    assert.equal(classifyEventTitle('Soccer'), 'sport', 'the classifier still names the gap');
    assert.equal(event?.icon.assetId, 'ico-cal', 'but the picture stays the calendar page');
  } finally {
    cleanup();
  }
});

test("an upstream-supplied category still wins over the title", () => {
  // `FetchedEvent.category` is documented as the upstream's own. No source we have supplies
  // one, which is why this module exists — but the day one does, it must not be second-guessed.
  const { db, cleanup } = freshDb();
  try {
    const run = openSyncRun(db, 'cs-family');
    stageAndPromote(db, 'cs-family', run, [{ ...allDay('u-x', 'Birthday'), category: 'hygiene' }]);
    const [event] = listPromotedEvents(db, { sourceId: 'cs-family' });
    assert.equal(event?.icon.assetId, 'ico-teeth');
  } finally {
    cleanup();
  }
});
