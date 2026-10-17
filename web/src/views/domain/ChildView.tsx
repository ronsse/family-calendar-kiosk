/**
 * Unit H — one child's screen: her routines, her chores, her points.
 *
 * Nothing here is persisted.  The moment the wall decays to ambient this component
 * unmounts, which is the point: a selected child that survives the evening is the
 * wrong screen at 6:00 AM (H3, adopted as an H2 Q3 graft).
 */

import { useMemo, useState } from 'react';

import type { Child, RoutineRunView } from '../../../../src/types.ts';
import { childAccentForSlot, spacePx } from '../../design/tokens.ts';
import { useWall } from '../../app/wallContext.ts';
import { px } from '../primitives/style.ts';
import type { ChoreKind } from '../../../../src/types.ts';
import type { GlyphName } from '../contract.ts';
import { isStepDone } from '../logic/progress.ts';
import { stepKey, choreKey } from '../logic/tap.ts';
import { choreProgress } from '../logic/chores.ts';
import { timeBoxState } from '../logic/timebox.ts';
import { featureOn } from '../logic/features.ts';
import { countdownsThatFit } from '../logic/theme.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import { BOARD_DAYS } from './AmbientView.tsx';
import { ChoreBoard } from './ChoreBoard.tsx';
import { CountdownPanel } from './CountdownPanel.tsx';
import { PointsPanel } from './PointsPanel.tsx';
import { RoutinePanel } from './RoutinePanel.tsx';
import { SectionSwitch, sameSection, type DaySection, type SectionOption } from './SectionSwitch.tsx';
import { WeekView } from './WeekView.tsx';

/**
 * The one routine that matters right now: the open one, or failing that the one opening
 * soonest.
 *
 * Rendering every run at once is what put a child's chores off the bottom of the screen.
 * The eldest has a morning and a bedtime routine; stacked with the chore board they needed 1032px
 * of a 235px column, and `overflow: hidden` silently ate the difference — every chore, which
 * is the entire way she earns money, was below the fold and untappable (measured on the panel
 * 2026-08-25).
 *
 * This is emphasis, not permission: whichever run is shown stays fully interactive, and
 * `timeBoxState` still reports `blocksInteraction: false`. Nothing here decides what a child
 * is ALLOWED to tick — only which of her routines the wall leads with, which is exactly the
 * job `opensAtLocal` / `closesAtLocal` were shipped as data to do.
 */
/**
 * The two chore destinations, in words — for the bands that read them.  The pre-reader gets
 * neither: `typo.showsText` is false for her and the circles carry the whole distinction.
 *
 * "Jobs" and "Extras" rather than "Duties" and "Paid extras". A five-year-old reads the short
 * one, and "duty" is a word she does not have; "jobs" is what this household already calls
 * them out loud. "Extras" carries the optional half without needing the word "paid" — the star
 * on the circle and the points on the tiles say the rest.
 */
const DUTIES_WORD = 'Jobs';
const EXTRAS_WORD = 'Extras';

function currentRun(runs: RoutineRunView[], localTime: string): RoutineRunView | null {
  if (runs.length === 0) return null;
  let soonest: { run: RoutineRunView; wait: number } | null = null;
  for (const run of runs) {
    const box = timeBoxState(run.opensAtLocal, run.closesAtLocal, localTime);
    if (box.phase === 'open') return run;
    if (soonest === null || box.minutesUntilOpen < soonest.wait) {
      soonest = { run, wait: box.minutesUntilOpen };
    }
  }
  return soonest?.run ?? null;
}

export function ChildView({ child }: { child: Child }) {
  const { snapshot, clock, gate } = useWall();
  const { frame } = useWallLayout();
  // The household's surfaces (`household.features`). The server already ships an off surface's
  // lists empty; these decide which DESTINATIONS exist, because "Jobs" with nothing behind it is
  // still a button.
  const choresOn = featureOn(snapshot.household, 'chores');
  const moneyOn = featureOn(snapshot.household, 'money');
  const countdownsOn = featureOn(snapshot.household, 'countdowns');
  const runs = featureOn(snapshot.household, 'routines')
    ? (snapshot.routines ?? []).filter((r) => r.childId === child.id)
    : [];
  const run = currentRun(runs, clock.localTime);
  const accent = childAccentForSlot(child.sortOrder);

  // One option per routine, then Jobs. Every routine gets its own button now: the old
  // two-value switch could only show whichever run the clock had picked, so a bedtime routine
  // was unreachable all morning and a morning routine unreachable all evening.
  const options: SectionOption[] = useMemo(() => {
    const fromRuns = runs.map((r): SectionOption => {
      const steps = r.steps ?? [];
      return {
        section: { kind: 'routine', runId: r.runId },
        label: r.labelShort,
        icon: r.icon,
        done: steps.filter((st) => gate.value(stepKey(st.runStepId), isStepDone(st))).length,
        total: steps.length,
      };
    });

    // The gate, not the snapshot: the ring has to agree with what she can SEE, and what she can
    // see includes her own optimistic tap. Reading state alone would leave the ring still for
    // the whole undo window after she ticked something, which reads as the tap not working.
    const isDone = (c: { assignmentId: number; state: string }) =>
      gate.value(choreKey(c.assignmentId), c.state !== 'pending');

    // Both destinations are ALWAYS drawn, even when one is empty. The pre-reader navigates by
    // "always the same place", and a switcher whose buttons appear and vanish with the day
    // defeats exactly that. An empty ring already reads correctly — ProgressRing draws its
    // track alone, which says "none yet".
    const chorePart = (kind: ChoreKind, label: string, icon: GlyphName): SectionOption => ({
      section: { kind: 'chores', choreKind: kind },
      label,
      icon,
      ...choreProgress(snapshot.chores, child.id, kind, isDone),
    });

    if (!choresOn) return fromRuns;

    return [
      ...fromRuns,
      // `home` for what the house requires; `gift` for what earns.
      //
      // NOT `star`, which was the first choice and was wrong on the panel: `icons/fallback.png`
      // — the `_default` chore icon, worn by every chore nobody authored an icon for — IS a
      // star. Two of the four chores on this household's board carry it right now, so the star
      // would have meant "paid extras" in the switcher and "no icon" six inches below it, on
      // the same screen. The only thing separating them would have been colour, and colour may
      // never carry a fact at 225 nits behind etched glass.
      //
      // `gift` is unused anywhere else in the view layer — checked, not assumed — so it carries
      // no second meaning to collide with, and it says the right thing on its own: extras are
      // the jobs you choose in order to get something.
      //
      // `home` is the rail's own glyph, which is a real tension and is accepted: the rail's
      // home button is chrome outside this pane, always in one fixed place, while these are
      // ringed circles inside it — and the two senses are related rather than merely
      // colliding. The house, and the jobs the house asks for.
      chorePart('duty', DUTIES_WORD, 'home'),
      chorePart('extra', EXTRAS_WORD, 'gift'),
    ];
  }, [snapshot.chores, runs, child.id, gate, choresOn]);

  // The clock chooses, the child can override. Inside its window the routine leads, because
  // at 6:00 AM that is the only thing anybody wants on this screen and nobody should have to
  // tap to reach it. Outside it, chores lead. `null` means "she has not chosen", so the
  // default keeps tracking the clock rather than freezing at whatever it was when she opened
  // her card — ChildView is transient anyway; it unmounts when the wall decays to ambient.
  const [chosen, setChosen] = useState<DaySection | null>(null);
  // Outside a routine window, DUTIES lead rather than paid extras. What the household requires
  // is the thing a child is expected to open; the earning list is a choice she makes, and a
  // wall that opens on "here is how to get money" every time is a different product.
  //
  // With chores off, the routine leads whatever the hour (the soonest one), and with neither
  // there is no section at all — see the end of this component.
  const byClock: DaySection | null =
    run !== null &&
    (!choresOn || timeBoxState(run.opensAtLocal, run.closesAtLocal, clock.localTime).phase === 'open')
      ? { kind: 'routine', runId: run.runId }
      : choresOn
        ? { kind: 'chores', choreKind: 'duty' }
        : null;
  // A choice that no longer exists (a surface turned off while her screen was up) is no choice.
  const section: DaySection | null =
    chosen !== null && options.some((o) => sameSection(o.section, chosen)) ? chosen : byClock;
  const shownRun =
    section?.kind === 'routine' ? (runs.find((r) => r.runId === section.runId) ?? null) : null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: px(spacePx.md),
        minHeight: 0,
        minWidth: 0,
        flex: 1,
        overflow: 'hidden',
      }}
    >
      {/*
        One row of chrome, and it is the ONLY header this screen gets. The routine panel used
        to draw its own title bar underneath saying the same word again; between them they
        spent ~150 of the 420px a child's day has. See SectionSwitch.
      */}
      {options.length <= 1 || section === null ? null : (
        <SectionSwitch options={options} value={section} onChange={setChosen} accent={accent} />
      )}
      {/*
        The section gets the FULL width, which is what a routine step needs: the alternative
        to a wide tile is a wrapped or truncated label, and "Ge…" is not a step anyone can
        follow. Points live inside Jobs rather than in a column of their own — that is where
        they are earned, and a permanent right-hand column cost the section 200px of width to
        show a number that is zero most of the day.

        `overflowY: auto` is a safety net, not the plan. The common case fits; a household with
        many more chores degrades to a scroll rather than to content nobody can reach, which is
        the failure this whole area was fixed for.
      */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(spacePx.md),
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {shownRun !== null ? (
          <RoutinePanel key={shownRun.runId} run={shownRun} child={child} />
        ) : section === null || section.kind !== 'chores' ? (
          /*
            No routine to run and no chores to do (a household that turned both off, or a
            child with no routine today and chores off): her screen is the household's
            countdowns over HER days. Both components are the ambient board's own, with its
            props — this is not a third screen, it is the board narrowed to one child.
          */
          <>
            {countdownsOn && snapshot.countdowns.length > 0 ? (
              <CountdownPanel limit={countdownsThatFit(frame.body.height)} />
            ) : null}
            <WeekView childId={child.id} days={BOARD_DAYS} />
          </>
        ) : (
          <>
            {/*
              The balance lives on the EARNING board only, and it LEADS it (2026-10).

              It is not decoration that belongs on every screen — it is the answer to "what has
              this got me", and that question is only being asked on the list that pays. On the
              duties board it was a number next to work that is worth nothing by design, which
              invites precisely the wrong reading: that duties are underpaid rather than unpaid.
              It also gives the duties list back the vertical space, which is the constraint
              this whole area was rebuilt for.

              First rather than last: all three theme directions put the points at the head of
              the child's screen, where the eye lands, and the list under it is the way to more.
              It is not in the header itself — that bar is the wall's chrome, drawn in whoever's
              band is up, with ~260px of middle and a leave-by banner that claims it.
            */}
            {moneyOn && section.choreKind === 'extra' ? <PointsPanel child={child} /> : null}
            <ChoreBoard child={child} kind={section.choreKind} />
          </>
        )}
      </div>
    </div>
  );
}
