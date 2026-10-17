/**
 * Unit B — what an event is ABOUT, derived from its title.
 *
 * Every event on the wall drew the same page-a-day glyph, because `FetchedEvent.category` is
 * documented as the *upstream's* category and no upstream we have supplies one. Google's API
 * has no such field, and Home Assistant's `calendar.*` state carries summary, start and end
 * and nothing else. So the icon column on a four-day agenda carried exactly zero bits: 48
 * rows, 48 identical icons, which for the two children who cannot read the title is the same
 * as no icon at all.
 *
 * This module is the missing signal. It is deliberately the dumbest thing that works — a
 * frozen vocabulary and a word-boundary lookup — for three reasons:
 *
 *  1. **It runs at sync time, never at render time.** `sync.ts` resolves an icon once per
 *     event per generation and stores the id. The wall renders from local state (ADR-0004)
 *     and must not depend on a classifier being up, fast, or even installed.
 *  2. **It is pure and total.** No I/O, no model, no clock. A title in, a category or `null`
 *     out. That is what makes it testable, and what makes the wrong answer a one-line fix in
 *     a table rather than a prompt to re-tune.
 *  3. **High precision, low recall — on purpose.** A generic calendar page on a swimming
 *     lesson is uninformative. A birthday cake on a dentist appointment is *confidently
 *     wrong*, and this wall treats confidently wrong as strictly worse than silent: a
 *     pre-reader cannot cross-check the picture against the words. So a rule earns its place
 *     only if the word means the same thing in essentially every family calendar that
 *     contains it, and everything else falls through to the calendar page it draws today.
 *     Recall is what the local classifier in H5 §6b is for; precision is not negotiable.
 *
 * The output is an `asset_fallback.category` key, so ADDING an icon is a data change — a
 * manifest row and a `fallbackFor` — and not a change here. The reverse also holds: a
 * vocabulary entry may ship BEFORE its art. `sync.ts` checks `fallbackCategories` and keeps
 * the calendar page for any category nobody has drawn yet, because the fallback chain's last
 * step is the `_default` question mark and degrading to *that* would be a downgrade from the
 * uninformative-but-sane glyph every event draws today.
 */

/**
 * The closed vocabulary.
 *
 * Closed, because an open one is how you end up with forty categories and eleven icons. Each
 * entry is a category key that either already has a fallback icon or is a named gap.
 */
export const EVENT_CATEGORIES = [
  'school',
  'celebration',
  'sport',
  'dance',
  'medical',
  'hygiene',
  'travel',
  'outing',
  'music',
  'kitchen',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** Is this stored text one of the vocabulary's words? A column read back from SQLite is a string. */
export function isEventCategory(v: unknown): v is EventCategory {
  return typeof v === 'string' && (EVENT_CATEGORIES as readonly string[]).includes(v);
}

/**
 * The one symbol the emoji table gives the whole day-off family — a break, a teacher work day,
 * a half day. Exported because "is there school today" is a question the leave-by rules ask,
 * and the honest answer is the same one the table already gives the five-year-old: an all-day
 * event carrying this mark means you are at home.
 */
export const HOME_DAY_EMOJI = '🏠';

/**
 * Word -> category.
 *
 * A `Map` built from a literal, and the Map is not decoration. A plain object inherits from
 * `Object.prototype`, so `WORDS['constructor']` is a FUNCTION rather than `undefined` — and
 * `constructor` is the one prototype key that survives this tokeniser intact, since `toString`
 * and `hasOwnProperty` are lowercased into nothing and `__proto__` loses its underscores. So
 * "Constructor meeting" classified as `Object`, violating this function's own return type. A
 * Map has no prototype keys to inherit, which fixes it by construction rather than by a
 * `hasOwn` guard that a later reader can quietly drop.
 *
 * Every key is a whole word, matched on word boundaries — `art` inside `party` and `gym`
 * inside `gymnasium` are exactly the mis-hits that make a keyword classifier untrustworthy.
 * Multi-word keys are matched as adjacent words in order.
 *
 * Where a word is genuinely ambiguous it is ABSENT rather than guessed. Notable omissions and
 * why, so nobody re-adds them:
 *
 *  - `class` — a school class, a gym class and a pottery class are three different icons.
 *  - `practice` alone — piano practice and soccer practice disagree; the sport words below
 *    carry it instead.
 *  - `party` — a birthday party is a celebration, a work party is not, and this is a
 *    children's wall where the difference matters less than the false positive rate.
 *    `birthday` is unambiguous and does the work.
 *  - `pickup` / `dropoff` — these describe the parent's logistics, not the child's day.
 *  - `game` — board game night and a soccer game. `match` has the same problem.
 */
const WORDS: ReadonlyMap<string, EventCategory> = new Map(Object.entries({
  // school
  school: 'school',
  homework: 'school',
  'parent teacher': 'school',
  'field trip': 'school',
  kindergarten: 'school',
  preschool: 'school',
  library: 'school',

  // celebration
  birthday: 'celebration',
  bday: 'celebration',
  anniversary: 'celebration',
  christmas: 'celebration',
  halloween: 'celebration',
  thanksgiving: 'celebration',
  easter: 'celebration',

  // sport
  soccer: 'sport',
  football: 'sport',
  basketball: 'sport',
  baseball: 'sport',
  hockey: 'sport',
  swim: 'sport',
  swimming: 'sport',
  gymnastics: 'sport',
  // Singular, because the household's own event is literally "Child A & Child B gymnastic".
  // Whole-word matching means the plural does not cover it.
  gymnastic: 'sport',
  karate: 'sport',
  taekwondo: 'sport',
  judo: 'sport',
  tennis: 'sport',
  golf: 'sport',
  ski: 'sport',
  skiing: 'sport',
  snowboard: 'sport',
  volleyball: 'sport',
  lacrosse: 'sport',
  wrestling: 'sport',
  track: 'sport',
  climbing: 'sport',

  // dance
  //
  // Its own category, and the reason is measurement rather than taste. `sport` shipped with a
  // soccer ball and ALL EIGHTEEN of the household's sport events turned out to be dance - 38%
  // of the wall drawn as a ball, on the screen of the child who cannot read the correction.
  // That is the confidently-wrong output this module's header forbids, caught on the panel
  // rather than in a probe, because the probe reported the category and not the word.
  //
  // The same argument does NOT extend to splitting the rest of `sport`. A ball is about as
  // close to a universal sport pictogram as an object gets, and swimming drawn as a ball is a
  // loose fit rather than a wrong one. Dance earned a category by being the whole of one.
  dance: 'dance',
  ballet: 'dance',

  // medical
  doctor: 'medical',
  pediatrician: 'medical',
  paediatrician: 'medical',
  dermatologist: 'medical',
  optometrist: 'medical',
  ophthalmologist: 'medical',
  checkup: 'medical',
  'check up': 'medical',
  'well child': 'medical',
  vaccine: 'medical',
  vaccination: 'medical',
  immunization: 'medical',
  immunisation: 'medical',
  therapy: 'medical',
  clinic: 'medical',
  hospital: 'medical',
  surgery: 'medical',

  // hygiene — the dentist shares the toothbrush glyph the routines already use
  dentist: 'hygiene',
  dental: 'hygiene',
  orthodontist: 'hygiene',
  braces: 'hygiene',
  haircut: 'hygiene',

  // travel
  flight: 'travel',
  airport: 'travel',
  vacation: 'travel',
  holiday: 'travel',
  trip: 'travel',
  camping: 'travel',
  campground: 'travel',
  hotel: 'travel',
  'road trip': 'travel',

  // outing
  zoo: 'outing',
  museum: 'outing',
  aquarium: 'outing',
  park: 'outing',
  playdate: 'outing',
  'play date': 'outing',
  picnic: 'outing',
  movie: 'outing',
  theater: 'outing',
  theatre: 'outing',
  festival: 'outing',
  parade: 'outing',
  fair: 'outing',
  hike: 'outing',
  hiking: 'outing',

  // music
  piano: 'music',
  violin: 'music',
  guitar: 'music',
  drums: 'music',
  cello: 'music',
  choir: 'music',
  orchestra: 'music',
  band: 'music',
  recital: 'music',
  concert: 'music',

  // kitchen
  dinner: 'kitchen',
  breakfast: 'kitchen',
  lunch: 'kitchen',
  brunch: 'kitchen',
  bake: 'kitchen',
  baking: 'kitchen',
  potluck: 'kitchen',
  'grocery': 'kitchen',
  'groceries': 'kitchen',
}));

/**
 * The title reduced to a list of lowercase words.
 *
 * Splitting on anything that is not a letter or digit is what gives the word boundaries:
 * "Soccer@6", "swim-lesson" and "Dentist (Child C)" all yield clean tokens, and no rule can
 * fire on a fragment inside a longer word.
 */
export function words(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/**
 * The category for a title, or `null` when nothing matches with confidence.
 *
 * `null` is a real answer and the common one. The caller falls through to
 * `DEFAULT_EVENT_CATEGORY`, which is the calendar page every event draws today — so the worst
 * this function can do is leave an event exactly as good as it was.
 *
 * **First match in title order wins, longest phrase first at a given position.** "Birthday
 * dinner" is a celebration, not a meal, and "school swim gala" is school; in both cases the
 * word an adult put first is the one that says what the entry is for. That is a rule rather
 * than a ranking table because a ranking table is a second thing to keep true.
 */
export function classifyEventTitle(title: string): EventCategory | null {
  const ws = words(title);
  for (let i = 0; i < ws.length; i += 1) {
    // Longest phrase first, so "field trip" beats "trip" and "play date" beats a bare "date".
    for (let span = Math.min(3, ws.length - i); span >= 1; span -= 1) {
      const hit = WORDS.get(ws.slice(i, i + span).join(' '));
      if (hit !== undefined) return hit;
    }
  }
  return null;
}

/** Every word the table knows. Exported so a test can hold the vocabulary to its own rules. */
export function classifierWords(): string[] {
  return [...WORDS.keys()];
}

// ---------------------------------------------------------------------------
// Emoji — a second, FINER channel on the same matcher
// ---------------------------------------------------------------------------

/**
 * Title -> emoji, for the children who cannot read the title.
 *
 * Asked for 2026-09-09: *"it would be nice to have a little emoji somewhere next to the item
 * for the nonreaders. Like, dance, maybe a little ballerina emoji, gymnastics, gymnastics
 * emoji, swimming swimming emoji… as it comes up, we can add them."*
 *
 * ## Why this is a second table and not more categories
 *
 * `WORDS` above is bound to ART. Its header says a closed vocabulary is what stops you having
 * "forty categories and eleven icons", and the `dance` note records the exact trade: dance
 * earned its own category by being 38% of the wall, and the rest of `sport` deliberately did
 * NOT get split because *"a ball is about as close to a universal sport pictogram as an object
 * gets, and swimming drawn as a ball is a loose fit rather than a wrong one."*
 *
 * **That whole argument is about the cost of drawing something.** An emoji costs nothing, so
 * the constraint that produced it simply is not present here, and splitting is free. This
 * table can be as fine as the words allow — which is exactly what was asked for, and why
 * adding one is a one-line data change with no art to commission.
 *
 * It is a REFINEMENT and never a contradiction: it runs on the same matcher, over the same
 * kind of closed whole-word table, and a title it does not know yields `null` and draws no
 * emoji at all. It cannot disagree with the icon, because it never overrides it — both are
 * resolved from the same title at the same moment in `sync.ts`, exactly once per event.
 *
 * ## Rules for adding one
 *
 * Whole words only, lower case, longest phrase first — the matcher handles that. Prefer an
 * emoji that reads as an OBJECT or an ACTION over one that reads as a person, because a person
 * emoji has a skin tone and a gender and this wall has three specific children who will decide
 * it is meant to be one of them. Where a person is unavoidable, pick the one the activity is
 * named for rather than the one the child is.
 */
const EMOJI: ReadonlyMap<string, string> = new Map(Object.entries({
  // The three the household named first.
  dance: '💃',
  ballet: '🩰',
  gymnastics: '🤸',
  gymnastic: '🤸',
  swim: '🏊',
  swimming: '🏊',
  'swim lesson': '🏊',

  // The rest of `sport`, which the icon layer deliberately draws as one ball. Free to split
  // here, and each of these is a thing a five-year-old can name from the picture.
  soccer: '⚽',
  football: '🏈',
  basketball: '🏀',
  baseball: '⚾',
  hockey: '🏒',
  tennis: '🎾',
  golf: '⛳',
  volleyball: '🏐',
  ski: '⛷️',
  skiing: '⛷️',
  snowboard: '🏂',
  karate: '🥋',
  taekwondo: '🥋',
  judo: '🥋',
  wrestling: '🤼',
  climbing: '🧗',
  track: '🏃',
  lacrosse: '🥍',
  bike: '🚲',
  biking: '🚲',
  cycling: '🚲',

  // School and the shape of the week.
  school: '🎒',
  kindergarten: '🎒',
  preschool: '🎒',
  daycare: '🎒',
  'day care': '🎒',

  // A DAY OFF SCHOOL — and these have to beat `school` above, which they do because the
  // matcher tries the longest phrase at each position first. "No School" drew a BACKPACK on
  // 2026-09-09, because the word `school` matched: the one symbol on the row said "school" on
  // the day there is none, to the two children who cannot read the words next to it. That is
  // the confidently-wrong output this table exists to avoid, and it was found by looking at
  // the wall rather than by testing the table.
  //
  // ONE symbol for the whole family of them, deliberately. A break, a teacher work day and an
  // assessment day are different things to an adult and the same thing to a five-year-old:
  // you are at home. A child can learn one mark; she cannot learn five that mean the same.
  'no school': HOME_DAY_EMOJI,
  'day off': HOME_DAY_EMOJI,
  'teacher work day': HOME_DAY_EMOJI,
  'teacher workday': HOME_DAY_EMOJI,
  'fall break': HOME_DAY_EMOJI,
  'winter break': HOME_DAY_EMOJI,
  'spring break': HOME_DAY_EMOJI,
  'thanksgiving break': HOME_DAY_EMOJI,
  'summer break': HOME_DAY_EMOJI,
  'no class': HOME_DAY_EMOJI,
  'early release': HOME_DAY_EMOJI,
  'half day': HOME_DAY_EMOJI,
  // A school day, and a celebration — not a home day. 🎒 would be true and would say nothing.
  'last day of school': '🎉',
  'first day of school': '🎒',
  conferences: '🍎',
  conference: '🍎',
  'picture day': '📷',
  'picture retakes': '📷',
  pictures: '📷',
  homework: '✏️',
  'field trip': '🚌',
  library: '📚',
  'parent teacher': '🍎',
  picture: '📷',

  // Celebrations.
  birthday: '🎂',
  bday: '🎂',
  party: '🎉',
  anniversary: '💐',
  christmas: '🎄',
  halloween: '🎃',
  thanksgiving: '🦃',
  easter: '🐰',

  // Health and grooming.
  doctor: '🩺',
  pediatrician: '🩺',
  checkup: '🩺',
  'check up': '🩺',
  vaccine: '💉',
  vaccination: '💉',
  dentist: '🦷',
  dental: '🦷',
  orthodontist: '🦷',
  braces: '🦷',
  haircut: '💇',
  optometrist: '👓',
  glasses: '👓',
  contacts: '👁️',

  // Going places.
  flight: '✈️',
  airport: '✈️',
  vacation: '🏖️',
  trip: '🧳',
  'road trip': '🚗',
  camping: '⛺',
  campground: '⛺',
  hotel: '🏨',
  zoo: '🦁',
  museum: '🏛️',
  park: '🌳',
  playground: '🛝',
  beach: '🏖️',
  pool: '🏊',
  movie: '🎬',
  truck: '🚚',
  fire: '🚒',
  train: '🚂',
  farm: '🚜',
  // Somebody coming to stay. Deliberately a wave and not a house: the emoji has to work for
  // an arrival, and a house reads as "we are going somewhere".
  visit: '👋',
  visiting: '👋',
  'play date': '🧸',
  sleepover: '🌙',

  // Music.
  piano: '🎹',
  guitar: '🎸',
  violin: '🎻',
  choir: '🎤',
  band: '🎺',
  concert: '🎵',
  recital: '🎵',

  // Around the house.
  dinner: '🍽️',
  lunch: '🥪',
  breakfast: '🥞',
  groceries: '🛒',
  church: '⛪',
  scouts: '🏕️',
}));

/**
 * The emoji for an event title, or `null` when the table does not know it.
 *
 * `null` is the common case and draws nothing. An emoji that is a guess is worse than no
 * emoji: the children who need it are exactly the ones who cannot check it against the words.
 */
export function eventEmoji(title: string): string | null {
  const ws = words(title);
  for (let i = 0; i < ws.length; i += 1) {
    // Longest phrase first, same as the classifier — "swim lesson" beats a bare "swim".
    //
    // FOUR words here where the classifier uses three, because this table has to out-rank a
    // single word that means the opposite. "LAST DAY OF SCHOOL" is four words, so at a span of
    // three no key could reach it and it fell through to the bare `school` -> 🎒. Same shape as
    // the "No School" backpack: the wrong symbol, on the row where the symbol is the message.
    for (let span = Math.min(4, ws.length - i); span >= 1; span -= 1) {
      const hit = EMOJI.get(ws.slice(i, i + span).join(' '));
      if (hit !== undefined) return hit;
    }
  }
  return null;
}

/** Every word the emoji table knows. Exported so a test can hold it to the same rules. */
export function emojiWords(): string[] {
  return [...EMOJI.keys()];
}
