// Decides where every `<pre id="*-output">` sits after its content changes.
//
// The panels are capped in height (main.css), so anything longer than the cap
// now scrolls, and where it scrolls to is the whole question. The outputs are
// written from a dozen modules, some by assignment and some by appending, so
// watching the elements keeps this in one place instead of at every call site.
//
// Two kinds of write, two answers:
//
//   * A whole new payload — `run()` in helpers.js replaces the panel outright —
//     is read from the top. Its "── onSuccess ──" header and first fields are
//     the part worth seeing; landing at the end of the JSON hides them.
//   * An append — the postMessage log in card-form-logger.js — follows the
//     newest line, but only for a reader who was already at the bottom. One who
//     has scrolled up to read stays where they put themselves.

/** Within this many pixels of the bottom still counts as "at the bottom". */
const SLACK = 24;

function follow(pre) {
    let text = pre.textContent;
    let height = pre.scrollHeight;

    new MutationObserver(() => {
        const current = pre.textContent;
        const appended =
            current.length > text.length && current.startsWith(text);

        // Measured against the height from *before* this mutation. Adding
        // content moves scrollHeight and leaves scrollTop and clientHeight
        // alone, so this asks where the reader was rather than where the new
        // content makes them appear to be.
        //
        // It also has to be computed here rather than cached from a `scroll`
        // listener: scroll events are dispatched during the rendering steps
        // while this callback is a microtask, so a cached flag can still say
        // "at the bottom" after the reader has scrolled away — and following
        // then puts them back at the bottom, which re-arms the flag and loses
        // the scroll for good.
        const wasAtBottom = pre.scrollTop + pre.clientHeight >= height - SLACK;

        text = current;
        if (!appended) {
            pre.scrollTop = 0;
        } else if (wasAtBottom) {
            pre.scrollTop = pre.scrollHeight;
        }
        height = pre.scrollHeight;
    }).observe(pre, { childList: true, characterData: true, subtree: true });
}

for (const pre of document.querySelectorAll('pre[id$="-output"]')) {
    follow(pre);
}
