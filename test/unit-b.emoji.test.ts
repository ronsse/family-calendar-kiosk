/**
 * Unit B — the event emoji.
 *
 * Asked for by the household for the two children who cannot read an event title. It is a
 * SECOND channel over the same matcher as the icon classifier, and finer, because an emoji
 * costs nothing to add — which is the entire constraint that keeps `sport` drawn as one ball.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEventTitle, emojiWords, eventEmoji } from '../src/calendar/classify.ts';

test('the three the household named each get their own, where the icon has one between them', () => {
  // The point of the second table: all three of these classify as `sport` or `dance` for the
  // drawn icon, and the drawn set deliberately does not split them.
  assert.equal(eventEmoji('Child A dance'), '💃');
  assert.equal(eventEmoji('Gymnastics practice'), '🤸');
  assert.equal(eventEmoji('Child B swim lesson'), '🏊');
  assert.equal(classifyEventTitle('Gymnastics practice'), 'sport');
  assert.equal(classifyEventTitle('Child B swim lesson'), 'sport');
});

test("the household's own event title is singular, and singular is what the calendar says", () => {
  // Found by running the table against the real calendar rather than against the examples:
  // the event is literally "Child A & Child B gymnastic". Whole-word matching means the plural
  // does not cover it, and the miss was silent — a title with no emoji looks exactly like a
  // title the table was never meant to know.
  assert.equal(eventEmoji('Child A & Child B gymnastic'), '🤸');
});

test('a title the table does not know draws NOTHING, never a guess', () => {
  // The readers this is for cannot check a wrong emoji against the words beside it.
  assert.equal(eventEmoji('Quarterly review'), null);
  assert.equal(eventEmoji(''), null);
  assert.equal(eventEmoji('   '), null);
});

test('the longest phrase wins, so a qualifier cannot be shadowed by its own noun', () => {
  assert.equal(eventEmoji('Swim lesson'), '🏊');
  assert.equal(eventEmoji('Field trip to the farm'), '🚌');
  // "trip" alone is a suitcase; "field trip" is a bus. If the shorter key won, every school
  // outing would be drawn as luggage.
  assert.equal(eventEmoji('Trip to Denver'), '🧳');
});

test('matching is on whole words, so a substring cannot fire', () => {
  // The classifier's own rule, and this table inherits the matcher rather than reimplementing
  // it. `ski` inside `skirt`, `park` inside `parking`.
  assert.equal(eventEmoji('New skirt shopping'), null);
  assert.equal(eventEmoji('Bandage change'), null);
});

test('a Map, not an object — `constructor` must not be a hit', () => {
  // The exact bug classify.ts records: a plain object inherits from Object.prototype, and
  // `constructor` is the one prototype key this tokeniser leaves intact.
  assert.equal(eventEmoji('constructor'), null);
  assert.equal(eventEmoji('toString'), null);
});

test('every entry is one emoji, lower case, and whole words', () => {
  for (const word of emojiWords()) {
    assert.equal(word, word.toLowerCase(), `${word} must be lower case`);
    assert.doesNotMatch(word, /[^a-z ]/, `${word} must be plain words`);
    assert.ok(word.trim().length > 0);
    const drawn = eventEmoji(word);
    assert.ok(drawn !== null, `${word} must resolve`);
    // One grapheme. Two emoji in a chip is a second thing to read, in the slot that exists
    // because the reader cannot read.
    assert.equal([...new Intl.Segmenter().segment(drawn)].length, 1, `${word} -> ${drawn}`);
  }
});

test('the table is not empty and covers what the wall actually shows', () => {
  assert.ok(emojiWords().length > 40);
});

test('a day OFF school must not draw a backpack', () => {
  // Found on the wall, not in this file: "No School" drew 🎒 because the word `school`
  // matched. The one symbol on the row said "school" on the day there is none, to the two
  // children who cannot read the words beside it.
  assert.equal(eventEmoji('No School'), '🏠');
  assert.equal(eventEmoji('Assessment Day by Appointment-No School'), '🏠');
  assert.equal(eventEmoji('Teacher Work Day'), '🏠');
  assert.equal(eventEmoji('Fall Break'), '🏠');
  assert.equal(eventEmoji('Winter Break'), '🏠');
  // ONE symbol for the whole family. A break and a teacher work day are different things to
  // an adult and the same thing to a five-year-old: you are at home.
  assert.equal(new Set(['No School', 'Fall Break', 'Teacher Work Day'].map(eventEmoji)).size, 1);
  // And a day she DOES attend still says school.
  assert.equal(eventEmoji('First day of school'), '🎒');
});

test('a four-word phrase can still win, because three was not enough', () => {
  // "LAST DAY OF SCHOOL" is four words. At a span of three no key could reach it and it fell
  // through to the bare `school` -> 🎒 — true, and saying nothing about the day.
  assert.equal(eventEmoji('LAST DAY OF SCHOOL'), '🎉');
});
