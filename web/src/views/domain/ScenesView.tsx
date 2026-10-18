/**
 * Unit H — the picture library, on the grown-up screen.
 *
 * Requested 2026-09-08: *"We also wanna be able to select images or go back or have a catalog…
 * maybe it's in the admin section… that we can review and test backgrounds."*
 *
 * ## Why the review happens AT the panel and not on a laptop
 *
 * A file browser would have been less work. It would also have been the wrong tool, because
 * the thing being judged cannot be judged anywhere else: this wall is 225 nits behind
 * anti-glare etched glass, and colours that separate cleanly on a laptop collapse into each
 * other on it. CLAUDE.md's instruction on exactly this is two words — *test on the panel*. A
 * background approved from a desk is a background approved against the wrong display.
 *
 * ## The shape: one big picture, and a list beside it
 *
 * An obvious grid of thumbnails was tried on paper first and abandoned. Three across in the
 * 800px pane gives 256x144 tiles, which is too small to see whether a child is findable, and
 * it leaves nowhere to put two ≥64px decisions with the mandatory 16px inert gutter between
 * them — the tile would have had to hold the picture AND both buttons. Splitting it — one
 * picture at 456x256 and a 64px-row list beside it — makes the picture four times the area,
 * and gives the two decisions a whole row of their own where they cannot be mis-tapped.
 *
 * The list SCROLLS and is GROUPED (2026-09-13): every picture the household has ever had, under
 * New / On the wall / Ready / Retired, newest first in each. It was eight fixed slots and a
 * count, and the count was the only evidence that the ninth picture existed. See
 * `ScrollColumn` for where scrolling is allowed on this wall and why here.
 *
 * ## Approving is choosing, and there is only one verb for it
 *
 * The wall shows the most recently APPROVED scene, so approving a picture that is already
 * approved is how you go back to it. That is why the primary button says *put this up* rather
 * than *approve*: it is the true description of what happens, for a candidate and for a scene
 * from three weeks ago alike, and it means an adult never has to learn a second concept.
 *
 * ## Putting one up asks for nothing; retiring one asks for the PIN
 *
 * Since 2026-09-16 choosing a picture is a WALL request (`WallActions.approveScene`): every
 * outcome is another picture, each undone by choosing a different one, and a door in front of
 * it had the household handing the children the PIN that also opens the ledger. RETIRE is the
 * one control here that removes rather than chooses, so it stayed an admin request. The pad
 * comes up for it — once per visit to the portal (grownupVisit.ts), never on arrival — and
 * names the picture it is about by its name, not its id. Looking needs nothing at all: the
 * catalog is a wall read.
 *
 * ## The picture on the wall stays until another one replaces it
 *
 * Its own row offers neither key (`sceneDecisions`, 2026-10-11). Retiring it used to be allowed,
 * and since the wall shows the newest APPROVED picture, it quietly put up whichever had been
 * approved before — a picture nobody chose this week, from a key that says removal. Put the
 * next one up first; then the old one can go.
 *
 * ## Its own destination, in the wall's frame
 *
 * Reached from the picture door in the wall's header and from the Picture tile on the grown-up
 * Home. The rest of the portal draws its own frame (GrownupChrome); this screen keeps the side
 * shell — the rail, the header and the week's picture behind the pane — so everything drawn
 * over that picture stands on a plate of its own, and a key that cannot be pressed is sunken
 * rather than see-through.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  colour,
  fontSizePx,
  fontWeight,
  layoutPx,
  radius,
  spacePx,
  strokePx,
} from '../../design/tokens.ts';
import {
  NULL_ADMIN_ACTIONS,
  REFUSAL_WORDS,
  SCENE_GROUP_HEADING_PX,
  SCENE_LIST_GAP_PX,
  SCENE_LIST_WIDTH_PX,
  SCENE_PREVIEW_HEIGHT_PX,
  SCENE_PREVIEW_WIDTH_PX,
  SCENE_ROW_HEIGHT_PX,
  catalogGroups,
  refusalCodeOf,
  refusalIsRetryable,
  reviewOrder,
  sceneDecisions,
  sceneHistoryWords,
  sceneLabel,
  type AdminActions,
  type RefusalCode,
  type SceneCatalog,
  type SceneCatalogEntry,
  type SceneGroupKey,
} from '../../app/adminActions.ts';
import { useWall } from '../../app/wallContext.ts';
import { BandScope, DeskScope, useBandTypography } from '../bands/registry.tsx';
import { AMBIENT_BAND } from '../logic/idle.ts';
import { ScrollColumn } from '../primitives/ScrollColumn.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { card, numeralText, plateStyle, px, text } from '../primitives/style.ts';
import { CARD_PLATE } from '../logic/plate.ts';
import { PinSheet } from './PinSheet.tsx';

const TITLE_WORD = 'Pictures';
const EMPTY_HEAD_WORD = 'No pictures yet';
const EMPTY_BODY_WORD = "Sunday night's run will put one here.";
const PUT_UP_WORD = 'Put this up';
const ON_WALL_WORD = 'On the wall now';
const RETIRE_WORD = 'Retire';
const BROKEN_WORD = 'Cannot be used — no tap regions';
const DOOR_WORD = 'Grown-ups';
const DOOR_DETAIL_WORD = 'Retiring a picture asks for the PIN. Putting one up never does.';
const SEPARATOR = ' · ';

/** The list's headings — what a reviewer scans for, which is not the state name. */
const GROUP_WORD: Record<SceneGroupKey, string> = {
  new: 'New this week',
  onWall: ON_WALL_WORD,
  ready: 'Ready to put up',
  retired: 'Retired',
};

// The geometry lives in `app/adminActions.ts`, beside the approval pane's, and NOT here.
// That is mechanical: the test runner strips `.ts` and not `.tsx`, so a number in a component
// cannot be asserted on at all — and this screen's row gutter shipped at 8px, half the inert
// gutter, and had to be caught by measuring the real panel.

/** The row's thumbnail. 96 is the rail's width — the wall's existing small-image size. */
const THUMB_W = 96;

export interface ScenesViewProps {
  actions?: AdminActions | undefined;
  /**
   * The PIN this visit to the grown-up portal is holding, or null if the door has not been
   * opened yet.  Shared with the approvals queue — one door, one entry (grownupVisit.ts).
   */
  pin?: string | null | undefined;
  /** Hand back a PIN that worked, or null to forget one the server rejected. */
  onPin?: ((pin: string | null) => void) | undefined;
}

export function ScenesView({ actions, pin, onPin }: ScenesViewProps) {
  return (
    <BandScope band={AMBIENT_BAND}>
      {/* An adult is standing at the glass with a finger on it, like every other decision
          surface — not reading this from the kitchen (H8: viewing distance is per destination). */}
      {/* The DESK — an adult at a control panel, one step down the type scale from a child at
          arm's length. Same reasoning as the approvals queue; see `deskTypography`. */}
      <DeskScope>
        <ScenesPane
          actions={actions ?? NULL_ADMIN_ACTIONS}
          pin={pin ?? null}
          onPin={onPin ?? (() => undefined)}
        />
      </DeskScope>
    </BandScope>
  );
}

type SceneDecision = 'approve' | 'retire';

function ScenesPane({
  actions,
  pin,
  onPin,
}: {
  actions: AdminActions;
  pin: string | null;
  onPin: (pin: string | null) => void;
}) {
  // `wall.actions` carries the DEVICE TOKEN; this component must not fetch on its own. It did
  // at first, and on the panel the catalog came back empty every time — the wall surface needs
  // `Authorization: Device <token>` and a bare `fetch` from a component has no way to know it.
  // The failure was silent in the worst way: the screen rendered perfectly and said "No
  // pictures yet", which is a sentence this wall is fully entitled to say.
  const { actions: wall, resetKey } = useWall();
  const TYPO = useBandTypography();
  const PRIMARY_TEXT = TYPO.primaryTextPx ?? fontSizePx.bodyLarge;
  const SECONDARY_TEXT = TYPO.secondaryTextPx ?? fontSizePx.small;

  const [catalog, setCatalog] = useState<SceneCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [intent, setIntent] = useState<SceneDecision | null>(null);
  const [refusal, setRefusal] = useState<RefusalCode | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The pad is the DOOR to the portal, not a confirmation on every picture.
   *
   * It used to be the latter — `intent !== null` raised it, every time — which meant putting
   * three new scenes up cost three full pad entries, on the same evening the operator asked for
   * the opposite.
   *
   * SINCE 2026-09-16 IT DOES NOT OPEN ON ARRIVAL AT ALL. Choosing a picture asks for nothing:
   * the route moved to the wall surface, because a door that made the household hand the
   * children the master key was buying less than it cost. The pad is raised only by RETIRE,
   * which is the one control here that removes rather than chooses.
   */
  const [padOpen, setPadOpen] = useState(false);

  const load = useCallback(() => {
    let live = true;
    void wall.fetchScenes().then((got) => {
      if (live) setCatalog(got);
    });
    return () => {
      live = false;
    };
  }, [wall]);

  // Refetched on every snapshot, because approving invalidates 'all' and the server is the
  // only thing that knows which picture actually won. A local guess here would be a second
  // opinion about the one fact this screen exists to state.
  useEffect(load, [load, resetKey]);

  const scenes = catalog === null ? [] : reviewOrder(catalog);
  // The selection follows the catalog rather than being remembered independently: a scene that
  // has gone, or a first load with nothing chosen yet, both resolve to "the first row".
  const selected = scenes.find((s) => s.id === selectedId) ?? scenes[0] ?? null;

  /**
   * The one path from this screen to the server, and it cannot be walked without a PIN.
   *
   * `parentPin` is a parameter of this function and of nothing else: it arrives from the
   * sheet, is spent on one request, and is unreachable afterwards. Never in state, never
   * closed over by a retry, never stored — the wall holds no admin session, by design.
   */
  function decide(parentPin: string | null, what: SceneDecision | null = intent): void {
    const target = selected;
    if (target === null || what === null || busy) return;
    // Retiring is the only thing here that still needs one, and `run()` below never calls this
    // for a retire without one — but a null would otherwise reach the request as the string
    // "null" and come back `bad_pin`, which reads as a wrong PIN rather than a missing one.
    if (what === 'retire' && parentPin === null) {
      setPadOpen(true);
      return;
    }
    setBusy(true);
    setRefusal(null);
    const call =
      what === 'approve'
        ? wall.approveScene(target.id)
        : actions.retireScene(target.id, parentPin as string);
    void call.then(
      () => {
        setBusy(false);
        setIntent(null);
        setRefusal(null);
        // It worked, so it is the household's PIN. Hold it for the rest of this visit. An
        // approve carries no PIN and has nothing to vouch for, so it says nothing about one.
        if (parentPin !== null) onPin(parentPin);
        setPadOpen(false);
        // Ask the server what happened rather than assuming. The picture on the wall is the
        // post-condition, and this screen's whole job is to state it correctly.
        load();
      },
      (err: unknown) => {
        setBusy(false);
        const code = refusalCodeOf(err);
        if (code === 'bad_pin') {
          // Forget it and ask again, here and in the queue: it is one PIN for one portal.
          onPin(null);
          setPadOpen(true);
        }
        // Some codes are contracted to say nothing at all. Nothing means nothing.
        if (REFUSAL_WORDS[code].length === 0) {
          setIntent(null);
          setRefusal(null);
          return;
        }
        setRefusal(code);
      },
    );
  }

  const said = refusal === null ? null : REFUSAL_WORDS[refusal];
  const padInert = busy || (refusal !== null && !refusalIsRetryable(refusal));
  const isActive = selected !== null && selected.id === catalog?.activeSceneId;
  const can = sceneDecisions(selected, catalog?.activeSceneId ?? null);

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: px(layoutPx.wallGutter),
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {scenes.length === 0 ? (
        <Empty primaryTextPx={PRIMARY_TEXT} secondaryTextPx={SECONDARY_TEXT} loaded={catalog !== null} />
      ) : (
        <>
          {/* On a plate: the week's picture is behind this pane, and a title set straight on
              the art is a line of type across somebody's drawing. */}
          <div
            style={plateStyle(CARD_PLATE, {
              display: 'flex',
              alignItems: 'center',
              gap: px(spacePx.sm),
              height: px(layoutPx.agendaRowHeight),
              padding: `${px(spacePx.none)} ${px(spacePx.sm)}`,
              borderRadius: radius.md,
              flex: '0 0 auto',
              minWidth: 0,
            })}
          >
            <span style={{ ...text(PRIMARY_TEXT), flex: 1, minWidth: 0 }}>{TITLE_WORD}</span>
            {/* The WHOLE library, not the visible part of it — the same meaning this numeral
                already has on the approval screen. Four rows fit and the library only grows, so
                without it the pictures below the fold would not exist as far as a reviewer is
                concerned. Retiring is how the list gets short again.

                Not the candidate count, tempting as that was: two numerals in one header is
                clutter, and a new picture is already the first row and the only one saying
                "New". */}
            <span
              style={{ ...numeralText(PRIMARY_TEXT, colour.ink), fontWeight: fontWeight.black }}
            >
              {String(scenes.length)}
            </span>
          </div>

          <div style={{ display: 'flex', gap: px(layoutPx.wallGutter), flex: 1, minHeight: 0 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: px(layoutPx.wallGutter),
                flex: '0 0 auto',
                width: px(SCENE_PREVIEW_WIDTH_PX),
              }}
            >
              <Preview scene={selected} isActive={isActive} secondaryTextPx={SECONDARY_TEXT} />
              <div style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>
                <Decision
                  word={isActive ? ON_WALL_WORD : PUT_UP_WORD}
                  tone="primary"
                  // Putting up the picture that is already up is a no-op an adult would read as
                  // a broken button, and a scene with no usable regions would be accepted by the
                  // server and then silently skipped by the wall — a dead end that looks like a
                  // working screen. Both are refused HERE, where the reason can be shown.
                  enabled={can.putUp}
                  minTapPx={TYPO.minTapPx}
                  onTap={() => {
                    setRefusal(null);
                    setIntent('approve');
                    // No pad, ever: the button IS the decision. Putting a picture up is not an
                    // adult action (see WallActions.approveScene).
                    decide(null, 'approve');
                  }}
                />
                <Decision
                  word={RETIRE_WORD}
                  tone="quiet"
                  // Never the picture that is up: see the header, and `sceneDecisions`.
                  enabled={can.retire}
                  minTapPx={TYPO.minTapPx}
                  onTap={() => {
                    setRefusal(null);
                    setIntent('retire');
                    // With the PIN already in hand the button IS the decision — no pad, no
                    // confirm step. That is the whole point of holding it for the visit.
                    if (pin !== null) decide(pin, 'retire');
                    else setPadOpen(true);
                  }}
                />
              </div>
            </div>

            {/*
              ONE column, every picture, grouped. A card of its own so the rows sit on white
              rather than on the faded scene behind the pane — the old rows were transparent,
              and "Ready trailer-camp" over a drawing of a trailer camp is two things in one
              place. The card is also the ground the scroll fades dissolve into.
            */}
            <div
              style={card({
                display: 'flex',
                flexDirection: 'column',
                width: px(SCENE_LIST_WIDTH_PX),
                flex: '0 0 auto',
                minHeight: 0,
                overflow: 'hidden',
              })}
            >
              <ScrollColumn gapPx={SCENE_LIST_GAP_PX} padPx={spacePx.xs}>
                {catalogGroups(catalog ?? { activeSceneId: null, scenes: [] }).map((group) => (
                  <div
                    key={group.key}
                    // The rows inside a group are the rows SCENE_LIST_GAP_PX is about. At 8px two
                    // of them sat half an inert gutter apart (panel audit, 2026-09-26).
                    style={{ display: 'flex', flexDirection: 'column', gap: px(SCENE_LIST_GAP_PX) }}
                  >
                    <GroupHeading
                      word={GROUP_WORD[group.key]}
                      count={group.scenes.length}
                      secondaryTextPx={SECONDARY_TEXT}
                    />
                    {group.scenes.map((scene) => (
                      <ListRow
                        key={scene.id}
                        scene={scene}
                        selected={selected?.id === scene.id}
                        primaryTextPx={PRIMARY_TEXT}
                        secondaryTextPx={SECONDARY_TEXT}
                        onTap={() => {
                          setSelectedId(scene.id);
                          setRefusal(null);
                        }}
                      />
                    ))}
                  </div>
                ))}
              </ScrollColumn>
            </div>
          </div>
        </>
      )}

      {/*
        The pad. Raised by Retire alone, and only while this visit holds no PIN; named for the
        retire, with the picture's name under it. Cancel dismisses it rather than leaving the
        screen: the catalog is readable by anyone, and always was.
      */}
      {padOpen && (scenes.length > 0 || intent !== null) ? (
        <PinSheet
          headline={intent === null ? DOOR_WORD : intent === 'approve' ? PUT_UP_WORD : RETIRE_WORD}
          detail={intent === null ? DOOR_DETAIL_WORD : selected === null ? '' : sceneLine(selected)}
          busy={padInert}
          refusal={said}
          onSubmit={(entered) => {
            // With nothing being decided — a refusal that says nothing clears the intent and
            // leaves the pad up — there is nothing to spend the PIN on. Take it for the visit;
            // the next retire is where the server gets its say. Calling `decide` here would do
            // NOTHING AT ALL — the 2026-09-10 shape this project keeps finding.
            if (intent === null) {
              onPin(entered);
              setPadOpen(false);
              return;
            }
            decide(entered);
          }}
          onCancel={() => {
            setPadOpen(false);
            setIntent(null);
            setRefusal(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** "Lantern night market · Week 38 · GPT": the picture's name for a person, never its id. */
function sceneLine(scene: SceneCatalogEntry): string {
  const label = sceneLabel(scene);
  return label.detail.length === 0 ? label.title : `${label.title}${SEPARATOR}${label.detail}`;
}

/** The picture in front of the reviewer, big enough to tell whether a child is findable in it. */
function Preview({
  scene,
  isActive,
  secondaryTextPx,
}: {
  scene: SceneCatalogEntry | null;
  isActive: boolean;
  secondaryTextPx: number;
}) {
  const history = scene === null ? '' : sceneHistoryWords(scene);
  return (
    <div
      style={{
        width: px(SCENE_PREVIEW_WIDTH_PX),
        height: px(SCENE_PREVIEW_HEIGHT_PX),
        flex: '0 0 auto',
        position: 'relative',
        borderRadius: radius.md,
        // A thick edge, and a heavier one when this is the picture that is up. The wall's own
        // art fills this box edge to edge, so without a border the preview has no boundary at
        // all against a screen that is itself showing a picture.
        border: `${px(isActive ? strokePx.thick : strokePx.medium)} solid ${
          isActive ? colour.borderStrong : colour.border
        }`,
        background: scene === null ? colour.surfaceSunken : `url("${scene.image}") center/cover`,
        overflow: 'hidden',
        // The border sits INSIDE the 16:9 box. Without this it was added outside, so the
        // preview was 8px wider and taller than the column arithmetic above allows — measured
        // 2026-09-26 as 480x274 in a 472px column, pushing the Decision row 8px past the pane —
        // and it changed size between the medium and thick edge when a picture went up.
        boxSizing: 'border-box',
      }}
    >
      {scene !== null && !scene.usable ? (
        // The one thing a reviewer cannot see by looking at the picture: it has no doors in
        // it. Said over the art, because the art looks perfectly fine and that is the problem.
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: `${px(spacePx.xs)} ${px(spacePx.sm)}`,
            background: colour.danger,
            ...text(secondaryTextPx),
            color: colour.inkInverse,
            fontWeight: fontWeight.black,
          }}
        >
          {BROKEN_WORD}
        </div>
      ) : null}
      {history.length === 0 ? null : (
        // How long this one has been up, ever — the favourites, measured. Laid OVER the art in
        // a corner rather than under it, because the column below the preview is already
        // exactly as tall as the pane allows (the 2026-09-26 measurement above).
        <div
          style={{
            position: 'absolute',
            left: px(spacePx.xs),
            top: px(spacePx.xs),
            padding: `${px(spacePx.xxs)} ${px(spacePx.sm)}`,
            borderRadius: radius.sm,
            background: colour.surface,
            ...text(secondaryTextPx),
            color: colour.ink,
            fontWeight: fontWeight.black,
          }}
        >
          {history}
        </div>
      )}
    </div>
  );
}

/** A group's heading: the word a reviewer is scanning for, and how many rows are under it. */
function GroupHeading({
  word,
  count,
  secondaryTextPx,
}: {
  word: string;
  count: number;
  secondaryTextPx: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.xs),
        height: px(SCENE_GROUP_HEADING_PX),
        flex: '0 0 auto',
        paddingLeft: px(spacePx.xxs),
        paddingRight: px(spacePx.xxs),
        borderBottom: `${px(strokePx.min)} solid ${colour.border}`,
      }}
    >
      <span
        style={{
          ...text(secondaryTextPx),
          flex: 1,
          minWidth: 0,
          fontWeight: fontWeight.black,
          color: colour.inkMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {word}
      </span>
      <span style={{ ...numeralText(secondaryTextPx, colour.inkMuted) }}>{String(count)}</span>
    </div>
  );
}

function ListRow({
  scene,
  selected,
  primaryTextPx,
  secondaryTextPx,
  onTap,
}: {
  scene: SceneCatalogEntry;
  selected: boolean;
  primaryTextPx: number;
  secondaryTextPx: number;
  onTap: () => void;
}) {
  const label = sceneLabel(scene);
  return (
    <Tappable
      enabled
      onTap={onTap}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.sm),
        height: px(SCENE_ROW_HEIGHT_PX),
        flex: '0 0 auto',
        padding: px(spacePx.xxs),
        textAlign: 'left',
        background: selected ? colour.surfaceSunken : 'transparent',
        border: `${px(strokePx.medium)} solid ${selected ? colour.borderStrong : 'transparent'}`,
        borderRadius: radius.md,
        cursor: 'pointer',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: px(THUMB_W),
          height: px(Math.round((THUMB_W * 9) / 16)),
          flex: '0 0 auto',
          borderRadius: radius.sm,
          background: `url("${scene.image}") center/cover`,
          border: `${px(strokePx.min)} solid ${colour.border}`,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        {/* The NAME leads now that the state is the heading above it — "Lantern night market"
            rather than "2026w38-lante…", which is what the id came to in this column. */}
        <span style={text(primaryTextPx, { wrap: true, lines: 1 })}>{label.title}</span>
        {label.detail.length === 0 ? null : (
          <span style={{ ...text(secondaryTextPx), color: colour.inkMuted }}>{label.detail}</span>
        )}
      </div>
    </Tappable>
  );
}

function Decision({
  word,
  tone,
  enabled,
  minTapPx,
  onTap,
}: {
  word: string;
  tone: 'primary' | 'quiet';
  enabled: boolean;
  minTapPx: number;
  onTap: () => void;
}) {
  const solid = tone === 'primary' && enabled;
  // A disabled control keeps its SIZE and loses its weight — removing it would move the other
  // button under a finger already on its way down. It is SUNKEN and OPAQUE: at 45% opacity it
  // let the week's picture behind the pane show through its own words.
  const fill = solid ? colour.surfaceInverse : enabled ? colour.surface : colour.surfaceSunken;
  const edge = solid ? colour.surfaceInverse : enabled ? colour.border : colour.surfaceSunken;
  return (
    <Tappable
      enabled={enabled}
      onTap={onTap}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minWidth: 0,
        minHeight: px(minTapPx),
        padding: `${px(spacePx.xxs)} ${px(spacePx.sm)}`,
        background: fill,
        border: `${px(strokePx.medium)} solid ${edge}`,
        borderRadius: radius.md,
        cursor: enabled ? 'pointer' : 'default',
        // 24 and above is where ink-inverse on the inverse surface is a declared-legal pair
        // (Unit G's contrast rules), and this button is the largest text on the row anyway.
        ...text(fontSizePx.bodyLarge),
        color: solid ? colour.inkInverse : enabled ? colour.ink : colour.inkMuted,
        fontWeight: fontWeight.black,
      }}
    >
      {word}
    </Tappable>
  );
}

function Empty({
  primaryTextPx,
  secondaryTextPx,
  loaded,
}: {
  primaryTextPx: number;
  secondaryTextPx: number;
  loaded: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: px(spacePx.xs),
        flex: 1,
        textAlign: 'center',
      }}
    >
      {/* Before the first answer arrives this says nothing rather than "no pictures", which
          would be a confident wrong statement for one round trip. */}
      {loaded ? (
        <>
          <span style={{ ...text(primaryTextPx), fontWeight: fontWeight.black }}>
            {EMPTY_HEAD_WORD}
          </span>
          <span style={{ ...text(secondaryTextPx), color: colour.inkMuted }}>
            {EMPTY_BODY_WORD}
          </span>
        </>
      ) : null}
    </div>
  );
}
