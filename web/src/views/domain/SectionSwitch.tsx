/**
 * The child's day is bigger than the wall, so she sees one part of it at a time.
 *
 * Measured on the panel 2026-08-25: a child's routine panel alone is 466px tall and her chore
 * board another ~260, against a content area of ~420. They do not both fit, and before this
 * they did not merely overflow — the remainder was UNTAPPABLE below the fold, so she could not
 * claim a chore at all.
 *
 * Shrinking the type was the alternative and was rejected: 225 nits behind anti-glare etch is
 * the constraint the whole design system is calibrated against, and a wall you cannot read
 * from the kitchen is not a smaller failure than a wall you cannot scroll.
 *
 * ## Rebuilt 2026-08-26 as ringed circles (H5 §3.4)
 *
 * It used to be two labelled pills, ~96px tall, sitting above a routine panel that then drew
 * its OWN header saying the same word again. Between them they spent ~150 of the 420px a
 * child's day gets, to say "Morning" twice.
 *
 * Now it is one circle per section — one per routine, plus Jobs — with a progress ring around
 * each. Three things fall out of that, and the third is why it is worth the change:
 *
 *   - **It reads with no words**, which is what the pre-reader needs and what two text pills
 *     could never be.
 *   - **The ring answers "how much of my morning is left" without entering it**, so the
 *     switch stops being pure navigation and starts carrying information.
 *   - **It is ~76px instead of ~150**, and the 74px it gives back is exactly what lets routine
 *     steps become a single full-width column — which is where a sequence belongs.
 *
 * Harvested from Skylight, which uses the same control for the same reason (H5 §2).
 *
 * ## Two properties that make this safe rather than a mode a child gets lost in
 *
 *   - The clock picks the default, so at 6:00 AM the routine is already showing and nobody
 *     taps anything. This is the same `opensAtLocal`/`closesAtLocal` data the routine panel
 *     uses, doing the same job one level up.
 *   - It is emphasis, never permission. Every section is one tap away, the tap targets are the
 *     band's own, and nothing here can make a chore unreachable.
 *
 * Not a band renderer leaf: `BandRenderers` is frozen (src/types.ts) and adding an eighth slot
 * is a stop-the-world change. This is chrome built from primitives, and it respects the band
 * the only way that matters — the pre-reader gets circles and no words at all.
 */

import type { AssetRef, ChoreKind } from '../../../../src/types.ts';
import type { GlyphName } from '../contract.ts';
import { colour, radius, spacePx, type ChildAccent } from '../../design/tokens.ts';
import { useBandTypography } from '../bands/registry.tsx';
import { AssetImage } from '../primitives/AssetImage.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { ProgressRing } from '../primitives/ProgressRing.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { plateStyle, px, tapRow, tapTarget, text } from '../primitives/style.ts';
import { doorPlate } from '../logic/plate.ts';
import { sectionSwitchMetrics } from '../logic/routineFit.ts';

/**
 * Which part of the day is on screen.
 *
 * A routine is identified by its RUN, not by the word "routine". The old two-value shape
 * could only ever show whichever run the clock had picked, so the eldest's bedtime routine was
 * unreachable all morning and her morning routine unreachable all evening — she had two
 * routines and one button.
 */
export type DaySection =
  | { kind: 'routine'; runId: number }
  /**
   * Chores, of ONE kind.
   *
   * Duties and paid extras are separate destinations rather than two sections of one list or a
   * badge on the paid ones — decided by panel 2026-08-27 (H10, unanimous). A badge makes
   * "duty" mean absence-of-badge, and absence is a COMPARISON: it says nothing at all on a day
   * with only one kind on the board, which for a three-year-old is most days. Two destinations
   * make each kind a positive, present thing with its own icon and its own progress.
   *
   * It also costs nothing. Measured on the panel: the switcher row is 800x76px and three
   * circles occupy 400 of it.
   */
  | { kind: 'chores'; choreKind: ChoreKind };

export function sameSection(a: DaySection, b: DaySection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'routine' && b.kind === 'routine') return a.runId === b.runId;
  if (a.kind === 'chores' && b.kind === 'chores') return a.choreKind === b.choreKind;
  return true;
}

export interface SectionOption {
  readonly section: DaySection;
  readonly label: string;
  /**
   * A routine's own authored icon, or a named glyph for the two chore destinations.
   *
   * The chore kinds get GLYPHS rather than assets on purpose: they are categories of the wall's
   * own, not household content, so there is nothing for an adult to author and nothing that can
   * go missing. A routine's icon is a fact about that routine; "duties" is a fact about this
   * application.
   */
  readonly icon: AssetRef | GlyphName | null;
  readonly done: number;
  readonly total: number;
}

/** Narrow the icon slot without a cast at the call site. */
function isGlyphName(icon: AssetRef | GlyphName | null): icon is GlyphName {
  return typeof icon === 'string';
}

function SectionButton({
  option,
  selected,
  onSelect,
  accent,
  ringPx,
  iconSizePx,
  showsText,
  textPx,
  tapPx,
}: {
  option: SectionOption;
  selected: boolean;
  onSelect: () => void;
  accent: ChildAccent;
  ringPx: number;
  iconSizePx: number;
  showsText: boolean;
  textPx: number;
  tapPx: number;
}) {
  return (
    <Tappable
      enabled
      onTap={onSelect}
      style={tapTarget(
        tapPx,
        // ON A PLATE, both of them (2026-10-11). The unchosen door used to be transparent at 70%
        // opacity, which was right when the page behind it was plain ground and has been 30% of
        // the week's picture under its label ever since the picture went behind every page. The
        // choice is carried by edge WEIGHT and by DEPTH — raised key, or pressed in — never by
        // colour alone: this panel is 225 nits behind etched glass and colour is the weakest
        // channel it has. See logic/plate.ts.
        plateStyle(doorPlate(selected), {
          // A ROW, ring beside label. Stacked it measured 104px tall and pushed the routine
          // panel's top to y=216, which left 300px for a panel that wanted 354 — the fourth
          // step fell off the bottom. Beside it, the button is the ring's own height.
          flexDirection: 'row',
          gap: px(spacePx.xs),
          padding: px(spacePx.xs),
          borderRadius: radius.xl,
        }),
      )}
    >
      <ProgressRing sizePx={ringPx} done={option.done} total={option.total} tone={accent.solid}>
        {option.icon === null ? (
          <Glyph name="unknown" sizePx={iconSizePx} tone={colour.ink} />
        ) : isGlyphName(option.icon) ? (
          <Glyph name={option.icon} sizePx={iconSizePx} tone={colour.ink} />
        ) : (
          <AssetImage asset={option.icon} sizePx={iconSizePx} />
        )}
      </ProgressRing>
      {showsText ? <span style={{ ...text(textPx), color: colour.ink }}>{option.label}</span> : null}
    </Tappable>
  );
}

export function SectionSwitch({
  options,
  value,
  onChange,
  accent,
}: {
  options: readonly SectionOption[];
  value: DaySection;
  onChange: (section: DaySection) => void;
  accent: ChildAccent;
}) {
  const typo = useBandTypography();
  // The ring is sized off the band's own secondary icon, capped at the rail's face, plus room
  // for the stroke and a little air. It is chrome, and its height is charged against the
  // routine pane under it — so the sizes are `sectionSwitchMetrics`, the same arithmetic the
  // routine's fit is tested against (logic/routineFit.ts).
  const { iconPx: iconSizePx, ringPx } = sectionSwitchMetrics(typo);
  return (
    <nav style={{ ...tapRow, gap: px(spacePx.tapGap), flex: '0 0 auto', justifyContent: 'flex-start' }}>
      {options.map((option) => (
        <SectionButton
          // One key per DESTINATION. Duties and extras are two chores sections, and a key of
          // plain 'chores' gave them the same one.
          key={
            option.section.kind === 'routine'
              ? `run-${String(option.section.runId)}`
              : `chores-${option.section.choreKind}`
          }
          option={option}
          selected={sameSection(option.section, value)}
          onSelect={() => {
            onChange(option.section);
          }}
          accent={accent}
          ringPx={ringPx}
          iconSizePx={iconSizePx}
          showsText={typo.showsText}
          textPx={typo.secondaryTextPx ?? 0}
          // `minTapPx`, not `navTapPx`. The rail's floor is 104 because it is the thing a
          // three-year-old aims at from across a room; this switcher sits inside a child's own
          // pane and its ring already sets a generous height. At 104 it measured 104px tall
          // and cost the fourth routine step.
          tapPx={typo.minTapPx}
        />
      ))}
    </nav>
  );
}
