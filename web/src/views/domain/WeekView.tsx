/**
 * Unit H — the calendar destination: the week, as columns.
 *
 * The idle wall's agenda (`UpcomingPanel`) is a list, and it is the right shape for the
 * question a parent asks from the kitchen. It is the wrong shape for the question the children
 * ask, which the household put like this: *"at this age, today, tomorrow, next day are
 * confusing. So being able to see, like, this event happens tomorrow. It's dance class happens
 * tomorrow at four PM. And what happens is school before that."*
 *
 * Two relations, and a list carries neither. Columns carry both: WHICH DAY is a horizontal
 * position with a word over it, and WHAT COMES BEFORE WHAT is reading one column downward.
 * `logic/week.ts` owns the hard half — a time axis built from the events rather than from the
 * clock — and this file is the drawing of it.
 *
 * Three decisions worth stating, because each of them is a thing somebody will want to undo:
 *
 *   - **Today's whole column is filled**, not badged, not outlined. It is the household's own
 *     instruction — *"today would be highlighted the entire column"* — and it is the only part
 *     of this screen that works with the words switched off. A pre-reader finds today the way
 *     she finds her own face: by looking, not by reading.
 *   - **A chip carries the words OR the picture, never both.** At a seventh of a 912px pane a
 *     column is ~123px wide, and an icon beside a title leaves the title 83px, which turns
 *     "Dance class" into two clamped lines and then an ellipsis. The band already says which
 *     of the two this reader needs; asking it is cheaper than splitting the width.
 *   - **This is drawn here rather than through the `EventCard` leaf.** That leaf is a ROW in a
 *     list — fixed at `agendaRowHeight`, laid out horizontally, sized for a full-width column.
 *     A block in a 123px column is not the same object, and forcing one component to be both
 *     is how a design system acquires a component that is wrong in both places. It still asks
 *     the band for every size it uses, which is what the rule was protecting.
 *
 * ## One component, three widths (2026-09-10)
 *
 * This used to be the calendar destination and nothing else, with the idle board drawing a
 * separate LIST beside it. The household's verdict after the first real evening: *"on the home
 * screen it has today and times, but you can't scroll on it. It's almost like the calendar view
 * is better. Maybe that home view is like the calendar view, but it's just today and tomorrow,
 * and the calendar view would be the full week."*
 *
 * So there is one grid now, at three widths, and each is the same reading at a different range:
 *
 *   - **2 days** — the idle board. Today and tomorrow, wide, read from the kitchen.
 *   - **5 days** — the calendar destination. The week's shape.
 *   - **1 day** — one day full-screen, which is where a title finally has room to be read in
 *     full. *"Because Friday, I see individual picture, but I can't see a full description."*
 *
 * The two lists that used to do this could not share a rule between them; this cannot help it.
 *
 * ## Distance is the CALLER'S to declare, not this file's
 *
 * It used to wrap itself in `NearScope`, which was correct while its only caller was a
 * destination somebody walks up to. It is now also the idle wall — the screen the 6:00 AM
 * invariant is about, read from ten feet — and a component that silently shrinks its own type
 * would have taken a step off the scale on exactly the screen where nothing may shrink (H8).
 * `WallApp` says `near` for the destination and says nothing for the board.
 *
 * That is also why the chip height comes from `chipPxFor(typo)` rather than from the constant:
 * the same grid draws a 24px title from the kitchen and a 20px one at arm's length.
 */

import {
  childAccentForSlot,
  colour,
  cssTokens,
  sourceStripe,
  fontSizePx,
  fontWeight,
  iconPx,
  layoutPx,
  radius,
  spacePx,
  stateTreatments,
  strokePx,
  type BandTypography,
  type ChildAccent,
} from '../../design/tokens.ts';
import { useRef, type ReactNode } from 'react';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import { useBandTypography } from '../bands/registry.tsx';
import { AssetImage } from '../primitives/AssetImage.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { card, px, text } from '../primitives/style.ts';
import { Tappable } from '../primitives/Tappable.tsx';
import { eventTimeText } from '../logic/clock.ts';
import { childById } from '../logic/summary.ts';
import {
  CHIP_TITLE_LINES,
  WEEK_METRICS,
  chipEmojiPx,
  chipPxFor,
  chipShape,
  swipeDirection,
  chipTitlePx,
  headingPxFor,
  WEEK_HEAD_GAP_PX,
  WEEK_HEAD_PX,
  weekLayout,
  weekPanePx,
  type WeekDay,
  type WeekEvent,
  type WeekLayout,
  type WeekRow,
} from '../logic/week.ts';
import type { CalendarEventView, Child } from '../../../../src/types.ts';

const NO_TIME_WORD = 'When?';
const MORE_MARK = '+';

/**
 * Today's column, in the household's own colour.
 *
 * It was a light amber, borrowed from the chore state ladder, on the household's earlier
 * instruction — *"today would be highlighted the entire column… this highlighted yellow,
 * bright yellow, light yellow."* Changed to green on 2026-09-09 having been seen on the wall:
 * *"have slices, like, light green, like, super light, transparent ish green is today."*
 *
 * The TOKEN WANTED note that used to sit here is DISCHARGED, and the colour change is what
 * forced it. Today's column is a calendar position and not a chore state; borrowing
 * `stateTreatments.claimed` meant it would silently follow the chore palette anywhere that
 * moved. It now has `--c-today-fill` / `--c-today-edge` of its own.
 *
 * The green was chosen to MATCH the amber it replaces on both measured axes rather than by
 * eye — 1.26 against the white columns either side where the amber was 1.24, and 5.82 for ink
 * on it where the amber was 5.89 — so this changes the hue and provably nothing else. See
 * tokens.css, which also records why the palette's "light green next to light amber is the
 * deuteranope trap" warning does not reach this screen.
 */
const TODAY_FILL = colour.todayFill;
const TODAY_EDGE = colour.todayEdge;

/** An event that has already finished is faded, not removed — "school BEFORE that". */
const PAST_OPACITY = stateTreatments.superseded.opacity;
const LIVE_OPACITY = stateTreatments.pending.opacity;

export interface WeekViewProps {
  childId: string | null;
  days: number;
  /** Where the window opens, in days after today. 0 unless one day has been focused. */
  startOffset?: number | undefined;
  /**
   * Tapping a day.  Absent, the days are not controls at all — which is the honest state for a
   * surface with nowhere to go, and keeps the audit's tap rules off a column that does nothing.
   */
  onPickDay?: ((offset: number) => void) | undefined;
  /**
   * A sideways swipe across the card: +1 asks for later days, -1 for earlier. Absent, the card
   * does not listen — the idle board is glanced at, not dragged.
   */
  onSwipe?: ((direction: 1 | -1) => void) | undefined;
  /**
   * A row drawn across the top of the card, above the days: the calendar's pager, in a shell
   * whose header has no room for it (`pagerPlace` in logic/theme.ts). The row is the tap floor
   * tall and the grid is fitted under it (`weekPanePx`), so what is passed here is laid out in
   * a 64px flex row and must fit one.
   */
  head?: ReactNode | undefined;
}

export function WeekView({ childId, days, startOffset, onPickDay, onSwipe, head }: WeekViewProps) {
  return (
    <WeekGrid
      childId={childId}
      days={days}
      startOffset={startOffset ?? 0}
      onPickDay={onPickDay}
      onSwipe={onSwipe}
      head={head}
    />
  );
}

function WeekGrid({
  childId,
  days,
  startOffset,
  onPickDay,
  onSwipe,
  head,
}: {
  childId: string | null;
  days: number;
  startOffset: number;
  onPickDay: ((offset: number) => void) | undefined;
  onSwipe: ((direction: 1 | -1) => void) | undefined;
  head: ReactNode | undefined;
}) {
  const { snapshot, clock } = useWall();
  const { frame } = useWallLayout();
  const typo = useBandTypography();
  /*
    THE SWIPE. Pointer events on the card, and `touch-action: none` on it while somebody can
    swipe, which is what makes them arrive: under the body's `manipulation` a sideways drag
    becomes a pan gesture, Chromium fires pointercancel and swallows the pointerup, and the
    card never learns how far the finger went. With `none` it gets the whole gesture — and a
    touch that moved past the slop still produces no click, so a swipe that ends over Tuesday
    does not also open Tuesday.
  */
  const swipeStart = useRef<{ id: number; x: number; y: number } | null>(null);
  // Both derived from the ACTIVE typography, never from the constants: this grid is drawn at
  // two distances now, and a chip or a heading sized for the other one clips its text.
  const headingPx = headingPxFor(typo.primaryTextPx, typo.secondaryTextPx);
  // The title's size narrows with the column, and the chip's height budget is computed from the
  // size that will actually be DRAWN — the two must not be able to disagree.
  const titlePx = chipTitlePx(typo.primaryTextPx, days);
  const layout = weekLayout(snapshot.events, {
    childId,
    nowMs: clock.nowMs,
    days,
    startOffset,
    chipPx: chipPxFor(titlePx, typo.secondaryTextPx, chipEmojiPx(typo), chipShape(days)),
    headingPx,
    // The body this shell left — 412 beside a side rail, 348 above felt's bottom one — less
    // the head row when the pager stands in it.
    panePx: weekPanePx(frame.body.height, head !== undefined),
  });

  return (
    // ONE card around the whole week, for the reason UpcomingPanel is one card: the columns are
    // transparent so today's fill can be the only filled thing on the screen, and transparent
    // columns sat directly on the backdrop would put a title over a pine tree.
    <div
      style={card({
        display: 'flex',
        flexDirection: 'column',
        gap: px(WEEK_METRICS.gapPx),
        padding: px(spacePx.xs),
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        touchAction: onSwipe === undefined ? undefined : 'none',
      })}
      onPointerDown={
        onSwipe === undefined
          ? undefined
          : (e) => {
              swipeStart.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            }
      }
      onPointerUp={
        onSwipe === undefined
          ? undefined
          : (e) => {
              const start = swipeStart.current;
              swipeStart.current = null;
              if (start === null || start.id !== e.pointerId) return;
              const direction = swipeDirection(e.clientX - start.x, e.clientY - start.y);
              if (direction !== 0) onSwipe(direction);
            }
      }
      onPointerCancel={() => {
        swipeStart.current = null;
      }}
    >
      {head === undefined ? null : (
        <div
          data-week-head=""
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: px(spacePx.tapGap),
            height: px(WEEK_HEAD_PX),
            flex: '0 0 auto',
            minWidth: 0,
            // The card's own gap plus this is the tap gutter: the pager's keys above, the days
            // (controls too) below. `weekPanePx` has already paid for it.
            marginBottom: px(WEEK_HEAD_GAP_PX - WEEK_METRICS.gapPx),
          }}
        >
          {head}
        </div>
      )}
      {/*
        THE TAP GUTTER BETWEEN COLUMNS, not the card's own 8px rhythm.

        It was `spacePx.xs` while a day was a drawing. A day is a CONTROL now — tap it and it
        fills the screen — and two 392px-tall targets a hand's width apart with 8px between them
        is exactly the mis-tap the 16px inert gutter exists to prevent. Found by the panel audit
        on the first deploy that made them tappable.

        It costs each column ~6px of width at five across, and buys nothing vertical, which is
        where this grid's budget actually lives.
      */}
      <div style={{ display: 'flex', gap: px(spacePx.tapGap), flex: 1, minWidth: 0, minHeight: 0 }}>
        {layout.days.map((day) => (
          <DayColumn
            key={day.date}
            day={day}
            layout={layout}
            typo={typo}
            roster={snapshot.children}
            headingPx={headingPx}
            titlePx={titlePx}
            onPick={onPickDay}
          />
        ))}
      </div>
      {layout.unplaceable.length === 0 ? null : (
        <UnplacedStrip events={layout.unplaceable} typo={typo} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A day
// ---------------------------------------------------------------------------

function DayColumn({
  day,
  layout,
  typo,
  roster,
  headingPx,
  titlePx,
  onPick,
}: {
  day: WeekDay;
  layout: WeekLayout;
  typo: BandTypography;
  roster: readonly Child[];
  headingPx: number;
  titlePx: number | null;
  onPick: ((offset: number) => void) | undefined;
}) {
  const byRow = new Map<number, WeekEvent[]>();
  for (const item of day.timed) {
    const bucket = byRow.get(item.row);
    if (bucket === undefined) byRow.set(item.row, [item]);
    else bucket.push(item);
  }

  /*
    THE WHOLE COLUMN IS THE TARGET, and there is no button drawn inside it.

    A day already looks like a control: it has a name, a date under it, a rule beneath that, and
    a fill of its own when it is today. A chevron or a "see all" would cost width the column has
    not got at five across, and would give a five-year-old a small thing to hit inside a big
    thing that does nothing.

    It cannot fail the 64px tap floor — a column is the full height of the grid and the narrowest
    it ever gets is a fifth of the pane — and `Tappable` renders a plain div when there is
    nowhere to go, so a surface with no destination is not a control the audit has to reason
    about. That is the same rule the chore card follows: never a greyed-out button.
  */
  return (
    <Tappable
      enabled={onPick !== undefined}
      onTap={() => {
        onPick?.(day.offset);
      }}
      style={{
        flex: '1 1 0',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: px(WEEK_METRICS.gapPx),
        background: day.isToday ? TODAY_FILL : 'transparent',
        // A <button> brings its own border, its own centred text and its own font. None of
        // those belong to a day; the column's look is the column's, at either end of the
        // enabled/not switch.
        border: 'none',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'inherit',
        appearance: 'none',
        borderRadius: radius.md,
        // Side padding only. The fill runs to the top and bottom edges because the
        // instruction was "the entire column", and because vertical padding here would be
        // height the grid budget in week.ts has not been told about.
        paddingLeft: px(spacePx.xxs),
        paddingRight: px(spacePx.xxs),
        boxSizing: 'border-box',
        // The count of what did not fit rides in the corner rather than in the flow: a row of
        // its own would cost every column height whether or not anything overflowed.
        position: 'relative',
      }}
    >
      <DayHeading day={day} typo={typo} headingPx={headingPx} />
      {layout.allDayRows === 0 ? null : (
        <div
          style={{
            flex: '0 0 auto',
            height: px(layout.allDayRows * WEEK_METRICS.allDayRowPx),
            display: 'grid',
            gridTemplateRows: `repeat(${String(layout.allDayRows)}, minmax(0, 1fr))`,
            gap: px(spacePx.xxs),
            minHeight: 0,
          }}
        >
          {day.allDay.map((event) => (
            <AllDayChip key={event.id} event={event} typo={typo} />
          ))}
        </div>
      )}
      {/*
        The axis. Every column renders the SAME row list with the same basis and the same
        growth, so a row lands at the same height in all of them — which is the whole reason
        this is a grid and not seven agendas side by side. Live rows take the slack (a taller
        stack takes proportionally more of it); quiet rows never do.
      */}
      <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {layout.rows.map((row, index) => (
          <AxisCell
            key={`${String(row.startHour)}-${String(row.kind)}`}
            row={row}
            items={byRow.get(index) ?? []}
            layout={layout}
            typo={typo}
            roster={roster}
            titlePx={titlePx}
          />
        ))}
      </div>
      {day.overflow === 0 ? null : (
        <span
          style={{
            ...text(typo.secondaryTextPx ?? fontSizePx.meta, { muted: true }),
            position: 'absolute',
            right: px(spacePx.xxs),
            bottom: 0,
          }}
        >
          {`${MORE_MARK}${String(day.overflow)}`}
        </span>
      )}
    </Tappable>
  );
}

/**
 * The word first, the date under it, and never the other way round.
 *
 * A bare "27" locates nothing for a five-year-old, and "Tuesday, August 25" was the widest
 * element on the old wall for no benefit (H5 §3.1). The word is what the child uses; the date
 * is for the adult standing next to her.
 */
function DayHeading({
  day,
  typo,
  headingPx,
}: {
  day: WeekDay;
  typo: BandTypography;
  headingPx: number;
}) {
  return (
    <div
      style={{
        flex: '0 0 auto',
        height: px(headingPx),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minWidth: 0,
        borderBottom: `${px(strokePx.min)} solid ${day.isToday ? TODAY_EDGE : colour.border}`,
        boxSizing: 'border-box',
      }}
    >
      {typo.showsText ? (
        <>
          <span style={text(typo.primaryTextPx ?? fontSizePx.body, { weight: fontWeight.black })}>
            {day.heading}
          </span>
          <span style={text(typo.secondaryTextPx ?? fontSizePx.meta, { muted: true })}>
            {day.subheading}
          </span>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The axis
// ---------------------------------------------------------------------------

function AxisCell({
  row,
  items,
  layout,
  typo,
  roster,
  titlePx,
}: {
  row: WeekRow;
  items: readonly WeekEvent[];
  layout: WeekLayout;
  typo: BandTypography;
  roster: readonly Child[];
  titlePx: number | null;
}) {
  if (row.kind === 'quiet') {
    // A collapsed span of empty hours, drawn rather than deleted. Six school hours and one
    // empty hour cost the same here, and the rule says so out loud instead of the day simply
    // jumping.
    return (
      <div
        style={{
          flex: `0 0 ${px(row.heightPx)}`,
          display: 'flex',
          alignItems: 'center',
          minHeight: 0,
        }}
      >
        <span style={{ flex: 1, borderTop: `${px(strokePx.min)} dashed ${colour.border}` }} />
      </div>
    );
  }

  return (
    <div
      style={{
        flexBasis: px(row.heightPx),
        // Live rows take the slack a quiet week leaves, in proportion to how much they hold —
        // but only up to a card's height per chip. Past that a chip stops looking like an
        // event and starts looking like a panel, and a week with one thing in it SHOULD read
        // as a week with one thing in it. The leftover stays empty at the bottom.
        flexGrow: row.stack,
        flexShrink: 1,
        maxHeight: px(row.stack * layout.chipGrowMaxPx),
        minHeight: 0,
        display: 'grid',
        // One track per chip the BUSIEST day stacks here, so a lone event on Tuesday is the
        // same size as each of Saturday's three and lines up with the first of them.
        gridTemplateRows: `repeat(${String(row.stack)}, minmax(0, 1fr))`,
        gap: px(spacePx.xxs),
        boxSizing: 'border-box',
      }}
    >
      {items.map((item) => (
        <EventChip
          key={item.event.id}
          item={item}
          layout={layout}
          typo={typo}
          titlePx={titlePx}
          accent={accentFor(roster, item.event)}
        />
      ))}
    </div>
  );
}

function accentFor(children: readonly Child[], event: CalendarEventView): ChildAccent | null {
  const owner = childById(children, event.childId);
  return owner === null ? null : childAccentForSlot(owner.sortOrder);
}

function EventChip({
  item,
  layout,
  typo,
  titlePx,
  accent,
}: {
  item: WeekEvent;
  layout: WeekLayout;
  typo: BandTypography;
  titlePx: number | null;
  accent: ChildAccent | null;
}) {
  return (
    <div
      style={{
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        // A ROW at two columns or fewer, a STACK above that — `chipShape` in week.ts says why,
        // and `chipPxFor` was paid for the same shape, so the two cannot disagree.
        flexDirection: layout.chipShape === 'row' ? 'row' : 'column',
        alignItems: layout.chipShape === 'row' ? 'center' : 'stretch',
        justifyContent: 'center',
        gap: layout.chipShape === 'row' ? px(spacePx.xs) : 0,
        // White on the plain ground and white on today's yellow: the chip has to separate from
        // both, and an outline would not at 225 nits behind etched glass (H5 §3.5).
        background: colour.surface,
        // The CALENDAR's colour where no child owns the event. `colourToken` has been on the
        // wire since the freeze and was drawn by nothing, so School and Family looked identical.
        borderLeft: `${px(strokePx.focus)} solid ${
          accent === null ? sourceStripe(item.event.colourToken) : accent.solid
        }`,
        borderRadius: radius.sm,
        // Vertical padding as well as horizontal, and it is the 2 x xxs that `chipPxFor` was
        // already charging the grid for. Without it the budget and the render disagreed by 8px
        // in the render's favour, so a chip that exactly filled its row put the last line of a
        // wrapped title flush against its own bottom edge — measurably not clipped, and it read
        // as clipped, which on this panel is the same defect.
        padding: `${px(spacePx.xxs)} ${px(spacePx.xxs)}`,
        opacity: item.isPast ? PAST_OPACITY : LIVE_OPACITY,
        boxSizing: 'border-box',
      }}
    >
      {typo.showsText ? (
        <>
          {/*
            The time leads. It is one line and it is the thing the household said out loud —
            "dance class happens tomorrow at four PM" — so it must survive a title that wraps;
            below the title it would be the first thing a short row clipped.

            THE EMOJI RIDES WITH THE TIME, not with the title, and that placement is the whole
            reason it can be here at all. This file's own header refuses an icon beside a title:
            *"at a seventh of a 912px pane a column is ~123px wide, and an icon beside a title
            leaves the title 83px, which turns 'Dance class' into two clamped lines and then an
            ellipsis."* That arithmetic is still correct and still binding — so nothing is put
            beside the title. The time line is short ("4:25 PM"), it is already one line, and it
            has room to spare at every band; the emoji costs the TITLE nothing.

            Asked for 2026-09-09, for the two children who cannot read the title. `null` for a
            word the table does not know, which draws nothing — see src/calendar/classify.ts.
          */}
          <span
            style={{
              ...text(typo.secondaryTextPx ?? fontSizePx.meta, { muted: true }),
              display: 'flex',
              alignItems: 'center',
              gap: px(spacePx.xxs),
              minWidth: 0,
              // In a row the time and its emoji keep their width and the TITLE is the thing
              // that gives — the same rule as the chore card: the name may ellipsise, the
              // time a household says out loud may not.
              flex: layout.chipShape === 'row' ? '0 0 auto' : undefined,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {eventTimeText(item.event.when)}
            </span>
            {item.event.emoji === null ? null : (
              // Sized off the band's own icon scale rather than the text, because it IS an
              // icon: at the secondary text size it would be the smallest thing on the wall
              // and this is the channel for the reader who has no other one.
              <span
                aria-hidden="true"
                style={{
                  fontSize: px(chipEmojiPx(typo)),
                  lineHeight: cssTokens['--lh-snug'],
                  flex: '0 0 auto',
                }}
              >
                {item.event.emoji}
              </span>
            )}
          </span>
          {/*
            The clamp and the height budget are THE SAME NUMBER, from `week.ts`. They were 2 and
            1 for one deploy and every long title on the calendar was cut through its second
            line — the budget said a chip needed 51px and the chip drew 76.
          */}
          <span
            style={{
              ...text(titlePx ?? fontSizePx.body, {
                wrap: true,
                lines: CHIP_TITLE_LINES,
              }),
              minWidth: 0,
              flex: layout.chipShape === 'row' ? 1 : undefined,
            }}
          >
            {item.event.title}
          </span>
        </>
      ) : (
        <AssetImage
          asset={item.event.icon}
          sizePx={chipIconPx(typo, layout)}
          style={{ margin: 'auto' }}
        />
      )}
    </div>
  );
}

/** The band's icon, bounded by the chip it has to fit inside. */
function chipIconPx(typo: BandTypography, layout: WeekLayout): number {
  return Math.max(iconPx.xs, Math.min(typo.secondaryIconPx, layout.chipPx - spacePx.md));
}

// ---------------------------------------------------------------------------
// The things that are not on the axis
// ---------------------------------------------------------------------------

/**
 * All-day events frame the day rather than sitting in it, so they sit above the axis in their
 * own strip — the same place Google puts them, and for the same reason: an event with no start
 * hour has nowhere on a time axis to be.
 */
function AllDayChip({ event, typo }: { event: CalendarEventView; typo: BandTypography }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        background: colour.surface,
        border: `${px(strokePx.min)} solid ${colour.borderStrong}`,
        borderRadius: radius.pill,
        paddingLeft: px(spacePx.xs),
        paddingRight: px(spacePx.xs),
        boxSizing: 'border-box',
      }}
    >
      {typo.showsText ? (
        <span style={text(typo.secondaryTextPx ?? fontSizePx.meta, { weight: fontWeight.black })}>
          {event.title}
        </span>
      ) : (
        <AssetImage asset={event.icon} sizePx={iconPx.xs} style={{ margin: 'auto' }} />
      )}
    </div>
  );
}

/**
 * An event we could not read a time from, on the screen anyway.
 *
 * The alternative is a filter, and a filter is how a wall loses the orthodontist. It is not
 * pinned to a day, because we do not know the day and inventing one is worse than admitting
 * we cannot place it — the strip says "when?" and shows the title, which is enough for an
 * adult to go and look.
 */
function UnplacedStrip({
  events,
  typo,
}: {
  events: readonly CalendarEventView[];
  typo: BandTypography;
}) {
  return (
    <div
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.xs),
        minWidth: 0,
        borderTop: `${px(strokePx.min)} solid ${colour.border}`,
        paddingTop: px(spacePx.xxs),
      }}
    >
      <Glyph name="alert" sizePx={iconPx.xs} tone={colour.danger} />
      {typo.showsText ? (
        <span style={text(typo.secondaryTextPx ?? fontSizePx.meta, { muted: true })}>
          {`${NO_TIME_WORD} ${events.map((e) => e.title).join(', ')}`}
        </span>
      ) : (
        events.map((event) => (
          <AssetImage key={event.id} asset={event.icon} sizePx={iconPx.xs} />
        ))
      )}
    </div>
  );
}
