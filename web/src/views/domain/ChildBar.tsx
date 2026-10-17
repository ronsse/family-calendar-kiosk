/**
 * Unit H — the selector: three faces, in their fixed order.
 *
 * This is the one surface all three bands use at the same moment, so each avatar
 * is drawn in ITS OWN child's band rather than in the band of whoever is currently
 * selected.  The three-year-old has to be able to find herself while her sister's
 * screen is up; if the bar rendered in her sister's fluent band she would be
 * looking for her face among names.
 *
 * `BandScope` is a registry lookup, not a branch — the whole point of Q3's design.
 */

import type { CSSProperties } from 'react';
import {
  childAccentForSlot,
  colour,
  cssTokens,
  fontWeight,
  iconPx,
  layoutPx,
  radius,
  strokePx,
  type ChildAccent,
} from '../../design/tokens.ts';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import { BandLeaf, BandScope } from '../bands/registry.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { plateStyle, px, tapColumn, tapRow, tapTarget } from '../primitives/style.ts';
import { railKeyPlate } from '../logic/plate.ts';
import { avatarRef, orderedChildren } from '../logic/summary.ts';
import { sceneFace } from '../logic/sceneFace.ts';
import {
  NAME_PILL_EDGE_PX,
  NAME_PILL_PAD_X_PX,
  NAME_PILL_PAD_Y_PX,
  planRailNames,
  railInsetPx,
  tileFramePx,
  type RailNamePlan,
} from '../logic/railNames.ts';
import type { RailDraw } from '../logic/theme.ts';

/**
 * The rail is PERMANENT, and it is always the same place on a given wall.
 *
 * It used to appear only once a child was selected, on the reasoning that the idle wall
 * already draws three faces in the middle and a rail would be the same row twice. True, and
 * the fix was the wrong half: navigation that is only there after you have already navigated
 * is not navigation. The faces moved OUT of the ambient view and INTO the rail, so there is
 * one switcher, in one place, on every screen — which is the property the pre-reader actually
 * uses, and it now holds while her sister's day is up.
 *
 * ## Four ways to draw it, one per theme plus one (2026-10)
 *
 * The household picks the wall's theme behind the PIN, and the theme decides where the faces
 * stand (`WallLayout.rail`, logic/theme.ts). The shell decides how the rail is DRAWN on the
 * screen in front of it (`ShellGeometry.rail`), and this component only ever asks which form:
 *
 *   - `row` — felt: a bar of faces along the BOTTOM edge, each with its name in a pill beside
 *     it. The three-year-old's reach is at the bottom of the glass, and a bar there is charged
 *     against the long axis rather than the scarce one. One tap target tall (64): the face is 56.
 *   - `column` — felt on the grown-up screens: the plain column of faces the wall has had since
 *     2026-09-15, beside the 816px body those screens were measured against.
 *   - `plinth` — gallery: a sunken column on the left with the portraits standing on it in square
 *     frames, names under them. The selected portrait gets an ink frame, not a tint.
 *   - `spine` — storybook: a dark column on the left, light names on it, and the selected child's
 *     tile is a BOOKMARK — the page's own paper, joined to the page across the spine's edge.
 *
 * EVERY NAME, WHOLE, ONE SIZE (2026-10-11). The names on the three named forms are the rail's,
 * not the bands': the rail sets every child's whole name at the one size that lets all of them
 * fit (logic/railNames.ts — type gives first, then a line, then on the bottom row the face), and
 * each band only places it inside its key. The bands used to draw them, and drew "Child A",
 * "Child" and nothing for the pre-reader; his name is for the readers in the room, not for him.
 *
 * The rail carries no progress, and that is a measurement rather than a preference. Marks
 * wrap: the middle child's eight ran to two rows, his tile came to ~190px, and three tiles then needed
 * more than the 420px the shell has to give. Progress belongs on the face as a RING — which
 * costs no height at all, and is what Skylight does (H5 §2) — and until that exists the rail
 * is navigation and only navigation.
 *
 * Deliberately NOT a drawer. A pull-out is a mode, and a three-year-old who opens one has no
 * way to read her way out of it — the 90-second idle decay resets the selected child but
 * cannot rescue a child from a state she does not know she is in. A fixed rail has nothing
 * to get stuck in, and every form holds its geometry whoever is selected: the faces are in the
 * same three positions on every screen of a given theme.
 *
 * `data-rail` and `data-rail-child` are for the panel audit, which used to find the rail by
 * "left of 130px" and would have read felt's bottom row as content.
 */
export function ChildBar({
  activeChildId,
  onSelect,
  onHome,
  awayFromHome,
  form,
}: {
  activeChildId: string | null;
  onSelect: (childId: string) => void;
  /** Back to the household board. Omit and no home button is drawn. */
  onHome?: (() => void) | undefined;
  /**
   * True when something other than the household board is showing — a child, or one of the
   * wall's own destinations. The home button is live exactly then, and inert otherwise, so
   * "am I already home" is answerable without reading anything.
   */
  awayFromHome?: boolean | undefined;
  /** How the rail is drawn on this screen: the shell's answer (`ShellGeometry.rail`). */
  form: RailDraw;
}) {
  const { snapshot, resetKey } = useWall();
  const { layout, frame } = useWallLayout();
  const children = orderedChildren(snapshot.children);
  const row = form === 'row';
  const onSpine = form === 'spine';
  const away = awayFromHome ?? activeChildId !== null;
  const homePlate = railKeyPlate(form, away);
  // Every child's name, whole, at one size — or none, on the grown-up screens' plain column. The
  // bottom row is charged its whole length; a side rail, its own width.
  const names = planRailNames(
    form,
    children.map((c) => c.displayName),
    row ? frame.body.width : layoutPx.sideWidth,
    onHome !== undefined,
  );

  return (
    <nav data-rail={form} style={railStyle(form)}>
      {/*
        THE WAY BACK. Until now the only exit from a child's screen was to wait ninety seconds
        for the idle decay — which is not navigation, it is a timeout, and a five-year-old who
        opened her sister's board had no way to leave it.

        First in the rail, always the same place, and drawn as a HOUSE rather than a face: it is
        a control, not a person, and the difference has to read at arm's length and from the
        kitchen. Home is the PICTURE (2026-09-13): on the board it is live whenever there is a
        picture to go to, and inert only when there is none. Either way it keeps its place, so
        the rail's geometry never changes as you navigate.
      */}
      {onHome === undefined ? null : (
        <Tappable
          enabled={away}
          onTap={onHome}
          style={tapTarget(layoutPx.railHomeHeight, {
            minHeight: px(layoutPx.railHomeHeight),
            height: px(layoutPx.railHomeHeight),
            // A square key in the bottom row; the column's full width everywhere else.
            width: row ? px(layoutPx.railHomeHeight) : '100%',
            flex: '0 0 auto',
            ...(homePlate === null
              ? {
                  // On the plinth and the spine the rail is its own ground. Inert means "you are
                  // here": the key is filled — with the page's own paper on the spine, where the
                  // rail is dark and the page is where "here" is.
                  background: away ? 'transparent' : onSpine ? colour.bg : colour.surface,
                  border: `${px(strokePx.medium)} solid ${
                    onSpine ? colour.inkInverse : activeChildId === null ? colour.borderStrong : colour.border
                  }`,
                  opacity: activeChildId === null ? 1 : 0.85,
                }
              : // Felt's row and column have nothing under them but the week's picture, so the key
                // stands on a plate: raised while it goes somewhere, sunken while you are home.
                // It used to be an outline at 85% over the art. See logic/plate.ts.
                plateStyle(homePlate)),
            borderRadius: radius.lg,
          })}
        >
          <Glyph
            name="home"
            sizePx={iconPx.sm}
            tone={onSpine && away ? colour.inkInverse : colour.ink}
          />
        </Tappable>
      )}
      {children.map((child) => {
        /*
         * HER FACE FROM THIS WEEK'S PICTURE, when the picture says where it is.
         *
         * Not conditioned on the picture being the screen right now: the rail is how she gets
         * to her own screen from anywhere, and a face that changed depending on what was up
         * would be a worse landmark, not a better one. It is the same face either way — the one
         * she is wearing in the picture she will be looking for herself in.
         */
        const face = sceneFace(snapshot.scene, child.sortOrder, children.length);
        const selected = child.id === activeChildId;
        const accent = childAccentForSlot(child.sortOrder);
        return (
          <div key={child.id} data-rail-child={child.id} style={tileStyle(form, selected)}>
            <BandScope band={child.readingBand}>
              <BandLeaf
                leaf="Avatar"
                resetKey={resetKey}
                props={{
                  childId: child.id,
                  avatar:
                    face === null
                      ? avatarRef(child)
                      : { assetId: `scene:${child.id}`, url: face.image, isFallback: false },
                  crop: face?.head ?? null,
                  accent,
                  selected,
                  nameplate:
                    names === null ? undefined : (
                      <Nameplate
                        name={child.displayName}
                        plan={names}
                        accent={accent}
                        // Light on the spine's dark, except on the bookmark, which is the page.
                        tone={onSpine && !selected ? colour.inkInverse : colour.ink}
                      />
                    ),
                  nameAt: names?.place,
                  faceSizePx: names?.facePx,
                  frame: layout.faceFrame,
                  // The plinth and the spine say "selected" with their own shape (below); a tint
                  // as well would be the same word twice, in the weaker channel.
                  selectedTint: form === 'row' || form === 'column',
                  onSelect: () => {
                    onSelect(child.id);
                  },
                }}
              />
            </BandScope>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * A child's name as the rail sets it: WHOLE. No ellipsis, no clamp, nothing hidden — the plan
 * chose a size at which it fits, and if a name is longer than any plan, it wraps where it must
 * rather than lose its end. A pill beside the face on the bottom row, edged in her colour; a
 * caption under it on the side rails. `data-rail-name` is for the panel audit.
 */
function Nameplate({
  name,
  plan,
  accent,
  tone,
}: {
  name: string;
  plan: RailNamePlan;
  accent: ChildAccent;
  tone: string;
}) {
  const type: CSSProperties = {
    fontSize: px(plan.sizePx),
    fontWeight: fontWeight.bold,
    lineHeight: cssTokens['--lh-snug'],
    color: tone,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    textAlign: 'center',
    minWidth: 0,
  };
  if (plan.place === 'beside') {
    return (
      <span
        data-rail-name=""
        style={{
          ...type,
          flex: '0 1 auto',
          background: colour.surface,
          border: `${px(NAME_PILL_EDGE_PX)} solid ${accent.solid}`,
          borderRadius: radius.pill,
          padding: `${px(NAME_PILL_PAD_Y_PX)} ${px(NAME_PILL_PAD_X_PX)}`,
        }}
      >
        {name}
      </span>
    );
  }
  return (
    <span data-rail-name="" style={{ ...type, maxWidth: '100%' }}>
      {name}
    </span>
  );
}

/** The spine's right edge — the page's gutter, drawn. */
const SPINE_EDGE_PX = strokePx.focus;

/**
 * Above the backdrop, in every form. The rail is a sibling of the wall's decoration now rather
 * than a child of the positioned body row, and an absolutely positioned element at z-index 0
 * paints over static siblings — the faces would sit under the art.
 */
const ABOVE_BACKDROP: CSSProperties = { position: 'relative', zIndex: 1 };

function railStyle(form: RailDraw): CSSProperties {
  if (form === 'row') {
    return {
      ...tapRow,
      ...ABOVE_BACKDROP,
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      height: px(layoutPx.railBottomHeight),
      flex: '0 0 auto',
      minWidth: 0,
    };
  }
  const inset = railInsetPx(form);
  return {
    ...tapColumn,
    ...ABOVE_BACKDROP,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    flex: '0 0 auto',
    // An explicit width, always. Unconstrained the rail sizes to its widest child, and that
    // child once was whoever had the most pips today — a switcher whose width is a function of
    // the chore list. It took 272 of the wall's 912 before this.
    width: px(layoutPx.sideWidth),
    minWidth: 0,
    height: '100%',
    boxSizing: 'border-box',
    // Its top aligns with the header beside it; the bottom is the wall's own margin.
    paddingTop: px(layoutPx.wallPad),
    paddingBottom: px(layoutPx.wallPad),
    paddingLeft: px(inset),
    paddingRight: px(inset),
    ...(form === 'plinth'
      ? {
          // Sunken, and separated from the wall by a line rather than by contrast it cannot
          // count on: plinth to wall is 1.04 on paper and less behind the glass.
          background: colour.surfaceSunken,
          borderRight: `${px(strokePx.min)} solid ${colour.border}`,
        }
      : form === 'spine'
        ? {
            background: colour.surfaceInverse,
            borderRight: `${px(SPINE_EDGE_PX)} solid ${colour.borderStrong}`,
          }
        : {}),
  };
}

/**
 * The tile a face stands in. Every form gives every child the same box whoever is selected —
 * an invisible frame is still a frame — so selecting a child never moves another one.
 */
function tileStyle(form: RailDraw, selected: boolean): CSSProperties {
  const base: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    flex: '0 0 auto',
    boxSizing: 'border-box',
  };
  if (form === 'plinth') {
    // The portrait that is "on": a heavy ink frame around the whole tile, and the mat's white
    // behind it. Shape first, because the three hues are already spent on the frames.
    return {
      ...base,
      border: `${px(tileFramePx(form))} solid ${selected ? colour.ink : 'transparent'}`,
      borderRadius: radius.sm,
      background: selected ? colour.surface : 'transparent',
    };
  }
  if (form === 'spine') {
    // THE BOOKMARK. The selected tile is the page's own paper, its outer corners rounded and its
    // inner edge run across the spine's edge into the page, so the child's screen reads as the
    // page her bookmark is in. The overhang is padded back, so her face does not move.
    const overhang = railInsetPx(form) + SPINE_EDGE_PX;
    return selected
      ? {
          ...base,
          background: colour.bg,
          borderTopLeftRadius: radius.lg,
          borderBottomLeftRadius: radius.lg,
          marginRight: px(-overhang),
          paddingRight: px(overhang),
          position: 'relative',
          zIndex: 1,
        }
      : base;
  }
  return base;
}
