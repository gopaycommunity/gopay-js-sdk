import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalletsApi } from '../../src/modules/wallets/wallets.module.js';
import { makeHttpClient, makePaymentsApiMock } from './_helpers.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
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
// Google Pay client mock factory
// ---------------------------------------------------------------------------

const validGoogleTokenData = JSON.stringify({
    protocolVersion: 'ECv2',
    signature: 'sig==',
    signedMessage: '{"encryptedMessage":"enc=="}',
});

function makeGoogleGlobal(onClickCapture?: (fn: () => Promise<void>) => void) {
    return {
        google: {
            payments: {
                api: {
                    PaymentsClient: class MockPaymentsClient {
                        isReadyToPay = vi
                            .fn()
                            .mockResolvedValue({ result: true });
                        loadPaymentData = vi.fn().mockResolvedValue({
                            paymentMethodData: {
                                tokenizationData: {
                                    token: validGoogleTokenData,
                                },
                            },
                        });
                        createButton = vi.fn(
                            ({ onClick }: { onClick: () => Promise<void> }) => {
                                onClickCapture?.(onClick);
                                const btn = document.createElement('button');
                                btn.setAttribute('data-testid', 'gpay-button');
                                btn.addEventListener(
                                    'click',
                                    () => void onClick(),
                                );
                                return btn;
                            },
                        );
                    },
                },
            },
        },
    };
}

const ITERATIONS = 200;

describe('mountGooglePayButton — stress / leak detection', () => {
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
    // Happy path: button click → payment data → charge succeeds
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× mount → click → payment → no DOM leak`, async () => {
        const containerChildrenBefore = container.children.length;

        for (let i = 0; i < ITERATIONS; i++) {
            let capturedOnClick: (() => Promise<void>) | undefined;
            vi.stubGlobal('window', {
                ...window,
                ...makeGoogleGlobal((fn) => {
                    capturedOnClick = fn;
                }),
            });

            const paymentsApi = makePaymentsApiMock();
            const api = createWalletsApi(
                makeHttpClient() as never,
                () => paymentsApi as never,
            );

            const ctrl = await api.mountGooglePayButton(container);

            expect(capturedOnClick).toBeDefined();
            // biome-ignore lint/style/noNonNullAssertion: asserted defined on the line above
            await capturedOnClick!();

            await ctrl.result;

            expect(container.children.length).toBe(containerChildrenBefore);
        }

        expect(
            container.querySelectorAll('[data-testid="gpay-button"]').length,
        ).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Cancellation path: unmount() before button click
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× mount → unmount → container is clean`, async () => {
        vi.stubGlobal('window', { ...window, ...makeGoogleGlobal() });

        const containerChildrenBefore = container.children.length;

        for (let i = 0; i < ITERATIONS; i++) {
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

    // -------------------------------------------------------------------------
    // Cancel from sheet: loadPaymentData rejects with CANCELED status
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× mount → cancel-from-sheet → no leak`, async () => {
        const containerChildrenBefore = container.children.length;

        for (let i = 0; i < ITERATIONS; i++) {
            const cancelError = Object.assign(new Error('User cancelled'), {
                statusCode: 'CANCELED',
            });

            let capturedOnClick: (() => Promise<void>) | undefined;
            vi.stubGlobal('window', {
                ...window,
                google: {
                    payments: {
                        api: {
                            PaymentsClient: class {
                                isReadyToPay = vi
                                    .fn()
                                    .mockResolvedValue({ result: true });
                                loadPaymentData = vi
                                    .fn()
                                    .mockRejectedValue(cancelError);
                                createButton = vi.fn(
                                    ({
                                        onClick,
                                    }: {
                                        onClick: () => Promise<void>;
                                    }) => {
                                        capturedOnClick = onClick;
                                        const btn =
                                            document.createElement('button');
                                        btn.addEventListener(
                                            'click',
                                            () => void onClick(),
                                        );
                                        return btn;
                                    },
                                );
                            },
                        },
                    },
                },
            });

            const paymentsApi = makePaymentsApiMock();
            const api = createWalletsApi(
                makeHttpClient() as never,
                () => paymentsApi as never,
            );

            const ctrl = await api.mountGooglePayButton(container);

            // Trigger the cancel path by simulating a button click
            // biome-ignore lint/style/noNonNullAssertion: set by createButton during mountGooglePayButton
            await capturedOnClick!().catch(() => {});
            await ctrl.result.catch(() => {});
            ctrl.unmount();

            expect(container.children.length).toBe(containerChildrenBefore);
        }
    });

    // -------------------------------------------------------------------------
    // activeGoogleCleanup resets after result settles
    // -------------------------------------------------------------------------

    it('activeGoogleCleanup resets after result settles, allowing re-mount', async () => {
        for (let i = 0; i < 50; i++) {
            let capturedOnClick: (() => Promise<void>) | undefined;
            vi.stubGlobal('window', {
                ...window,
                ...makeGoogleGlobal((fn) => {
                    capturedOnClick = fn;
                }),
            });

            const api = createWalletsApi(
                makeHttpClient() as never,
                () => makePaymentsApiMock() as never,
            );

            const ctrl = await api.mountGooglePayButton(container);
            // biome-ignore lint/style/noNonNullAssertion: set by makeGoogleGlobal during mount
            await capturedOnClick!();
            await ctrl.result;

            // After result settles, the same api instance can mount again
            let capturedOnClick2: (() => Promise<void>) | undefined;
            vi.stubGlobal('window', {
                ...window,
                ...makeGoogleGlobal((fn) => {
                    capturedOnClick2 = fn;
                }),
            });

            const ctrl2 = await api.mountGooglePayButton(container);
            ctrl2.result.catch(() => {});
            ctrl2.unmount();
            void capturedOnClick2;
        }
    });
});
