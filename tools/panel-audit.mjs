/**
 * Audit the wall as it is actually rendered, on the actual panel, against this project's own
 * floors — not against WCAG's.
 *
 *   ssh -f -N -L 9223:127.0.0.1:9222 wall-pi
 *   node tools/panel-audit.mjs
 *
 * The grown-up screens are behind a door that checks its PIN, so they are walked only when
 * `AUDIT_PIN` holds the PIN of the wall under audit (on a throwaway, the one given to
 * `provision.ts --pin`); without it the walk stops at the door and the summary says so.
 *
 * ## Why the rules are local ones
 *
 * The generic frontend advice does not fit this screen and following it would make the wall
 * worse. WCAG bakes 0.05 flare into its contrast formula; this panel is 225 nits behind
 * anti-glare etched glass and `tokens.ts` uses 0.10, which is strictly harsher. WCAG's touch
 * target is 24px; the floor here is 64 with a mandatory 16px inert gutter, because the user is
 * three years old. So this audit encodes `MIN` from the design system and nothing else.
 *
 * ## Why on the panel and not in a headless browser
 *
 * Every real defect this project has shipped was a GEOMETRY defect that type-checked, passed
 * its unit tests, and was invisible until something was measured at 960x540 with the real
 * fonts: a routine hiding two of its four steps behind a scroll a five-year-old cannot
 * discover, four steps needing 354px of a 328px pane, one status glyph left at 48px making
 * every row in a flex column 76px tall. None of those are catchable from the token files,
 * which is where the existing tests look.
 *
 * It sets `#probe=1` first, so its own navigation clicks do not land in the door-tap counter
 * that BACKLOG §5.1 is waiting on, and restores the plain URL when it is done.
 */

import { writeFileSync } from 'node:fs';

const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9223';
const KIOSK = process.env.KIOSK_URL ?? 'http://homeserver:8124/#gate=http%3A%2F%2F127.0.0.1%3A18765';

/** From web/src/design/tokens.ts `MIN`. Logical px; the panel renders at 2x. */
const MIN = {
  fontSizePx: 14,
  tapTargetPx: 64,
  /*
   * THE SCENE HAS ITS OWN FLOOR, and it is lower on purpose (2026-09-24).
   *
   * 64 is the wall's UI floor: a chore card, a PIN key, a rail face. A mis-tap there costs a
   * wrong claim or a wrong screen, so it stays generous. A tap on the PICTURE costs nothing —
   * the worst case is a child's own screen opening, or the dog's sheet — and the floors there
   * were measured against a coin rather than inherited: one logical px is 0.496 mm here, the
   * household reports the children can hit a dime, and a dime is 36 px. `scene-regions.py`
   * grows every scene target to 48 and never below 36.
   *
   * Without this split the audit failed the dog's box at 48x50 — a target built to the floor
   * the household measured, reported as a defect by a tool carrying the number it replaced.
   * An auditor that is wrong about the rule is worse than no auditor: it costs a real fix.
   */
  sceneTapTargetPx: 36,
  tapGapPx: 16,
  /*
   * And its own gutter, for the same reason: `scene-regions.py` fits children's targets apart to
   * GUTTER_PX = 12, and a mis-tap between two of them opens the wrong child's screen, which a
   * tap on the rail undoes. Only when BOTH targets are on the picture — a scene target beside a
   * header button keeps the UI gutter, because the cost of that mis-tap is the button's.
   */
  sceneTapGapPx: 12,
  strokePx: 2,
};

// ---------------------------------------------------------------------------
// A very small CDP client
// ---------------------------------------------------------------------------

async function connect() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target — is the kiosk up and the tunnel open?');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  // Every expression is wrapped so an in-page throw comes back as data rather than hanging the
  // await — a rejected promise inside a setTimeout never settles and the audit stalls forever.
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression: `(() => { try { return ${expression} } catch (e) { return { __error: String(e) }; } })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const value = res.result?.result?.value;
    if (value && value.__error) throw new Error(`in-page: ${value.__error}`);
    return value;
  };
  const screenshot = async (path) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(shot.result.data, 'base64'));
  };
  return { evaluate, screenshot, close: () => ws.close() };
}

const settle = (ms) => `new Promise((r) => setTimeout(() => r(true), ${ms}))`;

/**
 * Wait for the wall to actually be on screen, then let it settle.
 *
 * A fixed sleep after `location.reload()` was the first thing that broke: the click landed
 * before React had mounted and `buttons[3]` was undefined. The wall crossfades deliberately
 * (>=800ms, never mid-touch), so readiness and stillness are two different waits.
 */
async function ready(cdp, settleMs = 900) {
  for (let i = 0; i < 40; i++) {
    const n = await cdp.evaluate(`document.querySelectorAll('button,[role=button]').length`);
    if (typeof n === 'number' && n > 0) break;
    await cdp.evaluate(settle(250));
  }
  await cdp.evaluate(settle(settleMs));
}

// ---------------------------------------------------------------------------
// The audit, as one expression evaluated in the page
// ---------------------------------------------------------------------------

// NO BACKTICKS ANYWHERE INSIDE THIS STRING, comments included. It is a template literal that
// gets evaluated in the page, so a backtick around a filename in a comment ends the literal and
// the whole file stops parsing. It has happened twice; write file names bare.
const AUDIT = `(() => {
  const MIN = ${JSON.stringify(MIN)};
  const out = { type: [], tap: [], gutter: [], clipped: [], stroke: [], contrast: [], unknownBg: [], page: [], names: [], floating: [] };
  const seen = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // Clipped to a 1px box: an off-screen label for a screen reader, which draws NO PIXELS.
    // Every rule here is about what a person can see on a 225-nit panel, so a thing with no
    // pixels cannot break one. Without this the glyph-only approve and reject buttons report
    // their own names as 13px type — a finding nobody can act on, which is how an audit stops
    // being read at all.
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || (r.width <= 1 && r.height <= 1)) return false;
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' &&
           Number(cs.opacity) > 0.05;
  };
  // Identify an element by SHAPE, never by its text. A rendering audit walks the household's
  // real calendar, so quoting what it found would put event titles in a report that gets
  // pasted around and read by a hosted model. A tag, a class hint and a character count is
  // enough to find the thing again; run with SHOW_TEXT=1 locally if it is not.
  const SHOW_TEXT = ${JSON.stringify(process.env.SHOW_TEXT === '1')};
  const name = (el) => {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const tag = el.tagName.toLowerCase();
    if (SHOW_TEXT) return tag + (t ? ' "' + t.slice(0, 24) + '"' : '');
    return tag + (t ? ' [' + t.length + ' chars]' : '');
  };

  const all = [...document.querySelectorAll('*')].filter(seen);

  // 1. Type floor. Only elements with their OWN visible text — otherwise a wrapper inherits
  //    a size it never renders and every container reports as a violation.
  for (const el of all) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < MIN.fontSizePx - 0.01) out.type.push({ px: Math.round(px * 10) / 10, el: name(el) });
  }

  // 2 & 3. Tap floor and the inert gutter between neighbours.
  //
  // REACHABLE, not merely drawn. The PIN pad is an opaque sheet over the whole pane, and the
  // queue's own buttons are still laid out underneath it — visible to getComputedStyle, and
  // untouchable by a finger. Measuring the gap between a pad key and a button beneath it
  // produced 26 findings on the first run that opened the grown-up portal, none of which a
  // person could act on. A tap rule is about what a hand can hit, so it asks the browser what
  // is actually at the point the hand would land on.
  //
  // Scoped to the tap rules on purpose. Whether text under an overlay should still be measured
  // for size and contrast is a real question, and it has never once produced a finding here —
  // adding an untested filter to a rule that passes is how a rule quietly stops running.
  const reachable = (el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  };
  const taps = all.filter((el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ||
                                  el.tagName === 'A' || el.onclick)
                  .filter(reachable);
  const rects = taps.map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (const { el, r } of rects) {
    // Which floor applies is read from the DOM, not guessed from geometry: the attribute
    // data-scene-tap is set by SceneView on the three children and the dog. NO BACKTICKS in
    // here — this function is shipped to the browser inside a template literal, and one
    // closes it. See MIN.sceneTapTargetPx.
    const floor = el.closest('[data-scene-tap]') ? MIN.sceneTapTargetPx : MIN.tapTargetPx;
    if (r.width < floor - 0.01 || r.height < floor - 0.01) {
      out.tap.push({ w: Math.round(r.width), h: Math.round(r.height), floor, el: name(el) });
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      // Nested targets are a different problem; only compare disjoint ones.
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      if (overlap) continue;
      const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
      const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
      const gap = Math.hypot(dx, dy);
      const onPicture = rects[i].el.closest('[data-scene-tap]') !== null &&
                        rects[j].el.closest('[data-scene-tap]') !== null;
      const need = onPicture ? MIN.sceneTapGapPx : MIN.tapGapPx;
      if (gap < need - 0.01) {
        const at = (r) => Math.round(r.left) + ',' + Math.round(r.top) + ' ' +
                          Math.round(r.width) + 'x' + Math.round(r.height);
        out.gutter.push({
          gap: Math.round(gap),
          need,
          a: name(rects[i].el) + ' @' + at(a),
          b: name(rects[j].el) + ' @' + at(b),
        });
      }
    }
  }

  // 4. Content taller or wider than the box holding it. THE class of bug that hid two of the
  //    morning routine's four steps: reachable by dragging, with nothing saying so.
  for (const el of all) {
    const cs = getComputedStyle(el);
    const scrolls = /auto|scroll/.test(cs.overflowY + cs.overflowX);
    const hidden = /hidden|clip/.test(cs.overflowY + cs.overflowX);
    if (!scrolls && !hidden) continue;
    const overY = el.scrollHeight - el.clientHeight;
    const overX = el.scrollWidth - el.clientWidth;
    if (overY <= 1 && overX <= 1) continue;

    // TRUNCATION IS NOT CLIPPING. A title with text-overflow ellipsis or a line clamp is
    // overflowing on purpose and says so on screen with an ellipsis the reader can see. What
    // this rule is for is the silent kind: a pane that simply ends, with content below the
    // fold and nothing indicating it — the shape of the bug that hid two of the morning
    // routine's four steps from the two children least able to discover a drag gesture.
    const clamped = cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '';
    const ellipsis = cs.textOverflow === 'ellipsis';
    if (clamped || ellipsis) continue;

    // A SCROLL COLUMN THAT SAYS SO IS NOT CLIPPING EITHER (2026-09-26). ScrollColumn is the list
    // the household asked to scroll, and it draws a fade and a chevron at each cut edge. Before
    // this, the Pictures catalog failed here for having thirteen pictures in it. The check is on
    // the CUE, not the column: an edge that is cut must have its marked edge element drawn
    // beside the scroll box, or it is reported exactly as before. Sideways overflow in a
    // column is never excused, because a column never draws a sideways cue.
    let cue = '';
    if (el.hasAttribute('data-scroll-column') && overX <= 1) {
      const host = el.parentElement;
      const cutBelow = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      const cutAbove = el.scrollTop > 1;
      const drawn = (side) => host !== null &&
        host.querySelector(':scope > [data-scroll-edge="' + side + '"]') !== null;
      const missing = (cutBelow && !drawn('bottom')) || (cutAbove && !drawn('top'));
      if (!missing) continue;
      cue = ', NO CUE';
    }

    // Enough to FIX it from the report alone. A bare {overY, el} says a thing overflowed and
    // sends the reader off to re-drive the wall by hand, which on 2026-09-03 did not reproduce
    // it at all — the audit's walk reaches states a hand-driven one does not. So the report
    // carries the box, the flex/grid context, and the child that sticks out furthest, because
    // an overflow is always some child not fitting and naming it is most of the diagnosis.
    const r = el.getBoundingClientRect();
    let worst = null;
    for (const kid of el.children) {
      const k = kid.getBoundingClientRect();
      const past = Math.round(k.bottom - r.bottom + el.scrollTop);
      if (worst === null || past > worst.past) {
        worst = { past, kid: name(kid), h: Math.round(k.height) };
      }
    }
    out.clipped.push({
      overY, overX,
      how: (scrolls ? 'scrollable' : 'HIDDEN') + cue,
      el: name(el),
      box: Math.round(r.width) + 'x' + Math.round(r.height),
      content: el.scrollWidth + 'x' + el.scrollHeight,
      display: cs.display,
      flex: cs.display.includes('flex') ? cs.flexDirection + '/' + cs.gap : undefined,
      minH: cs.minHeight,
      kids: el.children.length,
      // NO BACKTICKS AND NO DOLLAR-BRACE IN HERE. This whole block lives inside the AUDIT template
      // literal, so an interpolation is evaluated by the OUTER script and a backtick ends the
      // string. It is the third time this file has been broken that way; the warning at the
      // top says so and I still did it. Plain concatenation, always.
      worst: worst ? (worst.kid + ' h=' + worst.h + ' past=' + worst.past) : undefined,
    });
  }

  // 5. Stroke floor: 1px logical is 2px physical and the etch smears it away.
  for (const el of all) {
    const cs = getComputedStyle(el);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = parseFloat(cs['border' + side + 'Width']);
      const style = cs['border' + side + 'Style'];
      if (style !== 'none' && w > 0 && w < MIN.strokePx - 0.01) {
        out.stroke.push({ w, side, el: name(el) });
        break;
      }
    }
  }

  // 6. CONTRAST, on the pair actually rendered rather than the pairs somebody declared.
  //
  // unit-g.contrast.test.ts already checks CONTRAST_RULES rigorously — but that is a list a
  // person wrote, and the wall composes foreground and background combinations nobody
  // enumerated. This is the other half, and it is the rule this panel is most likely to break:
  // 225 nits behind anti-glare etched glass diffuses ambient light back across the whole
  // surface, which is why every figure in this design system uses a 0.10 flare term instead of
  // the 0.05 WCAG bakes in. Same maths here, so the two agree.
  //
  // The floor is 4 and not 7 deliberately: 7 is the body-text rule and 4 is the weakest text
  // rule the system declares, so below 4 is unambiguously broken while 4-to-7 may be a
  // legitimate secondary-text pair. A checker that cannot tell them apart should fail only on
  // what it is sure of.
  const FLARE = 0.1;
  const MIN_RATIO = 4;
  const srgb = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const n = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
  };
  const over = (fg, bg) => [
    Math.round(fg.r * fg.a + bg[0] * (1 - fg.a)),
    Math.round(fg.g * fg.a + bg[1] * (1 - fg.a)),
    Math.round(fg.b * fg.a + bg[2] * (1 - fg.a)),
  ];
  /** The colour actually behind an element: first opaque ancestor, compositing translucency. */
  const behind = (el) => {
    const stack = [];
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { image: true };
      const c = parse(cs.backgroundColor);
      if (!c || c.a === 0) continue;
      stack.push(c);
      if (c.a === 1) {
        let acc = [c.r, c.g, c.b];
        for (let i = stack.length - 2; i >= 0; i -= 1) acc = over(stack[i], acc);
        return { rgb: acc };
      }
    }
    return { unknown: true };
  };

  for (const el of all) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg || fg.a === 0) continue;
    const bg = behind(el);
    if (bg.image || bg.unknown) {
      // Reported, never silently passed: a checker that cannot answer must say so, or an
      // unrunnable check reads exactly like a clean one.
      out.unknownBg.push({ why: bg.image ? 'sits on an image' : 'no opaque ancestor', el: name(el) });
      continue;
    }
    const f = lum(over(fg, bg.rgb));
    const b = lum(bg.rgb);
    const ratio = (Math.max(f, b) + FLARE) / (Math.min(f, b) + FLARE);
    if (ratio < MIN_RATIO - 0.005) {
      out.contrast.push({ ratio: Math.round(ratio * 100) / 100, px: Math.round(parseFloat(cs.fontSize)), el: name(el) });
    }
  }

  // 7. The page itself must never scroll sideways.
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    out.page.push({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth });
  }

  // 8. Every child on a naming rail has her name, whole (2026-10-11). Rule 4 excuses an
  //    ellipsis on purpose, so a name cut to "Bened..." passed it, and a tile with no name at all
  //    breaks no other rule: the rail drew a first word for one child and nothing for another,
  //    and nothing here said so. The plain column on felt's grown-up screens names nobody and is
  //    skipped. Reported by shape only, like everything else.
  for (const rail of document.querySelectorAll('[data-rail]')) {
    if (rail.getAttribute('data-rail') === 'column') continue;
    for (const tile of rail.querySelectorAll('[data-rail-child]')) {
      if (!seen(tile)) continue;
      const plates = [...tile.querySelectorAll('[data-rail-name]')].filter(seen);
      if (plates.length !== 1) {
        out.names.push({ why: plates.length + ' names drawn', el: name(tile) });
        continue;
      }
      const plate = plates[0];
      const cs = getComputedStyle(plate);
      // A box a line taller than its content is not a cut name: gallery's 14px caption reports
      // scrollHeight 20 in an 18px box with overflow visible, and every letter is on the glass.
      // Height only counts when something between the name and its tile actually CLIPS.
      let clips = false;
      for (let a = plate; a !== null && a !== tile.parentElement; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (o.overflowY !== 'visible' || o.overflow === 'hidden') { clips = true; break; }
      }
      const cut = cs.textOverflow === 'ellipsis' ||
        (cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '') ||
        plate.scrollWidth > plate.clientWidth + 1 ||
        (clips && plate.scrollHeight > plate.clientHeight + 1);
      const t = plate.getBoundingClientRect();
      const r = tile.getBoundingClientRect();
      const outside = t.left < r.left - 1 || t.right > r.right + 1 || t.top < r.top - 1 || t.bottom > r.bottom + 1;
      if (cut || outside) {
        out.names.push({
          why: cut ? 'cut' : 'outside its tile',
          px: Math.round(parseFloat(cs.fontSize)),
          box: Math.round(t.width) + 'x' + Math.round(t.height),
          content: plate.scrollWidth + 'x' + plate.scrollHeight,
          el: name(plate),
        });
      }
    }
  }

  // 9. Nothing that carries a word or a glyph stands on the PICTURE bare (2026-10-11).
  //
  //    The week's picture is behind every page, and it is a SIBLING of the page: rule 6 walks a
  //    text's ANCESTORS for its background, so it graded words floating over the art against
  //    the wall root's plain ground and passed them. Three floating controls survived a full
  //    audit that way. This asks the question rule 6 cannot: walking up from the text or glyph,
  //    what is the first OPAQUE thing under it — and is that the picture, or a box holding it?
  //    Opaque means a solid fill or an image of its own, at full opacity; a translucent box
  //    lets the art through, so the walk goes on past it. The picture is marked data-backdrop
  //    (WallBackdrop behind a page, SceneView on the home screen). Only what a hand would see:
  //    a sheet over the page is not reported for what lies under it.
  const pictures = [...document.querySelectorAll('[data-backdrop]')];
  if (pictures.length > 0) {
    const solid = (p) => {
      const cs = getComputedStyle(p);
      if (Number(cs.opacity) < 0.99) return false;
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
      const c = parse(cs.backgroundColor);
      return c !== null && c.a >= 0.99;
    };
    for (const el of all) {
      if (pictures.some((pic) => pic.contains(el) && pic.getAttribute('aria-hidden') === 'true')) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      const glyph = el.tagName.toLowerCase() === 'svg' && !(el.parentElement && el.parentElement.closest('svg'));
      if (!own && !glyph) continue;
      if (!reachable(el)) continue;
      let p = el;
      while (p && !solid(p)) p = p.parentElement;
      if (p && pictures.some((pic) => p.contains(pic))) {
        out.floating.push({ what: glyph ? 'glyph' : 'text', el: name(el) });
      }
    }
  }
  return out;
})()`;

// ---------------------------------------------------------------------------
// Walking the wall
// ---------------------------------------------------------------------------

const buttons = `[...document.querySelectorAll('button,[role=button]')]`;

/**
 * Buttons grouped by where they sit, because that is what is stable.
 *
 *   header  — the calendar and grown-ups doors, along the top
 *   home    — the rail's house, first in the rail
 *   avatars — the three faces, the rest of the rail
 *   content — everything else, which on a child's screen is the section switcher
 *
 * The rail is people and the header is chrome; that split is the wall's information
 * architecture, so it is also the right way to drive it.
 *
 * The rail is found by what it IS (`data-rail`), not where it is: it used to be "left of
 * 130px", and felt's rail is a row along the BOTTOM, whose second and third faces would have
 * been read as content. A face is found by its tile (`data-rail-child`), not by an <img>: a
 * face cropped out of the picture is a background image and has none.
 */
const classified = `(() => {
  const all = ${buttons}.map((el) => ({ el, r: el.getBoundingClientRect() }));
  const inRail = (b) => b.el.closest('[data-rail]') !== null;
  const isFace = (b) => b.el.closest('[data-rail-child]') !== null;
  return {
    header:  all.filter((b) => b.r.top < 100 && !inRail(b)),
    home:    all.filter((b) => inRail(b) && !isFace(b)),
    avatars: all.filter((b) => isFace(b)),
    content: all.filter((b) => b.r.top >= 100 && !inRail(b)),
  };
})()`;

/**
 * THE PIN this walk types at the grown-ups door: the instance's own, from the environment.
 *
 * Until October 2026 the door took any four digits — there was no verify route, and the first
 * decision was where the server had its say — so this walk typed four zeros and audited every
 * screen behind the door with a credential that could decide nothing. The door checks now (the
 * admin settings read is its verify) and a refused PIN puts the pad back before anything behind
 * it is drawn, so four zeros audit the door and nothing else.
 *
 * Give it the PIN of the instance under audit — a throwaway's own, set with `provision.ts
 * --pin`. Without one the walk stops at the door and SAYS so under "NOT AUDITED", because
 * "0 findings across N stops" over a walk that never got in is the sentence this audit hid
 * behind until 2026-09-10. Everything it presses behind the door is navigation — a section, an
 * open row, a sheet, a sub-view — and never a request.
 */
const AUDIT_PIN = process.env.AUDIT_PIN ?? '';

/** Press one live control by selector. False when there is none, or it is drawn but not live. */
const press = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el || el.tagName.toLowerCase() !== 'button') return false;
  el.click();
  return true;
})()`;

/** Inside the portal: the door is gone and the Home tiles are up. */
const PORTAL_UP = `(document.querySelector('[data-pin-door]') === null && document.querySelector('[data-home-tile]') !== null)`;

/** Poll an in-page expression until it holds, for at most `ms`. */
async function waitFor(cdp, expression, ms) {
  for (let waited = 0; waited < ms; waited += 150) {
    if (await cdp.evaluate(expression)) return true;
    await cdp.evaluate(settle(150));
  }
  return false;
}

/**
 * Type a PIN on the grown-ups door and press the check: ONE KEY PER EVALUATE. Two clicks in one
 * task land before React has drawn the first, and the check is not a button until the last digit
 * has been drawn — four taps and a check in a single evaluate do nothing at all (CLAUDE.md, "Drive
 * React over CDP in SEPARATE evaluates").
 */
async function enterPin(cdp, pin) {
  for (const digit of pin) {
    if (!(await cdp.evaluate(press(`[data-pin-door] [data-pin-key="${digit}"]`)))) return false;
    await cdp.evaluate(settle(120));
  }
  await cdp.evaluate(settle(200));
  return cdp.evaluate(press('[data-pin-door] [data-pin-key="check"]'));
}

async function run() {
  const cdp = await connect();
  const findings = [];
  const seenStops = new Set();
  /** What the walk meant to reach and could not — printed, because silence here reads as a pass. */
  const notAudited = [];
  const record = (where, r, sig) => {
    // Labelled by what was OBSERVED, not by what the walk intended. The first version of this
    // reported findings under "child 2 / day" while it was in fact looking at the scene,
    // because home now returns to the picture rather than to the board — and a report that
    // names a screen it is not on is worse than no report.
    const label = sig ? `${where} [${sig}]` : where;
    seenStops.add(label);
    for (const [rule, items] of Object.entries(r)) {
      for (const it of items) findings.push({ where: label, rule, ...it });
    }
  };

  /** A cheap fingerprint of which screen is actually up: what is tappable, and how big. */
  const signature = () =>
    cdp.evaluate(`[...document.querySelectorAll('button,[role=button]')]
        .map((b) => Math.round(b.getBoundingClientRect().width) + 'x' +
                    Math.round(b.getBoundingClientRect().height) +
                    (b.querySelector('img') ? 'i' : ''))
        .join(' ')`);

  try {
    await cdp.evaluate(`(location.href = ${JSON.stringify(KIOSK + '&probe=1')}, location.reload(), true)`);
    await ready(cdp, 1500);

    // The scene, where the doors are the only chrome.
    record('scene', await cdp.evaluate(AUDIT), await signature());

    // Through the calendar door to the board, then each child in the rail.
    //
    // Buttons are chosen by WHERE THEY ARE, not by index. The first version indexed the
    // non-avatar buttons and called [0] "home" — on the board that is the calendar door, and
    // the section loop was clicking the two header doors as if they were sections. So the walk
    // kept navigating somewhere else and auditing the scene over and over while labelling the
    // findings "child 2 / day". Position is stable; index is not.
    await cdp.evaluate(`(${classified}.header[0]?.el.click(), true)`);
    await ready(cdp);
    record('board / week', await cdp.evaluate(AUDIT), await signature());

    // A CHILD'S OWN DAY takes two clicks, and the second is not obvious. Selecting a face from
    // the board leaves the calendar destination open, so you get that child's WEEK — which has
    // no section switcher, which is why an earlier version of this walk silently audited five
    // screens and thought it had covered fifteen. Toggling the calendar door back off with a
    // child selected is what lands on her own day; there is no route via home, because home
    // now returns to the picture.
    const avatars = await cdp.evaluate(`${classified}.avatars.length`);
    for (let i = 0; i < avatars; i++) {
      await cdp.evaluate(`(${classified}.avatars[${i}]?.el.click(), true)`);
      await ready(cdp, 700);
      if (i === 0) {
        await cdp.evaluate(`(${classified}.header[0]?.el.click(), true)`);
        await ready(cdp);
      }
      record(`child ${i + 1} / day`, await cdp.evaluate(AUDIT), await signature());

      const sections = await cdp.evaluate(`${classified}.content.length`);
      for (let sIdx = 0; sIdx < sections; sIdx++) {
        // Re-classified every time: choosing a section can change what is on screen.
        await cdp.evaluate(`(${classified}.content[${sIdx}]?.el.click(), true)`);
        await ready(cdp, 700);
        record(`child ${i + 1} / section ${sIdx + 1}`, await cdp.evaluate(AUDIT), await signature());
      }
    }

    // THE GROWN-UP PORTAL — blind until 2026-09-10, and walked behind a real PIN since October.
    //
    // It never opened these screens before that, and said so nowhere: the picture list shipped
    // with 8px between its rows and the approvals row with 12px between its check and its X, and
    // both were found by hand. The door is header[1]; what is behind it is found by its marks
    // (`data-pin-door`, `data-home-tile`, `data-grownup-nav`, `data-grownup-leave`), because the
    // portal draws no wall header to classify.
    await cdp.evaluate(`(${classified}.header[1]?.el.click(), true)`);
    await ready(cdp, 900);
    const atDoor = await cdp.evaluate(`document.querySelector('[data-pin-door]') !== null`);
    record(atDoor ? 'grown-ups / door' : 'grown-ups (no door?)', await cdp.evaluate(AUDIT), await signature());
    let inside = false;
    if (!atDoor) notAudited.push('the grown-ups door showed no pad, so nothing behind it was walked');
    else if (AUDIT_PIN === '') notAudited.push('AUDIT_PIN is not set, so the portal behind the door was not walked');
    else if (!(await enterPin(cdp, AUDIT_PIN))) notAudited.push('the pad would not take AUDIT_PIN, so the portal was not walked');
    else {
      inside = await waitFor(cdp, PORTAL_UP, 6000);
      if (!inside) notAudited.push('the door refused AUDIT_PIN (is it this instance\u2019s PIN?), so the portal was not walked');
    }
    if (inside) {
      await ready(cdp, 900);
      record('grown-ups / home', await cdp.evaluate(AUDIT), await signature());
      const sections = await cdp.evaluate(
        `[...document.querySelectorAll('[data-grownup-nav]')].map((b) => b.getAttribute('data-grownup-nav'))`,
      );
      for (const section of sections) {
        if (section === 'home') continue;
        await cdp.evaluate(press(`[data-grownup-nav="${section}"]`));
        await ready(cdp, 700);
        record(`grown-ups / ${section}`, await cdp.evaluate(AUDIT), await signature());
        // Three layouts live one tap inside a section, and each has shipped a defect of its own.
        if (section === 'chores') {
          if (await cdp.evaluate(press('[data-chore-head]'))) {
            await ready(cdp, 700);
            record('grown-ups / chores / open row', await cdp.evaluate(AUDIT), await signature());
            await cdp.evaluate(press('[data-chore-head]'));
            await ready(cdp, 500);
          }
          if (await cdp.evaluate(press('[data-new-chore]'))) {
            await ready(cdp, 700);
            record('grown-ups / chores / new chore', await cdp.evaluate(AUDIT), await signature());
            await cdp.evaluate(press('[data-sheet-key="cross"]'));
            await ready(cdp, 500);
          }
        }
        if (section === 'settings' && (await cdp.evaluate(press('[data-step-key="forward"]')))) {
          await ready(cdp, 700);
          record('grown-ups / settings / leave-by', await cdp.evaluate(AUDIT), await signature());
          await cdp.evaluate(press('[data-step-key="back"]'));
          await ready(cdp, 500);
        }
      }
    }
    // Out the way an adult leaves — the door's "Back to the wall" or the portal's Leave, which
    // share the mark — so the PIN is dropped and the next door opens from the wall.
    await cdp.evaluate(press('[data-grownup-leave]'));
    await ready(cdp, 900);

    // PICTURES, its own destination: approving needs no PIN, so it opens on the catalog.
    // Clicking its door again closes it.
    await cdp.evaluate(`(${classified}.header[2]?.el.click(), true)`);
    await ready(cdp, 900);
    record('pictures / catalog', await cdp.evaluate(AUDIT), await signature());
    await cdp.evaluate(`(${classified}.header[2]?.el.click(), true)`);
    await ready(cdp, 700);

    // ---------------------------------------------------------------------
    const RULES = {
      type: `text below ${MIN.fontSizePx}px logical`,
      tap: `tap target below its floor (${MIN.tapTargetPx}px UI, ${MIN.sceneTapTargetPx}px on the picture)`,
      gutter: `less inert space between two targets than their floor (${MIN.tapGapPx}px UI, ${MIN.sceneTapGapPx}px on the picture)`,
      clipped: 'content larger than the box holding it',
      stroke: `border below ${MIN.strokePx}px logical`,
      contrast: 'text under 4:1 against what is actually behind it (0.10 flare, not WCAG 0.05)',
      unknownBg: 'text whose background could not be determined — NOT a pass',
      page: 'the page scrolls sideways',
      names: 'a child on a naming rail without her whole name',
      floating: 'text or a glyph drawn straight on the picture, with no opaque plate under it',
    };
    let total = 0;
    for (const [rule, label] of Object.entries(RULES)) {
      const hits = findings.filter((f) => f.rule === rule);
      total += hits.length;
      console.log(`\n${hits.length === 0 ? 'PASS' : 'FAIL'}  ${label}  (${hits.length})`);
      const shown = new Set();
      for (const h of hits) {
        const { where, rule: _r, ...rest } = h;
        const line = `    ${where.padEnd(22)} ${JSON.stringify(rest)}`;
        if (shown.has(line)) continue;
        shown.add(line);
        console.log(line);
      }
    }
    console.log(`\n${total} finding(s) across ${seenStops.size} distinct stop(s):`);
    for (const stop of seenStops) console.log(`    ${stop}`);
    if (notAudited.length > 0) {
      console.log('\nNOT AUDITED:');
      for (const why of notAudited) console.log(`    ${why}`);
    }
  } finally {
    await cdp.evaluate(`(location.href = ${JSON.stringify(KIOSK)}, location.reload(), true)`);
    cdp.close();
  }
}

await run();
