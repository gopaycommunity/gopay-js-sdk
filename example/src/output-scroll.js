// Decides where every `<pre id="*-output">` sits after its content changes.
//
// The panels are capped in height (main.css), so anything longer than the cap
// now scrolls, and where it scrolls to depends on which kind of write it was:
//
//   * A whole new payload — `run()` in helpers.js, and anything else that
//     assigns textContent — is read from the top. Its "── onSuccess ──" header
//     and first fields are the part worth seeing; landing at the end of the
//     JSON hides them.
//   * An append — a charge state arriving, a postMessage being logged — follows
//     the newest line, but only for a reader who was already at the bottom. One
//     who has scrolled up to read stays where they put themselves.
//
// Appending says so by calling `appendOutput`. That is the whole mechanism: a
// guess from the text — "the new value starts with the old one, so it must be
// an append" — gets a replacement wrong whenever a response happens to begin
// with the one before it, and a flag set for the observer to consume gets it
// wrong when an append and a replacement land in the same task, since the
// observer is handed both mutations at once and the flag only answers for one.
//
// Placing the scroll inside appendOutput leaves the observer with a single
// unambiguous job: anything it sees that appendOutput did not already place is
// a replacement.

/** Within this many pixels of the bottom still counts as "at the bottom". */
const SLACK = 24;

/** What the last appendOutput left in each panel, to tell its own mutation from
 *  a replacement that arrived in the same batch. */
const lastAppended = new WeakMap();

/**
 * Add to an output panel, keeping the newest line in view for a reader who was
 * already at the bottom and leaving one who has scrolled up alone.
 */
export function appendOutput(pre, text) {
    // Measured before the write: adding content moves scrollHeight and leaves
    // scrollTop and clientHeight where they were.
    const wasAtBottom =
        pre.scrollHeight - pre.scrollTop - pre.clientHeight <= SLACK;

    pre.textContent += text;
    lastAppended.set(pre, pre.textContent);
    if (wasAtBottom) {
        pre.scrollTop = pre.scrollHeight;
    }
}

for (const pre of document.querySelectorAll('pre[id$="-output"]')) {
    new MutationObserver(() => {
        // Compared against the value rather than a flag, so a replacement that
        // followed an append in the same task is still seen for what it is: the
        // append's text is no longer what the panel holds. A flag would answer
        // for only one of the two mutations the observer is handed together.
        //
        // Not covered by a spec: reaching that ordering needs an append and a
        // replacement with no await between them, and every writer here has
        // one. Driving it from a spec means importing this module a second
        // time, which gets its own WeakMap and proves nothing.
        if (lastAppended.get(pre) === pre.textContent) {
            return;
        }
        pre.scrollTop = 0;
    }).observe(pre, { childList: true, characterData: true, subtree: true });
}
