import { afterEach, describe, expect, it } from 'vitest';
import { loadScriptOnce } from '../../src/modules/wallets/load-script.js';

// Each test uses a unique URL so the module-level cache does not bleed between tests.

describe('loadScriptOnce()', () => {
    afterEach(() => {
        for (const el of document.head.querySelectorAll(
            'script[src^="https://cdn.test.load-script"]',
        )) {
            el.remove();
        }
    });

    it('appends a script element to document.head and resolves when load fires', async () => {
        const url = 'https://cdn.test.load-script/a.js';
        const promise = loadScriptOnce(url);

        const script = document.head.querySelector(
            `script[src="${url}"]`,
        ) as HTMLScriptElement;
        expect(script).not.toBeNull();
        expect(script.async).toBe(true);

        script.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toBeUndefined();
    });

    it('rejects and clears the cache when the error event fires', async () => {
        const url = 'https://cdn.test.load-script/b.js';
        const promise = loadScriptOnce(url);

        const script = document.head.querySelector(
            `script[src="${url}"]`,
        ) as HTMLScriptElement;
        expect(script).not.toBeNull();

        // jsdom does not dispatch onerror via the event system for script elements;
        // invoke the handler directly (same pattern used elsewhere in these tests).
        script.onerror?.(new ErrorEvent('error'));

        const err = await promise.catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain(url);

        // Cache was cleared — a second call must create a new promise (not return the old one).
        const promise2 = loadScriptOnce(url);
        expect(promise2).not.toBe(promise);

        // Resolve the second promise so it does not leak.
        const script2 = document.head.querySelector(
            `script[src="${url}"]`,
        ) as HTMLScriptElement;
        expect(script2).not.toBeNull();
        script2.dispatchEvent(new Event('load'));
        await promise2;
    });

    it('returns the same promise for the same URL (deduplication)', async () => {
        const url = 'https://cdn.test.load-script/c.js';

        const p1 = loadScriptOnce(url);
        const p2 = loadScriptOnce(url);

        expect(p1).toBe(p2);

        // Only one script element should be in the DOM.
        expect(
            document.head.querySelectorAll(`script[src="${url}"]`),
        ).toHaveLength(1);

        const script = document.head.querySelector(
            `script[src="${url}"]`,
        ) as HTMLScriptElement;
        expect(script).not.toBeNull();
        script.dispatchEvent(new Event('load'));
        await p1;
    });
});
