/**
 * Grown-ups → Chores: every chore in the house, one list (the admin mockups, private notes, B-4).
 *
 * The screen this replaces was one child's list — her chores above a line, everyone else's below
 * it — which answered "what does she do" and nothing an adult standing at the wall asks
 * first: what chores are there, what does each one pay, who does it. So every chore is one row
 * that says all of it in one line: the picture and the name, how it is shared and on which days,
 * what it is worth (a dash when it pays nothing, because a duty is not a zero), duty or extra, and
 * the faces of the children on it — a dimmed face is a child it is not on.
 *
 * ## A row opens; there is no pencil
 *
 * The mock drew a pencil at the end of every row. The ROW is the door instead: tap it and it
 * opens in place, one row open at a time, with the worth, the way it is shared and who is on it.
 * Its third line has **Edit**, which reopens the New-chore sheet on this chore for the name, the
 * picture and the days, and **Retire**. The closed row's every pixel opens it; nothing inside a
 * closed row is a second target.
 *
 * ## Retire asks twice, and is undone by Bring back
 *
 * Retire is soft (`logic/choreRetire.ts`). The chore leaves every list from today, its history
 * stays, and it moves to the Retired list at the bottom, where Bring back restores it. The key
 * asks twice because it is the one control here that takes something off the board. The server
 * refuses while a claim is waiting, and the caller says so in words.
 *
 * ## The two rules, said where they bite
 *
 * Who does it reaches TODAY's list — a pending row appears or goes, and a claim is work a child
 * did and stays for approval. Worth and sharing are the CHORE's, snapshotted when a day is built,
 * so they are the same for everyone and land on TOMORROW's list; re-dealing a turn at 17:00 is
 * how somebody loses one. Each rule sits beside the controls it is about (`CHORE_RULE_WORDS`),
 * because a change that does not show until tomorrow otherwise reads as a key that did nothing.
 *
 * ## The last face is inert, not refused
 *
 * The server reads an empty roster as EVERYONE and refuses the write that would make one. Drawn
 * live, the last child's face would be the dead-path bug this project keeps building — a tap, a
 * request, a refusal the wall has no sentence for — so it is drawn muted and is not a button.
 *
 * ## Turns are an order
 *
 * An open chore that takes turns lists its children in turn order, each with her place, and puts
 * an earlier-key in front of every face that can move up — between that face and the one it would
 * pass, so the arrow points at the swap (`facesInTurnOrder`). The closed row keeps household
 * order, the order every other row and the rail use.
 *
 * ## Worth walks 0 to 20 here, and the server would take 99
 *
 * The stepper is the new-chore sheet's range (`POINTS_MAX`); a file may set more, and then only
 * the minus is live. Which chores earn and what they pay is the household's decision, so nothing
 * here moves a number on its own — every press is one request, and the number drawn is the
 * server's answer.
 *
 * ## A new chore starts on one child
 *
 * The sheet has no roster step yet, so it makes the chore on the first child in household order,
 * and when it closes on a chore that was not there before, the list opens that row: the other
 * faces are one tap away instead of a surprise on tomorrow's board.
 */

import { Fragment, useEffect, useReducer, useRef, useState } from 'react';
import type { AssignmentModel } from '../../../../src/types.ts';
import {
  CHORE_POINTS_STEP,
  approvalRowHeightPx,
  type ChoreCatalog,
  type ChoreEditRequest,
  type NewChoreRequest,
} from '../../app/adminActions.ts';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import {
  childAccentForSlot,
  colour,
  cssTokens,
  fontSizePx,
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
import { Tappable } from '../primitives/Tappable.tsx';
import { numeralText, px, tapTarget, text } from '../primitives/style.ts';
import { MODEL_WORDS, modelChoices } from '../logic/choreAssign.ts';
import { emptyDraft, reduceDraft, type DraftAction } from '../logic/choreDraft.ts';
import {
  RETIRE_WORDS,
  armExpiresAtMs,
  isArmed,
  pressRetire,
  retiredChoreRows,
  type RetireArm,
  type RetiredChoreRow,
} from '../logic/choreRetire.ts';
import {
  CHORE_RULE_WORDS,
  addedChoreId,
  choreListRows,
  choreListSummary,
  facesInTurnOrder,
  type ChoreFace,
  type ChoreListRow,
} from '../logic/grownup.ts';
import { NOUN, nounFor } from '../logic/plural.ts';
import { avatarRef, orderedChildren } from '../logic/summary.ts';
import { StepKey } from './MoneyPanel.tsx';
import { NewChoreSheet, Pill } from './NewChoreSheet.tsx';
import { Notice } from './RoutinesPanel.tsx';

const NEW_CHORE_WORDS = 'New chore';
const NO_CHORES_WORDS = 'No chores are set up yet. Tap New chore to make one.';
const WORTH_DOWN_WORDS = 'One point less';
const WORTH_UP_WORDS = 'One point more';
const RESET: DraftAction = { type: 'reset' };

/** The closed row's faces: a summary, read at arm's length, so the small frame. */
const ROW_FACE_PX = iconPx.sm;
/** The badge in a face key's corner — the dog sheet's tick, the size it reads at. */
const FACE_BADGE_PX = iconPx.sm - spacePx.xxs;
/**
 * The closed row's right-hand columns are FIXED, so the worths, the tags and the faces line up
 * down the list and the name is the one thing that gives. Wide enough for "20 points" and "Extra".
 */
const WORTH_COLUMN_PX = iconPx.xl + spacePx.md;
const KIND_COLUMN_PX = iconPx.lg + spacePx.xs;

export interface ChoresPanelProps {
  catalog: ChoreCatalog;
  busy: boolean;
  /**
   * The sheet's state lives with the caller, because the caller is the one that learns whether
   * the server took the chore: `open` means the sheet is drawn in the pane, `refusal` is the
   * server's words for the last attempt or null. The caller closes it on success.
   */
  sheet: { open: boolean; refusal: string | null };
  onOpenSheet: () => void;
  onCloseSheet: () => void;
  onCreate: (body: NewChoreRequest) => void;
  onMember: (choreId: string, childId: string, member: boolean) => void;
  onMove: (choreId: string, childId: string, direction: 'up' | 'down') => void;
  onModel: (choreId: string, assignmentModel: AssignmentModel) => void;
  onWorth: (choreId: string, basePoints: number) => void;
  /** The edit sheet's save: only the fields that changed. The caller closes the sheet on success. */
  onEdit: (choreId: string, patch: ChoreEditRequest) => void;
  onRetire: (choreId: string) => void;
  onRestore: (choreId: string) => void;
}

export function ChoresPanel({
  catalog,
  busy,
  sheet,
  onOpenSheet,
  onCloseSheet,
  onCreate,
  onMember,
  onMove,
  onModel,
  onWorth,
  onEdit,
  onRetire,
  onRestore,
}: ChoresPanelProps) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.small;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.meta;
  const NUMERAL_TEXT = TYPO.numeralTextPx ?? fontSizePx.bodyLarge;
  const { snapshot } = useWall();
  const children = orderedChildren(snapshot.children);
  const firstChild = children[0] ?? null;

  // The draft outlives a close only until the next open: RESET on open is the reset.
  const [draft, dispatch] = useReducer(reduceDraft, undefined, emptyDraft);
  const [openId, setOpenId] = useState<string | null>(null);
  // Which chore the sheet is editing, or null for a new one. Read only while the sheet is open.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [arm, setArm] = useState<RetireArm | null>(null);

  // An armed retire key goes back to "Retire" by itself: one render at the moment it lapses.
  useEffect(() => {
    const at = armExpiresAtMs(arm);
    if (at === null) return;
    const t = setTimeout(() => {
      setArm((current) => (current === arm ? null : current));
    }, Math.max(0, at - Date.now()));
    return () => {
      clearTimeout(t);
    };
  }, [arm]);

  // A chore the sheet just made opens its row. `known` is the list as it stood when the sheet
  // opened; the caller hands back the new catalog and closes the sheet in one render.
  const known = useRef<readonly string[]>([]);
  const sheetWasOpen = useRef(sheet.open);
  useEffect(() => {
    if (sheetWasOpen.current && !sheet.open) {
      const added = addedChoreId(known.current, catalog);
      if (added !== null) setOpenId(added);
    }
    sheetWasOpen.current = sheet.open;
  }, [sheet.open, catalog]);

  // The open row is scrolled into view — `nearest`, so a row already on screen does not move.
  const openRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = openRow.current as unknown as Scrollable | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [openId]);

  const openSheet = () => {
    known.current = catalog.chores.map((c) => c.id);
    dispatch(RESET);
    setEditingId(null);
    onOpenSheet();
  };

  const editingChore = editingId === null ? null : (catalog.chores.find((c) => c.id === editingId) ?? null);

  if (sheet.open && firstChild !== null) {
    return (
      <NewChoreSheet
        draft={draft}
        dispatch={dispatch}
        icons={catalog.icons}
        childId={firstChild.id}
        busy={busy}
        refusal={sheet.refusal}
        onSend={onCreate}
        editingChore={editingChore}
        onSave={onEdit}
        onClose={onCloseSheet}
      />
    );
  }

  const openEdit = (choreId: string) => {
    const chore = catalog.chores.find((c) => c.id === choreId);
    if (chore === undefined) return;
    known.current = catalog.chores.map((c) => c.id);
    dispatch({ type: 'edit', chore });
    setEditingId(choreId);
    onOpenSheet();
  };

  const tapRetire = (choreId: string) => {
    const next = pressRetire(arm, choreId, Date.now());
    setArm(next.arm);
    if (next.fire) onRetire(choreId);
  };

  const rows = choreListRows(catalog, children);
  const retired = retiredChoreRows(catalog);
  const summary = choreListSummary(rows);

  return (
    <div
      data-grownup-chores=""
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: px(spacePx.tapGap),
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
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
        <span style={{ ...numeralText(NUMERAL_TEXT, colour.ink), whiteSpace: 'nowrap', flex: '0 0 auto' }}>
          {summary.head}
        </span>
        <span style={{ ...text(SECONDARY_TEXT, { muted: true }), flex: 1, minWidth: 0 }}>{summary.detail}</span>
        <Pill
          word={NEW_CHORE_WORDS}
          on={false}
          solid
          live={!busy && firstChild !== null}
          minTapPx={TYPO.minTapPx}
          textPx={PRIMARY_TEXT}
          onTap={openSheet}
          wide
          data={{ 'data-new-chore': '' }}
        />
      </div>

      {rows.length === 0 && retired.length === 0 ? (
        <Notice words={NO_CHORES_WORDS} textPx={PRIMARY_TEXT} />
      ) : (
        <ScrollColumn gapPx={spacePx.tapGap} ground={colour.surface}>
          {rows.map((row) => {
            const open = row.choreId === openId;
            return (
              <div
                key={row.choreId}
                ref={open ? openRow : undefined}
                data-chore-row={row.choreId}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: '0 0 auto',
                  minWidth: 0,
                  background: colour.surface,
                  // The portal's row grammar (Waiting, Money): an edge and no ledge, and the
                  // strong edge on the one that is open.
                  border: `${px(strokePx.medium)} solid ${open ? colour.ink : colour.border}`,
                  borderRadius: radius.md,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                }}
              >
                <RowHead
                  row={row}
                  open={open}
                  onTap={() => {
                    setOpenId(open ? null : row.choreId);
                  }}
                />
                {open ? (
                  <RowControls
                    row={row}
                    busy={busy}
                    onMember={(childId, member) => {
                      onMember(row.choreId, childId, member);
                    }}
                    onEarlier={(childId) => {
                      onMove(row.choreId, childId, 'up');
                    }}
                    onModel={(model) => {
                      onModel(row.choreId, model);
                    }}
                    onWorth={(basePoints) => {
                      onWorth(row.choreId, basePoints);
                    }}
                    armed={isArmed(arm, row.choreId, Date.now())}
                    onEdit={() => {
                      openEdit(row.choreId);
                    }}
                    onRetire={() => {
                      tapRetire(row.choreId);
                    }}
                  />
                ) : null}
              </div>
            );
          })}
          {retired.length === 0 ? null : (
            <RetiredList
              rows={retired}
              busy={busy}
              onRestore={(choreId) => {
                onRestore(choreId);
              }}
            />
          )}
        </ScrollColumn>
      )}
    </div>
  );
}

/** The one DOM method this panel calls, typed by hand: the tree compiles without a DOM lib. */
interface Scrollable {
  scrollIntoView(options: { block: 'nearest'; behavior: 'smooth' }): void;
}

/**
 * The row's one line, and the whole of it is the control that opens and closes the row. Its
 * height is the Waiting row's less the row's own edge, so a closed list has Waiting's rhythm.
 */
function RowHead({ row, open, onTap }: { row: ChoreListRow; open: boolean; onTap: () => void }) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.small;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.meta;
  const NUMERAL_TEXT = TYPO.numeralTextPx ?? fontSizePx.bodyLarge;
  return (
    <Tappable
      enabled
      onTap={onTap}
      label={row.labelFull}
      data={{ 'data-chore-head': row.choreId }}
      style={tapTarget(TYPO.minTapPx, {
        width: '100%',
        height: px(approvalRowHeightPx(TYPO.minTapPx) - 2 * strokePx.medium),
        flex: '0 0 auto',
        justifyContent: 'flex-start',
        gap: px(spacePx.sm),
        padding: `${px(spacePx.none)} ${px(spacePx.sm)} ${px(spacePx.none)} ${px(spacePx.xs)}`,
      })}
    >
      <AssetImage asset={row.icon} sizePx={iconPx.md} />
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={text(PRIMARY_TEXT)}>{row.labelFull}</span>
        <span style={text(SECONDARY_TEXT, { muted: true })}>{row.howLine}</span>
      </span>
      <span
        style={{
          ...numeralText(NUMERAL_TEXT, colour.ink),
          whiteSpace: 'nowrap',
          textAlign: 'right',
          width: px(WORTH_COLUMN_PX),
          flex: '0 0 auto',
        }}
      >
        {row.worthWords}
      </span>
      {/* A label, not a key: sunken and edgeless, so it does not read as a second target. */}
      <span
        style={{
          ...text(SECONDARY_TEXT),
          width: px(KIND_COLUMN_PX),
          flex: '0 0 auto',
          textAlign: 'center',
          padding: `${px(spacePx.xxs)} ${px(spacePx.none)}`,
          background: colour.surfaceSunken,
          borderRadius: radius.pill,
        }}
      >
        {row.kindWord}
      </span>
      <RowFaces faces={row.faces} />
      <Glyph name={open ? 'up' : 'down'} sizePx={iconPx.xs} tone={colour.inkMuted} />
    </Tappable>
  );
}

/** Who is on it, in household order; a child it is not on is drawn dim. */
function RowFaces({ faces }: { faces: readonly ChoreFace[] }) {
  const { layout } = useWallLayout();
  return (
    <span style={{ display: 'flex', gap: px(spacePx.xs), flex: '0 0 auto' }}>
      {faces.map((face) => (
        <span
          key={face.child.id}
          data-chore-member={face.member ? 'yes' : 'no'}
          style={{ display: 'flex', opacity: face.member ? 1 : cssTokens['--o-disabled'] }}
        >
          <AccentFrame
            accent={childAccentForSlot(face.child.sortOrder)}
            sizePx={ROW_FACE_PX}
            selected={false}
            shape={layout.faceFrame}
          >
            <AssetImage asset={avatarRef(face.child)} sizePx={ROW_FACE_PX} />
          </AccentFrame>
        </span>
      ))}
    </span>
  );
}

/**
 * An open row's controls, in two lines, each with the rule it obeys beside it. The worth and the
 * sharing pills are the chore's — the same for everyone, from tomorrow. The faces are who does
 * it, and that reaches today.
 */
function RowControls({
  row,
  busy,
  onMember,
  onEarlier,
  onModel,
  onWorth,
  armed,
  onEdit,
  onRetire,
}: {
  row: ChoreListRow;
  busy: boolean;
  onMember: (childId: string, member: boolean) => void;
  onEarlier: (childId: string) => void;
  onModel: (model: AssignmentModel) => void;
  onWorth: (basePoints: number) => void;
  /** The retire key has had its first tap and the next one sends. */
  armed: boolean;
  onEdit: () => void;
  onRetire: () => void;
}) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.small;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.meta;
  const NUMERAL_TEXT = TYPO.numeralTextPx ?? fontSizePx.bodyLarge;
  const line = {
    display: 'flex',
    alignItems: 'center',
    gap: px(spacePx.tapGap),
    minHeight: px(TYPO.minTapPx),
    minWidth: 0,
  } as const;
  return (
    <div
      data-chore-controls={row.choreId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        // The tap gutter above the first line and between the two: the head over them is a key
        // too, the whole width of the row, and the faces sit straight under the worth keys.
        gap: px(spacePx.tapGap),
        padding: `${px(spacePx.tapGap)} ${px(spacePx.xs)} ${px(spacePx.xs)}`,
        minWidth: 0,
      }}
    >
      <div style={line}>
        <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.xs), flex: '0 0 auto' }}>
          <StepKey
            glyph="minus"
            label={WORTH_DOWN_WORDS}
            live={row.canWorthDown}
            busy={busy}
            onTap={() => {
              onWorth(row.basePoints - CHORE_POINTS_STEP);
            }}
          />
          <span
            data-chore-worth={String(row.basePoints)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: px(iconPx.lg),
              flex: '0 0 auto',
            }}
          >
            <span style={numeralText(NUMERAL_TEXT, colour.ink)}>{String(row.basePoints)}</span>
            <span style={text(SECONDARY_TEXT, { muted: true })}>{nounFor(row.basePoints, NOUN.point)}</span>
          </span>
          <StepKey
            glyph="plus"
            label={WORTH_UP_WORDS}
            live={row.canWorthUp}
            busy={busy}
            onTap={() => {
              onWorth(row.basePoints + CHORE_POINTS_STEP);
            }}
          />
        </span>
        <span style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>
          {modelChoices(row.model).map((model) => (
            <Pill
              key={model}
              word={MODEL_WORDS[model]}
              on={model === row.model}
              live={!busy}
              minTapPx={TYPO.minTapPx}
              textPx={PRIMARY_TEXT}
              onTap={() => {
                onModel(model);
              }}
            />
          ))}
        </span>
        <span style={{ ...text(SECONDARY_TEXT, { muted: true, wrap: true, lines: 3 }), flex: 1, minWidth: 0 }}>
          {CHORE_RULE_WORDS.tomorrow}
        </span>
      </div>
      <div style={line}>
        {facesInTurnOrder(row).map((face) => (
          <Fragment key={face.child.id}>
            {face.canMoveEarlier ? (
              <StepKey
                glyph="back"
                label={`Move ${face.child.displayName} earlier`}
                live
                busy={busy}
                onTap={() => {
                  onEarlier(face.child.id);
                }}
              />
            ) : null}
            <FaceKey
              face={face}
              busy={busy}
              onTap={() => {
                onMember(face.child.id, !face.member);
              }}
            />
          </Fragment>
        ))}
        <span style={{ ...text(SECONDARY_TEXT, { muted: true, wrap: true, lines: 2 }), flex: 1, minWidth: 0 }}>
          {CHORE_RULE_WORDS.roster}
        </span>
      </div>
      <div style={line}>
        <Pill
          word={RETIRE_WORDS.edit}
          on={false}
          live={!busy}
          minTapPx={TYPO.minTapPx}
          textPx={PRIMARY_TEXT}
          onTap={onEdit}
          data={{ 'data-chore-edit': row.choreId }}
        />
        {/* Armed, the key fills and says what the next tap does: two channels, as everywhere. */}
        <Pill
          word={armed ? RETIRE_WORDS.confirm : RETIRE_WORDS.retire}
          on={false}
          solid={armed}
          live={!busy}
          minTapPx={TYPO.minTapPx}
          textPx={PRIMARY_TEXT}
          onTap={onRetire}
          data={{ 'data-chore-retire': row.choreId, 'data-armed': armed ? 'yes' : 'no' }}
        />
        <span style={{ ...text(SECONDARY_TEXT, { muted: true, wrap: true, lines: 2 }), flex: 1, minWidth: 0 }}>
          {RETIRE_WORDS.rule}
        </span>
      </div>
    </div>
  );
}

/**
 * The retired chores, under the live ones: a name, its picture and Bring back. They stay out of
 * the summary's counts, because a retired chore is on nobody's list.
 */
function RetiredList({
  rows,
  busy,
  onRestore,
}: {
  rows: readonly RetiredChoreRow[];
  busy: boolean;
  onRestore: (choreId: string) => void;
}) {
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.small;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.meta;
  return (
    <div
      data-chore-retired=""
      style={{ display: 'flex', flexDirection: 'column', gap: px(spacePx.tapGap), flex: '0 0 auto', minWidth: 0 }}
    >
      <span style={{ ...text(SECONDARY_TEXT, { muted: true }), paddingTop: px(spacePx.xs) }}>
        {`${RETIRE_WORDS.retired} · ${String(rows.length)}`}
      </span>
      {rows.map((row) => (
        <div
          key={row.choreId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: px(spacePx.sm),
            minHeight: px(TYPO.minTapPx),
            padding: `${px(spacePx.none)} ${px(spacePx.xs)}`,
            background: colour.surfaceSunken,
            borderRadius: radius.md,
            minWidth: 0,
          }}
        >
          <span style={{ display: 'flex', opacity: cssTokens['--o-disabled'] }}>
            <AssetImage asset={row.icon} sizePx={iconPx.sm} />
          </span>
          <span style={{ ...text(PRIMARY_TEXT, { muted: true }), flex: 1, minWidth: 0 }}>{row.labelFull}</span>
          <Pill
            word={RETIRE_WORDS.restore}
            on={false}
            live={!busy}
            minTapPx={TYPO.minTapPx}
            textPx={PRIMARY_TEXT}
            onTap={() => {
              onRestore(row.choreId);
            }}
            data={{ 'data-chore-restore': row.choreId }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A child's face as the key that puts her on the chore or takes her off. Two channels, never the
 * colour alone: the face is bright when she is on it and dim when she is not, and the corner says
 * the same thing with a mark — the approved green with a check, or an outlined plus. The last
 * child's corner goes quiet and the face stops being a button (see the file header). A chore that
 * takes turns carries her place in the other corner.
 */
function FaceKey({ face, busy, onTap }: { face: ChoreFace; busy: boolean; onTap: () => void }) {
  const TYPO = useBandTypography();
  const { layout } = useWallLayout();
  const size = TYPO.minTapPx;
  const frame = size - spacePx.xs;
  const name = face.child.displayName;
  const corner = !face.canToggle
    ? { background: colour.surfaceSunken, edge: colour.surfaceSunken, glyph: 'check' as const, tone: colour.inkMuted }
    : face.member
      ? {
          background: stateTreatments.approved.fill,
          edge: stateTreatments.approved.edge,
          glyph: 'check' as const,
          tone: stateTreatments.approved.ink,
        }
      : { background: colour.surface, edge: colour.ink, glyph: 'plus' as const, tone: colour.ink };
  const badge = {
    position: 'absolute',
    width: px(FACE_BADGE_PX),
    height: px(FACE_BADGE_PX),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    boxSizing: 'border-box',
  } as const;
  return (
    <Tappable
      enabled={face.canToggle && !busy}
      onTap={onTap}
      label={face.member ? `Take ${name} off` : `Put ${name} on`}
      data={{ 'data-chore-face': face.child.id, 'data-member': face.member ? 'yes' : 'no' }}
      style={tapTarget(size, {
        position: 'relative',
        width: px(size),
        height: px(size),
        padding: px(spacePx.none),
        flex: '0 0 auto',
      })}
    >
      <span style={{ display: 'flex', opacity: face.member ? 1 : cssTokens['--o-disabled'] }}>
        <AccentFrame
          accent={childAccentForSlot(face.child.sortOrder)}
          sizePx={frame}
          selected={false}
          shape={layout.faceFrame}
        >
          <AssetImage asset={avatarRef(face.child)} sizePx={frame} />
        </AccentFrame>
      </span>
      {face.turn === null ? null : (
        <span aria-hidden style={{ ...badge, left: 0, top: 0, background: colour.ink }}>
          <span style={numeralText(fontSizePx.meta, colour.inkInverse)}>{String(face.turn)}</span>
        </span>
      )}
      <span
        aria-hidden
        style={{
          ...badge,
          right: 0,
          bottom: 0,
          background: corner.background,
          border: `${px(strokePx.medium)} solid ${corner.edge}`,
        }}
      >
        <Glyph name={corner.glyph} sizePx={FACE_BADGE_PX - 2 * strokePx.medium} tone={corner.tone} />
      </span>
    </Tappable>
  );
}
