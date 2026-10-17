/**
 * Unit H — the EMERGENT band.  Child B is five: she reads a little, slowly, and
 * only words she already knows by shape.
 *
 * This is the band every design in the H2 tournament got wrong — six proposals
 * designed for the fluent reader and the pre-reader and let the middle fall out by
 * accident (H2, "what every proposal missed", #2).  So it is built explicitly:
 *
 *   - icon first, always, at `--icon-500`;
 *   - the FULL label, capped at `maxLabelWords` (6).  It was `labelShort` at two words
 *     until 2026-09-09, when the first evening of real use said plainly that `Dog` and
 *     `Fish` tell her nothing — see bandTypography.emergent for the whole argument;
 *   - quantity as `numeral-and-pips`: she gets both, so the numeral acquires
 *     meaning from the marks beside it rather than replacing them;
 *   - a real money surface — balance, pips, and a redemption affordance she can
 *     use without reading a sentence.
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
  fontSizePx,
  freshnessColour,
  iconPx,
  radius,
  spacePx,
  stateTreatments,
  strokePx,
} from '../../design/tokens.ts';
import { AccentFrame, AssetImage } from '../primitives/AssetImage.tsx';
import { EmojiOrIcon } from '../primitives/EmojiOrIcon.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { MoonPips, Pips } from '../primitives/Pips.tsx';
import { StateMark } from '../primitives/StateMark.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { card, numeralText, px, tapTarget, text } from '../primitives/style.ts';
import { truncateWords } from '../logic/labels.ts';
import { NAME_BELOW_GAP_PX, NAME_BESIDE_GAP_PX, NAME_TILE_PAD_PX } from '../logic/railNames.ts';
import { numeralThatFits } from '../logic/routineFit.ts';
import { useBandTypography } from './registry.tsx';

/** The offer, in the fewest letters an emergent reader can take in.  Never "Late". */
const STILL_TIME_WORD = 'Still time';

/**
 * The band's scale AT THE READER'S DISTANCE.
 *
 * These were module-level constants read straight off `bandTypography`, which meant the near
 * scale introduced by H8 reached the chrome that calls the hook and NOT the leaves — the type
 * on a child's own screen never moved. A hook is the only way a leaf can know how far away
 * somebody is standing, because distance is context, not a prop.
 *
 * `TYPO` keeps its name on purpose: test/unit-h.sources greps `tapTarget(TYPO.minTapPx` to
 * prove no target is sized by a number somebody picked.
 */
function useTypo() {
  const TYPO = useBandTypography();
  return {
    TYPO,
    PRIMARY_TEXT: TYPO.primaryTextPx ?? fontSizePx.bodyLarge,
    SECONDARY_TEXT: TYPO.secondaryTextPx ?? fontSizePx.small,
    NUMERAL_TEXT: TYPO.numeralTextPx ?? fontSizePx.sectionTitle,
    short: (s: string): string => truncateWords(s, TYPO.maxLabelWords),
  };
}



function EmergentAvatar({
  crop,
  avatar,
  accent,
  selected,
  selectedTint,
  nameplate,
  nameAt,
  faceSizePx,
  frame,
  onSelect,
}: AvatarProps) {
  const { TYPO } = useTypo();
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
      {/*
        Her name, as the rail drew it — whole, at the rail's one size — under the face on the
        plinth and the spine, in a pill beside it on felt's bottom row, and absent on the grown-up
        screens' plain column. Placed here so face and name are one key; never read here. It was
        her first word until 2026-10-11, which on a two-word name looked cut off.
      */}
      {nameplate}
    </Tappable>
  );
}

/**
 * One step of the routine — a row of its column, or a cell of its grid (H5 §3.3) — sized by the
 * panel (`fit`) and not by this
 * band: the picture, the mark and the label all come down together as a routine gets longer,
 * and the row never goes under the tap floor (logic/routineFit.ts).
 */
function EmergentRoutineStep({
  labelFull,
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
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, short } = useTypo();
  const treatment = done ? stateTreatments.approved : stateTreatments.pending;
  const mark = <StateMark treatment={treatment} shape={markShape} sizePx={fit.markPx} />;
  return (
    <Tappable
      enabled
      onTap={onToggle}
      style={tapTarget(TYPO.minTapPx, {
        justifyContent: 'flex-start',
        width: '100%',
        // The fitted row, which may be under this band's 80: the floor a routine step keeps is
        // the wall's 64, so a long routine still fits the pane.
        minHeight: px(fit.rowPx),
        height: px(fit.rowPx),
        padding: px(fit.padPx),
        background: done ? treatment.fill : colour.surface,
        // THE CONFIRM RING. One tap has landed and nothing has been applied yet, so this must
        // NOT look like "done" — it is a heavy ink outline, saying only "I heard you, do it
        // again". Wordless on purpose: the pre-reader's screens carry no text, and he is the
        // child this mechanism most exists to protect. It also outranks the `isNext` focus
        // ring, because what the wall is waiting for right now matters more than what is next.
        border: confirmPending
          ? `${px(strokePx.focus)} solid ${colour.ink}`
          : `${px(isNext && !done ? strokePx.focus : treatment.edgeWidthPx)} solid ${treatment.edge}`,
        borderRadius: radius.lg,
      })}
    >
      {/*
        The order numeral, when the THEME numbers its steps (storybook's book-like list). A
        five-year-old can read "1 2 3 4", and here it is a third carrier of order beside the
        column itself and the next-step ring — never the only one. Sized to the fitted row on
        one line, so a long routine's numerals shrink with it instead of setting its height.
      */}
      {showOrder ? (
        <span
          style={{
            ...numeralText(numeralThatFits(NUMERAL_TEXT, fit.contentPx), done ? treatment.ink : colour.inkMuted),
            minWidth: px(spacePx.xl),
            textAlign: 'center',
            flex: '0 0 auto',
          }}
        >
          {position}
        </span>
      ) : null}
      {markSide === 'start' ? mark : null}
      <AssetImage asset={icon} sizePx={fit.iconPx} />
      <span
        style={{
          ...text(fit.labelPx ?? PRIMARY_TEXT, { wrap: true, lines: 2 }),
          color: done ? treatment.ink : colour.ink,
          flex: 1,
          minWidth: 0,
        }}
      >
        {/* `labelFull`, same reason as the chore card — see bandTypography.emergent. */}
        {short(labelFull)}
      </span>
      {markSide === 'end' ? mark : null}
    </Tappable>
  );
}

/**
 * A FILLED ROW, matching this band's routine steps and the fluent board (H5 §3.5).
 *
 * It used to be a stacked tile in a white card with a coloured edge. At 225 nits behind
 * etched glass an edge is the first thing to go, and a tile spends the scarce axis twice —
 * once on the icon, once on everything under it.
 */
/**
 * TWO ROWS, for the reason `FluentChoreCard` documents at length: on one row the chore's NAME
 * is the only element with `minWidth: 0`, so it is the only one that can shrink, and it ends
 * up absorbing every pixel the status word, the points and the glyphs want. It is worse here
 * than in the fluent band — the type is 30px and the icons are 48 — so the name loses harder.
 *
 * The clock STAYS in this band. It is not duplication here the way it was for a fluent reader:
 * this is a five-year-old part-way into words, and a shape beside a word she is still decoding
 * is the redundancy that makes the card readable at all. What it no longer does is compete with
 * her own chore's name for room, because it is on the other row.
 *
 * The state mark is the theme's: felt's sticker ends the status row beside the points, and the
 * ledger's box (gallery, storybook) leads the whole card, beside both rows — never on the name's.
 */
function EmergentChoreCard({
  labelFull,
  icon,
  treatment,
  stateWordShort,
  points,
  pips,
  accent,
  interactive,
  stillTime,
  markSide,
  markShape,
  onClaim,
}: ChoreCardProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, short } = useTypo();
  const ink = treatment.fillRole === 'solid' ? treatment.ink : colour.ink;
  return (
    <Tappable
      enabled={interactive}
      onTap={onClaim}
      style={tapTarget(TYPO.minTapPx, {
        justifyContent: 'flex-start',
        gap: px(spacePx.sm),
        width: '100%',
        padding: px(spacePx.xs),
        background: treatment.fillRole === 'outline' ? accent.tint : treatment.fill,
        border: `${px(stillTime ? strokePx.focus : treatment.edgeWidthPx)} solid ${treatment.edge}`,
        borderLeftWidth: px(strokePx.focus),
        borderLeftColor: accent.solid,
        borderRadius: radius.lg,
        opacity: treatment.opacity,
      })}
    >
      {markSide === 'start' ? <StateMark treatment={treatment} shape={markShape} sizePx={iconPx.md} /> : null}
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(spacePx.xxs),
          flex: 1,
          minWidth: 0,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.sm), minWidth: 0 }}>
          <AssetImage asset={icon} sizePx={TYPO.secondaryIconPx} />
          <span
            style={{
              ...text(PRIMARY_TEXT, { wrap: true, lines: 2 }),
              color: ink,
              flex: 1,
              minWidth: 0,
            }}
          >
            {/*
              `labelFull`, not `labelShort`, since 2026-09-09.

              His board read `Clear table` / `Dog` / `Fish` — a fourteen-character stub of an
              instruction, on the screen of the child who is LEARNING to read and therefore needs
              the words most. "On the middle child, you can't read any of the descriptions. It's
              almost worthless." `Dog` is not a short way of saying "fill the dog's water and food"; it
              is a different, emptier sentence.

              `labelShort` stays on the contract for a surface that genuinely cannot fit a
              sentence — the week view's 190px column asks the band that question separately.
            */}
            {short(labelFull)}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.sm), minWidth: 0 }}>
          {/*
            The STATUS LINE, in its own smaller type step (`statusTextPx`, never under 14) rather
            than in shorter words: "that can just be smaller text to describe what's done there,
            so that it fits." `minWidth: 0` with an ellipsis makes it the element that gives way
            when the card is tight — the name never is.
          */}
          <span
            style={{
              ...text(TYPO.statusTextPx ?? SECONDARY_TEXT),
              color: ink,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {short(stillTime ? STILL_TIME_WORD : stateWordShort)}
          </span>
          {stillTime ? <Glyph name="clock" sizePx={iconPx.sm} tone={ink} /> : null}
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: px(spacePx.xxs),
              flex: '0 0 auto',
            }}
          >
            <span style={numeralText(SECONDARY_TEXT, ink)}>{String(points)}</span>
            <Pips spec={pips} sizePx={iconPx.xs} tone={ink} />
          </span>
          {markSide === 'end' ? <StateMark treatment={treatment} shape={markShape} sizePx={iconPx.sm} /> : null}
        </span>
      </span>
    </Tappable>
  );
}

function EmergentPointsBadge({
  points,
  pips,
  accent,
  pendingRedemptionPoints,
  cashOutOptions,
  onRequestRedemption,
}: PointsBadgeProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, short } = useTypo();
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
      <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.xs) }}>
        <Glyph name="star" sizePx={iconPx.md} tone={accent.solid} />
        <span style={numeralText(NUMERAL_TEXT, colour.ink)}>{String(points)}</span>
      </span>
      <Pips spec={pips} sizePx={iconPx.xs} tone={accent.solid} />
      {pendingRedemptionPoints === null ? null : (
        <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.xxs) }}>
          <Glyph name="gift" sizePx={iconPx.sm} tone={colour.ink} />
          <span style={numeralText(SECONDARY_TEXT, colour.ink)}>{String(pendingRedemptionPoints)}</span>
        </span>
      )}
      {/*
        ONE BUTTON PER AMOUNT, and the amount is drawn as MONEY rather than as points.
        "$2" is a thing a five-year-old has held; "8 points" is a conversion she has to do.
        The gift glyph stays as the shared signal that this row is the asking-for-money row.

        An amount she cannot afford is ABSENT — `cashOutOptions` never contains one — rather
        than present and greyed. A disabled button on a wall a child cannot read is a button
        she taps repeatedly and learns nothing from.

        `flexWrap` because there are at most four of these and the pane is 380px wide at this
        band: three fit in a row, a fourth wraps rather than shrinking below the tap floor.
      */}
      {onRequestRedemption === null || cashOutOptions.length === 0 ? null : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: px(spacePx.tapGap),
            width: '100%',
          }}
        >
          {cashOutOptions.map((option) => (
            <Tappable
              key={option.label}
              enabled
              onTap={() => {
                onRequestRedemption(option.points);
              }}
              style={tapTarget(TYPO.minTapPx, {
                flex: '1 1 auto',
                gap: px(spacePx.xxs),
                background: colour.surface,
                border: `${px(strokePx.medium)} solid ${accent.solid}`,
                borderRadius: radius.pill,
              })}
            >
              <Glyph name="gift" sizePx={iconPx.sm} tone={accent.solid} />
              <span style={numeralText(PRIMARY_TEXT, colour.ink)}>{option.label}</span>
            </Tappable>
          ))}
        </div>
      )}
    </div>
  );
}

function EmergentEventCard({ title, emoji, icon, timeText, accent, sourceStripe }: EventCardProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, short } = useTypo();
  return (
    <div
      style={card({
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.sm),
        padding: px(spacePx.sm),
        borderLeft: `${px(strokePx.focus)} solid ${accent === null ? sourceStripe : accent.solid}`,
      })}
    >
      <EmojiOrIcon emoji={emoji} asset={icon} sizePx={TYPO.secondaryIconPx} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={text(PRIMARY_TEXT)}>{short(title)}</span>
        <span style={text(SECONDARY_TEXT, { muted: true })}>{timeText}</span>
      </span>
    </div>
  );
}

function EmergentCountdownCard({ emoji, labelShort, icon, sleepsRemaining, pips }: CountdownCardProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, short } = useTypo();
  return (
    <div
      style={card({
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.sm),
        padding: px(spacePx.sm),
      })}
    >
      <EmojiOrIcon emoji={emoji} asset={icon} sizePx={TYPO.secondaryIconPx} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={text(PRIMARY_TEXT)}>{short(labelShort)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.xxs) }}>
          <span style={numeralText(NUMERAL_TEXT, colour.ink)}>{String(sleepsRemaining)}</span>
          <MoonPips spec={pips} sizePx={iconPx.xs} tone={colour.inkMuted} />
        </span>
      </span>
    </div>
  );
}

function EmergentStatusPill({ tone, glyph, labelShort }: StatusPillProps) {
  const { TYPO, PRIMARY_TEXT, SECONDARY_TEXT, NUMERAL_TEXT, short } = useTypo();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: px(spacePx.xs),
        padding: px(spacePx.xs),
        borderRadius: radius.pill,
        background: colour.surface,
        border: `${px(strokePx.medium)} solid ${freshnessColour[tone]}`,
      }}
    >
      <Glyph name={glyph} sizePx={iconPx.sm} tone={freshnessColour[tone]} />
      {/* No words (the header's choice while a leave-by banner is up): the glyph alone, centred. */}
      {labelShort === '' ? null : <span style={text(SECONDARY_TEXT)}>{short(labelShort)}</span>}
    </span>
  );
}

export const emergentRenderers: RendererSet = {
  Avatar: EmergentAvatar,
  RoutineStep: EmergentRoutineStep,
  ChoreCard: EmergentChoreCard,
  PointsBadge: EmergentPointsBadge,
  EventCard: EmergentEventCard,
  CountdownCard: EmergentCountdownCard,
  StatusPill: EmergentStatusPill,
};
