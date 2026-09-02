import { expandAllSections, expect, test } from '../fixtures/fixtures.js';

/**
 * Where an output panel sits after its content changes. Everything here is DOM
 * behaviour — the content is written straight into the panel, so no call
 * reaches the API.
 *
 * None of these dispatch a `scroll` event by hand. A real browser fires that
 * one during the rendering steps, well after the mutation the observer sees, so
 * a spec that synthesises it synchronously tests an ordering that never happens
 * — and would pass over a handler that reads a stale "at the bottom" flag.
 */

const LONG = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');

/** Value and scroll position exactly as the browser holds them. */
function state(page: import('@playwright/test').Page, id: string) {
    return page.locator(`#${id}`).evaluate((el) => ({
        top: el.scrollTop,
        client: el.clientHeight,
        scroll: el.scrollHeight,
    }));
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#sdk-badge')).toHaveText('LOADED');
    await expandAllSections(page);
});

test('a long payload is capped rather than pushing the page down', async ({
    page,
}) => {
    await page.locator('#cardpay-output').evaluate((el, text) => {
        el.textContent = text;
    }, LONG);

    const box = await state(page, 'cardpay-output');
    const overflowY = await page
        .locator('#cardpay-output')
        .evaluate((el) => getComputedStyle(el).overflowY);

    // 20rem at the default root size, plus the border box.
    expect(box.client).toBeLessThanOrEqual(340);
    expect(box.scroll).toBeGreaterThan(box.client);
    expect(overflowY).toBe('auto');
});

// This is what `run()` in helpers.js does to nearly every panel: it replaces
// the content outright. The reader wants the header and the first fields.
test('a replaced payload is read from the top', async ({ page }) => {
    await page.locator('#payment-create-output').evaluate((el, text) => {
        el.textContent = `── onSuccess ──\n${text}`;
    }, LONG);

    expect((await state(page, 'payment-create-output')).top).toBe(0);
});

test('a second response also starts at the top', async ({ page }) => {
    const output = page.locator('#payment-create-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);
    await output.evaluate((el) => {
        el.scrollTop = el.scrollHeight; // reader scrolled to the end of it
    });
    await output.evaluate((el, text) => {
        el.textContent = `── onSuccess ──\n${text}`;
    }, LONG);

    expect((await state(page, 'payment-create-output')).top).toBe(0);
});

// A response that happens to begin with the one before it. Told apart from an
// append by who wrote it, not by how the text looks — inferring that from a
// prefix sent this one to its end.
test('a replacement that starts with the previous payload still goes to the top', async ({
    page,
}) => {
    const output = page.locator('#payment-create-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);
    await output.evaluate((el) => {
        el.scrollTop = el.scrollHeight; // reader is at the bottom of it
    });
    await output.evaluate((el, text) => {
        el.textContent = `${text}\n"newField": "added in the second response"`;
    }, LONG);

    expect((await state(page, 'payment-create-output')).top).toBe(0);
});

/**
 * A real append into the one panel that grows a line at a time: a GOPAY_
 * postMessage, which card-form-logger.js picks up and writes through
 * `appendOutput`. Driving it this way rather than setting textContent keeps the
 * spec on the path the writer actually takes — an assignment from outside is a
 * replacement, and is meant to behave like one.
 */
async function postMessageTo(
    page: import('@playwright/test').Page,
    marker: string,
): Promise<void> {
    const before = await page
        .locator('#cardpay-output')
        .evaluate((el) => el.textContent?.length ?? 0);
    await page.evaluate((m) => {
        window.postMessage({ type: 'GOPAY_CARD_ENCRYPT_RESULT', m }, '*');
    }, marker);
    await page.waitForFunction(
        (n) =>
            (document.querySelector('#cardpay-output')?.textContent?.length ??
                0) > n,
        before,
    );
}

test('an append follows the newest line', async ({ page }) => {
    const output = page.locator('#cardpay-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);
    await output.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
    });
    await postMessageTo(page, 'first');

    // Pinned to the bottom, not merely near it. The old tolerance was 24 — the
    // same value as SLACK in output-scroll.js — so a one-line append left the
    // panel inside it whether or not anything scrolled, and deleting the
    // `if (wasAtBottom)` branch kept the suite green. Verified by deleting it:
    // this assertion now fails, and the one on the resume test below with it.
    const s = await state(page, 'cardpay-output');
    expect(s.scroll - s.top - s.client).toBeLessThanOrEqual(1);
});

test('an append leaves a reader who scrolled up where they are', async ({
    page,
}) => {
    const output = page.locator('#cardpay-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);
    await output.evaluate((el) => {
        el.scrollTop = 0;
    });
    await postMessageTo(page, 'while-reading');

    expect((await state(page, 'cardpay-output')).top).toBe(0);
});

test('following resumes once the reader returns to the bottom', async ({
    page,
}) => {
    const output = page.locator('#cardpay-output');
    await output.evaluate((el, text) => {
        el.textContent = text;
    }, LONG);
    await output.evaluate((el) => {
        el.scrollTop = 0;
    });
    await postMessageTo(page, 'while-reading');
    await output.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
    });
    await postMessageTo(page, 'back-at-the-bottom');

    const s = await state(page, 'cardpay-output');
    expect(s.scroll - s.top - s.client).toBeLessThanOrEqual(1);
});

test('every output panel is capped, not just the card form log', async ({
    page,
}) => {
    const panels = await page.evaluate(() =>
        [...document.querySelectorAll('pre[id$="-output"]')].map((pre) => ({
            id: pre.id,
            maxHeight: getComputedStyle(pre).maxHeight,
            overflowY: getComputedStyle(pre).overflowY,
        })),
    );

    expect(panels.length).toBeGreaterThan(5);
    for (const panel of panels) {
        expect(panel.maxHeight, panel.id).not.toBe('none');
        expect(panel.overflowY, panel.id).toBe('auto');
    }
});
