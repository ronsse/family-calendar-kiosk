/**
 * Unit H — the wall when nobody has touched it.
 *
 * This is what the room looks like almost all the time, including at 6:00 AM, so it is the
 * screen the prime invariant is really about.
 *
 * It used to draw the three children itself, in each child's own band, beside a narrow column
 * of household lists. That is gone: the faces live in the permanent rail now (see WallApp),
 * where they are one tap from every screen instead of only from this one. What is left here
 * is the household's day, and it gets the whole width that the avatars used to hold.
 *
 * Rendered in the AMBIENT band — the adults' and the fluent reader's — and at the FAR distance,
 * which is the default and is deliberately not opted out of. An idle wall that hid the day's
 * events behind pictograms would be useless to the person making lunches, and the rail is
 * already carrying the pre-reader's half of this screen.
 *
 * ## It is the calendar's little brother now (2026-09-10)
 *
 * The day used to be an agenda LIST here and a grid of day columns in the calendar destination
 * — two components, two height budgets, two sets of rules that could not be kept in step. The
 * household read both and said which one was right: *"on the home screen it has today and
 * times, but you can't scroll on it. It's almost like the calendar view is better. Maybe that
 * home view is like the calendar view, but it's just today and tomorrow, and the calendar view
 * would be the full week."*
 *
 * So this is `WeekView` at TWO DAYS, and the calendar destination is the same component at
 * five. The arithmetic, because "wider" is the whole claim: the board's pane is 816px beside
 * the 80px rail, three fifths of it when there is something to count down to, which is ~232px
 * per column — against the ~123px a day got in the old seven-across grid, and the ~160px it
 * gets in the five-day calendar. With no countdowns it is ~400px. Width is what buys the full
 * title, which is why no scroll had to be invented to fix a truncation — and at two columns a
 * chip is one ROW (time, emoji, title), the agenda line this grid replaced; see `chipShape`.
 *
 * **Tapping a day opens the calendar**, which is the household's own answer to the obvious
 * follow-up: *"clicking on tomorrow, maybe that takes you to the calendar."* Going back is the
 * house button in the rail, in the same place it is from every other screen.
 */

import { spacePx } from '../../design/tokens.ts';
import { NearScope } from '../bands/registry.tsx';
import { px } from '../primitives/style.ts';
import { CountdownPanel } from './CountdownPanel.tsx';
import { WeekView } from './WeekView.tsx';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import { countdownsThatFit } from '../logic/theme.ts';
import { featureOn } from '../logic/features.ts';

/**
 * Today and tomorrow, and nothing else.
 *
 * Named rather than inlined because it is half of a pair: this is the board and `WEEK_DAYS` in
 * WallApp is the calendar, and the whole point of the rebuild is that the difference between
 * the two screens is this one number.
 */
export const BOARD_DAYS = 2;

export function AmbientView({ onPickDay }: { onPickDay?: (() => void) | undefined }) {
  const { snapshot } = useWall();
  const { frame } = useWallLayout();
  /*
    Whether there is a right-hand column AT ALL.

    The comment below records why this pane is two columns: a single column down the middle
    "would leave half the wall empty — which is what the idle screen looked like before the
    calendar was connected, and the thing the operator saw first." On 2026-09-09 countdowns gained a
    60-day horizon, and the horizon put the wall straight back into that state — all four of
    the household's countdowns are months out, so the right column rendered as nothing and half
    the board was blank again.

    So the split is CONDITIONAL now. With something to count down to it is 3:2 as before; with
    nothing, the day takes the whole pane rather than holding space for an empty panel. The
    snapshot already carries only the countdowns that are inside the horizon, so this asks the
    same question the panel would — there is no second rule here to fall out of step.
  */
  // A household that turned countdowns off (`household.features`) gets the whole pane for the
  // day, the same as one with nothing inside the horizon. The server ships the list empty too.
  const counting = featureOn(snapshot.household, 'countdowns') && snapshot.countdowns.length > 0;
  return (
    <div style={{ display: 'flex', gap: px(spacePx.md), flex: 1, minHeight: 0, minWidth: 0 }}>
      {/*
        3:2. The day is the bigger job of the two and the one with longer strings in it;
        counting sleeps is a glance.
      */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(spacePx.md), flex: 3, minWidth: 0 }}>
        {/*
          NEAR, not far, since 2026-09-15 — and this is the one place the board departs from
          H8's "nothing on the idle wall may shrink". The day was drawn at the kitchen scale,
          24px titles over 17px times in chips that grew to 88px, and the household's verdict
          on the real wall was that it "is much larger than it needs to be". At the near scale
          a title is 20px logical — 40 physical, on a panel where the floor is 14 — which is
          still a size you read from the kitchen; what the far scale bought was air. The
          countdowns beside it stay far: three digits and a word are a glance, and the number is
          the whole card.
        */}
        <NearScope>
          <WeekView
            childId={null}
            days={BOARD_DAYS}
            onPickDay={onPickDay === undefined ? undefined : () => {
              // WHICH day was tapped is not passed on. From here the destination is the
              // calendar itself — five days, the shape of the week — and arriving on a single
              // focused day would skip the level that answers "what is this week like".
              // Focusing a day is a move you make from INSIDE the calendar, where there is
              // something to come back to.
              onPickDay();
            }}
          />
        </NearScope>
      </div>
      {/*
        Four, not two. Sorted by nearest, a limit of 2 could only ever surface the winter
        holiday and whichever birthday is next — so two of the three children's birthdays were
        structurally unreachable on a wall that has their birthdays on it precisely so they can
        count down to them.

        Four where four FIT, which is the side shell's 412px pane. Felt's bottom rail leaves the
        board 348, and a fixed four clipped the fourth card on the screen read from the kitchen
        — so the limit is what the pane holds (`countdownsThatFit`), three there.
      */}
      {counting ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: px(spacePx.md), flex: 2, minWidth: 0 }}>
          <CountdownPanel limit={countdownsThatFit(frame.body.height)} />
        </div>
      ) : null}
    </div>
  );
}
