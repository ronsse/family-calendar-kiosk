/**
 * Unit H — where the week's picture lives behind every page.
 *
 * A `.ts` and not part of `WallBackdrop.tsx`, for the reason this repo keeps relearning: the
 * test runner is `node --experimental-strip-types`, which strips `.ts` and NOT `.tsx`, so
 * anything inside a component is unreachable from a test. This particular function is here
 * because it was got wrong in production and nothing noticed for a day.
 */

/**
 * The CSS `url()` path for a scene image, given whatever the snapshot carried.
 *
 * ## The bug this exists to make impossible
 *
 * `WallBackdrop` used to be handed a bare `scenes/autumn-forest.jpg` and added the leading
 * slash itself. On 2026-09-08 scene selection moved to the server, `WallSnapshot.scene.image`
 * started arriving already rooted as `/scenes/autumn-forest.jpg`, and the prefix stayed — so
 * every page asked for `//scenes/autumn-forest.jpg`.
 *
 * A leading double slash is a PROTOCOL-RELATIVE url. The browser read `scenes` as a hostname,
 * tried `http://scenes/autumn-forest.jpg`, and failed. Silently: a background image that does
 * not load produces no error, no broken-image icon and no layout change — it simply is not
 * there, and what remains is the plain ground the component is designed to fall back to. So
 * the wall looked *exactly* like a deliberate design decision, which is why it survived a
 * deploy, a panel audit and a screenshot review, and was found only because the operator said the
 * picture he had asked for on every page was not on every page.
 *
 * Tolerant in one direction on purpose. Being strict here — refusing an unrooted path — would
 * trade a wrong picture for no picture, and no picture is the failure that hides.
 */
export function backdropUrl(image: string): string {
  return `/${image.replace(/^\/+/, '')}`;
}
