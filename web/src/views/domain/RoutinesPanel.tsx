/**
 * Grown-ups → Routines: WHO DOES WHICH STEPS (the admin mockups, private notes, B-6).
 *
 * Asked for the first week the routines ran: *"The youngest doesn't have brushing his teeth as part
 * of his bedtime routine."* The assignment existed in a table and could be changed with a
 * shell and a SQL statement, which in practice means it was never changed — a three-year-old's
 * bedtime is decided at 19:00 by whoever is in the room, not at a keyboard.
 *
 * ## One routine, one child, one list
 *
 * The head row picks both: the routine pills on the left, with the routine's window and days
 * beside them, and the children's faces on the right — the open one framed, the others dim. Under
 * it, the steps she HAS, each with her order number, an up and a down, and a green check that
 * takes it away; then a line that says whose routine the rest would join, and the steps she does
 * not have, each with a plus. Every row is a whole thought: no draft, no save button, and each
 * tap's response is the new catalog, so the list shows what the server holds rather than what it
 * hoped.
 *
 * ## The other two, small, on every row
 *
 * Beside each step are the faces of the children the screen is NOT open on, dim when they do not
 * have it (`stepHolders`) — so adding teeth to one bedtime shows at a glance whether the other two
 * already brush, without opening their lists.
 *
 * ## Tonight, not tomorrow
 *
 * A chore's worth starts tomorrow because the day is a snapshot. A routine run is a snapshot
 * too — and the server reconciles TODAY's in the same transaction as the definition
 * (src/domain/routines/assign.ts), so this screen's rule is the opposite one, said under the
 * window: add teeth to a bedtime at 19:00 and it is on his card when he walks over.
 *
 * ## No pencil
 *
 * The mock drew one, for the routine's window, days and step names. That is editing, and editing
 * is the second pass; this screen changes who does what, and in which order.
 *
 * ## The arrows go quiet at the ends, and that is the one exception
 *
 * `Tappable`'s rule is never to grey a control out. It was written about a child's card, where
 * a dimmed rectangle gets tapped harder. Here the top row's up-arrow is a control that CANNOT
 * do anything, for a reason an adult can see (it is first), and drawing it live would be the
 * dead-path bug this project keeps building: a tap, a request, no change, no word. So it is
 * drawn muted and is not a button. The check and the plus are always live.
 */

import type { Child } from '../../../../src/types.ts';
import { approvalRowHeightPx, type RoutineCatalog, type RoutineCatalogEntry } from '../../app/adminActions.ts';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import {
  childAccentForSlot,
  colour,
  cssTokens,
  fontSizePx,
  fontWeight,
  iconPx,
  radius,
  spacePx,
  stateTreatments,
  strokePx,
} from '../../design/tokens.ts';
import { useBandTypography } from '../bands/registry.tsx';
import { AccentFrame, AssetImage } from '../primitives/AssetImage.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { ScrollColumn } from '../primitives/ScrollColumn.tsx';
import { Tappable, type DataMarks } from '../primitives/Tappable.tsx';
import { card, numeralText, px, tapTarget, text } from '../primitives/style.ts';
import {
  ROUTINE_RULE_WORDS,
  routineGlyph,
  routinePoolHeading,
  routineWhenLine,
} from '../logic/grownup.ts';
import {
  childRoutineRows,
  routineById,
  stepHolders,
  type RoutineStepRow,
} from '../logic/routineAssign.ts';
import { avatarRef, orderedChildren } from '../logic/summary.ts';

const NO_ROUTINES_WORD = 'No routines are set up yet.';
const NO_CHILDREN_WORD = 'No children are set up yet.';

/** The picker's faces: a frame inside the tap floor, the size the chore list's face keys use. */
const PICKER_FACE_PX = iconPx.lg - spacePx.xs;
/** The other children beside a step: a glance, not a control, so the smallest frame. */
const HOLDER_FACE_PX = iconPx.xs;

export interface RoutinesPanelProps {
  catalog: RoutineCatalog;
  routineId: string | null;
  childId: string | null;
  busy: boolean;
  onRoutine: (routineId: string) => void;
  onChild: (childId: string) => void;
  onAssign: (routineId: string, stepId: string, assigned: boolean) => void;
  onMove: (routineId: string, stepId: string, direction: 'up' | 'down') => void;
}

export function RoutinesPanel({
  catalog,
  routineId,
  childId,
  busy,
  onRoutine,
  onChild,
  onAssign,
  onMove,
}: RoutinesPanelProps) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.small;
  const { snapshot } = useWall();
  const children = orderedChildren(snapshot.children);

  if (catalog.routines.length === 0) return <Notice words={NO_ROUTINES_WORD} textPx={PRIMARY_TEXT} />;

  const routine = routineId === null ? null : routineById(catalog, routineId);
  const child = children.find((c) => c.id === childId) ?? null;
  const rows = child === null ? null : childRoutineRows(routine, child.id);
  const others = children.filter((c) => c.id !== child?.id);

  return (
    <div
      data-grownup-routines=""
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: px(spacePx.tapGap),
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {/* Which routine, when it runs and the rule it obeys, and whose. One row, the tap floor tall. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: px(spacePx.tapGap),
          height: px(TYPO.minTapPx),
          flex: '0 0 auto',
          minWidth: 0,
        }}
      >
        {catalog.routines.map((r) => (
          <RoutinePill
            key={r.id}
            routine={r}
            on={r.id === routineId}
            minTapPx={TYPO.minTapPx}
            textPx={PRIMARY_TEXT}
            onTap={() => {
              onRoutine(r.id);
            }}
          />
        ))}
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          {routine === null ? null : (
            <span data-routine-when="" style={text(SECONDARY_TEXT)}>
              {routineWhenLine(routine)}
            </span>
          )}
          <span style={text(SECONDARY_TEXT, { muted: true, wrap: true, lines: 2 })}>{ROUTINE_RULE_WORDS}</span>
        </span>
        <span style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>
          {children.map((c) => (
            <PickerFace
              key={c.id}
              child={c}
              on={c.id === child?.id}
              minTapPx={TYPO.minTapPx}
              onTap={() => {
                onChild(c.id);
              }}
            />
          ))}
        </span>
      </div>

      {child === null || rows === null || routine === null ? (
        <Notice words={child === null ? NO_CHILDREN_WORD : NO_ROUTINES_WORD} textPx={PRIMARY_TEXT} />
      ) : (
        <ScrollColumn gapPx={spacePx.tapGap} ground={colour.surface}>
          {rows.assigned.map((row) => (
            <StepRow
              key={row.stepId}
              row={row}
              routine={routine}
              others={others}
              busy={busy}
              onToggle={() => {
                onAssign(routine.id, row.stepId, false);
              }}
              onMove={(direction) => {
                onMove(routine.id, row.stepId, direction);
              }}
            />
          ))}
          {rows.available.length === 0 ? null : (
            <PoolHeading words={routinePoolHeading(child.displayName, routine.labelShort)} textPx={SECONDARY_TEXT} />
          )}
          {rows.available.map((row) => (
            <StepRow
              key={row.stepId}
              row={row}
              routine={routine}
              others={others}
              busy={busy}
              onToggle={() => {
                onAssign(routine.id, row.stepId, true);
              }}
              onMove={() => {}}
            />
          ))}
        </ScrollColumn>
      )}
    </div>
  );
}

/** A routine to look at: solid when it is the one open, the time of day it runs at its front. */
function RoutinePill({
  routine,
  on,
  minTapPx,
  textPx,
  onTap,
}: {
  routine: RoutineCatalogEntry;
  on: boolean;
  minTapPx: number;
  textPx: number;
  onTap: () => void;
}) {
  const ink = on ? colour.inkInverse : colour.ink;
  return (
    <Tappable
      enabled={!on}
      onTap={onTap}
      data={{ 'data-routine-pill': routine.id }}
      style={tapTarget(minTapPx, {
        gap: px(spacePx.xs),
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
        padding: `${px(spacePx.none)} ${px(spacePx.md)}`,
        // The same solid-versus-outline pair the section tabs use, for the same reason: an
        // underline under one of two words dies on the glass.
        background: on ? colour.ink : colour.surface,
        border: `${px(strokePx.medium)} solid ${on ? colour.ink : colour.border}`,
        borderRadius: radius.pill,
      })}
    >
      <Glyph name={routineGlyph(routine.opensAtLocal)} sizePx={iconPx.xs} tone={ink} />
      <span style={{ ...text(textPx), color: ink, ...(on ? { fontWeight: fontWeight.black } : {}) }}>
        {routine.labelShort}
      </span>
    </Tappable>
  );
}

/** Whose routine is open. The open face is framed and inert; the other two are dim, and live. */
function PickerFace({
  child,
  on,
  minTapPx,
  onTap,
}: {
  child: Child;
  on: boolean;
  minTapPx: number;
  onTap: () => void;
}) {
  const { layout } = useWallLayout();
  return (
    <Tappable
      enabled={!on}
      onTap={onTap}
      label={child.displayName}
      data={{ 'data-routine-child': child.id, 'data-on': on ? 'yes' : 'no' }}
      style={tapTarget(minTapPx, {
        width: px(minTapPx),
        height: px(minTapPx),
        padding: px(spacePx.none),
        background: 'transparent',
        opacity: on ? 1 : cssTokens['--o-disabled'],
      })}
    >
      <AccentFrame accent={childAccentForSlot(child.sortOrder)} sizePx={PICKER_FACE_PX} selected={on} shape={layout.faceFrame}>
        <AssetImage asset={avatarRef(child)} sizePx={PICKER_FACE_PX} />
      </AccentFrame>
    </Tappable>
  );
}

/** Between the steps she has and the steps she could have: a sentence on a rule, not a heading. */
function PoolHeading({ words, textPx }: { words: string; textPx: number }) {
  const rule = { flex: 1, height: px(strokePx.medium), background: colour.border };
  return (
    <div
      data-routine-pool=""
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.sm),
        flex: '0 0 auto',
        minWidth: 0,
      }}
    >
      <span style={rule} />
      <span style={{ ...text(textPx, { muted: true }), flex: '0 1 auto', minWidth: 0 }}>{words}</span>
      <span style={rule} />
    </div>
  );
}

function StepRow({
  row,
  routine,
  others,
  busy,
  onToggle,
  onMove,
}: {
  row: RoutineStepRow;
  routine: RoutineCatalogEntry;
  others: readonly Child[];
  busy: boolean;
  onToggle: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const NUMERAL_TEXT = TYPO.numeralTextPx ?? fontSizePx.cardTitle;
  const minTapPx = TYPO.minTapPx;
  const holders = stepHolders(routine, row.stepId);
  return (
    <div
      data-routine-step={row.stepId}
      data-assigned={row.assigned ? 'yes' : 'no'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.sm),
        // The Waiting row's height, so the portal's lists share one rhythm.
        height: px(approvalRowHeightPx(minTapPx)),
        paddingLeft: px(spacePx.xs),
        paddingRight: px(spacePx.xxs),
        flex: '0 0 auto',
        minWidth: 0,
        overflow: 'hidden',
        // The portal's row grammar (Waiting, Money, Chores): an edge and no ledge.
        background: colour.surface,
        border: `${px(strokePx.medium)} solid ${colour.border}`,
        borderRadius: radius.md,
        boxSizing: 'border-box',
      }}
    >
      {/* Her order number, at the size the routine card shows it. The pool has none. */}
      <span
        style={{
          ...numeralText(NUMERAL_TEXT, colour.ink),
          fontWeight: fontWeight.black,
          width: px(iconPx.sm),
          textAlign: 'center',
          flex: '0 0 auto',
        }}
      >
        {row.position === null ? '' : String(row.position)}
      </span>
      {/*
        A step she does not have yet is a real row, drawn quieter: it is the pool, not the
        routine, and the two must read as different bands of one list. The ROW stays opaque —
        fading the whole row let the scene art bleed through it on the glass — so only the
        icon and the name go muted.
      */}
      <span style={{ display: 'flex', flex: '0 0 auto', opacity: row.assigned ? 1 : cssTokens['--o-disabled'] }}>
        <AssetImage asset={row.icon} sizePx={iconPx.md} />
      </span>
      {/*
        The NAME takes whatever is left and only the name carries the ellipsis (CLAUDE.md's
        rule, learned on the chore board). Everything beside it is fixed-width.
      */}
      <span style={{ ...text(PRIMARY_TEXT, { muted: !row.assigned }), flex: 1, minWidth: 0 }}>{row.labelFull}</span>
      <HolderFaces others={others} holders={holders} />
      <span style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>
        {/* The pool keeps the arrows' room empty, so the faces and the checks line up down the list. */}
        {row.assigned ? (
          <>
            <ArrowKey
              glyph="up"
              live={row.canMoveUp && !busy}
              minTapPx={minTapPx}
              label={`Move ${row.labelFull} earlier`}
              onTap={() => {
                onMove('up');
              }}
            />
            <ArrowKey
              glyph="down"
              live={row.canMoveDown && !busy}
              minTapPx={minTapPx}
              label={`Move ${row.labelFull} later`}
              onTap={() => {
                onMove('down');
              }}
            />
          </>
        ) : (
          <span style={{ width: px(2 * minTapPx + spacePx.tapGap), flex: '0 0 auto' }} />
        )}
        <ToggleKey
          assigned={row.assigned}
          enabled={!busy}
          tone="done"
          label={row.assigned ? `Take ${row.labelFull} off` : `Add ${row.labelFull}`}
          data={{ 'data-routine-toggle': row.stepId }}
          minTapPx={minTapPx}
          onTap={onToggle}
        />
      </span>
    </div>
  );
}

/** The children the screen is not open on, in household order; dim where the step is not theirs. */
function HolderFaces({ others, holders }: { others: readonly Child[]; holders: ReadonlySet<string> }) {
  const { layout } = useWallLayout();
  return (
    <span style={{ display: 'flex', gap: px(spacePx.xxs), flex: '0 0 auto' }}>
      {others.map((c) => {
        const has = holders.has(c.id);
        return (
          <span
            key={c.id}
            data-routine-holder={c.id}
            data-has={has ? 'yes' : 'no'}
            style={{ display: 'flex', opacity: has ? 1 : cssTokens['--o-disabled'] }}
          >
            <AccentFrame
              accent={childAccentForSlot(c.sortOrder)}
              sizePx={HOLDER_FACE_PX}
              selected={false}
              shape={layout.faceFrame}
            >
              <AssetImage asset={avatarRef(c)} sizePx={HOLDER_FACE_PX} />
            </AccentFrame>
          </span>
        );
      })}
    </span>
  );
}

/** Up or down. Muted and inert at the end of the list — see the file header for why. */
function ArrowKey({
  glyph,
  live,
  minTapPx,
  label,
  onTap,
}: {
  glyph: 'up' | 'down';
  live: boolean;
  minTapPx: number;
  label: string;
  onTap: () => void;
}) {
  return (
    <Tappable
      enabled={live}
      onTap={onTap}
      label={label}
      data={{ 'data-routine-arrow': glyph }}
      style={tapTarget(minTapPx, {
        width: px(minTapPx),
        height: px(minTapPx),
        padding: px(spacePx.none),
        background: live ? colour.surface : colour.surfaceSunken,
        border: `${px(strokePx.medium)} solid ${live ? colour.border : colour.surfaceSunken}`,
        borderRadius: radius.md,
      })}
    >
      <Glyph name={glyph} sizePx={fontSizePx.bodyLarge} tone={live ? colour.ink : colour.inkMuted} />
    </Tappable>
  );
}

/**
 * The one control on the row that changes WHAT she does: a filled check on a step she has
 * (tap to take it away), a plus on one she does not (tap to add it). Filled versus outline,
 * check versus plus — two channels, so the two states never rest on colour alone.
 */
export function ToggleKey({
  assigned,
  enabled,
  inert = false,
  tone = 'ink',
  label,
  data,
  minTapPx,
  onTap,
}: {
  assigned: boolean;
  enabled: boolean;
  /**
   * Inert for a REASON the adult can see (the last child on a chore): drawn like the arrows
   * at the end of their list — muted, and not a button. `enabled: false` alone is the
   * request-in-flight case, which lasts a moment and keeps its face so it does not flicker.
   */
  inert?: boolean;
  /**
   * What a filled key is filled WITH. `ink` is the default and the child-facing one (the dog's
   * deeds). The grown-up screens pass `done`: the approved green with its own ink, the colour the
   * redesign gave "this one is on" — and the check still carries the state, so it never rests on
   * the colour alone.
   */
  tone?: 'ink' | 'done';
  /** What the key does, for a reader that cannot see its mark ("Take Augusta off"). */
  label?: string | undefined;
  data?: DataMarks | undefined;
  minTapPx: number;
  onTap: () => void;
}) {
  const filled =
    tone === 'done'
      ? {
          background: stateTreatments.approved.fill,
          border: stateTreatments.approved.edge,
          glyph: stateTreatments.approved.ink,
        }
      : { background: colour.ink, border: colour.ink, glyph: colour.inkInverse };
  const face = inert
    ? { background: colour.surfaceSunken, border: colour.surfaceSunken, glyph: colour.inkMuted }
    : assigned
      ? filled
      : { background: colour.surface, border: colour.border, glyph: colour.ink };
  return (
    <Tappable
      enabled={enabled && !inert}
      onTap={onTap}
      label={label}
      data={data}
      style={tapTarget(minTapPx, {
        width: px(minTapPx),
        height: px(minTapPx),
        padding: px(spacePx.none),
        background: face.background,
        border: `${px(strokePx.medium)} solid ${face.border}`,
        borderRadius: radius.md,
      })}
    >
      <Glyph name={assigned ? 'check' : 'plus'} sizePx={fontSizePx.bodyLarge} tone={face.glyph} />
    </Tappable>
  );
}

export function Notice({ words, textPx }: { words: string; textPx: number }) {
  return (
    <div
      style={card({
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 0,
        padding: px(spacePx.lg),
      })}
    >
      <span style={text(textPx)}>{words}</span>
    </div>
  );
}
