import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalletsApi } from '../../src/modules/wallets/wallets.module.js';
import { makeHttpClient, makePaymentsApiMock } from './_helpers.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — mirrors the wallets unit test pattern
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
// Apple Pay session mock factory
// ---------------------------------------------------------------------------

function makeApplePaySessionClass() {
    let lastSession: {
        onvalidatemerchant: ((e: unknown) => void) | null;
        oncancel: ((e: unknown) => void) | null;
        onpaymentauthorized: ((e: unknown) => void) | null;
        completeMerchantValidation: ReturnType<typeof vi.fn>;
        completePayment: ReturnType<typeof vi.fn>;
        abort: ReturnType<typeof vi.fn>;
        begin: ReturnType<typeof vi.fn>;
    } | null = null;

    class MockApplePaySession {
        static canMakePayments = vi.fn<() => boolean>(() => true);
        static STATUS_SUCCESS = 0;
        static STATUS_FAILURE = 1;

        onvalidatemerchant = null as ((e: unknown) => void) | null;
        oncancel = null as ((e: unknown) => void) | null;
        onpaymentauthorized = null as ((e: unknown) => void) | null;
        completeMerchantValidation = vi.fn();
        completePayment = vi.fn();
        abort = vi.fn();
        begin = vi.fn();

        constructor(..._args: unknown[]) {
            // biome-ignore lint/suspicious/noExplicitAny: test-only capture
            lastSession = this as any;
        }
    }

    return {
        MockApplePaySession,
        getLastSession: () => lastSession,
    };
}

const validApplePaymentData = {
    data: 'V7Oc==',
    signature: 'MIAGCSqGSIb3==',
    version: 'EC_v1',
    header: {
        ephemeralPublicKey: 'MFkw==',
        publicKeyHash: 'hash==',
        transactionId: 'txn123',
    },
};

const ITERATIONS = 200;

describe('mountApplePayButton — stress / leak detection', () => {
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
    // Happy path: button click → payment authorized → charge succeeds
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× mount → click → authorize → no DOM leak`, async () => {
        const { MockApplePaySession, getLastSession } =
            makeApplePaySessionClass();
        vi.stubGlobal('ApplePaySession', MockApplePaySession);

        const containerChildrenBefore = container.children.length;

        for (let i = 0; i < ITERATIONS; i++) {
            const paymentsApi = makePaymentsApiMock();
            const client = makeHttpClient();
            const api = createWalletsApi(
                client as never,
                () => paymentsApi as never,
            );

            const ctrl = await api.mountApplePayButton(container);

            // Click the button to start the Apple Pay session
            const btn = container.querySelector(
                'apple-pay-button',
            ) as HTMLElement;
            expect(btn).not.toBeNull();
            btn.click();

            // Simulate payment authorized event
            // biome-ignore lint/style/noNonNullAssertion: session is guaranteed after button click
            const session = getLastSession()!;
            await session.onpaymentauthorized?.({
                payment: { token: { paymentData: validApplePaymentData } },
            });

            await ctrl.result;

            // Container should be clean after charge completes
            expect(container.children.length).toBe(containerChildrenBefore);
        }

        // No apple-pay-button elements should be left in the container
        expect(container.querySelectorAll('apple-pay-button').length).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Cancellation path: unmount() before button is clicked
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× mount → unmount → container is clean`, async () => {
        const { MockApplePaySession } = makeApplePaySessionClass();
        vi.stubGlobal('ApplePaySession', MockApplePaySession);

        const containerChildrenBefore = container.children.length;

        for (let i = 0; i < ITERATIONS; i++) {
            const paymentsApi = makePaymentsApiMock();
            const client = makeHttpClient();
            const api = createWalletsApi(
                client as never,
                () => paymentsApi as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});
            ctrl.unmount();

            expect(container.children.length).toBe(containerChildrenBefore);
        }

        expect(container.querySelectorAll('apple-pay-button').length).toBe(0);
    });

    // -------------------------------------------------------------------------
    // activeAppleCleanup singleton: re-mount after previous result settles
    // -------------------------------------------------------------------------

    it('activeAppleCleanup resets after result settles, allowing re-mount', async () => {
        const { MockApplePaySession, getLastSession } =
            makeApplePaySessionClass();
        vi.stubGlobal('ApplePaySession', MockApplePaySession);

        const client = makeHttpClient();

        // Each iteration creates a fresh walletsApi instance (fresh closure),
        // so activeAppleCleanup doesn't persist across iterations.
        // This verifies result-settlement clears the active cleanup flag.
        for (let i = 0; i < 50; i++) {
            const paymentsApi = makePaymentsApiMock();
            const api = createWalletsApi(
                client as never,
                () => paymentsApi as never,
            );

            const ctrl = await api.mountApplePayButton(container);

            const btn = container.querySelector(
                'apple-pay-button',
            ) as HTMLElement;
            btn.click();
            // biome-ignore lint/style/noNonNullAssertion: session is guaranteed after button click
            const session = getLastSession()!;
            await session.onpaymentauthorized?.({
                payment: { token: { paymentData: validApplePaymentData } },
            });
            await ctrl.result;

            // After result settles, mounting again on the same api should work
            // (activeAppleCleanup was set to undefined by resolveResult)
            const ctrl2 = await api.mountApplePayButton(container);
            ctrl2.result.catch(() => {});
            ctrl2.unmount();
        }
    });

    // -------------------------------------------------------------------------
    // loadScriptOnce: called on every mount (caching is inside load-script.ts,
    // not visible here since it's mocked), but we verify the mock was reached
    // -------------------------------------------------------------------------

    it('loadScriptOnce is called every mount (caching responsibility is in load-script.ts)', async () => {
        const { MockApplePaySession } = makeApplePaySessionClass();
        vi.stubGlobal('ApplePaySession', MockApplePaySession);

        const callsBefore = mockLoadScriptOnce.mock.calls.length;
        const MOUNTS = 10;

        for (let i = 0; i < MOUNTS; i++) {
            const api = createWalletsApi(
                makeHttpClient() as never,
                () => makePaymentsApiMock() as never,
            );
            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});
            ctrl.unmount();
        }

        // wallets.module.ts calls loadScriptOnce on each mount —
        // the real load-script.ts deduplicates, but the mock does not
        expect(mockLoadScriptOnce.mock.calls.length - callsBefore).toBe(MOUNTS);
    });
});
