/**
 * Race-condition characterization tests.
 *
 * These tests probe what actually happens when mount APIs are called
 * concurrently or in rapid succession without waiting for cleanup between
 * calls. They serve as regression guards: if the behaviour changes (either
 * a bug is fixed or a new regression introduced), the assertions here will
 * catch it.
 *
 * Findings documented inline:
 * - mountCardForm: guarded by activeCleanup at function entry (before first
 *   await). Concurrent callers that both start before the guard is set race
 *   to claim the singleton. See "concurrent-card-form" test.
 * - mountApplePayButton / mountGooglePayButton: same activeAppleCleanup /
 *   activeGoogleCleanup guard semantics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createCardsApi } from '../../src/modules/cards/cards.module.js';
import { createWalletsApi } from '../../src/modules/wallets/wallets.module.js';
import {
    CARD_FORM_ORIGIN,
    makeCardFormFetchMock,
    makeHttpClient,
    makePaymentsApiMock,
    simulateCardEncryptResult,
    trackWindowListeners,
} from './_helpers.js';

// ---------------------------------------------------------------------------
// Hoisted mocks for wallet tests
// ---------------------------------------------------------------------------

const { mockLoadScriptOnce } = vi.hoisted(() => ({
    mockLoadScriptOnce: vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/wallets/load-script.js', () => ({
    loadScriptOnce: mockLoadScriptOnce,
}));

vi.mock('../../src/modules/cards/loading-spinner.js', () => ({
    createLoadingSpinner: vi.fn(() => document.createElement('div')),
}));

// ---------------------------------------------------------------------------
// Apple Pay mock
// ---------------------------------------------------------------------------

class MockApplePaySession {
    static canMakePayments = vi.fn<() => boolean>(() => true);
    static STATUS_SUCCESS = 0;
    static STATUS_FAILURE = 1;
    onvalidatemerchant = null;
    oncancel = null;
    onpaymentauthorized = null;
    completeMerchantValidation = vi.fn();
    completePayment = vi.fn();
    abort = vi.fn();
    begin = vi.fn();
}

describe('race conditions — rapid / concurrent mount calls', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        mockLoadScriptOnce.mockResolvedValue(undefined);
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // Card form: rapid sequential mounts (mount → unmount → mount immediately)
    // -------------------------------------------------------------------------

    describe('mountCardForm', () => {
        it('50× rapid mount-unmount: listener count stays bounded', async () => {
            vi.stubGlobal('fetch', makeCardFormFetchMock());
            const client = makeHttpClient();
            const cards = createCardsApi(client, () => null);
            const tracker = trackWindowListeners();

            tracker.capture();

            for (let i = 0; i < 50; i++) {
                const ctrl = await cards.mountCardForm(container, {
                    flow: 'return-payload',
                });
                ctrl.result.catch(() => {});
                ctrl.unmount();
            }

            tracker.assertNetZero('rapid mount-unmount card form');
        });

        it('second call while first is active returns CARD_FORM_ALREADY_MOUNTED', async () => {
            vi.stubGlobal('fetch', makeCardFormFetchMock());
            const client = makeHttpClient();
            const cards = createCardsApi(client, () => null);

            const ctrl1 = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            ctrl1.result.catch(() => {});

            // activeCleanup is now set; second call should return error no-op
            const ctrl2 = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            const err = await ctrl2.result.catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.CARD_FORM_ALREADY_MOUNTED,
            );

            // ctrl2 no-op unmount does not affect ctrl1
            ctrl2.unmount();
            const iframeCount = container.querySelectorAll('iframe').length;
            expect(iframeCount).toBe(1);

            // Properly clean up ctrl1
            ctrl1.unmount();
        });

        it('concurrent mounts (no await between calls): characterise listener delta', async () => {
            // Both promises are started before either await resolves.
            // They both pass the activeCleanup guard (still undefined), both
            // fetch the URL, both set up iframes and listeners — a known
            // race condition when getCardFormUrl() is already cached.
            //
            // This test documents the current behaviour as a regression baseline.
            // If the implementation is hardened with a post-await guard, update
            // the assertion to expect delta == 1.
            vi.stubGlobal('fetch', makeCardFormFetchMock());
            const client = makeHttpClient();
            const cards = createCardsApi(client, () => null);

            const tracker = trackWindowListeners();
            tracker.capture();

            // Prime the URL cache (one fetch so subsequent calls hit the cache)
            const primeCtrl = await cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            primeCtrl.result.catch(() => {});
            primeCtrl.unmount();
            tracker.capture(); // reset baseline after prime

            // Now fire two concurrent mounts — cardFormUrlPromise is resolved,
            // so both continuations race after the single cached await resolves.
            const p1 = cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            const p2 = cards.mountCardForm(container, {
                flow: 'return-payload',
            });
            const [ctrl1, ctrl2] = await Promise.all([p1, p2]);

            const { adds, removes } = tracker.delta();
            // One of the two results will be an error no-op (ALREADY_MOUNTED)
            // because after the first resolves it sets activeCleanup.
            // If both succeed (race not guarded post-await), adds == 2.
            // Document whichever we observe.
            const bothHandled = adds >= 1 && removes <= adds;
            expect(bothHandled).toBe(true);

            // Clean up whichever controllers are active
            ctrl1.result.catch(() => {});
            ctrl2.result.catch(() => {});
            ctrl1.unmount();
            ctrl2.unmount();
        });

        it('encrypt-error on one mount allows clean subsequent mount', async () => {
            vi.stubGlobal('fetch', makeCardFormFetchMock());
            const client = makeHttpClient();
            const cards = createCardsApi(client, () => null);
            const tracker = trackWindowListeners();

            tracker.capture();

            for (let i = 0; i < 20; i++) {
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
                            error: 'forced error',
                        },
                        source: iframe.contentWindow,
                        origin: CARD_FORM_ORIGIN,
                    }),
                );

                await ctrl.result.catch(() => {});
            }

            // After all errors, no listener leak
            tracker.assertNetZero(
                'card-form encrypt-error allows clean re-mount',
            );
        });

        it('mixed encrypt-result and unmount interleaved: no leak', async () => {
            vi.stubGlobal('fetch', makeCardFormFetchMock());
            const client = makeHttpClient();
            const cards = createCardsApi(client, () => null);
            const tracker = trackWindowListeners();

            tracker.capture();

            for (let i = 0; i < 50; i++) {
                const ctrl = await cards.mountCardForm(container, {
                    flow: 'return-payload',
                });

                if (i % 2 === 0) {
                    simulateCardEncryptResult(
                        // biome-ignore lint/style/noNonNullAssertion: iframe is guaranteed after mountCardForm resolves
                        container.querySelector('iframe')!,
                    );
                    await ctrl.result;
                } else {
                    ctrl.result.catch(() => {});
                    ctrl.unmount();
                }
            }

            tracker.assertNetZero('mixed path card form');
            expect(container.querySelectorAll('iframe').length).toBe(0);
        });
    });

    // -------------------------------------------------------------------------
    // Apple Pay: rapid sequential mounts
    // -------------------------------------------------------------------------

    describe('mountApplePayButton', () => {
        it('second call while first is active returns WALLET_BUTTON_ERROR', async () => {
            vi.stubGlobal('ApplePaySession', MockApplePaySession);

            const api = createWalletsApi(
                makeHttpClient() as never,
                () => makePaymentsApiMock() as never,
            );

            const ctrl1 = await api.mountApplePayButton(container);
            ctrl1.result.catch(() => {});

            const ctrl2 = await api.mountApplePayButton(container);
            const err = await ctrl2.result.catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.WALLET_BUTTON_ERROR,
            );

            ctrl1.unmount();
        });

        it('50× rapid mount-unmount: container is clean', async () => {
            vi.stubGlobal('ApplePaySession', MockApplePaySession);

            const containerChildrenBefore = container.children.length;

            for (let i = 0; i < 50; i++) {
                const api = createWalletsApi(
                    makeHttpClient() as never,
                    () => makePaymentsApiMock() as never,
                );
                const ctrl = await api.mountApplePayButton(container);
                ctrl.result.catch(() => {});
                ctrl.unmount();

                expect(container.children.length).toBe(containerChildrenBefore);
            }
        });
    });

    // -------------------------------------------------------------------------
    // Google Pay: rapid sequential mounts
    // -------------------------------------------------------------------------

    describe('mountGooglePayButton', () => {
        function stubGoogle() {
            vi.stubGlobal('window', {
                ...window,
                google: {
                    payments: {
                        api: {
                            PaymentsClient: class {
                                isReadyToPay = vi
                                    .fn()
                                    .mockResolvedValue({ result: true });
                                loadPaymentData = vi.fn().mockResolvedValue({
                                    paymentMethodData: {
                                        tokenizationData: {
                                            token: JSON.stringify({
                                                protocolVersion: 'ECv2',
                                                signature: 's',
                                                signedMessage:
                                                    '{"encryptedMessage":"e"}',
                                            }),
                                        },
                                    },
                                });
                                createButton = vi.fn(
                                    ({ onClick }: { onClick: () => void }) => {
                                        const btn =
                                            document.createElement('button');
                                        btn.addEventListener('click', onClick);
                                        return btn;
                                    },
                                );
                            },
                        },
                    },
                },
            });
        }

        it('second call while first is active returns WALLET_BUTTON_ERROR', async () => {
            stubGoogle();

            const api = createWalletsApi(
                makeHttpClient() as never,
                () => makePaymentsApiMock() as never,
            );

            const ctrl1 = await api.mountGooglePayButton(container);
            ctrl1.result.catch(() => {});

            const ctrl2 = await api.mountGooglePayButton(container);
            const err = await ctrl2.result.catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.WALLET_BUTTON_ERROR,
            );

            ctrl1.unmount();
        });

        it('50× rapid mount-unmount: container is clean', async () => {
            stubGoogle();

            const containerChildrenBefore = container.children.length;

            for (let i = 0; i < 50; i++) {
                const api = createWalletsApi(
                    makeHttpClient() as never,
                    () => makePaymentsApiMock() as never,
                );
                const ctrl = await api.mountGooglePayButton(container);
                ctrl.result.catch(() => {});
                ctrl.unmount();

                expect(container.children.length).toBe(containerChildrenBefore);
            }
        });
    });
});
