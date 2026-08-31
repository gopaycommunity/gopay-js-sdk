// Decides where every `<pre id="*-output">` sits after its content changes.
//
// The panels are capped in height (main.css), so anything longer than the cap
// now scrolls, and where it scrolls to depends on which kind of write it was:
//
//   * A whole new payload — `run()` in helpers.js replaces the panel outright —
//     is read from the top. Its "── onSuccess ──" header and first fields are
//     the part worth seeing; landing at the end of the JSON hides them.
//   * An append — the postMessage log in card-form-logger.js — follows the
//     newest line, but only for a reader who was already at the bottom. One who
//     has scrolled up to read stays where they put themselves.
//
// Appending says so by calling `appendOutput`, rather than the scroll being
// guessed from the text afterwards. A guess based on the new value starting
// with the old one gets a replacement wrong whenever a response happens to
// begin with the one before it, and sends the reader to the end of it.
//
// Only one writer appends, so only one has to say so; the twenty that replace
// need no changes and cannot forget to.

/** Within this many pixels of the bottom still counts as "at the bottom". */
const SLACK = 24;

/** Panels whose current mutation came from appendOutput, not from a replacement. */
const appending = new WeakSet();

/**
 * Add to an output panel, keeping the newest line in view for a reader who was
 * already at the bottom and leaving one who has scrolled up alone.
 */
export function appendOutput(pre, text) {
    // Measured before the write: adding content moves scrollHeight and leaves
    // scrollTop and clientHeight where they were.
    const wasAtBottom =
        pre.scrollHeight - pre.scrollTop - pre.clientHeight <= SLACK;

    appending.add(pre);
    pre.textContent += text;
    if (wasAtBottom) {
        pre.scrollTop = pre.scrollHeight;
    }
}

for (const pre of document.querySelectorAll('pre[id$="-output"]')) {
    new MutationObserver(() => {
        // appendOutput has already placed this one and says so here, once.
        if (appending.delete(pre)) {
            return;
        }
        pre.scrollTop = 0;
    }).observe(pre, { childList: true, characterData: true, subtree: true });
}
