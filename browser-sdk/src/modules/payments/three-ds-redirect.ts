/**
 * How long a 3DS redirect gets to actually take the page away before the SDK
 * stops waiting for it.
 *
 * In redirect mode the documented contract is that the promise stays pending
 * as the page unloads. When the page does not unload — a webview that blocks
 * or silently drops a top-level navigation — nothing settles it, ever.
 * `CHARGE_TIMEOUT` cannot cover this: it is deliberately cancelled the moment
 * `ACTION_REQUIRED` is seen, because a customer answering a 3DS challenge has
 * no time limit. So the failure is pure silence, which is what the 22.09.
 * report "went into 3DS, confirmed it, never finished" looked like.
 *
 * 30 s, matching the initial charge timeout rather than undercutting it. The
 * page stays alive until the *next* document starts committing, so this is
 * racing the ACS's first response over the customer's connection — and a
 * tighter bound would report a redirect that is merely slow on mobile data as
 * one that never happened. Nothing is lost by waiting: the alternative to a
 * late answer here is no answer at all.
 *
 * Its own module because the leave latch is bound to the same window and the
 * logging side cannot import the payments module, which imports it.
 */
export const THREE_DS_REDIRECT_TIMEOUT_MS = 30_000;
