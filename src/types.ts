/**
 * family-calendar — Phase 0 contract: domain and wire types.
 *
 * FROZEN 2026-08-24 (H1 review passed). Nothing in Phase 1+ may edit this file; a change
 * here is a stop-the-world event (build-plan.md §1). Every unit imports from here rather
 * than redeclaring shapes.
 *
 * Time discipline, enforced by the type names:
 *   Utc       — an ISO-8601 instant. Ordering and durations only.
 *   LocalDate — a floating calendar date. "Today", recurrence, all-day events, countdowns.
 *   LocalTime — a floating wall-clock time. Routine boxes.
 * Never derive a LocalDate from a Utc with `toISOString().slice(0,10)`; use
 * Intl.DateTimeFormat('en-CA', { timeZone }) on BOTH server and client (H3 finding #6).
 */

import type { EventCategory } from './calendar/classify.ts';

/** Two-letter weekday codes, RRULE spelling, Sunday first. */
export const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type DayCode = (typeof DAY_CODES)[number];

export type Utc = string & { readonly __brand: 'Utc' };
export type LocalDate = string & { readonly __brand: 'LocalDate' };
export type LocalTime = string & { readonly __brand: 'LocalTime' };

/**
 * The zone a household with no `timezone` setting lives in (2026-10-12: until then this was a
 * compile-time constant). The live zone is a household setting now — `src/config/household.ts`
 * reads it, `src/time.ts` holds it, and the snapshot carries it to the bundle — so this is only
 * ever the DEFAULT, and nothing may format a date against it directly.
 */
export const DEFAULT_TZ = 'America/Denver' as const;
/** The default `locale` and `currency` household settings; today's wall, unchanged. */
export const DEFAULT_LOCALE = 'en-US' as const;
export const DEFAULT_CURRENCY = 'USD' as const;

// ---------------------------------------------------------------------------
// The wall's look
// ---------------------------------------------------------------------------

/**
 * Which of three looks the wall wears (2026-10-11). Presentation only, exactly like a reading
 * band: one state, three renderings, and nothing a child can do changes which one is up. An
 * adult picks it behind the PIN (Grown-ups → Worth) and it rides in the snapshot, so a change
 * is one refetch on every screen and never a request of its own.
 *
 * `felt` (the felt board) is the default; `gallery` and `storybook` are the alternatives the
 * household chose between in `the theme mockups, private notes/`. The ids are deliberately
 * not `picture`, `fluent` or `emergent`: the band-literal guard reads every string in the web
 * sources and cannot tell a band from anything else spelled the same way.
 */
export const WALL_THEMES = ['felt', 'gallery', 'storybook'] as const;
export type WallThemeId = (typeof WALL_THEMES)[number];
export const DEFAULT_WALL_THEME: WallThemeId = 'felt';

/** Total over `unknown`, so a stored row or a wire value can never name a fourth look. */
export function isWallThemeId(v: unknown): v is WallThemeId {
  return typeof v === 'string' && (WALL_THEMES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The household's settings, as the wall sees them
// ---------------------------------------------------------------------------

/**
 * Which surfaces a household uses. Every one defaults ON, which is today's wall. Leave-by is
 * not here: it already has its own switch, `DepartureRules.enabled`.
 */
export interface HouseholdFeatures {
  readonly chores: boolean;
  readonly money: boolean;
  readonly routines: boolean;
  readonly countdowns: boolean;
}

/** When the board replaces the picture, as household-local "HH:MM", half-open `[opens, closes)`. */
export interface BoardWindow {
  readonly opensAtLocal: string;
  readonly closesAtLocal: string;
}

/** A pet, as much of one as the wall draws: its id and the name it signs its sheet with. */
export interface PetView {
  readonly id: string;
  readonly name: string;
}

/**
 * `WallSnapshot.household` (2026-10-12). Defined HERE, not in `src/config/household.ts`, because
 * this file is the contract and stays dependency-free; the loader imports it. The `scenes`
 * setting is deliberately absent — only the host-side tools read it.
 */
export interface HouseholdView {
  readonly timezone: string;
  readonly locale: string;
  readonly currency: string;
  readonly features: HouseholdFeatures;
  readonly boardWindows: readonly BoardWindow[];
  readonly pets: readonly PetView[];
}

// ---------------------------------------------------------------------------
// Children and presentation
// ---------------------------------------------------------------------------

/**
 * The literacy band drives presentation only — never a different data model
 * (PRD §4: one state, three renderers). Set once by an adult; never inferred.
 */
export type ReadingBand = 'picture' | 'emergent' | 'fluent';

export interface Child {
  id: string;
  displayName: string;
  readingBand: ReadingBand;
  /** False for the pre-reader: chores still run the state machine, no ledger row is ever written. */
  ledgerEnabled: boolean;
  avatarAssetId: string;
  sortOrder: number;
}

/**
 * A resolved asset reference. `url` is produced by walking the fallback chain at
 * snapshot time, so it is always non-empty — the render path can never miss
 * (H2 gap #1: for a pre-reader, a missing icon IS a blank screen).
 */
export interface AssetRef {
  assetId: string;
  url: string;
  /** True when the fallback chain was used, so authoring gaps stay visible to adults. */
  isFallback: boolean;
}

// ---------------------------------------------------------------------------
// Chores
// ---------------------------------------------------------------------------

export type AssignmentModel = 'individual' | 'shared' | 'first_complete' | 'rotation';

/**
 * `superseded` is the terminal, non-paying state for losers of a first_complete race.
 *
 * There is deliberately no `rejected`: a parent rejecting a claim returns the chore to
 * `pending` so the child can redo it. An earlier draft had `rejected` here while api.md
 * documented reject -> pending; two parallel agents would have implemented two different
 * machines, one of which left the card stuck for the rest of the day (H1 lens 2).
 */
export type ChoreState = 'pending' | 'claimed' | 'approved' | 'superseded';

/**
 * Required, or chosen and paid?
 *
 * The household's own split, and a first-class one: "earn money" is one of this wall's four
 * jobs, not a decoration on the chore job.  Duties are part of belonging here and pay nothing;
 * extras are optional, earn, and the list is meant to change over time.
 *
 * Decided by panel 2026-08-27 (H10, unanimous): the two kinds are separate DESTINATIONS behind
 * the section switcher, not two sections of one list and not a badge on some tiles.  A badge
 * makes "duty" mean absence-of-badge, and absence is a comparison — it says nothing on a day
 * with only one kind on the board, which for a three-year-old is most days.
 */
export type ChoreKind = 'duty' | 'extra';

export interface ChoreAssignmentView {
  assignmentId: number;
  choreId: string;
  childId: string;
  localDate: LocalDate;
  state: ChoreState;
  kind: ChoreKind;
  /**
   * Whether finishing it counts toward the child's full day (ADR-0006 §4). Always `false` for
   * an extra. A duty that does not count is on the board as a reminder — homework, eye
   * exercises — and leaving it undone costs the day nothing. Added 2026-10-27 (schema v13) for
   * the all-done celebration, which must judge the day the way the server does.
   */
  countsTowardDay: boolean;
  /**
   * "HH:MM" local, or `null` for a chore with no window.
   *
   * Carried RAW, and lateness is derived from it in the view layer against the wall's own
   * clock.  Not an `overdue` state on this type, and not a boolean computed on the server:
   * the snapshot is rebuilt on SSE and at the local date boundary, not every minute, so a
   * server-computed flag would mean a chore silently never goes late between rebuilds.  A raw
   * bound plus the clock the wall already ticks is correct at every instant.
   */
  dueByLocal: LocalTime | null;
  points: number;
  labelShort: string;
  labelFull: string;
  icon: AssetRef;
  /**
   * The chore's free-text category (`pet`, `kitchen`, `tidy`…).  On the wire because the dog's
   * sheet gathers today's `pet` extras as his own asks — the one place a chore is grouped by
   * what it is rather than whose it is.
   */
  category: string;
  /**
   * When the child said she did it, or `null` for anything not `claimed`.
   *
   * Added 2026-10-11 for the grown-up queue's "18 min ago" — an adult clearing the queue after
   * dinner wants to know which claim is from this morning. Set on claim and cleared on unclaim
   * and on send-back (the column already did both); this is only the read. Additive, so an older
   * wall that ignores it loses nothing.
   */
  claimedAtUtc: Utc | null;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type LedgerReason = 'chore_approved' | 'redemption_approved' | 'adjustment';
export type LedgerRefType = 'chore_assignment' | 'redemption_request' | 'manual';

export interface LedgerEntry {
  id: number;
  childId: string;
  delta: number;
  reason: LedgerReason;
  refType: LedgerRefType;
  refId: string;
  note: string | null;
  createdAtUtc: Utc;
}

/**
 * Always derived as SUM(delta) on read — never stored, never cached. There is
 * deliberately no second copy of truth to diverge from the entries (H3 finding #2).
 *
 * `WallSnapshot.balances` MUST contain exactly one entry per ACTIVE child, defaulting to
 * `points: 0`, independent of ledger history — built as a LEFT JOIN from `child`, never as a
 * bare aggregate over `ledger_entry`, which returns no row at all for a child who has never
 * had an approval. That is every child on day one (H1 lens 5).
 */
export interface Balance {
  childId: string;
  points: number;
  /** Null when the household rate is unset or the child has ledgerEnabled=false. */
  cashCents: number | null;
}

/**
 * How many days running a child has done what was asked of her.
 *
 * A SEPARATE array rather than a field on `Balance`, and that is a deliberate call.
 * `Balance` has two producers — Unit A's `listBalances` and the ledger domain's
 * `balanceFor` — and `balance.ts` says outright that they apply the same rules "so the two
 * reads can never disagree". Adding a field neither of them can compute without a
 * `LocalDate` they do not take would force the date into both, and the first one that
 * forgot would reintroduce exactly the divergence that comment exists to prevent. A streak
 * is also not money: it is the one number the pre-reader could have, and she has no balance
 * by design.
 *
 * The rules behind the number are in `domain/chores/streaks.ts`; the reasoning is in
 * docs/decisions/0005-streaks.md.
 */
export interface ChildStreak {
  childId: string;
  /**
   * Qualifying days running, or `null` when there is nothing worth showing. The wire
   * carries the DISPLAY value, not the raw count, so the three band renderers cannot
   * disagree about when a streak is worth drawing.
   */
  days: number | null;
}

export type RedemptionState = 'pending' | 'approved' | 'rejected' | 'cancelled';

/**
 * There is no `paid` state, by decision (H2 Q2, unanimous). The physical handover is
 * unobservable, and a state that depends on an adult remembering to tap it will drift
 * and then lie to a child. Cost: nothing tracks who is owed cash. Recorded as unsettled
 * in docs/design-review/H2-tournament.md.
 */
export interface RedemptionRequest {
  id: number;
  childId: string;
  pointsRequested: number;
  centsPerPoint: number;
  cashCents: number;
  state: RedemptionState;
  requestedAtUtc: Utc;
  decidedAtUtc: Utc | null;
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

/**
 * A step as snapshotted into today's run. Labels and icon are copies, not lookups —
 * that is what makes a parent's mid-day edit harmless to an in-flight run (H2 Q1).
 */
export interface RoutineRunStepView {
  runStepId: number;
  position: number;
  labelShort: string;
  labelFull: string;
  icon: AssetRef;
  completedAtUtc: Utc | null;
}

/**
 * The time box ships as DATA (`opensAtLocal`/`closesAtLocal`), never as a server-computed
 * open/locked flag. A snapshot generated at 00:00 carrying `locked` would never open at
 * 06:00, because the wall only refetches on SSE open and at the date boundary — the
 * fatal flaw H2 Q1 found. The client computes box state from its own clock.
 */
export interface RoutineRunView {
  runId: number;
  routineId: string;
  childId: string;
  localDate: LocalDate;
  labelShort: string;
  labelFull: string;
  icon: AssetRef;
  opensAtLocal: LocalTime;
  closesAtLocal: LocalTime;
  steps: RoutineRunStepView[];
}

// ---------------------------------------------------------------------------
// Upcoming
// ---------------------------------------------------------------------------

/**
 * A timed event carries instants; an all-day event carries floating dates and no
 * instant. Never both — storing all-day as UTC midnight is what puts an event on two
 * local days (H3 finding #5).
 */
export type EventWhen =
  | { kind: 'timed'; startsAtUtc: Utc; endsAtUtc: Utc }
  | { kind: 'allDay'; startDate: LocalDate; /** exclusive */ endDate: LocalDate };

export interface CalendarEventView {
  id: number;
  title: string;
  when: EventWhen;
  sourceId: string;
  colourToken: string;
  childId: string | null;
  icon: AssetRef;
  /**
   * A single emoji for the children who cannot read `title`, or `null`.
   *
   * Added 2026-09-09. Resolved from the title at SYNC time, by the same matcher that picks
   * `icon` and at the same moment, so the two can never disagree about the same event. It is
   * deliberately FINER than the icon's category: an emoji costs nothing to add, which is the
   * entire constraint that kept `sport` drawn as one ball (src/calendar/classify.ts), so
   * gymnastics, swimming and dance can each have their own where the drawn set cannot.
   *
   * `null` is the common case and draws nothing. A guessed emoji is worse than none: the
   * readers it is for are exactly the ones who cannot check it against the words.
   */
  emoji: string | null;
  /**
   * What the title is about, from the closed vocabulary in `src/calendar/classify.ts`, or
   * `null`. Added 2026-09-15 for the leave-by rules: "get ready for dance" is decided by the
   * category, never by matching a title on the wall. Derived at sync time like `emoji`, and
   * kept even for a category nobody has drawn an icon for yet.
   */
  category: EventCategory | null;
}

export interface CountdownView {
  id: string;
  labelShort: string;
  labelFull: string;
  icon: AssetRef;
  /**
   * The emoji beside it, or `null`.
   *
   * Added 2026-09-09, because every countdown drew a birthday cake — three birthdays and
   * "Winter holiday" all resolved to the one `celebration` icon, so the picture said nothing.
   * Authored on the row where an adult wrote the countdown, falling back to the same title
   * matcher the calendar uses so an unauthored row still gets something sensible.
   */
  emoji: string | null;
  targetDate: LocalDate;
  /** Whole local-date difference — a date subtraction, never an instant delta. */
  sleepsRemaining: number;
  /**
   * NULL = whole household. Added 2026-08-24: `countdown.child_id` exists in the schema
   * and the seed scopes a birthday to one child, but this view dropped it — so every
   * child's birthday rendered as everyone's. Found by Unit F.
   */
  childId: string | null;
}

// ---------------------------------------------------------------------------
// Freshness  (H2 gap #3 — make wrongness visible)
// ---------------------------------------------------------------------------

export type MaterializationStatus = 'ok' | 'stale' | 'error';

/**
 * Every snapshot carries its own provenance so the wall can RENDER staleness rather
 * than presenting stale data with full confidence. Stale-but-labelled satisfies the
 * prime invariant; stale-and-confident does not.
 */
export interface Freshness {
  /**
   * The date the SERVER used to build this snapshot. The client MUST compare it against
   * the date it asked for and refetch on mismatch: with even a second of clock skew at
   * local midnight, the server can answer "yesterday" and — since nothing else fires until
   * the next boundary — the wall stays a day behind through 6:00 AM (H1 lens 3).
   */
  snapshotLocalDate: LocalDate;
  generatedAtUtc: Utc;
  calendarSyncAgeSeconds: number | null;
  /**
   * True when at least one calendar source is included, i.e. an adult asked for calendars.
   *
   * Added 2026-08-25. `calendarSyncAgeSeconds: null` conflates "configured and never synced"
   * with "no calendar configured at all", and the client treated both as stale — so a
   * household with no calendar wired up saw "Showing older information" permanently. A badge
   * that never turns off is a badge nobody reads, which costs precisely the signal this
   * struct exists to carry. Calendar staleness is only meaningful when something is owed.
   */
  calendarConfigured: boolean;
  routineMaterialization: MaterializationStatus;
}

// ---------------------------------------------------------------------------
// The wall snapshot  (the single authoritative read)
// ---------------------------------------------------------------------------

/**
 * Fetched in full on SSE `open` and at every local date boundary. SSE is an
 * invalidation channel and never the source of truth (H3 finding #4) — the kiosk runs
 * for months without reloading, so nothing may depend on a page load happening.
 */
/** Where a scene sits in the library.  See db/schema.sql and src/domain/scenes/library.ts. */
export type SceneState = 'candidate' | 'approved' | 'retired';

/** One tappable child in the picture, in fractions of the image. */
export interface SceneRegion {
  slot: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * A tight crop of this child's HEAD in this picture, or `null` when the finder could not
   * give one (2026-09-16).  The rail shows it in place of her cartoon avatar, so the face a
   * child taps to reach her own screen is the face she is wearing in the picture in front of
   * her — which is what lets a scene put her further back and stay findable.
   *
   * Separate from the tap box above and never interchangeable with it: that one is GROWN to a
   * 96px tap floor and then gutter-fitted, so it is a target, not a likeness.  Nullable
   * because every manifest written before this date lacks it, and because a crop of the wrong
   * thing is worse than the cartoon — the wall falls back, it does not guess.
   */
  head?: SceneBox | null;
}

/**
 * The picture behind the wall, chosen by the SERVER.
 *
 * Named `WallScene` and not `SceneView` because `SceneView` is the COMPONENT that draws it;
 * the wire shape and the renderer sharing one name is how an import ends up meaning the other
 * thing entirely in a file that uses both.
 *
 * It used to be chosen in the browser: the bundle carried a committed array of ids, fetched
 * `<id>.json` for each, and took the first that parsed. That put the decision on the far side
 * of a redeploy, so a picture generated on Sunday night could not reach the wall until somebody
 * edited a source file — which is why the weekly cadence never actually happened.
 *
 * `null` means no approved scene has a picture and a usable manifest. The wall renders the
 * information board, which is the right answer and not a degraded one.
 */
/** A box in the picture, in fractions of the image. */
export interface SceneBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WallScene {
  id: string;
  /** Root-relative URL, already encoded — it goes into a CSS `url("…")`. */
  image: string;
  regions: SceneRegion[];
  /**
   * Where the dog is hiding, or `null` when the manifest does not say.  The Easter egg
   * (2026-09-15): a tap here opens the dog's week rather than a child's screen.  Optional on
   * purpose — every scene prompt hides the dog, but the finder is asked for him after the
   * children and drops him rather than refuse a picture, so a scene without a dog box is a
   * scene, not a broken one.
   */
  dog: SceneBox | null;
}

/** One of the dog's deeds this week, and whether somebody has ticked it. */
export interface DogDeed {
  id: string;
  label: string;
  emoji: string;
  done: boolean;
}

/**
 * The dog's week.  Six deeds drawn from a fixed pool by the ISO week (src/domain/dog/deeds.ts),
 * so the list changes on Monday without anybody writing it, and the ticks are the only state.
 * No child, no points, no approval: it is a joke the household tells itself, and a tap on the
 * dog in the picture is the whole door.
 */
export interface DogWeek {
  /** ISO week key, "2026-W38". Echoed back on a tick so a stale sheet cannot tick next week. */
  week: string;
  deeds: DogDeed[];
}

export interface WallSnapshot {
  freshness: Freshness;
  /** Echo of the client's requested date, so a mismatch is detectable without a clock. */
  requestedLocalDate: LocalDate;
  children: Child[];
  routines: RoutineRunView[];
  chores: ChoreAssignmentView[];
  events: CalendarEventView[];
  countdowns: CountdownView[];
  balances: Balance[];
  /** One entry per active child, always — same shape and same reason as `balances`. */
  streaks: ChildStreak[];
  /**
   * PENDING redemption requests only. Added 2026-08-24: nothing rendered a request at all,
   * so a child could tap "cash out" and see no evidence she had — and then tap again — while
   * a parent had no queue to approve from. Decided requests are history and belong in the
   * ledger view, not on the wall.
   */
  redemptions: RedemptionRequest[];
  /**
   * The picture behind every screen, or `null` when nothing approved is usable.  Added
   * 2026-09-08 (api.md amendment): selection moved to the server so that approving a scene —
   * a row the weekly generator and the grown-up surface can both write — is what puts one up,
   * rather than a committed array in the bundle.
   */
  scene: WallScene | null;
  /**
   * The dog's week (2026-09-15); the deeds come from code, not rows.  `null` when the household
   * has no pet (`household.pets` is empty, the default) — 2026-10-12.
   */
  dog: DogWeek | null;
  /**
   * The household's leave-by rules (2026-09-15). The wall turns these plus today's events
   * plus its own clock into "get ready for dance, leave by 4:15" — on the client, from local
   * state, like every other time-of-day judgement on this wall. The server only stores them.
   */
  departures: DepartureRules;
  /**
   * Which look the wall wears (2026-10-11). Stored in `household_config.wall_theme`; a missing
   * or unknown row reads as `felt`. The client resolves it again with the same guard, because
   * its snapshot validator is shallow on purpose and an older server sends no field at all.
   */
  theme: WallThemeId;
  /**
   * The household's settings the wall needs (2026-10-12): zone, locale, currency, which
   * surfaces are on, the board's hours, the pets. Applied by `provision.ts --settings`, stored
   * as `household_config` rows, and every missing row reads as today's behaviour. An older
   * server sends no field at all, so the client reads it defensively.
   */
  household: HouseholdView;
  /** Bumped when the wire shape changes; the client hard-reloads below its minimum. */
  apiVersion: number;
  minClientBuild: number;
}

/**
 * When to start getting ready, and for what.
 *
 * Asked for in these words: *"get ready for dance, get dressed for gymnastics … school is 10
 * minutes away, we try to leave between 7:30 and 7:40 … think about a way to have an alarm or
 * an alert that we can turn on and off."* Two kinds of departure: SCHOOL, which is a rule (a
 * weekday, a leave-by time, and no day-off event on the calendar), and an EVENT, which is any
 * timed event today whose category is one the household drives to. Both open a get-ready
 * window `readyMinutes` before the leave-by time; an event's leave-by is its start minus
 * `travelMinutes`.
 *
 * `enabled` is the switch. It is one field rather than a separate row so that the whole
 * object is one JSON value in `household_config`, and so that turning the alerts off does not
 * forget how they were set.
 */
export interface DepartureRules {
  enabled: boolean;
  /** How long before the leave-by time the wall starts saying so. */
  readyMinutes: number;
  /** Door to door, for an event with a start time. */
  travelMinutes: number;
  school: {
    leaveAt: LocalTime;
    /** Empty means no school rule at all. */
    days: DayCode[];
    label: string;
  };
  /** Which kinds of event are worth a leave-by line. */
  eventCategories: EventCategory[];
}

/** SSE payloads carry no state — only a reason to refetch. */
export type WallEvent =
  | { type: 'invalidate'; scope: 'all' | 'chores' | 'routines' | 'ledger' | 'calendar' | 'dog' }
  | { type: 'heartbeat'; generatedAtUtc: Utc; minClientBuild: number };

// ---------------------------------------------------------------------------
// The renderer contract  (H2 Q3 winner)
// ---------------------------------------------------------------------------

/**
 * The one place a band may be branched on is the renderer registry. An ESLint rule
 * forbids `if (band ===` and `switch (band)` anywhere else, so the three renderings
 * cannot silently diverge as features land. Domain components own data and actions;
 * they call useBandRenderer() only to obtain a presentational leaf.
 *
 * Keep this exhaustive: a `Record<ReadingBand, …>` makes a new band a compile error
 * until every renderer implements it.
 */
export interface BandRenderers<C> {
  Avatar: C;
  RoutineStep: C;
  ChoreCard: C;
  PointsBadge: C;
  EventCard: C;
  CountdownCard: C;
  StatusPill: C;
}

export type BandRendererRegistry<C> = Record<ReadingBand, BandRenderers<C>>;
