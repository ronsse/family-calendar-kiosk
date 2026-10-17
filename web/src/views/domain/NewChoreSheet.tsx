/**
 * A chore, made at the wall, in three steps.
 *
 * The Chores panel's sheet: it takes the panel's whole pane while it is open, because the
 * panel has no keyboard and the sheet needs the room to draw one. Three steps, one screen
 * each, all the same height as the pane so nothing beneath them moves:
 *
 *   NAME     `[✕] [the name so far] [Next]` over three rows of keys. Ten keys of 64px and nine
 *            gutters is 784px, which is why the rows are the shape they are.
 *   ICON     `[Back] [name] [Next]` over the icons the house has, wrapped eight to a row.
 *   DETAILS  `[Back] [icon + name] [Duty|Extra] [Add]` over the points stepper and the three
 *            sharing pills, the three spans, and the seven days. The days are TOGGLES
 *            (2026-10-11): any set of them, never none; a span sets them all at once.
 *
 * The same sheet EDITS a chore (`draft.editing`, opened by `draftForEdit`): the same three
 * steps, holding what the chore holds, and the last one is only its days — kind, worth and
 * sharing each have their own control on the chore's row. Its last key says Save and sends
 * only what changed (`draftToEdit`); saving nothing simply closes.
 *
 * Every rule about what the draft may hold is in `logic/choreDraft.ts`; this file dispatches
 * and draws. The Next and Add keys are drawn inert until the step is whole — the same
 * treatment as an arrow at the end of its list — so a tap never lands on nothing.
 *
 * A refusal from the server is shown in the server's words (`refusal`), in the place the name
 * was. It stays until the next attempt or the sheet closes.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { AssignmentModel, ChoreKind } from '../../../../src/types.ts';
import {
  colour,
  fontSizePx,
  fontWeight,
  iconPx,
  radius,
  spacePx,
  strokePx,
} from '../../design/tokens.ts';
import type {
  ChoreCatalogEntry,
  ChoreEditRequest,
  ChoreIconEntry,
  NewChoreRequest,
} from '../../app/adminActions.ts';
import { useBandTypography } from '../bands/registry.tsx';
import { AssetImage } from '../primitives/AssetImage.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { ScrollColumn } from '../primitives/ScrollColumn.tsx';
import { Tappable, type DataMarks } from '../primitives/Tappable.tsx';
import { numeralText, px, tapTarget, text } from '../primitives/style.ts';
import { MODEL_WORDS, WALL_MODELS } from '../logic/choreAssign.ts';
import { pillState } from '../logic/pill.ts';
import { NOUN, nounFor } from '../logic/plural.ts';
import { DAY_ORDER, DAY_WORDS, SPANS, dayPillFlags, spanPillFlags } from '../logic/choreDays.ts';
import {
  KEY_ROWS,
  KIND_WORDS,
  canProceed,
  draftToEdit,
  draftToRequest,
  keyboardWidthPx,
  type ChoreDraft,
  type DraftAction,
} from '../logic/choreDraft.ts';

const NAME_HINT_WORD = 'Type a name';
const NEXT_WORD = 'Next';
const ADD_WORD = 'Add';
const SAVE_WORD = 'Save';
/** Shown in the spans row while an edited chore's rule is one the toggles cannot draw. */
const CUSTOM_DAYS_WORD = 'Custom days — tap a day to replace';
/** The edit sheet's one rule, under its days: when each change reaches the board. */
export const EDIT_RULE_WORDS = 'The name and picture change today. New days start tomorrow.';
/** The wall's hint when the house has no icons to choose from: a chore still needs one. */
const NO_ICONS_WORD = 'No pictures to choose from yet.';

/** The icon tile: bigger than a key so the drawing reads, and a whole number of them per row. */
const ICON_TILE_PX = 80;

export interface NewChoreSheetProps {
  draft: ChoreDraft;
  dispatch: (action: DraftAction) => void;
  icons: readonly ChoreIconEntry[];
  /**
   * The whole roster of the new chore: the first child in household order, since the chore list
   * is everyone's and this sheet has no roster step yet. The list opens the new row afterwards,
   * where the other faces are one tap each.
   */
  childId: string;
  busy: boolean;
  /** The server's words for why the last attempt was refused, or null. */
  refusal: string | null;
  onSend: (body: NewChoreRequest) => void;
  /** The chore being edited, when `draft.editing` names one. */
  editingChore?: ChoreCatalogEntry | null;
  /** Edit mode's way out: only the changed fields. Never called with nothing to send. */
  onSave?: (choreId: string, patch: ChoreEditRequest) => void;
  onClose: () => void;
}

export function NewChoreSheet({
  draft,
  dispatch,
  icons,
  childId,
  busy,
  refusal,
  onSend,
  editingChore = null,
  onSave,
  onClose,
}: NewChoreSheetProps) {
  const editing = draft.editing !== null && editingChore !== null && editingChore.id === draft.editing;
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.small;
  const NUMERAL_TEXT = TYPO.numeralTextPx ?? fontSizePx.cardTitle;
  const minTapPx = TYPO.minTapPx;
  const ready = canProceed(draft) && !busy;

  const key = (
    label: string,
    live: boolean,
    onTap: () => void,
    extra: { wide?: boolean; solid?: boolean } = {},
  ) => (
    <Pill
      word={label}
      on={false}
      solid={extra.solid === true && live}
      live={live}
      minTapPx={minTapPx}
      textPx={PRIMARY_TEXT}
      onTap={onTap}
      wide={extra.wide === true}
    />
  );

  const back = draft.step === 'name'
    ? <SquareKey glyph="cross" live={!busy} minTapPx={minTapPx} onTap={onClose} />
    : <SquareKey glyph="back" live={!busy} minTapPx={minTapPx} onTap={() => { dispatch({ type: 'back' }); }} />;

  const chosenIcon = icons.find((i) => i.assetId === draft.iconAssetId) ?? null;

  const middle = (
    <span
      style={{
        ...fieldStyle(minTapPx, { flex: 1, gap: px(spacePx.sm), padding: `${px(spacePx.none)} ${px(spacePx.md)}` }),
        ...text(PRIMARY_TEXT, { muted: refusal !== null || draft.name === '' }),
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {draft.step === 'details' && chosenIcon !== null ? (
        <AssetImage asset={{ assetId: chosenIcon.assetId, url: chosenIcon.url, isFallback: false }} sizePx={iconPx.sm} />
      ) : null}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {refusal ?? (draft.name === '' ? NAME_HINT_WORD : draft.name)}
      </span>
    </span>
  );

  const navRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.tapGap),
        height: px(minTapPx),
        flex: '0 0 auto',
        minWidth: 0,
      }}
    >
      {back}
      {middle}
      {draft.step === 'details' && editing ? (
        key(SAVE_WORD, ready, () => {
          const patch = draftToEdit(draft, editingChore);
          if (patch === null) return;
          if (Object.keys(patch).length === 0 || onSave === undefined) onClose();
          else onSave(editingChore.id, patch);
        }, { wide: true, solid: true })
      ) : draft.step === 'details' ? (
        <>
          <PillRow>
            {(Object.keys(KIND_WORDS) as ChoreKind[]).map((kind) => (
              <Pill
                key={kind}
                word={KIND_WORDS[kind]}
                on={draft.kind === kind}
                live={!busy}
                minTapPx={minTapPx}
                textPx={PRIMARY_TEXT}
                onTap={() => { dispatch({ type: 'setKind', kind }); }}
              />
            ))}
          </PillRow>
          {key(ADD_WORD, ready, () => {
            const body = draftToRequest(draft, childId);
            if (body !== null) onSend(body);
          }, { wide: true, solid: true })}
        </>
      ) : (
        key(NEXT_WORD, ready, () => { dispatch({ type: 'next' }); }, { wide: true, solid: true })
      )}
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: px(spacePx.tapGap),
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {navRow}
      {draft.step === 'name' ? (
        <Keyboard live={!busy} minTapPx={minTapPx} textPx={NUMERAL_TEXT} dispatch={dispatch} />
      ) : draft.step === 'icon' ? (
        icons.length === 0 ? (
          <span style={{ ...text(PRIMARY_TEXT, { muted: true }), padding: px(spacePx.md) }}>{NO_ICONS_WORD}</span>
        ) : (
          <ScrollColumn gapPx={spacePx.tapGap} ground={colour.bg} padPx={strokePx.medium}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: px(spacePx.tapGap) }}>
              {icons.map((icon) => {
                const on = icon.assetId === draft.iconAssetId;
                return (
                  <Tappable
                    key={icon.assetId}
                    enabled={!busy}
                    onTap={() => { dispatch({ type: 'setIcon', assetId: icon.assetId }); }}
                    style={tapTarget(minTapPx, {
                      width: px(ICON_TILE_PX),
                      height: px(ICON_TILE_PX),
                      padding: px(spacePx.none),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      // The chosen tile keeps its white ground so the drawing stays legible;
                      // the choice is a thick ink frame, not a fill (an icon on ink goes dark).
                      background: on ? colour.surfaceSunken : colour.surface,
                      border: `${px(on ? strokePx.thick : strokePx.medium)} solid ${on ? colour.ink : colour.border}`,
                      borderRadius: radius.md,
                    })}
                  >
                    <AssetImage
                      asset={{ assetId: icon.assetId, url: icon.url, isFallback: false }}
                      sizePx={iconPx.md}
                    />
                  </Tappable>
                );
              })}
            </div>
          </ScrollColumn>
        )
      ) : (
        <Details
          editing={editing}
          draft={draft}
          dispatch={dispatch}
          busy={busy}
          minTapPx={minTapPx}
          primaryTextPx={PRIMARY_TEXT}
          secondaryTextPx={SECONDARY_TEXT}
          numeralTextPx={NUMERAL_TEXT}
        />
      )}
    </div>
  );
}

function Details({
  editing,
  draft,
  dispatch,
  busy,
  minTapPx,
  primaryTextPx,
  secondaryTextPx,
  numeralTextPx,
}: {
  editing: boolean;
  draft: ChoreDraft;
  dispatch: (action: DraftAction) => void;
  busy: boolean;
  minTapPx: number;
  primaryTextPx: number;
  secondaryTextPx: number;
  numeralTextPx: number;
}) {
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: px(spacePx.tapGap),
    height: px(minTapPx),
    flex: '0 0 auto',
    minWidth: 0,
  } as const;
  const days = (
    <>
      <div style={rowStyle}>
        <PillRow>
          {SPANS.map((span) => (
            <Pill
              key={span.id}
              word={span.word}
              {...spanPillFlags(draft.days, span, busy)}
              minTapPx={minTapPx}
              textPx={primaryTextPx}
              onTap={() => { dispatch({ type: 'setSpan', spanId: span.id }); }}
              data={{ 'data-day-span': span.id }}
            />
          ))}
        </PillRow>
        {draft.days === null ? (
          <span style={{ ...text(secondaryTextPx, { muted: true }), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {CUSTOM_DAYS_WORD}
          </span>
        ) : null}
      </div>
      <div style={rowStyle}>
        <PillRow>
          {DAY_ORDER.map((day) => (
            <Pill
              key={day}
              word={DAY_WORDS[day]}
              {...dayPillFlags(draft.days, day, busy)}
              minTapPx={minTapPx}
              textPx={primaryTextPx}
              onTap={() => { dispatch({ type: 'toggleDay', day }); }}
              data={{ 'data-day': day }}
            />
          ))}
        </PillRow>
      </div>
    </>
  );
  if (editing) {
    return (
      <>
        {days}
        <span style={text(secondaryTextPx, { muted: true })}>{EDIT_RULE_WORDS}</span>
      </>
    );
  }
  return (
    <>
      <div style={rowStyle}>
        <SquareKey glyph="minus" live={!busy && draft.basePoints > 0} minTapPx={minTapPx} onTap={() => { dispatch({ type: 'points', delta: -1 }); }} />
        <span style={fieldStyle(minTapPx, { flex: '0 0 auto', gap: px(spacePx.sm), padding: `${px(spacePx.none)} ${px(spacePx.md)}` })}>
          <span style={{ ...numeralText(numeralTextPx, colour.ink), minWidth: px(iconPx.sm), textAlign: 'center' }}>
            {draft.basePoints}
          </span>
          <span style={text(secondaryTextPx, { muted: true })}>{nounFor(draft.basePoints, NOUN.point)}</span>
        </span>
        <SquareKey glyph="plus" live={!busy} minTapPx={minTapPx} onTap={() => { dispatch({ type: 'points', delta: 1 }); }} />
        <span style={{ width: px(spacePx.sm) }} />
        <PillRow>
          {WALL_MODELS.map((model: AssignmentModel) => (
            <Pill
              key={model}
              word={MODEL_WORDS[model]}
              on={draft.assignmentModel === model}
              live={!busy}
              minTapPx={minTapPx}
              textPx={primaryTextPx}
              onTap={() => { dispatch({ type: 'setModel', model }); }}
            />
          ))}
        </PillRow>
      </div>
      {days}
    </>
  );
}

function Keyboard({
  live,
  minTapPx,
  textPx,
  dispatch,
}: {
  live: boolean;
  minTapPx: number;
  textPx: number;
  dispatch: (action: DraftAction) => void;
}) {
  // One block as wide as the widest row, centred on the sheet (`keyboardWidthPx`).
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: px(spacePx.tapGap),
        width: px(keyboardWidthPx(minTapPx, spacePx.tapGap)),
        alignSelf: 'center',
        flex: '0 0 auto',
      }}
    >
      {KEY_ROWS.map((row, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: px(spacePx.tapGap),
            height: px(minTapPx),
            flex: '0 0 auto',
            minWidth: 0,
          }}
        >
          {row.map((k) =>
            typeof k === 'string' ? (
              <Tappable
                key={k}
                enabled={live}
                onTap={() => { dispatch({ type: 'type', char: k }); }}
                style={keyStyle(minTapPx, false)}
              >
                <span style={numeralText(textPx, colour.ink)}>{k}</span>
              </Tappable>
            ) : k.key === 'backspace' ? (
              <Tappable key="backspace" enabled={live} onTap={() => { dispatch({ type: 'backspace' }); }} style={keyStyle(minTapPx, false)}>
                <Glyph name="back" sizePx={fontSizePx.bodyLarge} tone={colour.ink} />
              </Tappable>
            ) : (
              <Tappable key="space" enabled={live} onTap={() => { dispatch({ type: 'space' }); }} style={keyStyle(minTapPx, true)}>
                <span style={{ width: '40%', height: px(strokePx.medium), background: colour.ink, borderRadius: radius.pill }} />
              </Tappable>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function keyStyle(minTapPx: number, wide: boolean) {
  return tapTarget(minTapPx, {
    width: wide ? undefined : px(minTapPx),
    flex: wide ? 1 : '0 0 auto',
    height: px(minTapPx),
    padding: px(spacePx.none),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colour.surface,
    border: `${px(strokePx.medium)} solid ${colour.border}`,
    borderRadius: radius.md,
  });
}

/** A square key with a glyph: the sheet's close, back, minus and plus. Inert is muted, like an arrow at the end. */
function SquareKey({
  glyph,
  live,
  minTapPx,
  onTap,
}: {
  glyph: 'cross' | 'back' | 'minus' | 'plus';
  live: boolean;
  minTapPx: number;
  onTap: () => void;
}) {
  return (
    <Tappable
      enabled={live}
      onTap={onTap}
      data={{ 'data-sheet-key': glyph }}
      style={tapTarget(minTapPx, {
        width: px(minTapPx),
        height: px(minTapPx),
        padding: px(spacePx.none),
        flex: '0 0 auto',
        background: live ? colour.surface : colour.surfaceSunken,
        border: `${px(strokePx.medium)} solid ${live ? colour.border : colour.surfaceSunken}`,
        borderRadius: radius.md,
      })}
    >
      <Glyph name={glyph} sizePx={fontSizePx.bodyLarge} tone={live ? colour.ink : colour.inkMuted} />
    </Tappable>
  );
}

/** A field: the surface the keys wear, for the words and numbers a parent is building. */
function fieldStyle(minTapPx: number, extra: CSSProperties): CSSProperties {
  return {
    height: px(minTapPx),
    boxSizing: 'border-box',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    background: colour.surface,
    border: `${px(strokePx.medium)} solid ${colour.border}`,
    borderRadius: radius.md,
    ...extra,
  };
}

function PillRow({ children }: { children: ReactNode }) {
  return <span style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>{children}</span>;
}

/**
 * One word in a pill. Which face it wears and whether it is a button is `pillState`'s answer
 * (`logic/pill.ts`, where the test is). Shared with the chores panel's model pills.
 */
export function Pill({
  word,
  on,
  solid = false,
  live,
  minTapPx,
  textPx,
  onTap,
  wide = false,
  data,
}: {
  word: string;
  on: boolean;
  solid?: boolean;
  live: boolean;
  minTapPx: number;
  textPx: number;
  onTap: () => void;
  wide?: boolean;
  /** Marks for the audit and the probes (`Tappable`'s `DataMarks`). */
  data?: DataMarks | undefined;
}) {
  const { enabled, filled, muted } = pillState({ on, solid, live });
  const face = muted
    ? { background: colour.surfaceSunken, border: colour.surfaceSunken, ink: colour.inkMuted }
    : filled
      ? { background: colour.ink, border: colour.ink, ink: colour.inkInverse }
      : { background: colour.surface, border: colour.border, ink: colour.ink };
  return (
    <Tappable
      enabled={enabled}
      onTap={onTap}
      data={data}
      style={tapTarget(minTapPx, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
        padding: `${px(spacePx.none)} ${px(wide ? spacePx.lg : spacePx.sm)}`,
        background: face.background,
        border: `${px(strokePx.medium)} solid ${face.border}`,
        borderRadius: radius.pill,
      })}
    >
      <span style={{ ...text(textPx), color: face.ink, ...(filled ? { fontWeight: fontWeight.black } : {}) }}>
        {word}
      </span>
    </Tappable>
  );
}
