/**
 * Unit H — the PICTURE band.  Child C is three and cannot read.
 *
 * There is no text in this file.  Not small text, not a numeral, not a single
 * letter: `bandTypography.picture.showsText` is `false` and every text size on it
 * is `null` rather than `0`, because a size invites someone to render at it.  If
 * she sees a word, the design has failed her — so this is enforced twice, by the
 * absence of the sizes and by test/unit-h.sources.test.ts, which greps this file
 * for the text-bearing prop names and for JSX text nodes.
 *
 * What she gets instead:
 *   - the largest icons and the largest tap targets in the system (the band scale
 *     inverts deliberately: less literacy buys bigger everything, because reading
 *     and fine motor control arrive together);
 *   - quantity as pips, and past `maxPips` a single "lots" heap;
 *   - "when" as an analog dial with hands and no digits;
 *   - state as a distinct SHAPE with a distinct fill, never as a hue.
 *
 * The props it receives are identical to the other two bands'.  It simply never
 * reaches for the fields it must not show.
 */

import type {
  AvatarProps,
  ChoreCardProps,
  CountdownCardProps,
  EventCardProps,
  PointsBadgeProps,
  RendererSet,
  RoutineStepProps,
  StatusPillProps,
} from '../contract.ts';
import {
  bandTypography,
  colour,
  freshnessColour,
  iconPx,
  radius,
  spacePx,
  stateTreatments,
  strokePx,
} from '../../design/tokens.ts';
import { AccentFrame, AssetImage } from '../primitives/AssetImage.tsx';
import { EmojiOrIcon } from '../primitives/EmojiOrIcon.tsx';
import { ClockFace, Glyph } from '../primitives/Glyph.tsx';
import { MoonPips, Pips } from '../primitives/Pips.tsx';
import { pipsForCount } from '../logic/pips.ts';
import { NAME_BELOW_GAP_PX, NAME_BESIDE_GAP_PX, NAME_TILE_PAD_PX } from '../logic/railNames.ts';
import { StateMark } from '../primitives/StateMark.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { card, px, tapTarget } from '../primitives/style.ts';
import { clockHands } from '../logic/clock.ts';

const TYPO = bandTypography.picture;

function PictureAvatar({
  crop,
  avatar,
  accent,
  selected,
  selectedTint,
  nameplate,
  nameAt,
  frame,
  faceSizePx,
  onSelect,
}: AvatarProps) {
  // He finds himself by the FACE — the one he is wearing in this week's picture. The name beside
  // or under it is the rail's, drawn for the readers in the room, and this leaf only gives it a
  // place in his key: it reads no word and sets none (2026-10-11). Until then his tile was the
  // one without a name, which read on the glass as his name gone missing.
  const face = faceSizePx ?? TYPO.navAvatarPx;
  // A rail that sets the face is one that names its children, and it charged the padding.
  const pad = faceSizePx === undefined ? spacePx.xs : NAME_TILE_PAD_PX;
  const beside = nameAt === 'beside';
  return (
    <Tappable
      enabled
      onTap={onSelect}
      style={tapTarget(TYPO.navTapPx, {
        flexDirection: beside ? 'row' : 'column',
        // 8, not the target's 12: the face is 64 and the rail is 80. See `navTapPx`.
        padding: px(pad),
        gap: px(beside ? NAME_BESIDE_GAP_PX : NAME_BELOW_GAP_PX),
        background: selected && selectedTint !== false ? accent.tint : 'transparent',
        borderRadius: radius.xl,
        ...(faceSizePx === undefined ? {} : { minHeight: px(face + 2 * pad) }),
      })}
    >
      <AccentFrame accent={accent} sizePx={face} selected={selected} shape={frame}>
        <AssetImage asset={avatar} sizePx={face} crop={crop} />
      </AccentFrame>
      {nameplate}
      {/*
        No progress marks in the rail. The rail is NAVIGATION — three faces to switch between —
        and the marks belong where the progress does: on the ambient wall, which is what the
        room sees almost all the time, and inside the child's own view. In the rail they were
        pure cost: 380px of rail against 381px of content.
      */}
    </Tappable>
  );
}

/**
 * One step of the routine — a row of its column, or a cell of its grid — sized by the panel
 * (`fit`) and not by this band.
 *
 * The picture shrinks with the rest when the routine is long — that is the auto-fit — but the
 * ROW never goes under the 64px tap floor, and the state mark keeps its shape at any size.
 * The next step wears the focus ring here too: the pre-reader cannot be told "the third one"
 * in words, and in a grid he cannot be told which way to read it either, so the ring is how the
 * wall points.
 */
function PictureRoutineStep({
  icon,
  done,
  confirmPending,
  isNext,
  position,
  showOrder,
  fit,
  markSide,
  markShape,
  onToggle,
}: RoutineStepProps) {
  const treatment = done ? stateTreatments.approved : stateTreatments.pending;
  const mark = <StateMark treatment={treatment} shape={markShape} sizePx={fit.markPx} />;
  return (
    <Tappable
      enabled
      onTap={onToggle}
      style={tapTarget(TYPO.minTapPx, {
        justifyContent: 'flex-start',
        width: '100%',
        // The fitted row, which may be under this band's 96: the floor a routine step keeps is
        // the wall's 64, so a long routine still fits the pane (logic/routineFit.ts).
        minHeight: px(fit.rowPx),
        height: px(fit.rowPx),
        padding: px(fit.padPx),
        background: done ? treatment.fill : colour.surface,
        // THE CONFIRM RING. One tap has landed and nothing has been applied yet, so this must
        // NOT look like "done" — it is a heavy ink outline, the same weight used for focus,
        // saying only "I heard you, do it again". Wordless on purpose: the pre-reader's screens
        // carry no text, and he is the child this mechanism most exists to protect. It outranks
        // the next-step ring, because what the wall is waiting for matters more than what is next.
        border: confirmPending
          ? `${px(strokePx.focus)} solid ${colour.ink}`
          : `${px(isNext && !done ? strokePx.focus : treatment.edgeWidthPx)} solid ${treatment.edge}`,
        borderRadius: radius.lg,
        opacity: treatment.opacity,
      })}
    >
      {/*
        Order as PIPS, not as a numeral, when the theme numbers its steps (storybook).

        Pips rather than a digit because a pre-reader cannot read "3", and this band already
        says so: its `quantity` is `pips` everywhere else on the wall. A numeral here would be
        the emergent band's answer borrowed for a child who cannot use it.
      */}
      {showOrder ? (
        <Pips
          spec={pipsForCount(position, 'picture')}
          sizePx={iconPx.sm}
          tone={done ? treatment.ink : treatment.edge}
        />
      ) : null}
      {markSide === 'start' ? mark : null}
      <AssetImage asset={icon} sizePx={fit.iconPx} />
      {markSide === 'end' ? <span style={{ marginLeft: 'auto', display: 'flex' }}>{mark}</span> : null}
    </Tappable>
  );
}

/**
 * A FILLED ROW, matching this band's routine steps and the fluent board (H5 §3.5).
 *
 * It used to be a stacked tile in a white card with a coloured edge. At 225 nits behind
 * etched glass an edge is the first thing to go, and a tile spends the scarce axis twice —
 * once on the icon, once on everything under it.
 *
 * The state is the theme's mark — felt's sticker at the end beside the points, or the ledger's
 * box leading the row — and the same mark the routine steps wear, so a ticked sticker means
 * one thing everywhere on his screen.
 */
function PictureChoreCard({
  icon,
  treatment,
  pips,
  accent,
  interactive,
  stillTime,
  markSide,
  markShape,
  onClaim,
}: ChoreCardProps) {
  const mark = <StateMark treatment={treatment} shape={markShape} sizePx={iconPx.md} />;
  return (
    <Tappable
      enabled={interactive}
      onTap={onClaim}
      style={tapTarget(TYPO.minTapPx, {
        justifyContent: 'flex-start',
        width: '100%',
        padding: px(spacePx.xs),
        background: treatment.fillRole === 'outline' ? accent.tint : treatment.fill,
        // The only channel a three-year-old gets, and it is a SHAPE — a heavier edge plus the
        // clock glyph below. Not colour: 225 nits behind etched glass is where colour goes to
        // die, and "red means late" is the exact pattern the contrast rules forbid.
        border: `${px(stillTime ? strokePx.focus : treatment.edgeWidthPx)} solid ${treatment.edge}`,
        borderRadius: radius.lg,
        opacity: treatment.opacity,
        borderLeftWidth: px(strokePx.focus),
        borderLeftColor: accent.solid,
      })}
    >
      {markSide === 'start' ? mark : null}
      <AssetImage asset={icon} sizePx={TYPO.secondaryIconPx} />
      {stillTime ? (
        // A CLOCK, deliberately, and never `alert`. The clock says "there is time in this";
        // the triangle says "something is wrong with you". She cannot read either word, so the
        // shape is the whole message and it has to be the right shape.
        <Glyph name="clock" sizePx={iconPx.md} tone={colour.ink} />
      ) : null}
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: px(spacePx.sm) }}>
        <Pips spec={pips} sizePx={iconPx.xs} tone={treatment.fillRole === 'solid' ? treatment.ink : colour.ink} />
        {markSide === 'end' ? mark : null}
      </span>
    </Tappable>
  );
}

function PicturePointsBadge({ pips, accent, pendingRedemptionPoints }: PointsBadgeProps) {
  return (
    <div
      style={card({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: px(spacePx.xs),
        padding: px(spacePx.md),
        background: accent.tint,
      })}
    >
      <Glyph name="star" sizePx={TYPO.secondaryIconPx} tone={accent.solid} />
      <Pips spec={pips} sizePx={iconPx.sm} tone={accent.solid} />
      {pendingRedemptionPoints === null ? null : (
        <Glyph name="gift" sizePx={iconPx.md} tone={colour.ink} />
      )}
    </div>
  );
}

function PictureEventCard({ emoji, icon, startsAtLocalTime, isAllDay, accent, sourceStripe }: EventCardProps) {
  const hands = startsAtLocalTime === null ? null : clockHands(startsAtLocalTime);
  return (
    <div
      style={card({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: px(spacePx.xs),
        padding: px(spacePx.sm),
        borderBottom: `${px(strokePx.focus)} solid ${accent === null ? sourceStripe : accent.solid}`,
      })}
    >
      <EmojiOrIcon emoji={emoji} asset={icon} sizePx={TYPO.secondaryIconPx} />
      {isAllDay || hands === null ? (
        <Glyph name="sun" sizePx={iconPx.md} tone={colour.inkMuted} />
      ) : (
        <ClockFace hourDeg={hands.hourDeg} minuteDeg={hands.minuteDeg} sizePx={iconPx.md} />
      )}
    </div>
  );
}

function PictureCountdownCard({ emoji, icon, pips }: CountdownCardProps) {
  return (
    <div
      style={card({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: px(spacePx.xs),
        padding: px(spacePx.sm),
      })}
    >
      <EmojiOrIcon emoji={emoji} asset={icon} sizePx={TYPO.secondaryIconPx} />
      <MoonPips spec={pips} sizePx={iconPx.sm} tone={colour.inkMuted} />
    </div>
  );
}

function PictureStatusPill({ tone, glyph }: StatusPillProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: px(spacePx.xs),
        borderRadius: radius.pill,
        background: colour.surface,
        border: `${px(strokePx.medium)} solid ${freshnessColour[tone]}`,
      }}
    >
      <Glyph name={glyph} sizePx={iconPx.sm} tone={freshnessColour[tone]} />
    </span>
  );
}

export const pictureRenderers: RendererSet = {
  Avatar: PictureAvatar,
  RoutineStep: PictureRoutineStep,
  ChoreCard: PictureChoreCard,
  PointsBadge: PicturePointsBadge,
  EventCard: PictureEventCard,
  CountdownCard: PictureCountdownCard,
  StatusPill: PictureStatusPill,
};
