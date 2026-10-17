/**
 * The dog's deeds.
 *
 * A fixed pool and a seeded draw.  Four deeds per ISO week, chosen by hashing the week key, so
 * every wall and a fresh database agree on this week's list without a row existing anywhere —
 * the draw is a pure function of the calendar.  The ticks are the only state
 * (`dog_deed_done`), which is what makes the whole feature reversible from the wall with no
 * PIN: undoing a tick is deleting a row, and there is nothing else to protect.
 *
 * The labels are the joke, and they are HIS: the sheet speaks as the dog ("What I did"), so each
 * deed is first person, past tense, with the "I" carried by the heading — "Slept all day",
 * "Chased my tail".  Written to be read aloud by a seven-year-old to a five-year-old, and for
 * the three-year-old there is the emoji.  Keep them short — the sheet draws them in two columns
 * on a 960px wall — and keep them about THIS dog: a small brown dog who lives with three
 * children.  Never "his": the dog is talking.
 */

export interface DeedSpec {
  readonly id: string;
  readonly label: string;
  readonly emoji: string;
}

export const DEED_POOL: readonly DeedSpec[] = [
  { id: 'sleep-all-day', label: 'Slept all day', emoji: '😴' },
  { id: 'poop-outside', label: 'Pooped outside', emoji: '💩' },
  { id: 'eat-underwear', label: 'Ate some underwear', emoji: '🩲' },
  { id: 'wander-away', label: 'Wandered off', emoji: '🚶' },
  { id: 'get-pet', label: 'Got pet', emoji: '🐾' },
  { id: 'get-pet-more', label: 'Got pet MORE', emoji: '❤️' },
  { id: 'chase-squirrel', label: 'Chased a squirrel', emoji: '🐿️' },
  { id: 'bark-at-nothing', label: 'Barked at nothing', emoji: '📢' },
  { id: 'steal-sock', label: 'Stole a sock', emoji: '🧦' },
  { id: 'beg-at-dinner', label: 'Begged at dinner', emoji: '🍗' },
  { id: 'roll-in-grass', label: 'Rolled in the grass', emoji: '🌿' },
  { id: 'dig-hole', label: 'Dug a hole', emoji: '🕳️' },
  { id: 'chase-tail', label: 'Chased my tail', emoji: '🌀' },
  { id: 'lick-face', label: 'Licked a face', emoji: '👅' },
  { id: 'drink-toilet', label: 'Drank from the toilet', emoji: '🚽' },
  { id: 'sniff-trees', label: 'Sniffed every tree', emoji: '🌳' },
  { id: 'car-ride', label: 'Went for a car ride', emoji: '🚗' },
  { id: 'get-bath', label: 'Had a bath', emoji: '🛁' },
  { id: 'get-treat', label: 'Got a treat', emoji: '🦴' },
  { id: 'zoomies', label: 'Did zoomies', emoji: '💨' },
  { id: 'nap-in-sun', label: 'Napped in the sun', emoji: '☀️' },
  { id: 'bark-at-mail', label: 'Barked at the mail', emoji: '📬' },
  { id: 'shake-off-water', label: 'Shook water on someone', emoji: '💦' },
  { id: 'hide-under-bed', label: 'Hid under the bed', emoji: '🛏️' },
  { id: 'carry-stick', label: 'Carried a big stick', emoji: '🪵' },
  { id: 'meet-dog', label: 'Met another dog', emoji: '🐕' },
  { id: 'get-brushed', label: 'Got brushed', emoji: '🪮' },
  { id: 'belly-rubs', label: 'Got belly rubs', emoji: '🤗' },
  { id: 'howl-at-siren', label: 'Howled at a siren', emoji: '🚨' },
  { id: 'catch-ball', label: 'Caught a ball', emoji: '🎾' },
  { id: 'tip-water-bowl', label: 'Tipped my water bowl', emoji: '💧' },
  { id: 'sit-on-feet', label: "Sat on someone's feet", emoji: '🦶' },
  { id: 'stare-at-snack', label: 'Stared at a snack', emoji: '👀' },
  { id: 'snore', label: 'Snored', emoji: '💤' },
  { id: 'fall-off-couch', label: 'Fell off the couch', emoji: '🛋️' },
  { id: 'chase-bird', label: 'Chased a bird', emoji: '🐦' },
  { id: 'sniff-cat', label: 'Sniffed a cat', emoji: '🐈' },
  { id: 'splash-puddle', label: 'Splashed in a puddle', emoji: '🌧️' },
  { id: 'steal-shoe', label: 'Ran off with a shoe', emoji: '👟' },
  { id: 'lick-plate', label: 'Licked a plate clean', emoji: '🍽️' },
  { id: 'tilt-head', label: 'Tilted my head', emoji: '🤔' },
  { id: 'wag-so-hard', label: 'Wagged so hard I wiggled', emoji: '🐶' },
];

/**
 * How many deeds a week gets.  Two columns of two on the sheet — the top half of the sheet is
 * his asks for today (`dogAsks`), and four deeds is what leaves room for them on a 540px wall.
 * Was six before 2026-09-15; a smaller draw keeps the first four of the same shuffle, so a week
 * already ticked keeps its ticks on the deeds that stay.
 */
export const DEEDS_PER_WEEK = 4;

const BY_ID = new Map(DEED_POOL.map((d) => [d.id, d]));

export function deedById(id: string): DeedSpec | undefined {
  return BY_ID.get(id);
}

/** FNV-1a, 32-bit.  A hash and not `Math.random` so that the draw is the same everywhere. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** xorshift32 over the seed; enough randomness for a shuffle nobody is betting on. */
function* xorshift(seed: number): Generator<number> {
  let x = seed || 0x9e3779b9;
  for (;;) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    yield x / 0x1_0000_0000;
  }
}

/**
 * This week's deeds, in the order the sheet draws them.  Deterministic in `week`: the same
 * key always yields the same six, so a tick written on Tuesday still names a deed that is on
 * Thursday's list.  `n` is exposed for tests and for a pool smaller than a week.
 */
export function weekDeeds(week: string, n: number = DEEDS_PER_WEEK): DeedSpec[] {
  const order = [...DEED_POOL];
  const rnd = xorshift(fnv1a(`dog:${week}`));
  // Fisher–Yates from the top; only the first n positions matter but the swap is cheap.
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor((rnd.next().value as number) * (i + 1));
    [order[i], order[j]] = [order[j] as DeedSpec, order[i] as DeedSpec];
  }
  return order.slice(0, Math.min(n, order.length));
}
