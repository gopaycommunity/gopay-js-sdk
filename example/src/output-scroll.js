// Keeps every `<pre id="*-output">` scrolled to its newest line.
//
// The panels are capped in height (main.css), so anything longer than the cap
// now scrolls — and the interesting part of a response, or of the postMessage
// log, is the end. Watching the elements rather than patching the call sites
// keeps this in one place: the outputs are written from a dozen modules, some
// by assignment and some by appending, and each of those is a place the scroll
// could otherwise be forgotten.
//
// Sticky, not forced: an output already at the bottom follows its new content,
// one the reader has scrolled up in stays where they put it.

/** Within this many pixels of the bottom still counts as "at the bottom". */
const SLACK = 24;

function atBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= SLACK;
}

function follow(pre) {
    // Read before the mutation is painted: scrollTop still describes where the
    // reader was, which is what decides whether to follow.
    let stick = true;

    new MutationObserver(() => {
        if (stick) {
            pre.scrollTop = pre.scrollHeight;
        }
    }).observe(pre, { childList: true, characterData: true, subtree: true });

    pre.addEventListener('scroll', () => {
        stick = atBottom(pre);
    });
}

for (const pre of document.querySelectorAll('pre[id$="-output"]')) {
    follow(pre);
}
