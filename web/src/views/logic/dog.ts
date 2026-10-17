/**
 * The dog's week, minus its pixels.  The Easter egg behind the dog in the picture.
 *
 * What the sheet needs to know, as functions with tests: which deeds go in which column, what
 * the line under the title says, and when the sheet closes on its own.  The component draws;
 * this file decides.  No React, no `.tsx` import — the test runner cannot load a component.
 */

import type {
  AssetRef,
  Child,
  ChoreAssignmentView,
  ChoreState,
  DogWeek,
  HouseholdView,
  SceneBox,
} from '../../../../src/types.ts';

/** The gate key for one deed, so a tap is debounced and undoable like every other tap. */
export const deedKey = (week: string, deedId: string): string => `dog:${week}:${deedId}`;

/**
 * How long an untouched sheet stays up.  Shorter than the shell's 90 s: the sheet covers the
 * picture, which is HOME, and nothing on it is something a person comes back to finish.
 */
export const DOG_SHEET_DECAY_MS = 60_000;

/**
 * The line under "What I did".  The dog is talking — every word on the sheet is his — and it is
 * written for the seven-year-old to read to the other two; the count is there because "3 of 4"
 * is a thing a five-year-old can say back.
 */
export function dogLine(week: DogWeek): string {
  const done = week.deeds.filter((d) => d.done).length;
  const total = week.deeds.length;
  // Short: the line sits over a 320px column and "Tap what you saw me do this week." lost its
  // last word on the panel (2026-09-15).
  if (total === 0) return 'Nothing on my list.';
  if (done === 0) return 'Tap what you saw me do.';
  if (done === total) return `All ${String(total)} — what a week I had.`;
  return `${String(done)} of ${String(total)} so far.`;
}

/**
 * One face on an ask: one child, and whether they did it.
 *
 * `inert` is a row that cannot be tapped either way — a `superseded` row from a day that was
 * materialized under the old `first_complete` model, or an `approved` claim, which a child
 * may not take back.  Drawn, because leaving a child off the row would say she is not allowed
 * to walk the dog, and that is the thing this sheet got wrong.
 */
export interface DogFace {
  readonly childId: string;
  readonly assignmentId: number;
  readonly state: ChoreState;
  readonly done: boolean;
  readonly inert: boolean;
}

/**
 * One of the dog's asks for today.  A chore in the `pet` category that is an EXTRA — anyone may
 * do it, nobody must — gathered across every child's row for the day, because the sheet is the
 * one place a chore is drawn by what it is rather than whose it is.
 *
 * `faces` IS THE ASK: every eligible child, in the household's order, each with their own row
 * and their own answer.  It replaced an `open` list and a single `doneBy` on 2026-09-16, and
 * that pair was not a display choice — it was `first_complete` showing through.  Under that
 * model the first claim won and the other two rows came back `superseded`, so tapping one face
 * made the other two VANISH: "you can only select one kid", and a selection flow that made no
 * sense because it was not a selection at all, it was a race being lost.  The pet chores are
 * `shared` now — every claimant earns the full amount — so three children can walk the dog and
 * the row reads as what it always meant: who did this today.
 */
export interface DogAsk {
  readonly choreId: string;
  /** The ask itself, in his voice — "Brush me", "Play fetch with me". */
  readonly label: string;
  readonly icon: AssetRef;
  readonly points: number;
  readonly faces: readonly DogFace[];
  /** How many of them did it — the ask is "done" only when nobody is left who could. */
  readonly doneCount: number;
}

/** What makes a chore one of his: the category is his, and nobody is on the hook for it. */
export function isDogAsk(chore: Pick<ChoreAssignmentView, 'category' | 'kind'>): boolean {
  return chore.category === 'pet' && chore.kind === 'extra';
}

/**
 * Today's asks, from today's rows.  The rows come in already SHOWN — the component runs each
 * state through the tap gate first (`shownChoreTap`), so a face just tapped moves from `open`
 * to `doneBy` at once, exactly as a card on the board would fill.
 */
export function dogAsks(
  chores: readonly ChoreAssignmentView[],
  children: readonly Pick<Child, 'id' | 'sortOrder'>[],
): DogAsk[] {
  const rank = new Map(children.map((c) => [c.id, c.sortOrder]));
  const byChore = new Map<string, { ask: DogAsk; faces: DogFace[] }>();
  for (const chore of chores) {
    if (!isDogAsk(chore)) continue;
    // A child no longer in the household has no face to tap.
    if (!rank.has(chore.childId)) continue;
    const entry = byChore.get(chore.choreId) ?? {
      ask: {
        choreId: chore.choreId,
        label: chore.labelFull,
        icon: chore.icon,
        points: chore.points,
        faces: [],
        doneCount: 0,
      },
      faces: [],
    };
    const done = chore.state === 'claimed' || chore.state === 'approved';
    entry.faces.push({
      childId: chore.childId,
      assignmentId: chore.assignmentId,
      state: chore.state,
      done,
      // Approved is the adult's word and a child may not take it back; superseded is a row
      // from a `first_complete` day that has already been lost and can never be claimed.
      inert: chore.state === 'approved' || chore.state === 'superseded',
    });
    byChore.set(chore.choreId, entry);
  }
  const asks: DogAsk[] = [];
  for (const { ask, faces } of byChore.values()) {
    faces.sort((a, b) => (rank.get(a.childId) ?? 0) - (rank.get(b.childId) ?? 0));
    asks.push({ ...ask, faces, doneCount: faces.filter((f) => f.done).length });
  }
  // An ask with nobody left to do it sinks below the ones still open; within a group, his order
  // is alphabetical, which is stable across the day and needs no other input.
  const spent = (a: DogAsk) => Number(a.faces.every((f) => f.done || f.inert));
  return asks.sort((a, b) => spent(a) - spent(b) || a.label.localeCompare(b.label));
}

/** The line under "Do this for me". */
export function askLine(asks: readonly DogAsk[]): string {
  if (asks.length === 0) return 'Nothing today. Just pet me.';
  // "Left" is an ask NOBODY has done. One child walking the dog does not close the row — the
  // other two may still have walked him too, and the row is a log, not a race.
  const left = asks.filter((a) => a.doneCount === 0).length;
  if (left === 0) return 'All done. You are the best.';
  return 'Tap the face of whoever did it.';
}

/**
 * How many asks the sheet draws before the list scrolls.  The asks stand beside the four
 * deeds, and four 64px rows is the deeds column's own height; a day with a fifth ask keeps it,
 * behind a scroll, rather than hiding it.  The pet schedule is laid out so no day has more
 * than three.
 */
export const DOG_ASKS_VISIBLE = 4;

/**
 * Whether the picture's dog is a door at all (2026-10-12).  Both halves must say yes: the
 * picture must know where he is (`scene.dog`), and the household must have a pet (`snapshot.dog`
 * is `null` when `household.pets` is empty).  A dogless household can still be shown a picture
 * that has a dog in it — the art is shared — and tapping him must then do nothing at all,
 * rather than open a sheet with no week behind it.  `undefined` is an older server's snapshot
 * and reads as no pet.
 */
export function dogDoorOpen(sceneDog: SceneBox | null, week: DogWeek | null | undefined): boolean {
  return sceneDog !== null && week !== null && week !== undefined;
}

/**
 * The pet's name, from the household's settings, or `''` when it has none (or the snapshot is
 * from a server that predates `household`).  The sheet is the only place it is drawn.
 */
export function petNameOf(household: Pick<HouseholdView, 'pets'> | undefined): string {
  return household?.pets?.[0]?.name ?? '';
}

/** The sheet's title.  He introduces himself; with no name on file he still does, just shorter. */
export function dogTitle(name: string): string {
  return name === '' ? 'It’s me' : `It’s me, ${name}`;
}

/**
 * Whether the sheet may stay open.  It lives on the picture and only on the picture: a child
 * selected, a door opened, the board back — anything that takes the picture down takes the
 * sheet with it, or the sheet would come back over whatever went up next.
 */
export function dogSheetAfter(open: boolean, showingScene: boolean): boolean {
  return open && showingScene;
}

/**
 * The sheet's width in the 880-wide picture (the rail has the other 80).  Measured on the panel
 * three times on 2026-09-15: at 640 two columns of deeds ran off the card; at 800 with the
 * asks ABOVE the deeds the sheet was 625px tall on a 540px wall and lost its title and its
 * last row.  So the asks stand BESIDE the deeds — three ask rows on the left, four deeds in one
 * column on the right — and the sheet is 840: 20px of picture either side still says it is a
 * sheet ON the picture, and the ask labels get ~190px, enough for "Play fetch with me" on two
 * lines at the body size.
 */
export const DOG_SHEET_WIDTH_PX = 840;

/** The least picture that must show either side of the sheet for it to read as a sheet. */
export const DOG_SHEET_EDGE_MIN_PX = 20;

/**
 * The deeds column: a 64px check, a 48px emoji, and ~190px of label — "Wagged so hard I
 * wiggled" on two lines at the body size, which is why the labels are `body` and not
 * `bodyLarge` on this sheet.
 */
export const DOG_DEEDS_COLUMN_PX = 320;

/**
 * The tick that sits on a face that has done the ask.
 *
 * `AccentFrame selected` alone was the whole answer until 2026-09-16, and on the panel it is a
 * few pixels of inset — invisible at a glance and completely invisible to the two children who
 * cannot read the muted label beside it. That was survivable while an ask had at most ONE
 * claimant and the other faces disappeared: the row said who did it by being a row of one.
 * Now that all three faces always stand there, the mark IS the answer to "who did this today",
 * and it has to be legible from across the room.
 *
 * 28px on a 48px face, half-overlapping the bottom-right of the ring: big enough to read at the
 * wall's distance, small enough to leave the face recognisable, which is what a child is
 * actually scanning for.
 */
export const DOG_FACE_TICK_PX = 28;
