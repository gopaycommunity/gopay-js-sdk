import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCardsApi } from '../../src/modules/cards/cards.module.js';
import {
    CARD_FORM_ORIGIN,
    makeCardFormFetchMock,
    makeHttpClient,
    simulateCardEncryptResult,
    trackWindowListeners,
} from './_helpers.js';

const ITERATIONS = 200;

describe('mountCardForm — stress / leak detection', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // Happy-path: encrypt-result resolves the form cleanly
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× mount → encrypt-result → no listener or iframe leak`, async () => {
        const fetchMock = makeCardFormFetchMock();
        vi.stubGlobal('fetch', fetchMock);

        const client = makeHttpClient();
        const cards = createCardsApi(client, () => null);
        const tracker = trackWindowListeners();

        const iframesBefore = document.body.querySelectorAll('iframe').length;
        tracker.capture();

        for (let i = 0; i < ITERATIONS; i++) {
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });

            // biome-ignore lint/style/noNonNullAssertion: iframe is guaranteed after mountCardForm resolves
            const iframe = container.querySelector('iframe')!;
            simulateCardEncryptResult(iframe);
            const result = await ctrl.result;

            expect(
                (result as { encryptedPayload: string }).encryptedPayload,
            ).toBe('tok_test');
        }

        tracker.assertNetZero('card-form encrypt-result path');
        expect(document.body.querySelectorAll('iframe').length).toBe(
            iframesBefore,
        );
        // URL promise is cached — exactly one fetch across all iterations
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    // Cancellation path: unmount() before iframe posts a result
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× mount → unmount → no listener or iframe leak`, async () => {
        vi.stubGlobal('fetch', makeCardFormFetchMock());

        const client = makeHttpClient();
        const cards = createCardsApi(client, () => null);
        const tracker = trackWindowListeners();

        const iframesBefore = document.body.querySelectorAll('iframe').length;
        tracker.capture();

        for (let i = 0; i < ITERATIONS; i++) {
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});
            ctrl.unmount();
        }

        tracker.assertNetZero('card-form unmount path');
        expect(document.body.querySelectorAll('iframe').length).toBe(
            iframesBefore,
        );
    });

    // -------------------------------------------------------------------------
    // Error path: iframe posts GOPAY_CARD_ENCRYPT_ERROR
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× mount → encrypt-error → no listener or iframe leak`, async () => {
        vi.stubGlobal('fetch', makeCardFormFetchMock());

        const client = makeHttpClient();
        const cards = createCardsApi(client, () => null);
        const tracker = trackWindowListeners();

        tracker.capture();

        for (let i = 0; i < ITERATIONS; i++) {
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl.result.catch(() => {});

            // biome-ignore lint/style/noNonNullAssertion: iframe is guaranteed after mountCardForm resolves
            const iframe = container.querySelector('iframe')!;
            window.dispatchEvent(
                new MessageEvent('message', {
                    data: {
                        type: 'GOPAY_CARD_ENCRYPT_ERROR',
                        error: 'test error',
                    },
                    source: iframe.contentWindow,
                    origin: CARD_FORM_ORIGIN,
                }),
            );

            await ctrl.result.catch(() => {});
        }

        tracker.assertNetZero('card-form encrypt-error path');
        expect(document.body.querySelectorAll('iframe').length).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Singleton: cardFormUrlPromise is cached across factory instance lifetime
    // -------------------------------------------------------------------------

    it('cardFormUrlPromise cached: only 1 fetch across independent mounts', async () => {
        const fetchMock = makeCardFormFetchMock();
        vi.stubGlobal('fetch', fetchMock);

        const client = makeHttpClient();
        const cards = createCardsApi(client, () => null);

        for (let i = 0; i < 50; i++) {
            const ctrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            // biome-ignore lint/style/noNonNullAssertion: iframe is guaranteed after mountCardForm resolves
            simulateCardEncryptResult(container.querySelector('iframe')!);
            await ctrl.result;
        }

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    // Singleton: loading-spinner injects exactly one <style> after many mounts
    // -------------------------------------------------------------------------

    it('loading-spinner <style> is injected exactly once across many mounts', async () => {
        vi.stubGlobal('fetch', makeCardFormFetchMock());

        // Use direct-charge flow to trigger the spinner code path, but since
        // getPaymentsApi() returns null, it will reject with PAYMENT_NOT_ATTACHED
        // — still exercises getCardFormUrl + iframe mount + cleanup.
        // For the spinner itself, call createLoadingSpinner by triggering the
        // return-payload flow; the spinner is only shown in direct-charge.
        // Instead just run many return-payload mounts (spinner not used).

        // Test the spinner singleton directly:
        const { createLoadingSpinner } = await import(
            '../../src/modules/cards/loading-spinner.js'
        );
        const stylesBefore = document.head.querySelectorAll('style').length;

        for (let i = 0; i < 50; i++) {
            createLoadingSpinner('#1899d6').remove();
        }

        // stylesInjected flag ensures only one <style> is ever appended
        expect(document.head.querySelectorAll('style').length).toBe(
            stylesBefore + 1,
        );
    });
});
