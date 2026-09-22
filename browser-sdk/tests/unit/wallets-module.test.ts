import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createWalletsApi } from '../../src/modules/wallets/wallets.module.js';

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
// Fixtures
// ---------------------------------------------------------------------------

function makeApplePayInfo() {
    return {
        applepayVersion: 3,
        applePayPaymentRequest: {
            supportedNetworks: ['visa', 'masterCard'],
            countryCode: 'CZ',
            currencyCode: 'CZK',
            total: { label: 'GoPay', amount: '10.00', type: 'final' },
        },
    };
}

function makeGooglePayInfo() {
    return {
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
    };
}

const mockChargeState = {
    id: 'pay_001',
    state: 'SUCCEEDED',
    payment_instrument: { payment_instrument: 'PAYMENT_CARD' },
    return_url: 'https://example.com/return',
};

/**
 * `!` needs a `biome-ignore` beside it, and CLAUDE.md does not allow one. This
 * also says more when it fires: `!` on a missing element throws "cannot read
 * click of null" a line later, while this names what was not there.
 */
function must<T>(value: T | null | undefined, what: string): T {
    if (value === null || value === undefined) {
        throw new Error(`[test] expected ${what} to be present`);
    }
    return value;
}

function makePaymentsApi(overrides?: Record<string, unknown>) {
    return {
        getApplePayInfo: vi.fn().mockResolvedValue(makeApplePayInfo()),
        getGooglePayInfo: vi.fn().mockResolvedValue(makeGooglePayInfo()),
        chargePayment: vi.fn().mockResolvedValue({}),
        awaitChargeState: vi.fn().mockResolvedValue(mockChargeState),
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

function makeClient() {
    return {
        emitError: vi.fn((e: unknown) => {
            throw e;
        }),
        // Wallet failures are delivered by rejecting `result` rather than by
        // throwing, so this — not emitError — is the call that carries them to
        // onError.
        reportError: vi.fn<(error: unknown) => void>(),
    };
}

function makeTelemetry() {
    return {
        apiCall: vi.fn(),
        error: vi.fn(),
        lifecycle: vi.fn(),
        submit: vi.fn(),
        walletUnavailable: vi.fn(),
        integratorError: vi.fn(),
    };
}

/**
 * Restated rather than imported: the module does not export it, and a test that
 * quietly followed a change to it would stop testing the URL the CSP watcher is
 * actually scoped to.
 */
const APPLE_PAY_SCRIPT_SRC =
    'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js';

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

const validGoogleTokenData = JSON.stringify({
    protocolVersion: 'ECv2',
    signature: 'sig==',
    signedMessage: '{"encryptedMessage":"enc=="}',
});

// ---------------------------------------------------------------------------
// Apple Pay
// ---------------------------------------------------------------------------

describe('mountApplePayButton()', () => {
    let container: HTMLDivElement;

    // Outer vars updated by the mock class constructor on each instantiation
    let lastSession: {
        onvalidatemerchant: ((e: unknown) => void) | null;
        oncancel: ((e: unknown) => void) | null;
        onpaymentauthorized: ((e: unknown) => void) | null;
        completeMerchantValidation: ReturnType<typeof vi.fn>;
        completePayment: ReturnType<typeof vi.fn>;
        abort: ReturnType<typeof vi.fn>;
        begin: ReturnType<typeof vi.fn>;
    };
    let applePayCtorArgs: unknown[][];

    // Class defined inside describe so it closes over lastSession and applePayCtorArgs.
    // Vitest 4 requires mockImplementation to receive a class (not an arrow fn).
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

        constructor(...args: unknown[]) {
            applePayCtorArgs.push(args);
            // biome-ignore lint/suspicious/noExplicitAny: test-only capture
            lastSession = this as any;
        }
    }

    // The real Apple Pay SDK registers <apple-pay-button>; here loadScriptOnce is
    // mocked, so the registry is stubbed instead. jsdom's own registry is not usable
    // for this — it is append-only, so a test could never go back to "not registered".
    let appleButtonRegistered: boolean;

    function stubCustomElements() {
        vi.stubGlobal('customElements', {
            get: (tag: string) =>
                appleButtonRegistered && tag === 'apple-pay-button'
                    ? class {}
                    : undefined,
            whenDefined: (tag: string) =>
                appleButtonRegistered && tag === 'apple-pay-button'
                    ? Promise.resolve()
                    : // Never settles — mirrors a sub-module that failed to load.
                      new Promise<void>(() => {}),
            define: vi.fn(),
        });
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        applePayCtorArgs = [];
        appleButtonRegistered = true;
        MockApplePaySession.canMakePayments.mockReturnValue(true);
        vi.stubGlobal('ApplePaySession', MockApplePaySession);
        stubCustomElements();
        // Reset call history — these tests assert whether the SDK loaded the script.
        mockLoadScriptOnce.mockReset();
        mockLoadScriptOnce.mockResolvedValue(undefined);
    });

    afterEach(() => {
        container.remove();
        // A leaked tag would make hasApplePayScriptTag() true for later tests.
        for (const el of document.head.querySelectorAll(
            'script[src*="applepay.cdn-apple.com"]',
        )) {
            el.remove();
        }
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('returns PAYMENT_NOT_ATTACHED controller when getPaymentsApi returns null', async () => {
        const client = makeClient();
        const api = createWalletsApi(client as never, () => null);

        const ctrl = await api.mountApplePayButton(container);
        const err = await ctrl.result.catch((e: unknown) => e);

        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        );
    });

    it('PAYMENT_NOT_ATTACHED unmount is a no-op', async () => {
        const client = makeClient();
        const api = createWalletsApi(client as never, () => null);
        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});
        expect(() => ctrl.unmount()).not.toThrow();
    });

    it('returns WALLET_BUTTON_ERROR when script fails to load', async () => {
        // ApplePaySession absent → loadScriptOnce is reached
        vi.stubGlobal('ApplePaySession', undefined);
        mockLoadScriptOnce.mockRejectedValue(new Error('network'));
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        const err = await ctrl.result.catch((e: unknown) => e);

        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('returns WALLET_BUTTON_ERROR when ApplePaySession is not in globalThis', async () => {
        vi.stubGlobal('ApplePaySession', undefined);
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        const err = await ctrl.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('loads the 1.latest Apple Pay SDK build with crossorigin when the button is not registered', async () => {
        appleButtonRegistered = false;
        // Registration lands while the SDK is waiting on whenDefined().
        mockLoadScriptOnce.mockImplementation(() => {
            appleButtonRegistered = true;
            return Promise.resolve();
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(mockLoadScriptOnce).toHaveBeenCalledWith(
            'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js',
            { crossOrigin: 'anonymous' },
        );
    });

    it('skips loading when the button is registered and ApplePaySession is present', async () => {
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(mockLoadScriptOnce).not.toHaveBeenCalled();
    });

    it('loads the SDK when the button is registered but ApplePaySession is missing (host loaded the v1 build)', async () => {
        vi.stubGlobal('ApplePaySession', undefined);
        mockLoadScriptOnce.mockImplementation(() => {
            vi.stubGlobal('ApplePaySession', MockApplePaySession);
            return Promise.resolve();
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(mockLoadScriptOnce).toHaveBeenCalledOnce();
        expect(container.querySelector('apple-pay-button')).not.toBeNull();
    });

    it('waits for whenDefined() when the button registers on a later tick', async () => {
        // The registry stays empty, so get() cannot short-circuit — this is the
        // only test that exercises the whenDefined() resolution path itself.
        let registerButton!: () => void;
        const registered = new Promise<void>((res) => {
            registerButton = res;
        });
        vi.stubGlobal('customElements', {
            get: () => undefined,
            whenDefined: () => registered,
            define: vi.fn(),
        });

        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        let settled = false;
        const pending = api.mountApplePayButton(container).then((c) => {
            settled = true;
            return c;
        });

        await Promise.resolve();
        expect(settled).toBe(false); // still waiting on whenDefined()

        registerButton();
        const ctrl = await pending;
        ctrl.result.catch(() => {});

        expect(container.querySelector('apple-pay-button')).not.toBeNull();
    });

    it('returns WALLET_BUTTON_ERROR when whenDefined() rejects', async () => {
        vi.stubGlobal('customElements', {
            get: () => undefined,
            whenDefined: () => Promise.reject(new SyntaxError('bad tag name')),
            define: vi.fn(),
        });
        const onUnavailable = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container, {
            onUnavailable,
        });
        const err = await ctrl.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
        expect((err as GoPaySDKError).cause).toBeInstanceOf(SyntaxError);
        expect(onUnavailable).toHaveBeenCalledOnce();
    });

    // The `?components=` case is the reason the DOM check matches on prefix rather
    // than equality — an exact match would miss it and inject a second copy.
    it.each([
        [
            'no query',
            'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js',
        ],
        [
            'with ?components=',
            'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js?components=apple-pay-button',
        ],
    ])('does not inject the script when the page already carries the same SDK tag (%s)', async (_label, src) => {
        // Element registered by the host tag, shim not installed yet — so the
        // load is wanted, and only the DOM check suppresses it.
        vi.stubGlobal('ApplePaySession', undefined);
        const tag = document.createElement('script');
        tag.src = src;
        document.head.appendChild(tag);

        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(mockLoadScriptOnce).not.toHaveBeenCalled();
    });

    it('injects the script when the page carries only the older v1 tag', async () => {
        // v1 registers the element but installs no shim, so 1.latest must still load.
        vi.stubGlobal('ApplePaySession', undefined);
        const tag = document.createElement('script');
        tag.src = 'https://applepay.cdn-apple.com/jsapi/v1/apple-pay-sdk.js';
        document.head.appendChild(tag);
        mockLoadScriptOnce.mockImplementation(() => {
            vi.stubGlobal('ApplePaySession', MockApplePaySession);
            return Promise.resolve();
        });

        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(mockLoadScriptOnce).toHaveBeenCalledOnce();
    });

    it('calls onUnavailable when the script fails to load', async () => {
        vi.stubGlobal('ApplePaySession', undefined);
        appleButtonRegistered = false;
        mockLoadScriptOnce.mockRejectedValue(new Error('blocked'));
        const onUnavailable = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container, {
            onUnavailable,
        });
        await ctrl.result.catch(() => {});

        expect(onUnavailable).toHaveBeenCalledOnce();
    });

    it('calls onUnavailable when the button is never registered', async () => {
        vi.useFakeTimers();
        appleButtonRegistered = false;
        const onUnavailable = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const pending = api.mountApplePayButton(container, { onUnavailable });
        await vi.advanceTimersByTimeAsync(10_000);
        const ctrl = await pending;
        await ctrl.result.catch(() => {});

        expect(onUnavailable).toHaveBeenCalledOnce();
    });

    it('returns WALLET_BUTTON_ERROR when the button is never registered after the script loads', async () => {
        vi.useFakeTimers();
        appleButtonRegistered = false; // whenDefined() never settles
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const pending = api.mountApplePayButton(container);
        await vi.advanceTimersByTimeAsync(10_000);
        const ctrl = await pending;
        const err = await ctrl.result.catch((e: unknown) => e);

        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('rejects with WALLET_BUTTON_ERROR when the ApplePaySession constructor throws', async () => {
        // The non-Safari shim validates the payment request and throws TypeError.
        class ThrowingApplePaySession {
            static canMakePayments = () => true;
            static STATUS_SUCCESS = 0;
            static STATUS_FAILURE = 1;
            constructor() {
                throw new TypeError(
                    'Member ApplePayPaymentRequest.merchantCapabilities is required',
                );
            }
        }
        vi.stubGlobal('ApplePaySession', ThrowingApplePaySession);
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();

        const err = await ctrl.result.catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
        expect((err as GoPaySDKError).cause).toBeInstanceOf(TypeError);
    });

    it('calls onUnavailable and returns WALLET_BUTTON_ERROR when canMakePayments is false', async () => {
        MockApplePaySession.canMakePayments.mockReturnValue(false);
        const onUnavailable = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container, {
            onUnavailable,
        });
        const err = await ctrl.result.catch((e: unknown) => e);

        expect(onUnavailable).toHaveBeenCalledOnce();
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('rejects result when getApplePayInfo throws', async () => {
        const apiError = new Error('API failure');
        const paymentsApi = makePaymentsApi({
            getApplePayInfo: vi.fn().mockRejectedValue(apiError),
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        const err = await ctrl.result.catch((e: unknown) => e);

        expect(err).toBe(apiError);
    });

    it('appends an apple-pay-button element to the container', async () => {
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(container.querySelector('apple-pay-button')).not.toBeNull();
    });

    it('sets default buttonstyle=black and type=buy attributes', async () => {
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        await api.mountApplePayButton(container);

        expect(
            container
                .querySelector('apple-pay-button')
                ?.getAttribute('buttonstyle'),
        ).toBe('black');
        expect(
            container.querySelector('apple-pay-button')?.getAttribute('type'),
        ).toBe('buy');
    });

    it('forwards appleButtonOptions attributes', async () => {
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        await api.mountApplePayButton(container, {
            appleButtonOptions: {
                buttonstyle: 'white',
                type: 'check-out',
                locale: 'cs-CZ',
            },
        });

        expect(
            container
                .querySelector('apple-pay-button')
                ?.getAttribute('buttonstyle'),
        ).toBe('white');
        expect(
            container.querySelector('apple-pay-button')?.getAttribute('type'),
        ).toBe('check-out');
        expect(
            container.querySelector('apple-pay-button')?.getAttribute('locale'),
        ).toBe('cs-CZ');
    });

    it('creates ApplePaySession with version and request from getApplePayInfo on click', async () => {
        const info = { ...makeApplePayInfo(), applepayVersion: 6 };
        const paymentsApi = makePaymentsApi({
            getApplePayInfo: vi.fn().mockResolvedValue(info),
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();

        expect(applePayCtorArgs).toHaveLength(1);
        expect(applePayCtorArgs[0]).toEqual([6, info.applePayPaymentRequest]);
    });

    it('resolves result when onpaymentauthorized fires with valid data', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();

        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing handler should hard-fail, not silently no-op via ?.
        lastSession.onpaymentauthorized!({
            payment: { token: { paymentData: validApplePaymentData } },
        });

        const result = await ctrl.result;

        expect(paymentsApi.chargePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                payment_instrument: expect.objectContaining({
                    input: expect.objectContaining({ input_type: 'APPLE_PAY' }),
                }),
            }),
            // the wallet controller's abort must reach the charge itself
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(result).toEqual(mockChargeState);
    });

    it('reports the authorisation as a submit, ahead of the charge', async () => {
        // The wallet sheet is as opaque as the card form iframe: the customer
        // authorising is the one moment the SDK sees. Without it a dismissed
        // sheet and a charge that never fired are the same absence.
        const telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
        };
        const paymentsApi = makePaymentsApi();
        const api = createWalletsApi(
            makeClient() as never,
            () => paymentsApi as never,
            telemetry as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        must(
            container.querySelector<HTMLElement>('apple-pay-button'),
            'the apple-pay-button element',
        ).click();
        must(
            lastSession.onpaymentauthorized,
            'the onpaymentauthorized handler',
        )({
            payment: { token: { paymentData: validApplePaymentData } },
        });
        await ctrl.result;

        expect(telemetry.submit).toHaveBeenCalledWith('applepay-button', {
            paymentMethod: 'applepay',
        });
        // Nothing from the wallet token may travel with it.
        expect(JSON.stringify(telemetry.submit.mock.calls)).not.toContain(
            'APPLE_PAY',
        );
    });

    it('calls completePayment(STATUS_SUCCESS) on successful authorisation', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing handler should hard-fail, not silently no-op via ?.
        lastSession.onpaymentauthorized!({
            payment: { token: { paymentData: validApplePaymentData } },
        });

        await vi.waitFor(() =>
            expect(lastSession.completePayment).toHaveBeenCalledWith(0),
        );
    });

    it('rejects with WALLET_BUTTON_ERROR when paymentData is missing from authorisation event', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing handler should hard-fail, not silently no-op via ?.
        lastSession.onpaymentauthorized!({ payment: { token: {} } });

        const err = await ctrl.result.catch((e: unknown) => e);

        expect(lastSession.completePayment).toHaveBeenCalledWith(1);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('fires onCancel when the Apple Pay session is cancelled', async () => {
        const onCancel = vi.fn();
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        await api.mountApplePayButton(container, { onCancel });
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        lastSession.oncancel?.({});

        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('unmount() rejects result and calls client.emitError when not yet settled', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.unmount();

        const err = await ctrl.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
        expect(client.emitError).toHaveBeenCalledOnce();
    });

    it('unmount() is a no-op when result is already settled', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing handler should hard-fail, not silently no-op via ?.
        lastSession.onpaymentauthorized!({
            payment: { token: { paymentData: validApplePaymentData } },
        });
        await ctrl.result;

        expect(() => ctrl.unmount()).not.toThrow();
        expect(client.emitError).not.toHaveBeenCalled();
    });

    it('second mountApplePayButton call while active rejects the new call, leaves the first alive', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const first = await api.mountApplePayButton(container);
        first.result.catch(() => {});

        const second = await api.mountApplePayButton(container);
        const err = await second.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
        // First controller is still live — its button is still in the container
        expect(container.querySelector('apple-pay-button')).not.toBeNull();
    });

    it('uses default version 3 and empty payment request when applepayVersion and applePayPaymentRequest are absent', async () => {
        const paymentsApi = makePaymentsApi({
            getApplePayInfo: vi.fn().mockResolvedValue({}),
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();

        expect(applePayCtorArgs[0]).toEqual([3, {}]);
    });

    it('falls back to en-US locale when no appleButtonOptions.locale and navigator.language is absent', async () => {
        vi.stubGlobal('navigator', { language: null });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        await api.mountApplePayButton(container);

        expect(
            container.querySelector('apple-pay-button')?.getAttribute('locale'),
        ).toBe('en-US');
    });

    it('rejects with WALLET_BUTTON_ERROR when onpaymentauthorized fires without a payment key', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing handler should hard-fail, not silently no-op via ?.
        lastSession.onpaymentauthorized!('not-an-object');

        const err = await ctrl.result.catch((e: unknown) => e);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('rejects result when awaitChargeState throws during the Apple Pay charge flow', async () => {
        const chargeError = new Error('charge flow failed');
        const paymentsApi = makePaymentsApi({
            awaitChargeState: vi.fn().mockRejectedValue(chargeError),
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing handler should hard-fail, not silently no-op via ?.
        lastSession.onpaymentauthorized!({
            payment: { token: { paymentData: validApplePaymentData } },
        });

        const err = await ctrl.result.catch((e: unknown) => e);
        expect(err).toBe(chargeError);
    });

    it('removes spinner and forwards onStateChange when ACTION_REQUIRED fires with redirect_url in Apple Pay flow', async () => {
        const paymentsApi = makePaymentsApi({
            awaitChargeState: vi
                .fn()
                .mockImplementation(
                    async (opts: { onStateChange?: (s: unknown) => void }) => {
                        opts.onStateChange?.({
                            state: 'ACTION_REQUIRED',
                            action: { redirect_url: 'https://3ds.example.com' },
                        });
                        return mockChargeState;
                    },
                ),
        });
        const onStateChange = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container, {
            awaitOptions: { onStateChange },
        });
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing handler should hard-fail, not silently no-op via ?.
        lastSession.onpaymentauthorized!({
            payment: { token: { paymentData: validApplePaymentData } },
        });

        await ctrl.result;
        expect(onStateChange).toHaveBeenCalledWith(
            expect.objectContaining({ state: 'ACTION_REQUIRED' }),
        );
    });

    it('clicking the apple-pay-button after unmount is a no-op', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        // Keep reference to the button before unmount removes it from the container.
        const btn = container.querySelector<HTMLElement>('apple-pay-button');
        expect(btn).not.toBeNull();
        ctrl.unmount();

        // Invoke onclick directly — active is false so it returns immediately.
        // biome-ignore lint/suspicious/noExplicitAny: test-only invocation
        (btn as any)?.onclick?.();

        await new Promise((r) => setTimeout(r, 0));
        expect(paymentsApi.chargePayment).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Error reporting (GPOMA-2647)
    //
    // Every failure below leaves by rejecting `result`, never by throwing, so
    // onError sees it only if the module hands it over explicitly.
    // -----------------------------------------------------------------------

    it('reports PAYMENT_NOT_ATTACHED to onError', async () => {
        const client = makeClient();
        const api = createWalletsApi(client as never, () => null);

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
            }),
        );
    });

    it('reports a failed Apple Pay SDK script load to onError', async () => {
        vi.stubGlobal('ApplePaySession', undefined);
        mockLoadScriptOnce.mockRejectedValue(new Error('network'));
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('Apple Pay is not available'),
            }),
        );
    });

    it('reports the unavailable wallet even when onUnavailable throws', async () => {
        // onUnavailable is the one integrator callback the SDK is guaranteed
        // to invoke on this path, and it runs ahead of both the telemetry and
        // the reportError. A merchant whose fallback UI throws would take out
        // the very event added to explain why their button never drew.
        vi.useFakeTimers();
        MockApplePaySession.canMakePayments.mockReturnValue(false);
        const telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            walletUnavailable: vi.fn(),
            integratorError: vi.fn(),
        };
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountApplePayButton(container, {
            onUnavailable: () => {
                throw new TypeError('their fallback UI is broken');
            },
        });
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalled();
        expect(client.reportError).toHaveBeenCalled();
        expect(telemetry.integratorError).toHaveBeenCalledWith(
            'onUnavailable',
            'TypeError',
        );
        vi.useRealTimers();
    });

    it('names Apple Pay and the reason when the device gate turns it away', async () => {
        // The whole point of the reason code: "a wallet was unavailable" is
        // not an answer anyone can act on, and the sentence this replaces was
        // emitted verbatim by both wallets.
        MockApplePaySession.canMakePayments.mockReturnValue(false);
        const telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            walletUnavailable: vi.fn(),
        };
        const api = createWalletsApi(
            makeClient() as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentMethod: 'applepay',
                reason: 'unsupported-device',
            }),
        );
    });

    it('blames the library, not the device, when ApplePaySession never installed', async () => {
        // The script can register the button and still leave no
        // ApplePaySession — the older v1 build does exactly that. Filing it
        // under unsupported-device would blame the shopper's phone for a
        // script that did not finish loading, and they can do nothing about
        // the former.
        vi.stubGlobal('ApplePaySession', undefined);
        const telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            walletUnavailable: vi.fn(),
            integratorError: vi.fn(),
        };
        const api = createWalletsApi(
            makeClient() as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentMethod: 'applepay',
                reason: 'library-missing',
            }),
        );
    });

    it('carries the mobile flag that a DevTools device toolbar flips', async () => {
        // There is no way to detect the toolbar itself. What is detectable is
        // the flag it sets, which is the input Apple's non-Safari shim reads
        // to turn the page away — so an internal repro stops reading as a
        // shopper-facing outage.
        Object.defineProperty(globalThis.navigator, 'userAgentData', {
            value: { mobile: true },
            configurable: true,
        });
        MockApplePaySession.canMakePayments.mockReturnValue(false);
        const telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            walletUnavailable: vi.fn(),
        };
        const api = createWalletsApi(
            makeClient() as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
            expect.objectContaining({
                capabilities: expect.objectContaining({ ua_mobile: true }),
            }),
        );

        Reflect.deleteProperty(globalThis.navigator, 'userAgentData');
    });

    it('separates a policy refusal from an ad-blocker, and says what to allow', async () => {
        // The two are the same bare error on the script tag — a browser says
        // nothing more about a cross-origin load it refused — so this is the
        // one cause the data could never attribute. The violation is
        // dispatched while the element is being blocked, ahead of the error
        // that rejects the load, which is what makes reading it here sound.
        vi.stubGlobal('ApplePaySession', undefined);
        appleButtonRegistered = false;
        mockLoadScriptOnce.mockImplementation(() => {
            document.dispatchEvent(
                Object.assign(new Event('securitypolicyviolation'), {
                    blockedURI: APPLE_PAY_SCRIPT_SRC,
                    effectiveDirective: 'script-src-elem',
                }),
            );
            return Promise.reject(new Error('blocked'));
        });
        const telemetry = makeTelemetry();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentMethod: 'applepay',
                reason: 'script-blocked-csp',
                capabilities: expect.objectContaining({
                    csp_directive: 'script-src-elem',
                }),
            }),
        );
        // The remedy, not just the diagnosis: this is the one cause the
        // integrator can fix outright, and it reaches their own monitoring
        // through onError.
        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining(
                    'allow https://applepay.cdn-apple.com in script-src-elem',
                ),
            }),
        );
    });

    it('stays script-blocked when no policy refusal was reported', async () => {
        // The absence of the violation is the evidence for the other two
        // causes. Reporting a CSP here would send the merchant to look at a
        // policy that is not the problem.
        vi.stubGlobal('ApplePaySession', undefined);
        appleButtonRegistered = false;
        mockLoadScriptOnce.mockRejectedValue(new Error('blocked'));
        const telemetry = makeTelemetry();
        const api = createWalletsApi(
            makeClient() as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
            expect.objectContaining({ reason: 'script-blocked' }),
        );
    });

    it('ignores a policy refusal of somebody else’s script', async () => {
        // A merchant page with violations of its own is ordinary. Counting
        // them would turn every ad-blocked wallet script into a CSP report —
        // the exact confusion this exists to end.
        vi.stubGlobal('ApplePaySession', undefined);
        appleButtonRegistered = false;
        mockLoadScriptOnce.mockImplementation(() => {
            document.dispatchEvent(
                Object.assign(new Event('securitypolicyviolation'), {
                    blockedURI: 'https://analytics.example.com/tag.js',
                    effectiveDirective: 'script-src-elem',
                }),
            );
            return Promise.reject(new Error('blocked'));
        });
        const telemetry = makeTelemetry();
        const api = createWalletsApi(
            makeClient() as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
            expect.objectContaining({ reason: 'script-blocked' }),
        );
    });

    it('stops listening for violations once the script has settled', async () => {
        // The window is kept as narrow as the load itself; a violation from
        // anything else on the page afterwards is none of this SDK's business.
        const removeListener = vi.spyOn(document, 'removeEventListener');
        vi.stubGlobal('ApplePaySession', undefined);
        appleButtonRegistered = false;
        mockLoadScriptOnce.mockRejectedValue(new Error('blocked'));
        const api = createWalletsApi(
            makeClient() as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(removeListener).toHaveBeenCalledWith(
            'securitypolicyviolation',
            expect.any(Function),
        );
    });

    it('reports the unavailable-device guard to onError', async () => {
        MockApplePaySession.canMakePayments.mockReturnValue(false);
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        ctrl.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
                message: expect.stringContaining('not available'),
            }),
        );
    });

    it('reports the already-active guard to onError', async () => {
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const first = await api.mountApplePayButton(container);
        first.result.catch(() => {});
        const second = await api.mountApplePayButton(container);
        second.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('already active'),
            }),
        );
    });

    it('reports a charge-flow failure to onError through rejectResult', async () => {
        const chargeError = new Error('charge flow failed');
        const paymentsApi = makePaymentsApi({
            awaitChargeState: vi.fn().mockRejectedValue(chargeError),
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing handler should hard-fail, not silently no-op via ?.
        lastSession.onpaymentauthorized!({
            payment: { token: { paymentData: validApplePaymentData } },
        });
        await ctrl.result.catch(() => {});

        // Reported as a named wallet failure rather than raw: an unnamed
        // error is one core can only call SDK.UNKNOWN, and `reportError`
        // used to drop it entirely. The original stays on `cause`, and
        // `result` still rejects with it — only reporting changed.
        const reported = client.reportError.mock.calls[0]?.[0] as GoPaySDKError;
        expect(reported).toBeInstanceOf(GoPaySDKError);
        expect(reported.errorCode).toBe(GoPayErrorCodes.WALLET_BUTTON_ERROR);
        expect(reported.cause).toBe(chargeError);
    });

    it('reports missing payment data in the authorisation event to onError', async () => {
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountApplePayButton(container);
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing element should hard-fail, not silently no-op via ?.
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        // biome-ignore lint/style/noNonNullAssertion: tests should fail fast — missing handler should hard-fail, not silently no-op via ?.
        lastSession.onpaymentauthorized!('not-an-object');
        await ctrl.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
            }),
        );
    });

    describe('getApplePayAvailability()', () => {
        const makeTelemetry = () => ({
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            walletUnavailable: vi.fn(),
            integratorError: vi.fn(),
        });

        it('answers without an attached payment, which is the whole point', async () => {
            // It is called to decide whether to render an Apple Pay option at
            // all — before a payment exists, let alone is attached.
            const api = createWalletsApi(makeClient() as never, () => null);

            await expect(api.getApplePayAvailability()).resolves.toEqual({
                available: true,
            });
        });

        it('refuses an Android phone without fetching Apple’s script', async () => {
            // The case this exists for. A Chromium reporting itself as mobile with
            // no ApplePaySession is an Android phone, and Apple's shim would only
            // be fetched to say the same thing — so 58 kB and a round trip are
            // skipped and the method list can render immediately.
            vi.stubGlobal('ApplePaySession', undefined);
            vi.stubGlobal('navigator', {
                ...navigator,
                userAgentData: { mobile: true },
            });
            const api = createWalletsApi(makeClient() as never, () => null);

            await expect(api.getApplePayAvailability()).resolves.toEqual({
                available: false,
                reason: 'unsupported-device',
            });
            expect(mockLoadScriptOnce).not.toHaveBeenCalled();
        });

        it('answers from Safari’s built-in session without fetching anything', async () => {
            const api = createWalletsApi(makeClient() as never, () => null);

            await expect(api.getApplePayAvailability()).resolves.toEqual({
                available: true,
            });
            expect(mockLoadScriptOnce).not.toHaveBeenCalled();
        });

        it('does not guess on a desktop browser — it loads and asks', async () => {
            // userAgentData is Chromium-only, so Safari and Firefox report
            // nothing here. The shortcut is narrow on purpose: they fall through
            // to the honest path rather than being guessed about.
            vi.stubGlobal('ApplePaySession', undefined);
            vi.stubGlobal('navigator', {
                ...navigator,
                userAgentData: undefined,
            });
            const api = createWalletsApi(makeClient() as never, () => null);

            const result = await api.getApplePayAvailability();

            expect(mockLoadScriptOnce).toHaveBeenCalled();
            // The mocked script installs nothing, so the library is missing —
            // which is a different answer from "this device cannot".
            expect(result).toEqual({
                available: false,
                reason: 'library-missing',
            });
        });

        it('reports the device gate turning it away', async () => {
            MockApplePaySession.canMakePayments.mockReturnValue(false);
            const api = createWalletsApi(makeClient() as never, () => null);

            await expect(api.getApplePayAvailability()).resolves.toEqual({
                available: false,
                reason: 'unsupported-device',
            });
        });

        it('separates a policy refusal from an ad-blocker, same as the mount', async () => {
            vi.stubGlobal('ApplePaySession', undefined);
            vi.stubGlobal('navigator', {
                ...navigator,
                userAgentData: undefined,
            });
            mockLoadScriptOnce.mockRejectedValue(new Error('blocked'));
            const api = createWalletsApi(makeClient() as never, () => null);

            await expect(api.getApplePayAvailability()).resolves.toEqual({
                available: false,
                reason: 'script-blocked',
            });
        });

        it('reports the negative to telemetry but never as an error', async () => {
            MockApplePaySession.canMakePayments.mockReturnValue(false);
            const telemetry = makeTelemetry();
            const client = makeClient();
            const api = createWalletsApi(
                client as never,
                () => null,
                telemetry as never,
            );

            await api.getApplePayAvailability();

            expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
                expect.objectContaining({
                    paymentMethod: 'applepay',
                    reason: 'unsupported-device',
                }),
            );
            // The caller asked a question and got an answer. An answer is not a
            // failure, so onError must stay clean.
            expect(client.reportError).not.toHaveBeenCalled();
        });

        it('stays silent when the answer is yes', async () => {
            const telemetry = makeTelemetry();
            const api = createWalletsApi(
                makeClient() as never,
                () => null,
                telemetry as never,
            );

            await api.getApplePayAvailability();

            expect(telemetry.walletUnavailable).not.toHaveBeenCalled();
        });
    });
});

// ---------------------------------------------------------------------------
// Google Pay
// ---------------------------------------------------------------------------

describe('mountGooglePayButton()', () => {
    let container: HTMLDivElement;
    let capturedOnClick: (() => Promise<void>) | undefined;

    // Outer vars referenced by the mock class — must be set before each test
    let mockIsReadyToPay: ReturnType<typeof vi.fn>;
    let mockLoadPaymentData: ReturnType<typeof vi.fn>;
    let mockCreateButton: ReturnType<typeof vi.fn>;

    // Class defined inside describe to close over the outer mock fns.
    // Vitest 4 requires mockImplementation to receive a class.
    class MockPaymentsClient {
        isReadyToPay = mockIsReadyToPay;
        loadPaymentData = mockLoadPaymentData;
        createButton = mockCreateButton;
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        capturedOnClick = undefined;

        mockIsReadyToPay = vi.fn().mockResolvedValue({ result: true });
        mockLoadPaymentData = vi.fn().mockResolvedValue({
            paymentMethodData: {
                tokenizationData: { token: validGoogleTokenData },
            },
        });
        mockCreateButton = vi
            .fn()
            .mockImplementation((opts: { onClick?: () => Promise<void> }) => {
                capturedOnClick = opts.onClick;
                return document.createElement('button');
            });

        vi.stubGlobal('google', {
            payments: {
                api: { PaymentsClient: MockPaymentsClient },
            },
        });
        mockLoadScriptOnce.mockResolvedValue(undefined);
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('returns PAYMENT_NOT_ATTACHED controller when getPaymentsApi returns null', async () => {
        const client = makeClient();
        const api = createWalletsApi(client as never, () => null);

        const ctrl = await api.mountGooglePayButton(container);
        const err = await ctrl.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
        );
    });

    it('returns WALLET_BUTTON_ERROR when script fails to load', async () => {
        mockLoadScriptOnce.mockRejectedValue(new Error('network'));
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        const err = await ctrl.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('calls onUnavailable when the script fails to load', async () => {
        mockLoadScriptOnce.mockRejectedValue(new Error('blocked'));
        const onUnavailable = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container, {
            onUnavailable,
        });
        await ctrl.result.catch(() => {});

        expect(onUnavailable).toHaveBeenCalledOnce();
    });

    it('returns WALLET_BUTTON_ERROR when google global is absent', async () => {
        vi.unstubAllGlobals();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        const err = await ctrl.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('calls onUnavailable and rejects when isReadyToPay returns false', async () => {
        mockIsReadyToPay = vi.fn().mockResolvedValue({ result: false });
        const onUnavailable = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container, {
            onUnavailable,
        });
        const err = await ctrl.result.catch((e: unknown) => e);

        expect(onUnavailable).toHaveBeenCalledOnce();
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('calls onUnavailable when isReadyToPay throws', async () => {
        mockIsReadyToPay = vi
            .fn()
            .mockRejectedValue(new Error('not supported'));
        const onUnavailable = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container, {
            onUnavailable,
        });
        ctrl.result.catch(() => {});

        expect(onUnavailable).toHaveBeenCalledOnce();
    });

    it('rejects result when getGooglePayInfo throws', async () => {
        const apiError = new Error('API failure');
        const paymentsApi = makePaymentsApi({
            getGooglePayInfo: vi.fn().mockRejectedValue(apiError),
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        const err = await ctrl.result.catch((e: unknown) => e);

        expect(err).toBe(apiError);
    });

    it('appends a button element to the container', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        ctrl.result.catch(() => {});

        expect(container.querySelector('button')).not.toBeNull();
    });

    it('passes googleButtonOptions to createButton', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        await api.mountGooglePayButton(container, {
            googleButtonOptions: { buttonColor: 'black', buttonType: 'buy' },
        });

        expect(mockCreateButton).toHaveBeenCalledWith(
            expect.objectContaining({
                buttonColor: 'black',
                buttonType: 'buy',
            }),
        );
    });

    it('resolves result when loadPaymentData succeeds and charge completes', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        expect(capturedOnClick).toBeDefined();
        await must(capturedOnClick, 'the Google Pay button onClick')();

        expect(paymentsApi.chargePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                payment_instrument: expect.objectContaining({
                    input: expect.objectContaining({
                        input_type: 'GOOGLE_PAY',
                    }),
                }),
            }),
            // the wallet controller's abort must reach the charge itself
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        const result = await ctrl.result;
        expect(result).toEqual(mockChargeState);
    });

    it('reports the authorisation as a submit, ahead of the charge', async () => {
        const telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
        };
        const paymentsApi = makePaymentsApi();
        const api = createWalletsApi(
            makeClient() as never,
            () => paymentsApi as never,
            telemetry as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        await must(capturedOnClick, 'the Google Pay button onClick')();
        await ctrl.result;

        expect(telemetry.submit).toHaveBeenCalledWith('googlepay-button', {
            paymentMethod: 'googlepay',
        });
    });

    it('fires onCancel and does not reject when loadPaymentData is cancelled', async () => {
        const cancelError = Object.assign(new Error('Cancelled'), {
            statusCode: 'CANCELED',
        });
        mockLoadPaymentData = vi.fn().mockRejectedValue(cancelError);
        const onCancel = vi.fn();
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        await api.mountGooglePayButton(container, { onCancel });
        expect(capturedOnClick).toBeDefined();
        await must(capturedOnClick, 'the Google Pay button onClick')();

        expect(onCancel).toHaveBeenCalledOnce();
        expect(paymentsApi.chargePayment).not.toHaveBeenCalled();
    });

    it('fires onCancel when loadPaymentData rejects with AbortError', async () => {
        const abortError = new DOMException('Aborted', 'AbortError');
        mockLoadPaymentData = vi.fn().mockRejectedValue(abortError);
        const onCancel = vi.fn();
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        await api.mountGooglePayButton(container, { onCancel });
        expect(capturedOnClick).toBeDefined();
        await must(capturedOnClick, 'the Google Pay button onClick')();

        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('rejects result when loadPaymentData fails with a non-cancel error', async () => {
        const networkError = new Error('network');
        mockLoadPaymentData = vi.fn().mockRejectedValue(networkError);
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        expect(capturedOnClick).toBeDefined();
        await must(capturedOnClick, 'the Google Pay button onClick')();

        const err = await ctrl.result.catch((e: unknown) => e);
        expect(err).toBe(networkError);
    });

    it('rejects with WALLET_BUTTON_ERROR when paymentMethodData is missing', async () => {
        mockLoadPaymentData = vi.fn().mockResolvedValue({});
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        expect(capturedOnClick).toBeDefined();
        await must(capturedOnClick, 'the Google Pay button onClick')();

        const err = await ctrl.result.catch((e: unknown) => e);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('rejects with WALLET_BUTTON_ERROR when token JSON is invalid', async () => {
        mockLoadPaymentData = vi.fn().mockResolvedValue({
            paymentMethodData: {
                tokenizationData: { token: 'bad-json' },
            },
        });
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        expect(capturedOnClick).toBeDefined();
        await must(capturedOnClick, 'the Google Pay button onClick')();

        const err = await ctrl.result.catch((e: unknown) => e);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });

    it('unmount() rejects result and calls client.emitError when not yet settled', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        ctrl.unmount();

        const err = await ctrl.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
        expect(client.emitError).toHaveBeenCalledOnce();
    });

    it('unmount() is a no-op when result is already settled', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        expect(capturedOnClick).toBeDefined();
        await must(capturedOnClick, 'the Google Pay button onClick')();
        await ctrl.result;

        expect(() => ctrl.unmount()).not.toThrow();
        expect(client.emitError).not.toHaveBeenCalled();
    });

    it('second mountGooglePayButton call while active rejects the new call, leaves the first alive', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const first = await api.mountGooglePayButton(container);
        first.result.catch(() => {});

        const second = await api.mountGooglePayButton(container);
        const err = await second.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
        // First controller is still live — its button is still in the container
        expect(container.querySelector('button')).not.toBeNull();
    });

    it('rejects result when awaitChargeState throws during the charge flow', async () => {
        const chargeError = new Error('3DS timeout');
        const paymentsApi = makePaymentsApi({
            awaitChargeState: vi.fn().mockRejectedValue(chargeError),
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        await must(capturedOnClick, 'the Google Pay button onClick')();

        const err = await ctrl.result.catch((e: unknown) => e);
        expect(err).toBe(chargeError);
    });

    it('removes spinner and forwards onStateChange when ACTION_REQUIRED fires with redirect_url', async () => {
        const paymentsApi = makePaymentsApi({
            awaitChargeState: vi
                .fn()
                .mockImplementation(
                    async (opts: { onStateChange?: (s: unknown) => void }) => {
                        opts.onStateChange?.({
                            state: 'ACTION_REQUIRED',
                            action: { redirect_url: 'https://3ds.example.com' },
                        });
                        return mockChargeState;
                    },
                ),
        });
        const onStateChange = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container, {
            awaitOptions: { onStateChange },
        });
        await must(capturedOnClick, 'the Google Pay button onClick')();

        await ctrl.result;
        expect(onStateChange).toHaveBeenCalledWith(
            expect.objectContaining({ state: 'ACTION_REQUIRED' }),
        );
    });

    it('uses empty object for isReadyToPay and loadPaymentData when paymentDataRequest is absent', async () => {
        const paymentsApi = makePaymentsApi({
            getGooglePayInfo: vi
                .fn()
                .mockResolvedValue({ environment: 'TEST' }),
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        await must(capturedOnClick, 'the Google Pay button onClick')();
        await ctrl.result;

        expect(mockIsReadyToPay).toHaveBeenCalledWith({});
        expect(mockLoadPaymentData).toHaveBeenCalledWith({});
    });

    it('calling onClick after unmount is a no-op', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        ctrl.result.catch(() => {});

        expect(capturedOnClick).toBeDefined();
        ctrl.unmount();

        // active is now false — onClick should return early without charging.
        if (capturedOnClick) {
            await capturedOnClick();
        }

        expect(paymentsApi.chargePayment).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Error reporting (GPOMA-2647)
    // -----------------------------------------------------------------------

    it('reports PAYMENT_NOT_ATTACHED to onError', async () => {
        const client = makeClient();
        const api = createWalletsApi(client as never, () => null);

        const ctrl = await api.mountGooglePayButton(container);
        ctrl.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED,
            }),
        );
    });

    it('reports a failed Google Pay script load to onError', async () => {
        mockLoadScriptOnce.mockRejectedValue(new Error('network'));
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        ctrl.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('Google Pay is not available'),
            }),
        );
    });

    it('separates a policy refusal from an ad-blocker on the Google Pay script too', async () => {
        // The pair that keeps the two wallets symmetrical: same discrimination,
        // other host. Google Pay has no shim and no custom element, so a
        // blocked script is the only way it reaches this path at all.
        mockLoadScriptOnce.mockImplementation(() => {
            document.dispatchEvent(
                Object.assign(new Event('securitypolicyviolation'), {
                    blockedURI: 'https://pay.google.com/gp/p/js/pay.js',
                    effectiveDirective: 'script-src-elem',
                }),
            );
            return Promise.reject(new Error('blocked'));
        });
        const telemetry = makeTelemetry();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentMethod: 'googlepay',
                reason: 'script-blocked-csp',
                capabilities: expect.objectContaining({
                    csp_directive: 'script-src-elem',
                }),
            }),
        );
        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining(
                    'allow https://pay.google.com in script-src-elem',
                ),
            }),
        );
    });

    it('names Google Pay, not just "a wallet", when its gate turns it away', async () => {
        // The pair that makes the attribution real: same reason code, other
        // payment_method. Before this both produced an identical line.
        mockIsReadyToPay = vi.fn().mockResolvedValue({ result: false });
        const telemetry = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            walletUnavailable: vi.fn(),
        };
        const api = createWalletsApi(
            makeClient() as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentMethod: 'googlepay',
                reason: 'unsupported-device',
            }),
        );
    });

    it('reports the isReadyToPay=false guard to onError', async () => {
        mockIsReadyToPay = vi.fn().mockResolvedValue({ result: false });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        ctrl.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
                message: expect.stringContaining('not available'),
            }),
        );
    });

    it('reports the already-active guard to onError', async () => {
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const first = await api.mountGooglePayButton(container);
        first.result.catch(() => {});
        const second = await api.mountGooglePayButton(container);
        second.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('already active'),
            }),
        );
    });

    it('reports a charge-flow failure to onError through rejectResult', async () => {
        const chargeError = new Error('charge flow failed');
        const paymentsApi = makePaymentsApi({
            awaitChargeState: vi.fn().mockRejectedValue(chargeError),
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        await must(capturedOnClick, 'the Google Pay button onClick')();
        await ctrl.result.catch(() => {});

        // Reported as a named wallet failure rather than raw: an unnamed
        // error is one core can only call SDK.UNKNOWN, and `reportError`
        // used to drop it entirely. The original stays on `cause`, and
        // `result` still rejects with it — only reporting changed.
        const reported = client.reportError.mock.calls[0]?.[0] as GoPaySDKError;
        expect(reported).toBeInstanceOf(GoPaySDKError);
        expect(reported.errorCode).toBe(GoPayErrorCodes.WALLET_BUTTON_ERROR);
        expect(reported.cause).toBe(chargeError);
    });

    it('reports the plain object Google Pay rejects with, which is not an Error', async () => {
        // This is the real shape of a Google Pay misconfiguration, and it is
        // not an Error — so `reportError`'s instanceof guard dropped it and
        // DEVELOPER_ERROR / MERCHANT_ACCOUNT_ERROR reached nothing at all.
        mockLoadPaymentData = vi.fn().mockRejectedValue({
            statusCode: 'DEVELOPER_ERROR',
            statusMessage: 'merchantId not recognised',
        });
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        await must(capturedOnClick, 'the Google Pay button onClick')();
        await ctrl.result.catch(() => {});

        const reported = client.reportError.mock.calls[0]?.[0] as GoPaySDKError;
        expect(reported).toBeInstanceOf(GoPaySDKError);
        expect(reported.errorCode).toBe(GoPayErrorCodes.WALLET_BUTTON_ERROR);
        expect(reported.message).toContain('DEVELOPER_ERROR');
    });

    it('treats a plain object cancel as a cancel, not as a failure', async () => {
        // Same shape, CANCELED. Gating the check on `instanceof Error` turned
        // a customer dismissing the sheet into a reported error with no
        // onCancel — and with the fix above it would have been reported twice
        // as loudly.
        mockLoadPaymentData = vi
            .fn()
            .mockRejectedValue({ statusCode: 'CANCELED' });
        const onCancel = vi.fn();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container, { onCancel });
        await must(capturedOnClick, 'the Google Pay button onClick')();

        expect(onCancel).toHaveBeenCalledOnce();
        expect(client.reportError).not.toHaveBeenCalled();
        // `result` stays pending: the customer may tap the button again.
        let settled = false;
        void ctrl.result.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );
        await Promise.resolve();
        expect(settled).toBe(false);
    });

    it('reports missing paymentMethodData to onError', async () => {
        mockLoadPaymentData = vi.fn().mockResolvedValue({});
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => makePaymentsApi() as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        await must(capturedOnClick, 'the Google Pay button onClick')();
        await ctrl.result.catch(() => {});

        expect(client.reportError).toHaveBeenCalledWith(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
            }),
        );
    });
});
