/**
 * Unit H — the wall shell.
 *
 * What it owns: which child is selected, which band the chrome renders in, the
 * clock, the tap gate, and the 90-second decay back to ambient.  All of it in
 * React state.  **Never localStorage, never the server** — a persisted selection is
 * what leaves the wrong child's screen up all night (H3, adopted as H2 Q3 graft #3).
 *
 * What it does NOT own: fetching.  The snapshot arrives as a prop.  SSE wiring, the
 * date-boundary refetch and the `minClientBuild` hard-reload belong to the data
 * layer over `src/http/**`, which is another unit's file boundary; this component
 * reports a local-date rollover through `onLocalDateChange` and renders whatever it
 * is handed, including a stale snapshot — labelled as stale, which is the contract
 * (H2 gap #3: stale-but-labelled satisfies the prime invariant, stale-and-confident
 * does not).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useState, type CSSProperties } from 'react';
import type { LocalDate, WallSnapshot } from '../../../src/types.ts';
import {
  colour,
  controlShadow,
  font,
  fontSizePx,
  fontWeight,
  ground,
  iconPx,
  layoutPx,
  radius,
  spacePx,
  strokePx,
  tapPx,
} from '../design/tokens.ts';
import { BandRendererProvider, BandLeaf, NearScope, useBandTypography } from '../views/bands/registry.tsx';
import { InertBlock, RendererErrorBoundary } from '../views/RendererErrorBoundary.tsx';
import { AmbientView } from '../views/domain/AmbientView.tsx';
import { DepartureBanner, useDepartureAlert } from '../views/domain/DepartureBanner.tsx';
import { ApprovalsView } from '../views/domain/ApprovalsView.tsx';
import { ScenesView } from '../views/domain/ScenesView.tsx';
import { WeekView } from '../views/domain/WeekView.tsx';
import { SceneView } from '../views/domain/SceneView.tsx';
import { ChildBar } from '../views/domain/ChildBar.tsx';
import { ChildView } from '../views/domain/ChildView.tsx';
import { ClockFace, Glyph } from '../views/primitives/Glyph.tsx';
import { Tappable, type DataMarks } from '../views/primitives/Tappable.tsx';
import type { GlyphName } from '../views/contract.ts';
import { WallBackdrop } from './WallBackdrop.tsx';
import { card, numeralText, plateStyle, px, tapTarget, text } from '../views/primitives/style.ts';
import { headerPlate } from '../views/logic/plate.ts';
import { headerDateFit } from '../views/logic/textFit.ts';
import { headerKeeps } from '../views/logic/departures.ts';
import { useTextRoom } from '../views/primitives/useTextRoom.ts';
import { clientTimeText, clockHands, localDateText } from '../views/logic/clock.ts';
import { effectiveBand, initialShellState, msUntilDecay, wallShell, type WallDestination } from '../views/logic/idle.ts';
import { freshnessStatus } from '../views/logic/freshness.ts';
import { childById, orderedChildren } from '../views/logic/summary.ts';
import { idleModeFromClock } from '../views/logic/timeTrust.ts';
import { applyWallTheme, documentRoot, layoutFor, pagerPlace, shellGeometry, type DoorForm } from '../views/logic/theme.ts';
import { serverClockEvidence } from '../views/logic/serverClock.ts';
import { preferPiEvidence, usePiClock } from './usePiClock.ts';
import { choreKey, redemptionKey, stepKey } from '../views/logic/tap.ts';
import { WEEK_DAYS, clampWeekPage, pageRangeWords, weekPageCount, weekPageOffset } from '../views/logic/week.ts';
import { NULL_WALL_ACTIONS, type WallActions } from './actions.ts';
import { approvalQueue, type AdminActions } from './adminActions.ts';
import { visitPinAfterMove } from './grownupVisit.ts';
import { useTapGate } from './useTapGate.ts';
import { DogSheet } from '../views/domain/DogSheet.tsx';
import { deedKey, dogSheetAfter } from '../views/logic/dog.ts';
import { DEFAULT_TICK_MS, useWallClock } from './useWallClock.ts';
import { WallContext, useWall, type WallContextValue } from './wallContext.ts';
import { WallLayoutContext, useWallLayout, type WallLayoutValue } from './layoutContext.ts';

export interface WallAppProps {
  snapshot: WallSnapshot;
  actions?: WallActions | undefined;
  /** The admin surface. Absent in tests and in any build that must not approve anything. */
  adminActions?: AdminActions | undefined;
  /** Fired when the CLIENT's local date rolls over.  The data layer refetches. */
  onLocalDateChange?: ((date: LocalDate) => void) | undefined;
  tickMs?: number | undefined;
}

export function WallApp({ snapshot, actions, adminActions, onLocalDateChange, tickMs }: WallAppProps) {
  const clock = useWallClock(tickMs ?? DEFAULT_TICK_MS);
  const gate = useTapGate();
  const [shell, dispatch] = useReducer(wallShell, Date.now(), initialShellState);
  /**
   * Which of the wall's own destinations is open, on top of whatever the rail has selected.
   *
   * Shell memory since 2026-09-13. It was a `useState` beside the reducer, closed off the back
   * of the reducer's decay — and the reducer only kept its clock running while a child was
   * selected, so a calendar opened from the idle wall with nobody selected never closed. One
   * memory, one clock: see idle.ts.
   */
  const destination = shell.destination;
  const setDestination = useCallback((next: WallDestination) => {
    dispatch({ type: 'openDestination', destination: next, atMs: Date.now() });
  }, []);
  /**
   * The PIN for THIS VISIT to the grown-up portal, held here because the portal is two screens.
   *
   * It lives at the root rather than inside either of them for the reason `grownupVisit.ts`
   * gives: approvals and pictures are one door from the room, and a PIN that died with the
   * approvals component asked again the moment an adult went to put a picture up. Its whole
   * lifetime is the one line below — leave the portal, and it is gone.
   */
  const [visitPin, setVisitPin] = useState<string | null>(null);
  /**
   * ONE DAY, FULL SCREEN — an offset in days after today, or null for the whole week.
   *
   * *"It'd be nice to click on today and then have today as, like, the full screen, and then hit
   * back or click on today again and have it go back... because Friday, I see individual
   * picture, but I can't see a full description."*
   *
   * Held here rather than inside the grid because it is a NAVIGATION fact, like `destination`,
   * and it has to be cleared by the same things that close a destination — the house button and
   * the idle decay. A focus remembered inside the component would come back with it.
   */
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  /**
   * LATER DAYS, five at a time — which page of the calendar is open. 0 is today's.
   *
   * *"the calendar view should show a full week or allow scrolling left/right to view later
   * days."* Seven columns was measured and rejected (see `WEEK_DAYS`), so the answer is the
   * second half of that sentence: the same five columns, moved. A navigation fact like the two
   * above it, and cleared by the same things: leaving the calendar, and the idle decay.
   */
  const [weekPage, setWeekPage] = useState(0);
  const weekPages = weekPageCount();
  // How many things are waiting for a grown-up. Zero most of the time, and the badge is absent
  // rather than a "0" — a wall that permanently displays nothing-to-do is a wall that nags.
  const waiting = useMemo(() => approvalQueue(snapshot).length, [snapshot]);

  /**
   * Which idle screen: the information board, or the picture.
   *
   * The gate FAILS CLOSED (H9, timeTrust.ts). Unless we can prove the clock is right and we
   * are outside every routine window, the wall shows the board. A Pi with no RTC that has just booted cannot prove any of that, so it shows the
   * board — which is the screen the 6:00 AM invariant is about.
   *
   * Evidence comes from the PI's own systemd-timesyncd where it can be had — a real last-sync
   * time, still answering when the network is down, which is the post-power-cut case this gate
   * exists for. Where it cannot (no gate, an old build, a Chromium that starts enforcing
   * Private Network Access) it falls back to the server's stamp: the server is mains-powered with a
   * hardware clock, so "does this wall's clock agree with one we believe" is a weaker question
   * than "when did this wall last sync", but it is a real one. Neither available is no evidence,
   * which closes the gate — the correct answer, and the one that shows the board.
   */
  const piClock = usePiClock();

  const idle = useMemo(() => {
    const { decision, trust } = idleModeFromClock(
      preferPiEvidence(piClock, serverClockEvidence(snapshot.freshness, clock.nowMs), clock.nowMs),
      clock.localTime,
      snapshot.household?.boardWindows,
    );
    // `trust.reason` is carried through so "why is the board up at three in the afternoon?"
    // is answerable from one value rather than from re-deriving the gate by hand.
    //
    // `source` matters as much as `why` now that there are two evidence sources that can
    // disagree. Without it, "the clock is not trusted" does not say WHOSE clock was asked, and
    // that ambiguity is the exact shape of the bug that put the board on this wall for two days
    // in August — a build stamp read as a heartbeat, invisible until the gate was made to say
    // what it had actually looked at.
    return {
      mode: decision.mode,
      why: trust.trusted ? decision.reason : trust.reason,
      source: piClock === null ? 'server' : 'pi',
    };
  }, [snapshot.freshness, clock.nowMs, clock.localTime, piClock]);


  const children = orderedChildren(snapshot.children);
  const band = effectiveBand(shell, children);
  const activeChild = childById(children, shell.activeChildId);

  /**
   * Which picture, if any — decided by the SERVER as of 2026-09-08, and simply read here.
   *
   * This used to be four fetches of `/scenes/<id>.json` against a committed array of ids, with
   * the first usable one winning. That arrangement answered H10's cadence question by refusing
   * to answer it, and the cost was concrete: a picture generated on Sunday night could not
   * reach the wall until somebody edited a source file and redeployed, so the weekly cadence
   * the whole scene pipeline was built for never actually ran. Selection now lives in the
   * `scene` table, where a cron and a parent can both write it. §5.2 is closed: the newest
   * APPROVED scene is the one up, and approving an old one again is how you go back.
   *
   * `null` is still a real answer, and it is still why `showingScene` asks about the scene
   * rather than only about the gate: no usable picture means the information board. A picture
   * with no regions would be a dead end that looks like a working screen — the rail is not on
   * this screen to rescue it — so a broken picture is strictly worse than no picture.
   */
  const scene = snapshot.scene;

  /**
   * The picture is up: nobody selected, no destination open, we have one, and EITHER the gate
   * opened OR somebody asked for it with the house button. The request is not gated on the
   * clock: the trust gate exists so an unattended wall never puts a picture up at 6:00 AM on
   * a wrong clock, and a finger on the house is the opposite of unattended. It decays like
   * everything else, so inside a board window the board is back in 90 seconds.
   */
  const showingScene =
    activeChild === null &&
    destination === null &&
    scene !== null &&
    (idle.mode === 'scene' || shell.sceneRequested);
  /**
   * THE DOG'S SHEET — open only by tapping the dog in the picture, and only while the picture
   * is up.  Not shell memory: it has no destination, no child and no decay of its own beyond
   * the sixty seconds the sheet keeps for itself.  It is cleared here the moment the picture
   * goes, so it cannot come back over whatever went up instead.
   */
  const [dogOpen, setDogOpen] = useState(false);
  useEffect(() => {
    if (!dogSheetAfter(dogOpen, showingScene)) setDogOpen(false);
  }, [dogOpen, showingScene]);
  const closeDog = useCallback(() => {
    setDogOpen(false);
  }, []);

  /**
   * Leaving the portal forgets the PIN — including by the decay above, which is how a parent
   * who walks away closes the door without knowing it.  One rule, one place, and it is a plain
   * function so it can be tested without a DOM.
   */
  useEffect(() => {
    setVisitPin((held) => visitPinAfterMove(held, destination));
  }, [destination]);

  /**
   * The calendar opens on TODAY, every time. A page remembered across visits would put a
   * parent who opened the calendar last Tuesday onto the week after next, with no "Today"
   * column to say so — and the whole point of the first page is the word "Today".
   */
  useEffect(() => {
    if (destination !== 'week') {
      setWeekPage(0);
      setFocusedDay(null);
    }
  }, [destination]);

  // A focused day belongs to the calendar and to nothing else. Leaving it — the house button,
  // another door, the 90-second decay — puts the week back, so returning never lands on a
  // single day somebody focused an hour ago.
  useEffect(() => {
    if (destination !== 'week') setFocusedDay(null);
  }, [destination]);

  // The roster changed under us: a selection that no longer exists must go, or the
  // wall holds an empty screen for a child who was removed this morning.
  const childIds = children.map((c) => c.id).join(',');
  useEffect(() => {
    dispatch({ type: 'children', childIds: childIds.length === 0 ? [] : childIds.split(','), atMs: Date.now() });
  }, [childIds]);

  // Decay is scheduled precisely rather than polled, so 90 s means 90 s.
  useEffect(() => {
    const wait = msUntilDecay(shell, Date.now());
    if (!Number.isFinite(wait)) return;
    const id = setTimeout(() => {
      dispatch({ type: 'tick', atMs: Date.now() });
    }, wait);
    return () => {
      clearTimeout(id);
    };
  }, [shell]);

  // A fresh snapshot retires optimistic values the server has now confirmed.
  useEffect(() => {
    gate.sync(serverValues(snapshot));
  }, [snapshot, gate]);

  // The household's theme, on the root element (logic/theme.ts says why there). A LAYOUT
  // effect, so a wall that boots into gallery never paints one frame of felt first.
  const theme = snapshot.theme;
  useLayoutEffect(() => {
    const root = documentRoot();
    if (root !== null) applyWallTheme(root, theme);
  }, [theme]);

  // The household's STRUCTURE, beside its paint: which rail, which header, which doors
  // (logic/theme.ts). Resolved once, here, and handed down by context — so a component asks
  // "which rail?" or "how tall is my pane?" and never "which theme?". The picture library takes
  // the side shell whatever the theme (`shellGeometry` says why). The grown-up portal takes NONE
  // of the wall's frame — no rail, no header, no banner, no picture behind it — because past the
  // PIN the sections are the navigation; it draws its own (`GrownupChrome`, `grownupGeometry`).
  const grownupShell = destination === 'approvals';
  const adultScreen = destination === 'scenes';
  const layoutValue = useMemo<WallLayoutValue>(() => {
    const layout = layoutFor(theme);
    return { layout, frame: shellGeometry(layout, adultScreen) };
  }, [theme, adultScreen]);
  const frame = layoutValue.frame;
  const sideShell = frame.kind === 'side';

  const localDate = clock.localDate;
  useEffect(() => {
    onLocalDateChange?.(localDate);
  }, [localDate, onLocalDateChange]);

  const value = useMemo<WallContextValue>(
    () => ({
      snapshot,
      actions: actions ?? NULL_WALL_ACTIONS,
      gate,
      clock,
      resetKey: snapshot.freshness.generatedAtUtc,
    }),
    [snapshot, actions, gate, clock],
  );

  /*
    THE THREE PIECES, BUILT ONCE AND PLACED BY THE SHELL — the faces, the header and the body.

    Where the faces go is the theme's (logic/theme.ts): a full-height column flush to the left
    edge with the header and the body padded beside it (gallery's plinth, storybook's spine, and
    felt on a grown-up screen), or a row along the bottom under both (felt). Nothing else moves:
    the header holds the same things in the same order, and the body is the same destinations.

    It is a rail on every screen of the wall but one. It used to render only while a child was
    selected, because AmbientView drew the three faces itself and a rail would have been the
    same row twice. That was the wrong half of the fix: navigation you only get after
    navigating is not navigation. "Always the same place" — the property the pre-reader
    navigates by — is per theme now: a household that switches themes moves the faces once.

    NO RAIL ON THE PICTURE, and that is structural rather than a conditional: the picture does
    not render these at all. On that screen the picture IS the navigation, you find yourself in
    it and tap yourself, and a rail of the same three faces beside it would answer the question
    the picture is asking.
  */
  const rail = (
    <ChildBar
      activeChildId={shell.activeChildId}
      form={frame.rail}
      // "Away from home" now means away from the PICTURE, not from the board. On the
      // board with a picture available the house is live and takes you to it; it is
      // only inert when there is no picture to go to. Asked for in these words: "how
      // do I get to the image display? ... I should be able to click somewhere ... from
      // any of the menus."
      awayFromHome={activeChild !== null || destination !== null || scene !== null}
      onSelect={(childId) => {
        dispatch({ type: 'selectChild', childId, atMs: Date.now() });
      }}
      onHome={() => {
        // One event, one meaning, from anywhere: the reducer undoes the selection, the
        // band override and the destination together, and asks for the picture on top.
        dispatch({ type: 'home', atMs: Date.now() });
      }}
    />
  );
  // The calendar's pager, while the five-day calendar is up. WHERE it stands is the shell's
  // (`pagerPlace`): in the header across felt's wall, and at the head of the week card beside a
  // side rail, whose 816px header has no room for it once the status is stale.
  const weekNav: WeekNav | null =
    destination === 'week' && focusedDay === null
      ? {
          page: weekPage,
          pages: weekPages,
          onPage: (page) => {
            setWeekPage(clampWeekPage(page, weekPages));
          },
        }
      : null;
  const pagerAt = pagerPlace(frame);
  const header = (
    <WallHeader
      destination={destination}
      onDestination={setDestination}
      waiting={waiting}
      weekNav={pagerAt === 'header' ? weekNav : null}
    />
  );
  const body = (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        // Positioned, with a z-index above the backdrop. Without this the decoration —
        // an absolutely positioned element at z-index 0 — paints OVER static siblings,
        // which is the CSS painting order and reads as "the art ate the chore board".
        position: 'relative',
        zIndex: 1,
      }}
    >
      <RendererErrorBoundary
        label="wall-body"
        resetKey={snapshot.freshness.generatedAtUtc}
        fallback={<InertBlock />}
      >
        {destination === 'week' ? (
          // A destination somebody WALKS UP TO, so it opts in to the near scale (H8).
          // The idle board renders the same component and does not.
          <NearScope>
            <WeekView
              childId={shell.activeChildId}
              days={focusedDay === null ? WEEK_DAYS : 1}
              startOffset={focusedDay ?? weekPageOffset(weekPage)}
              onSwipe={
                focusedDay === null
                  ? (direction) => {
                      setWeekPage((page) => clampWeekPage(page + direction, weekPages));
                    }
                  : undefined
              }
              onPickDay={(offset) => {
                // Tap a day to fill the screen with it; tap it again to come back. One
                // control, both directions — asked for in exactly those words, and it
                // means the way back is in the place the way in was.
                setFocusedDay((current) => (current === null ? offset : null));
              }}
              head={pagerAt === 'week' && weekNav !== null ? <WeekPagerHead nav={weekNav} /> : undefined}
            />
          </NearScope>
        ) : destination === 'scenes' ? (
          <ScenesView actions={adminActions} pin={visitPin} onPin={setVisitPin} />
        ) : activeChild === null ? (
          <AmbientView
            onPickDay={() => {
              setDestination('week');
            }}
          />
        ) : (
          // A child's own screen is the one somebody WALKS UP TO — she has a finger on
          // the glass. The idle wall behind this is still read from the kitchen and does
          // not move (H8).
          <NearScope>
            <ChildView child={activeChild} />
          </NearScope>
        )}
      </RendererErrorBoundary>
    </div>
  );
  // The wall's own margin, or none. NO PADDING UNDER THE PICTURE: the wall's gutter is what
  // frames cards, and the picture is not a card — it is the surface. Left in, it drew a sand
  // border on all four sides of an illustration that is meant to run off the edge of the
  // glass. None around the SIDE shell either: its rail runs to the edge of the glass, and the
  // column beside it carries the margin itself.
  const rim = showingScene || sideShell || grownupShell ? null : frame.pad;

  return (
    <BandRendererProvider band={band}>
      <WallContext.Provider value={value}>
        <WallLayoutContext.Provider value={layoutValue}>
          <div
            /*
              The gate's verdict, on the page.
              "Why is the board up at three in the afternoon?" has to be answerable from the wall
              itself — by someone standing in front of it with a phone, at 06:05, who did not
              build this. A gate that fails silently is how this becomes undebuggable, which is
              the same argument timeTrust.ts makes for reporting every failed condition rather
              than the first.
            */
            data-idle={idle.mode}
            data-idle-why={idle.why}
            data-clock-source={idle.source}
            data-shell={showingScene ? 'scene' : grownupShell ? 'grownup' : frame.kind}
            onPointerDownCapture={() => {
              dispatch({ type: 'interaction', atMs: Date.now() });
            }}
            style={{
              width: px(layoutPx.wallWidth),
              height: px(layoutPx.wallHeight),
              paddingTop: px(rim?.top ?? 0),
              paddingRight: px(rim?.right ?? 0),
              paddingBottom: px(rim?.bottom ?? 0),
              paddingLeft: px(rim?.left ?? 0),
              boxSizing: 'border-box',
              // Longhands, never `background`: felt paints a dot grid over its ground colour,
              // and React warns when a shorthand and its longhands meet on one element.
              backgroundColor: ground.colour,
              backgroundImage: ground.texture,
              backgroundSize: ground.textureSize,
              color: colour.ink,
              fontFamily: font.family,
              display: 'flex',
              flexDirection: sideShell && !showingScene && !grownupShell ? 'row' : 'column',
              gap: px(rim === null ? 0 : frame.gutterPx),
              overflow: 'hidden',
              // The backdrop is absolutely positioned against this box.
              position: 'relative',
            }}
          >
            {/*
              Decoration first in the DOM and behind in the stack, so nothing above it needs to
              know it exists. The scene follows whoever is on screen — see WallBackdrop.

              Not under the picture: the horizon band exists to give the BOARD a ground, and a
              full-bleed illustration already has one. Drawing both was paint nobody could see.
            */}
            {showingScene || grownupShell ? null : <WallBackdrop image={scene?.image ?? null} />}
            {/*
              THE PICTURE IS HOISTED OUT OF THE BODY, and that is the whole fix rather than a
              tidy-up. Inside the body its `inset: 0` resolved against the body row — 960x370
              after the header and the wall padding — so `cover` cropped a third of the drawing
              away and framed what was left in sand. Against the wall it resolves against the
              wall.

              The header is chrome for a screen that is doing something else, so the picture
              does not get one. The clock and the date go with it — they are in the calendar
              view, one tap away, which is where anyone asking "what day is it" is already
              headed. What survives is the two destinations and, only when it has something to
              say, the stale label. Those float. See SceneChrome.
            */}
            {showingScene ? (
              <RendererErrorBoundary
                label="wall-scene"
                resetKey={snapshot.freshness.generatedAtUtc}
                fallback={<InertBlock />}
              >
                <SceneView
                  scene={scene}
                  onSelect={(childId) => {
                    dispatch({ type: 'selectChild', childId, atMs: Date.now() });
                  }}
                  onDog={() => {
                    setDogOpen(true);
                  }}
                >
                  <SceneChrome onDestination={setDestination} waiting={waiting} />
                  {/*
                    "Get ready, we leave at" floats top-left, opposite the doors. Judged from the
                    clock every tick; not an input to the idle gate, which has exactly two.
                  */}
                  <DepartureBanner placement="scene" />
                  {dogOpen && snapshot.dog !== null ? <DogSheet onClose={closeDog} /> : null}
                </SceneView>
              </RendererErrorBoundary>
            ) : grownupShell ? (
              /*
                THE GROWN-UP PORTAL, on the bare ground. Its door and its sections draw their own
                frame; Leave goes back to whichever wall the room was showing, and forgets the PIN
                on the way (grownupVisit.ts — the move does it, not this line). The picture library
                is a destination of its own and the visit carries on into it.
              */
              <RendererErrorBoundary
                label="wall-grownup"
                resetKey={snapshot.freshness.generatedAtUtc}
                fallback={<InertBlock />}
              >
                <ApprovalsView
                  actions={adminActions}
                  pin={visitPin}
                  onPin={setVisitPin}
                  onLeave={() => {
                    setDestination(null);
                  }}
                  onPictures={() => {
                    setDestination('scenes');
                  }}
                />
              </RendererErrorBoundary>
            ) : sideShell ? (
              <>
                {rail}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: px(frame.gutterPx),
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    paddingTop: px(frame.pad.top),
                    paddingRight: px(frame.pad.right),
                    paddingBottom: px(frame.pad.bottom),
                    paddingLeft: px(frame.pad.left),
                    boxSizing: 'border-box',
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  {header}
                  {body}
                </div>
              </>
            ) : (
              <>
                {header}
                {body}
                {rail}
              </>
            )}
          </div>
        </WallLayoutContext.Provider>
      </WallContext.Provider>
    </BandRendererProvider>
  );
}

/**
 * The header is CHROME, not one of the seven leaves, so it asks the band's
 * typography whether words are allowed at all rather than which component to use.
 * The dial is always drawn: it is the only "what time is it" a pre-reader has.
 *
 * Rebuilt 2026-08-25 from 96px to 56px (H5 §3.1), and the 40px it gives back is the whole
 * reason the moves below it fit. Two changes make that possible:
 *
 *   - The date stops being a sentence. "Tuesday, August 25" was the widest element on the
 *     wall, and it is meaningless to a three-year-old and redundant to a seven-year-old who
 *     can read the clock beside it. It is now a large TIME with a short date under it, which
 *     is what Skylight and Hearth both put in this position (H5 §2).
 *   - The dial shrinks and pairs with the numeral instead of standing alone. It is still
 *     drawn in every band, because it remains the pre-reader's only reading of "what time is
 *     it" — but next to "4:30 PM" it now also teaches the numeral.
 */
function WallHeader({
  destination,
  onDestination,
  waiting,
  weekNav,
}: {
  destination: WallDestination;
  onDestination: (d: WallDestination) => void;
  waiting: number;
  /** The calendar's pager, present only while the five-day calendar is the screen AND the shell puts it here. */
  weekNav: WeekNav | null;
}) {
  const typo = useBandTypography();
  const { actions, clock, snapshot } = useWall();
  const { layout, frame } = useWallLayout();
  const hands = clockHands(clock.localTime);
  const status = freshnessStatus(snapshot.freshness, clock.localDate, snapshot.requestedLocalDate);
  const leaving = useDepartureAlert();
  // While the leave-by banner holds the middle, the bar makes room for it in a fixed order
  // (logic/departures.ts `headerKeeps`). The date steps aside. A FRESH status drops to its check,
  // which already says it. A stale wall keeps its words: "Showing older information" is the
  // honest label and the one thing on this bar that must never shrink. So there the dial steps
  // aside instead, beside numerals that already say the time.
  const keeps = headerKeeps(leaving !== null, status.tone === 'ok', typo.showsText);
  const statusWords = keeps.statusWords ? status.words : { short: '', full: '' };

  const bar: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    // `tapGap`, not `sm`: two of this row's children are tap targets sitting side by side,
    // and at 12px the grown-ups door — which opens the PIN-gated adult surface — was
    // within a finger's width of the calendar door on every screen.
    gap: px(spacePx.tapGap),
    // `xs` rather than `sm`: at 56px tall the StatusPill is the tallest thing in here and
    // it needs the room. Measured on the panel, not guessed.
    padding: px(spacePx.xs),
    height: px(layoutPx.wallHeaderHeight),
    boxSizing: 'border-box',
    flex: '0 0 auto',
    position: 'relative',
    zIndex: 1,
  };

  // Felt and gallery set the bar as their card. Storybook's is a RUNNING HEAD, a line of type
  // over a rule — and since the week's picture went behind every page, a running head set on
  // "the page" was set on the art. So it stands on a plate too, in storybook's own card language,
  // HANGING from the top edge of the glass the way its ribbon and index tabs do: it grows up
  // through the shell's top margin, so its own 64px and everything below it stay where they were.
  // See logic/plate.ts.
  const head = headerPlate(layout.header, frame.pad.top);
  const hang: CSSProperties =
    head.hangPx === 0
      ? {}
      : {
          marginTop: px(-head.hangPx),
          height: px(layoutPx.wallHeaderHeight + head.hangPx),
          paddingTop: px(spacePx.xs + head.hangPx),
          borderTop: 'none',
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
        };

  return (
    <header
      data-header={layout.header}
      style={plateStyle(head.plate, { ...bar, borderRadius: radius.lg, ...hang })}
    >
      {hands === null || !keeps.dial ? null : (
        <ClockFace hourDeg={hands.hourDeg} minuteDeg={hands.minuteDeg} sizePx={iconPx.sm} />
      )}
      {typo.showsText ? (
        <span
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: px(spacePx.xs),
            // The leave-by banner takes the middle of the bar when it is up, and the date
            // steps aside for it: the banner's second line is a time already, and the date is
            // one tap away on the calendar. The clock never steps aside.
            flex: leaving === null ? 1 : '0 0 auto',
            minWidth: 0,
          }}
        >
          {/*
            The clock does not shrink; the date beside it gives way first. Both carry an
            ellipsis, and a flex row shrinks them in proportion, so a stale label on the week
            screen used to take "5:34 AM" to "5:34 A…" with the date still half drawn beside it.
          */}
          <span style={{ ...numeralText(fontSizePx.cardTitle, colour.ink), flex: '0 0 auto' }}>
            {clientTimeText(clock.nowMs)}
          </span>
          {keeps.date ? <HeaderDate date={clock.localDate} /> : null}
        </span>
      ) : leaving === null ? (
        <span style={{ flex: 1 }} />
      ) : null}
      {leaving === null ? null : <DepartureBanner placement="header" />}
      {/*
        The wall's own destinations live HERE, not in the rail, and the split is the whole
        information architecture in one line: THE RAIL IS PEOPLE, THE HEADER IS CHROME.

        It is also the only arithmetic that works. The rail has 420px; home at 56 plus three
        faces plus a calendar and a grown-ups tile plus five gaps is 536. In a 56px header that
        is already mostly empty between the clock and the freshness pill, two icon buttons cost
        nothing at all.
      */}
      {/*
        The same count, with the picture DOWN — the baseline that makes the other number mean
        something. A raw "the calendar was opened nine times" says nothing on its own; nine
        times while the picture is up against once while the board is up is the whole argument.

        Only an OPENING is counted, never the close, because these two toggle. Counting both
        would double every visit and make the two surfaces incomparable, since the floating
        pair cannot close a destination at all.
      */}
      {/*
        LATER DAYS. The pager sits with the calendar door because it is the calendar's control
        and nothing else's: it appears when the five-day calendar is up and goes when it is not,
        so on every other screen the header is exactly what it was. Felt's header has the room —
        it runs across the wall at 912 — where the week card has no WIDTH to give: two 64px
        arrows beside the columns would take each one back to the width that was rejected.

        Beside a side rail the header is 816 and has not got the room either, once the stale
        label is up; there the pager stands at the head of the week card instead (`pagerPlace`,
        `WeekPagerHead`), which costs the grid height and not width.
      */}
      {weekNav === null ? null : <PagerKeys nav={weekNav} />}
      <HeaderButton
        glyph="calendar"
        data={{ 'data-door': 'calendar' }}
        active={destination === 'week'}
        onTap={() => {
          if (destination !== 'week') actions.recordDoorTap('calendar', false);
          onDestination(destination === 'week' ? null : 'week');
        }}
      />
      <HeaderButton
        glyph="grown-up"
        data={{ 'data-door': 'grownups' }}
        active={destination === 'approvals'}
        badge={waiting}
        onTap={() => {
          if (destination !== 'approvals') actions.recordDoorTap('grown-ups', false);
          onDestination(destination === 'approvals' ? null : 'approvals');
        }}
      />
      {/*
        The picture library. A THIRD door rather than a tab inside the grown-up screen, and
        that was measured rather than preferred: a 64px switcher row above the approval queue
        takes it from four visible rows to three at the household's tap size, and the queue is
        the screen somebody stands here for after dinner. The header has the room — faces, two
        doors and the gaps came to 536 of 960 — so the cheaper place to spend is here.

        It carries no badge. A waiting candidate is not something anybody must act on today:
        the wall keeps last week's picture and is completely fine, which is the whole design
        of the weekly run. A badge would make a nicety look like a chore.
      */}
      <HeaderButton
        glyph="picture"
        data={{ 'data-door': 'pictures' }}
        active={destination === 'scenes'}
        badge={0}
        onTap={() => {
          onDestination(destination === 'scenes' ? null : 'scenes');
        }}
      />
      <BandLeaf
        leaf="StatusPill"
        resetKey={snapshot.freshness.generatedAtUtc}
        props={{
          tone: status.tone,
          glyph: status.tone === 'ok' ? 'check' : 'alert',
          labelShort: statusWords.short,
          labelFull: statusWords.full,
        }}
      />
    </header>
  );
}

/**
 * The header's date, in the longest form the room beside the clock will hold WHOLE.
 *
 * It used to be one form with an ellipsis, and beside a side rail on a stale wall it was given 89
 * of the 96px "Sun, Oct 11" needs (gallery, 2026-10-11) — "Sun, Oct …". The room moves with the
 * time of day, the typeface and the freshness label, so it is measured, and logic/textFit.ts
 * picks: the same words at the 14px floor, then "Oct 11", then nothing.
 */
function HeaderDate({ date }: { date: LocalDate }) {
  const { ref, room } = useTextRoom<HTMLSpanElement>(fontWeight.bold);
  // Until the first reading (it lands before paint) the form it always had.
  const fit =
    room === null
      ? { words: localDateText(date, 'short'), sizePx: fontSizePx.small }
      : headerDateFit(date, room.roomPx, room.measure);
  return (
    <span
      ref={ref}
      data-header-date=""
      // Its width is the room and never its words: grown from nothing, allowed to shrink to nothing.
      style={{ ...text(fit?.sizePx ?? fontSizePx.meta, { muted: true }), flex: '1 1 0', minWidth: 0 }}
    >
      {fit?.words ?? ''}
    </span>
  );
}

/**
 * The only chrome on the picture: the two doors out of it, floating over the art.
 *
 * ## Why these two and nothing else
 *
 * The header's other contents were all answers to questions this screen is not asking. The
 * clock and the date are in the calendar view, which is one tap away and is where somebody
 * wondering what day it is was going anyway. The "next up" ribbon was the day recited over a
 * picture of the day. What is left is a door to the calendar and a door for grown-ups —
 * neither of which the picture itself can offer, because a picture cannot be a door to a list.
 *
 * ## Why they are legible over a busy illustration
 *
 * Not with a scrim, and not with translucency. On a 225-nit panel behind etched glass a
 * half-transparent button over a colouring-book scene is a smudge. The doors sit in ONE
 * opaque tray drawn as the theme's own card and edged the way its CONTROLS are — a strong
 * edge and the theme's control ledge — so it holds against a white cloud and a dark wood
 * alike, whichever card language the theme speaks. Until 2026-09-13 each door was its own
 * white disc in a 4px black ring, on the theory that the ring was the art's own mark; on the
 * panel it read as two stickers on a painting ("the white circle contrast looks...
 * unpolished"). One shape instead of two — which is why felt's round doors and gallery's
 * square keys are a chip SHAPE inside this tray, and never two floating discs again.
 *
 * It stays on the TOP edge in every theme, where the picture's sky is. Storybook's HANGS from
 * it — flush to the glass, square where it meets it — the way that theme's tabs hang from the
 * top of a page; the others float a gutter in from the corner.
 *
 * ## The one piece of information that stays
 *
 * The stale label, and ONLY when it has something to say. A wall showing yesterday's data must
 * admit it on whatever screen it is on — stale-but-labelled satisfies the prime invariant,
 * stale-and-confident does not — and that rule is older than any layout this has had. When
 * everything is current it draws nothing at all, because a permanent "Up to date" badge over an
 * illustration is a wall that nags.
 */
function SceneChrome({
  onDestination,
  waiting,
}: {
  onDestination: (d: WallDestination) => void;
  waiting: number;
}) {
  const { actions, clock, snapshot } = useWall();
  const { layout } = useWallLayout();
  const status = freshnessStatus(snapshot.freshness, clock.localDate, snapshot.requestedLocalDate);
  const hangs = layout.doors === 'tab';

  return (
    <div
      data-scene-tray={hangs ? 'hangs' : 'floats'}
      style={card({
        position: 'absolute',
        top: px(hangs ? 0 : spacePx.md),
        right: px(spacePx.md),
        display: 'flex',
        alignItems: 'center',
        // `tapGap`, not `sm`. These are the only two controls on the scene and they sat 12px
        // apart — under the 16px inert gutter — with the grown-ups door, which opens the
        // PIN-gated adult surface, next to the one a three-year-old is aiming for.
        gap: px(spacePx.tapGap),
        padding: px(spacePx.xs),
        // The CONTROL's edge and ledge, not the card's. A card's edge is tuned for a ground the
        // theme chose — gallery's is a thin grey line — and here there is no such ground: the
        // edge has to separate a white tray from a white cloud on its own, so it is the strong
        // 3px one in every theme, with the ledge every pressable thing in the theme wears.
        border: `${px(strokePx.medium)} solid ${colour.borderStrong}`,
        boxShadow: controlShadow,
        ...(hangs ? { borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 } : {}),
        // Above the tap regions, so a button that happens to land over a child in the picture
        // is a button and not a way into the wrong screen.
        zIndex: 2,
      })}
    >
      {status.tone === 'ok' ? null : (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: px(spacePx.xs),
            height: px(iconPx.md),
            paddingLeft: px(spacePx.sm),
            paddingRight: px(spacePx.sm),
            background: colour.surfaceSunken,
            border: `${px(strokePx.min)} solid ${colour.borderStrong}`,
            borderRadius: radius.md,
            boxSizing: 'border-box',
          }}
        >
          <Glyph name="alert" sizePx={iconPx.sm} tone={colour.ink} />
          <span style={text(fontSizePx.small)}>{status.words.short}</span>
        </span>
      )}
      {/*
        The count that settles §5.1, taken where the answer actually lives.

        This component renders ONLY on the scene, so `true` here is not an assumption about
        the mode — it is the condition for this code existing at all. Recorded BEFORE the
        navigation and discarded without waiting, so the calendar opens on the same frame it
        always did; an instrument that makes the thing it measures slower measures something
        else.
      */}
      <HeaderButton
        glyph="calendar"
        data={{ 'data-door': 'calendar' }}
        active={false}
        onTap={() => {
          actions.recordDoorTap('calendar', true);
          onDestination('week');
        }}
      />
      <HeaderButton
        glyph="grown-up"
        data={{ 'data-door': 'grownups' }}
        active={false}
        badge={waiting}
        onTap={() => {
          actions.recordDoorTap('grown-ups', true);
          onDestination('approvals');
        }}
      />
    </div>
  );
}

/** The calendar's pager: which page of five days is open, and how many there are. */
interface WeekNav {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}

/**
 * Earlier days and later ones. An arrow with nowhere to go is drawn faint and is not a
 * control, on the Tappable rule: a child who taps it taps nothing, rather than a greyed button
 * that looks broken.
 */
function PagerKeys({ nav }: { nav: WeekNav }) {
  return (
    <>
      <HeaderButton
        glyph="back"
        active={false}
        enabled={nav.page > 0}
        onTap={() => {
          nav.onPage(nav.page - 1);
        }}
      />
      <HeaderButton
        glyph="forward"
        active={false}
        enabled={nav.page < nav.pages - 1}
        onTap={() => {
          nav.onPage(nav.page + 1);
        }}
      />
    </>
  );
}

/**
 * The head of the week card beside a side rail: the days this page shows, and the pager.
 *
 * The same keys as the header's, so the calendar's control looks like one thing wherever the
 * shell puts it. The words are for whoever can read them — the picture band's head is the two
 * arrows alone, as its header is the dial alone.
 */
function WeekPagerHead({ nav }: { nav: WeekNav }) {
  const typo = useBandTypography();
  const { clock } = useWall();
  return (
    <>
      <span style={{ ...text(typo.primaryTextPx ?? fontSizePx.bodyLarge), flex: 1, minWidth: 0 }}>
        {typo.showsText ? pageRangeWords(clock.localDate, nav.page) : null}
      </span>
      <PagerKeys nav={nav} />
    </>
  );
}

/**
 * One of the wall's own destinations, in the header.
 *
 * Small, because it is chrome — the things a child taps are in the rail and on her own board,
 * and these two are for the adult standing at the wall. `tapPx.min` is still the floor: a
 * control being secondary is not a reason to make it hard to hit.
 */
function HeaderButton({
  glyph,
  active,
  badge,
  enabled,
  onTap,
  data,
}: {
  glyph: GlyphName;
  active: boolean;
  /** Marks for the audit and the screenshot script (`data-door`); no behaviour. */
  data?: DataMarks | undefined;
  badge?: number | undefined;
  /** Default on. Off draws the glyph faint and renders no control at all — see Tappable. */
  enabled?: boolean | undefined;
  onTap: () => void;
}) {
  const live = enabled ?? true;
  const { layout } = useWallLayout();
  return (
    <Tappable
      enabled={live}
      onTap={onTap}
      data={data}
      style={tapTarget(tapPx.min, {
        width: px(tapPx.min),
        height: px(tapPx.min),
        // No overhang: the header is now 64 too. It was 56, and a 64px target in a 56px bar
        // had to hang 4px out of each side — which quietly spent a quarter of the wall gutter
        // and left the grown-ups door 15px from the section switcher on the emergent reader's
        // screen. A tap floor and a bar that cannot hold it is a contradiction to fix in the
        // bar, not to absorb in a margin.
        padding: 0,
        background: 'transparent',
        border: 'none',
      })}
    >
      {/*
        Hit area outside, CHIP inside. The target has to be 64 and the header is 56, so a
        single box cannot be both — painting the active state on a 64px box would draw a chip
        taller than the bar it sits in. The visual stays 48 and only the reach grows.
      */}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          width: px(iconPx.md),
          height: px(iconPx.md),
          background: active ? colour.surfaceSunken : 'transparent',
          border: `${px(active ? strokePx.medium : strokePx.min)} solid ${
            active ? colour.borderStrong : 'transparent'
          }`,
          ...doorChipShape(layout.doors),
          boxSizing: 'border-box',
        }}
      >
        <Glyph name={glyph} sizePx={iconPx.sm} tone={live ? colour.ink : colour.inkMuted} />
        {badge === undefined || badge <= 0 ? null : <Badge count={badge} />}
      </span>
    </Tappable>
  );
}

/**
 * The chip's shape, which is the theme's door: felt's round sticker, gallery's square key, and
 * storybook's tab — square along the edge it hangs from, rounded at the end it hangs to. Only
 * the shape: what makes a door look open (the sunken fill and the heavier edge) is the same in
 * all three, so "this one is open" reads the same whichever theme is up.
 */
function doorChipShape(form: DoorForm): CSSProperties {
  if (form === 'round') return { borderRadius: radius.pill };
  if (form === 'tab') {
    return {
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      borderBottomLeftRadius: radius.md,
      borderBottomRightRadius: radius.md,
    };
  }
  return { borderRadius: radius.sm };
}

/** How many things are waiting for a grown-up.  Absent at zero — a wall that says "0" nags. */
function Badge({ count }: { count: number }) {
  return (
    <span
      style={{
        ...numeralText(fontSizePx.meta, colour.inkInverse),
        position: 'absolute',
        top: 0,
        right: 0,
        minWidth: px(spacePx.md),
        textAlign: 'center',
        background: colour.danger,
        borderRadius: radius.pill,
        paddingLeft: px(spacePx.xxs),
        paddingRight: px(spacePx.xxs),
      }}
    >
      {String(count)}
    </span>
  );
}

/** Every gate-managed target's server value, for the post-snapshot reconciliation. */
function* serverValues(snapshot: WallSnapshot): Generator<readonly [string, boolean]> {
  for (const run of snapshot.routines ?? []) {
    for (const step of run.steps ?? []) {
      yield [stepKey(step.runStepId), step.completedAtUtc !== null];
    }
  }
  for (const chore of snapshot.chores ?? []) {
    yield [choreKey(chore.assignmentId), chore.state !== 'pending'];
  }
  const dog = snapshot.dog ?? null; // null when the household has no pet (2026-10-12)
  if (dog !== null) {
    for (const deed of dog.deeds ?? []) yield [deedKey(dog.week, deed.id), deed.done];
  }
  for (const child of snapshot.children ?? []) {
    yield [
      redemptionKey(child.id),
      (snapshot.redemptions ?? []).some((r) => r.childId === child.id && r.state === 'pending'),
    ];
  }
}
