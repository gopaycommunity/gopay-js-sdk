import { createHttpClient } from '@gopay-internal/core';
import { expect, vi } from 'vitest';

export const CARD_FORM_URL = 'https://test.gopay.com/card-form';
export const CARD_FORM_ORIGIN = 'https://test.gopay.com';

export function makeHttpClient() {
    const c = createHttpClient({
        baseUrl: 'https://example.com',
        shareableKey: 'pk_test',
    });
    c.setClientId('cid_test');
    return c;
}

export function makeResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

export function makeCardFormFetchMock() {
    return vi
        .fn()
        .mockResolvedValue(makeResponse({ card_form_url: CARD_FORM_URL }));
}

export function simulateCardEncryptResult(
    iframe: HTMLIFrameElement,
    token = 'tok_test',
) {
    window.dispatchEvent(
        new MessageEvent('message', {
            data: { type: 'GOPAY_CARD_ENCRYPT_RESULT', card_token: token },
            source: iframe.contentWindow,
            origin: CARD_FORM_ORIGIN,
        }),
    );
}

export function makePaymentsApiMock(overrides?: Record<string, unknown>) {
    return {
        getApplePayInfo: vi.fn().mockResolvedValue({
            applepayVersion: 3,
            applePayPaymentRequest: {
                supportedNetworks: ['visa', 'masterCard'],
                countryCode: 'CZ',
                currencyCode: 'CZK',
                total: { label: 'GoPay', amount: '10.00', type: 'final' },
            },
        }),
        getGooglePayInfo: vi.fn().mockResolvedValue({
            environment: 'TEST',
            paymentDataRequest: {
                apiVersion: 2,
                apiVersionMinor: 0,
                allowedPaymentMethods: [],
                transactionInfo: {
                    currencyCode: 'CZK',
                    totalPriceStatus: 'FINAL',
                    totalPrice: '10.00',
                },
                merchantInfo: { merchantName: 'GoPay' },
            },
        }),
        chargePayment: vi.fn().mockResolvedValue({}),
        awaitChargeState: vi.fn().mockResolvedValue({
            id: 'pay_001',
            state: 'SUCCEEDED',
            payment_instrument: { payment_instrument: 'PAYMENT_CARD' },
            return_url: 'https://example.com/return',
        }),
        startApplePaySession: vi.fn().mockImplementation(
            (
                session: {
                    oncancel: ((e: unknown) => void) | null;
                    begin: () => void;
                },
                callbacks?: { oncancel?: (e: unknown) => void },
            ) => {
                session.oncancel = (e: unknown) => callbacks?.oncancel?.(e);
                session.begin();
            },
        ),
        ...overrides,
    };
}

/**
 * Spy on window.addEventListener / removeEventListener, capture a baseline,
 * then assert the net count (adds − removes) since the baseline is zero.
 *
 * Call `capture()` right before the section under test; call `assertNetZero()`
 * when done.
 */
export function trackWindowListeners() {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    let baselineAdds = 0;
    let baselineRemoves = 0;

    return {
        capture() {
            baselineAdds = addSpy.mock.calls.length;
            baselineRemoves = removeSpy.mock.calls.length;
        },
        assertNetZero(label = 'window listener leak') {
            const deltaAdds = addSpy.mock.calls.length - baselineAdds;
            const deltaRemoves = removeSpy.mock.calls.length - baselineRemoves;
            expect(deltaAdds, `${label}: add count`).toBeGreaterThan(0);
            expect(deltaAdds, label).toBe(deltaRemoves);
        },
        delta() {
            return {
                adds: addSpy.mock.calls.length - baselineAdds,
                removes: removeSpy.mock.calls.length - baselineRemoves,
            };
        },
    };
}
