import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
} from '../../src/errors.js';
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

const PENDING = Symbol('still pending');

/**
 * The promise's outcome — its value or its rejection — or `PENDING` if it has
 * none within `ms`. Several bugs below leave `result` pending forever, and
 * awaiting it directly would fail on vitest's timeout, which names nothing.
 */
function outcomeWithin(promise: Promise<unknown>, ms = 50): Promise<unknown> {
    return Promise.race([
        promise.then(
            (value) => value,
            (error: unknown) => error,
        ),
        new Promise((resolve) => setTimeout(() => resolve(PENDING), ms)),
    ]);
}

/**
 * What a click handler throws never reaches the test: the DOM hands it to
 * `window.onerror`, which is exactly where the Sentry event came from. This
 * collects it there instead.
 */
function captureUncaught(): { errors: unknown[]; stop: () => void } {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
        errors.push(event.error);
        event.preventDefault();
    };
    window.addEventListener('error', onError);
    return {
        errors,
        stop: () => window.removeEventListener('error', onError),
    };
}

/**
 * Run something that has to exhaust the ApplePaySession poll, without
 * spending its ten seconds of wall clock.
 *
 * The poll matches gw-ui's (500 ms, 20 attempts), so any path where the script
 * installs no session now takes ten seconds to reach its verdict — longer than
 * vitest's per-test timeout, and pointless to sit through.
 */
async function withoutTheSessionWait<T>(run: () => Promise<T>): Promise<T> {
    vi.useFakeTimers();
    try {
        const promise = run();
        // Drains the chain rather than advancing a computed amount: the poll
        // schedules each attempt from the previous one, and the last of them
        // lands exactly on the bound, which is the wrong side of a boundary to
        // be betting a test on.
        await vi.runAllTimersAsync();
        return await promise;
    } finally {
        vi.useRealTimers();
    }
}

/** Sentry event 8dd085c3: Chrome Mobile iOS 153 on iOS 26.6 (UA frozen at 18_6). */
const CHROME_IOS_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.7000.0 Mobile/15E148 Safari/604.1';

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
        walletUnmount: vi.fn(),
        walletAvailability: vi.fn(),
        walletStep: vi.fn(),
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

        const ctrl = await withoutTheSessionWait(() =>
            api.mountApplePayButton(container),
        );
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
        const telemetry = makeTelemetry();
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

    it('refuses a 3DS challenge on Apple Pay rather than navigating the page to it', async () => {
        // GPOMA-2668 §3. The device already authenticated the token, so 3DS
        // never applies — yet the flow was the card one, redirect mode
        // included, and an ACTION_REQUIRED would have sent the page to an ACS
        // while the sheet was still up. An error beats that, and beats silence.
        const threeDsState = {
            state: 'ACTION_REQUIRED',
            action: { redirect_url: 'https://3ds.example.com' },
        };
        const paymentsApi = makePaymentsApi({
            awaitChargeState: vi.fn(
                (opts: {
                    signal?: AbortSignal;
                    onStateChange?: (s: unknown) => void;
                    onActionRequired?: (url: string) => void;
                }) => {
                    opts.onStateChange?.(threeDsState);
                    opts.onActionRequired?.(threeDsState.action.redirect_url);
                    // What the real poll does after ACTION_REQUIRED: waits,
                    // with no timeout, until it is aborted.
                    return new Promise((_, reject) => {
                        opts.signal?.addEventListener('abort', () =>
                            reject(
                                new GoPaySDKError(
                                    '[GoPaySDK] Charge polling aborted.',
                                    {
                                        errorCode:
                                            GoPayErrorCodes.CHARGE_FAILED,
                                    },
                                ),
                            ),
                        );
                    });
                },
            ),
        });
        const onStateChange = vi.fn();
        const api = createWalletsApi(
            makeClient() as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountApplePayButton(container, {
            awaitOptions: { onStateChange },
        });
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

        const err = await outcomeWithin(ctrl.result);
        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
        // Never handed to the redirect: manual mode is what keeps the page.
        expect(paymentsApi.awaitChargeState).toHaveBeenCalledWith(
            expect.objectContaining({ threeDS: { mode: 'manual' } }),
        );
        expect(lastSession.completePayment).toHaveBeenCalledWith(
            MockApplePaySession.STATUS_FAILURE,
        );
        // The integrator still sees the state it was refused on.
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
        const telemetry = makeTelemetry();
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
        const telemetry = makeTelemetry();
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
        const telemetry = makeTelemetry();
        const api = createWalletsApi(
            makeClient() as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await withoutTheSessionWait(() =>
            api.mountApplePayButton(container),
        );
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
        const telemetry = makeTelemetry();
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

    // -----------------------------------------------------------------------
    // Production Sentry (GPOMA-2668)
    // -----------------------------------------------------------------------

    describe('the session the shopper taps into', () => {
        const authorise = () =>
            must(
                lastSession.onpaymentauthorized,
                'the onpaymentauthorized handler',
            )({
                payment: { token: { paymentData: validApplePaymentData } },
            });

        const tap = () =>
            must(
                container.querySelector<HTMLElement>('apple-pay-button'),
                'the apple-pay-button element',
            ).click();

        it('ignores a second tap while the first sheet is still opening', async () => {
            // Sentry 8dd085c3: two taps 1.32 s apart, no merchant validation
            // between them. The second tap built a second session, its
            // begin() threw InvalidAccessError into window.onerror, and
            // onError never heard of it.
            //
            // WebKit allows one payment session per page; the plain mock
            // does not model that, so this one does.
            let open: object | null = null;
            class OnePerPageSession extends MockApplePaySession {
                begin = vi.fn(() => {
                    if (open) {
                        throw new DOMException(
                            'Page already has an active payment session.',
                            'InvalidAccessError',
                        );
                    }
                    open = this;
                });
            }
            vi.stubGlobal('ApplePaySession', OnePerPageSession);
            const uncaught = captureUncaught();
            const api = createWalletsApi(
                makeClient() as never,
                () => makePaymentsApi() as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            tap();
            const first = lastSession;
            tap();
            uncaught.stop();

            expect(uncaught.errors).toEqual([]);
            expect(applePayCtorArgs).toHaveLength(1);
            // The sheet that did open is still the one the shopper pays in.
            lastSession = first;
            authorise();
            await expect(ctrl.result).resolves.toEqual(mockChargeState);
        });

        it('reports a begin() that throws to onError as WALLET_BUTTON_ERROR', async () => {
            // The constructor was guarded, begin() was not — so its throw
            // skipped onError and cleanup and left `result` pending.
            const refusal = new DOMException(
                'Page already has an active payment session.',
                'InvalidAccessError',
            );
            class RefusingSession extends MockApplePaySession {
                begin = vi.fn(() => {
                    throw refusal;
                });
            }
            vi.stubGlobal('ApplePaySession', RefusingSession);
            const uncaught = captureUncaught();
            const client = makeClient();
            const api = createWalletsApi(
                client as never,
                () => makePaymentsApi() as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            tap();
            uncaught.stop();

            const err = await outcomeWithin(ctrl.result);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.WALLET_BUTTON_ERROR,
            );
            expect((err as GoPaySDKError).cause).toBe(refusal);
            expect(client.reportError).toHaveBeenCalledWith(err);
            expect(uncaught.errors).toEqual([]);
        });

        it('unmount() aborts a sheet the shopper still has open', async () => {
            // The only abort() in the SDK was the failed-merchant-validation
            // branch, so tearing the button down left the session active —
            // and with it every later begin() on the page.
            const api = createWalletsApi(
                makeClient() as never,
                () => makePaymentsApi() as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});
            tap();
            ctrl.unmount();

            expect(lastSession.abort).toHaveBeenCalledOnce();
        });

        it('reports a teardown as an unmount, not as a wallet error', async () => {
            // unmount() reached gw-logger only as SDK.WALLET_BUTTON_ERROR, so
            // a merchant tearing the button down when the shopper stepped back
            // through the checkout looked exactly like a sheet that broke —
            // and spent the error budget saying so.
            const telemetry = makeTelemetry();
            const client = makeClient();
            const api = createWalletsApi(
                client as never,
                () => makePaymentsApi() as never,
                telemetry as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});
            tap();
            ctrl.unmount();

            expect(telemetry.walletUnmount).toHaveBeenCalledWith({
                paymentMethod: 'applepay',
                sheetOpen: true,
                chargeInFlight: false,
            });
            // One teardown is one event: the rejection still carries the error
            // to onError, but asks for no second event describing it worse.
            expect(client.reportError).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
                }),
                { telemetry: false },
            );
        });

        it('reports an idle teardown as idle, with no sheet and no charge', async () => {
            const telemetry = makeTelemetry();
            const api = createWalletsApi(
                makeClient() as never,
                () => makePaymentsApi() as never,
                telemetry as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});
            ctrl.unmount();

            expect(telemetry.walletUnmount).toHaveBeenCalledWith({
                paymentMethod: 'applepay',
                sheetOpen: false,
                chargeInFlight: false,
            });
        });

        it('records the tap and the dismissal, so the funnel has a middle', async () => {
            // The gap the Sentry case fell through. `ready` said the button
            // drew and the next event was whatever the charge did; a shopper
            // who tapped and got no sheet produced nothing at all. gw-ui logs
            // begin and cancel for its wallets and that is what this matches.
            const telemetry = makeTelemetry();
            const api = createWalletsApi(
                makeClient() as never,
                () => makePaymentsApi() as never,
                telemetry as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});
            tap();
            must(lastSession.oncancel, 'the oncancel handler')({});

            expect(telemetry.walletStep.mock.calls.map(([c]) => c)).toEqual([
                { paymentMethod: 'applepay', step: 'begin', status: 'start' },
                { paymentMethod: 'applepay', step: 'cancel', status: 'info' },
            ]);
        });

        it('reports one event for a teardown that interrupts a charge', async () => {
            // Review measured the opposite: `rejectResult` set `settled` and
            // never read it, so unmount() during a charge settled twice — once
            // for the teardown (with the telemetry opt-out) and again when the
            // aborted charge came back as a failure (without it). One teardown,
            // two SDK.WALLET_BUTTON_ERROR events and two onError calls. The old
            // unmount tests all ran with no charge in flight, which is why they
            // never saw it.
            const paymentsApi = makePaymentsApi({
                awaitChargeState: vi.fn(
                    (opts: { signal?: AbortSignal }) =>
                        new Promise((_, reject) => {
                            opts.signal?.addEventListener('abort', () =>
                                reject(
                                    new GoPaySDKError(
                                        '[GoPaySDK] Charge polling aborted.',
                                        {
                                            errorCode:
                                                GoPayErrorCodes.CHARGE_FAILED,
                                        },
                                    ),
                                ),
                            );
                        }),
                ),
            });
            const telemetry = makeTelemetry();
            const client = makeClient();
            const api = createWalletsApi(
                client as never,
                () => paymentsApi as never,
                telemetry as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});
            tap();
            authorise();
            await vi.waitFor(() =>
                expect(paymentsApi.awaitChargeState).toHaveBeenCalled(),
            );

            ctrl.unmount();
            await ctrl.result.catch(() => {});
            // `result` rejects on the teardown itself, so awaiting it returns
            // before the aborted charge has unwound. The second settle attempt
            // — the one that used to slip through — happens a tick later, when
            // awaitChargeState rejects and runChargeFlow hands back { ok:false }.
            // Without this the assertion below passes either way.
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(telemetry.walletUnmount).toHaveBeenCalledWith({
                paymentMethod: 'applepay',
                sheetOpen: true,
                chargeInFlight: true,
            });
            // One teardown is one event — the assertion that was true only
            // while nothing was being charged.
            expect(client.reportError).toHaveBeenCalledTimes(1);
            expect(client.reportError).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
                }),
                { telemetry: false },
            );
        });

        it('refuses a second authorisation, the v4 charge being terminal', async () => {
            // Reported from a live FAILED charge (fail_reason _5009): the sheet
            // stayed up and offered another card. Apple treats a failure result
            // as correctable, so `onpaymentauthorized` fires again — and
            // nothing stopped that from starting a second chargePayment on a
            // payment v4 had already settled, which cannot succeed and tells
            // the shopper a different story than the page.
            const paymentsApi = makePaymentsApi({
                awaitChargeState: vi.fn().mockRejectedValue(
                    new GoPaySDKError('[GoPaySDK] Charge failed', {
                        errorCode: GoPayErrorCodes.CHARGE_FAILED,
                    }),
                ),
            });
            const api = createWalletsApi(
                makeClient() as never,
                () => paymentsApi as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});
            tap();
            const session = lastSession;
            authorise();
            await ctrl.result.catch(() => {});

            expect(session.completePayment).toHaveBeenCalledWith(
                MockApplePaySession.STATUS_FAILURE,
            );
            // Dismissed, rather than left holding out an offer we cannot meet.
            expect(session.abort).toHaveBeenCalledOnce();

            // And if the sheet authorises anyway, the charge is not repeated.
            lastSession = session;
            authorise();
            expect(paymentsApi.chargePayment).toHaveBeenCalledOnce();
        });

        it('lets the shopper tap again after merchant validation fails', async () => {
            // Raised in review of this change, and real: merchant validation
            // failing calls session.abort(), and WebKit's abort() reaches the
            // session's final state WITHOUT dispatching a cancel event. So
            // oncancel never runs, the tap guard added above goes on holding a
            // session that no longer exists, and one failed
            // /apple-pay/validate — a blip is enough — takes the button out
            // for the rest of the page's life, every later tap ignored.
            const failure = new GoPayHTTPError(502, { errors: [] });
            const paymentsApi = makePaymentsApi({
                startApplePaySession: vi.fn(
                    (
                        session: { begin: () => void },
                        callbacks?: {
                            onvalidationfailure?: (error: unknown) => void;
                        },
                    ) => {
                        session.begin();
                        callbacks?.onvalidationfailure?.(failure);
                    },
                ),
            });
            const client = makeClient();
            const api = createWalletsApi(
                client as never,
                () => paymentsApi as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});
            tap();

            // Not silence: the sheet vanished and the merchant hears why.
            expect(client.reportError).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
                    cause: failure,
                }),
            );

            // And the button still works — the failure may well be transient,
            // so the next tap has to build a fresh session rather than be
            // swallowed by the guard.
            tap();
            expect(applePayCtorArgs).toHaveLength(2);
        });

        it('does not tell the sheet the payment succeeded before the charge has', async () => {
            // §2: STATUS_SUCCESS went out before chargePayment was even
            // called, so the sheet showed a green tick and closed however
            // the charge then ended.
            let settleCharge: (state: unknown) => void = () => {};
            const paymentsApi = makePaymentsApi({
                awaitChargeState: vi.fn(
                    () =>
                        new Promise((resolve) => {
                            settleCharge = resolve;
                        }),
                ),
            });
            const api = createWalletsApi(
                makeClient() as never,
                () => paymentsApi as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            tap();
            authorise();
            await vi.waitFor(() =>
                expect(paymentsApi.awaitChargeState).toHaveBeenCalled(),
            );

            expect(lastSession.completePayment).not.toHaveBeenCalled();

            settleCharge(mockChargeState);
            await ctrl.result;
            expect(lastSession.completePayment).toHaveBeenCalledOnce();
            expect(lastSession.completePayment).toHaveBeenCalledWith(
                MockApplePaySession.STATUS_SUCCESS,
            );
        });

        it.each([
            [
                'the gateway reports the charge FAILED',
                {
                    awaitChargeState: vi.fn().mockRejectedValue(
                        new GoPaySDKError('[GoPaySDK] Charge failed', {
                            errorCode: GoPayErrorCodes.CHARGE_FAILED,
                        }),
                    ),
                },
            ],
            [
                'the charge request itself is refused',
                {
                    chargePayment: vi
                        .fn()
                        .mockRejectedValue(
                            new GoPayHTTPError(422, { errors: [] }),
                        ),
                },
            ],
        ])('tells the sheet the payment failed when %s', async (_label, overrides) => {
            const paymentsApi = makePaymentsApi(overrides);
            const api = createWalletsApi(
                makeClient() as never,
                () => paymentsApi as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            tap();
            authorise();
            await ctrl.result.catch(() => {});

            expect(lastSession.completePayment).toHaveBeenCalledOnce();
            expect(lastSession.completePayment).toHaveBeenCalledWith(
                MockApplePaySession.STATUS_FAILURE,
            );
        });

        it('leaves a trace when completePayment throws, instead of swallowing it', async () => {
            // Apple gives up on a session it has waited on too long, and
            // completePayment then throws. The empty catch around it meant
            // nobody would ever learn the sheet showed a failure for a charge
            // that went through.
            const expired = new DOMException(
                'The payment session is no longer active.',
                'InvalidAccessError',
            );
            class ExpiredSession extends MockApplePaySession {
                completePayment = vi.fn(() => {
                    throw expired;
                });
            }
            vi.stubGlobal('ApplePaySession', ExpiredSession);
            const telemetry = makeTelemetry();
            const api = createWalletsApi(
                makeClient() as never,
                () => makePaymentsApi() as never,
                telemetry as never,
            );

            const ctrl = await api.mountApplePayButton(container);
            tap();
            authorise();

            // The charge went through, and that is still what the page hears.
            await expect(ctrl.result).resolves.toEqual(mockChargeState);
            expect(telemetry.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
                    cause: expired,
                }),
            );
        });

        it('offers Apple Pay on Chrome for iOS, where the shim has a flow to show', async () => {
            // Reversed on purpose. An earlier revision read the browser out of
            // the user agent and refused these, on the reasoning that Apple Pay
            // JS is Safari-only on iOS — but the shim does load there and
            // offers its scan-with-an-iPhone flow, so the rule suppressed a
            // button that had something to show. Nothing decides availability
            // from a browser name any more: the session answers for itself,
            // which is what gw-ui does and has mileage on.
            vi.stubGlobal('navigator', {
                ...navigator,
                userAgent: CHROME_IOS_UA,
            });
            const onUnavailable = vi.fn();
            const api = createWalletsApi(
                makeClient() as never,
                () => makePaymentsApi() as never,
            );

            const ctrl = await api.mountApplePayButton(container, {
                onUnavailable,
            });
            ctrl.result.catch(() => {});

            expect(container.querySelector('apple-pay-button')).not.toBeNull();
            expect(onUnavailable).not.toHaveBeenCalled();
        });

        it('names the function that asked, so a probe is not filed as a mount', async () => {
            // §4: the event becomes a js_event, and function_name is the
            // field that says which call turned Apple Pay away.
            MockApplePaySession.canMakePayments.mockReturnValue(false);
            const telemetry = makeTelemetry();
            const api = createWalletsApi(
                makeClient() as never,
                () => makePaymentsApi() as never,
                telemetry as never,
            );

            await api.getApplePayAvailability();
            const ctrl = await api.mountApplePayButton(container);
            ctrl.result.catch(() => {});

            // The probe has an event of its own, reported either way; the
            // mount keeps walletUnavailable, which fires only when a button
            // that was asked for could not be offered.
            expect(telemetry.walletAvailability).toHaveBeenCalledWith(
                expect.objectContaining({
                    functionName: 'getApplePayAvailability',
                    available: false,
                }),
            );
            expect(telemetry.walletUnavailable.mock.calls).toEqual([
                [
                    expect.objectContaining({
                        functionName: 'mountApplePayButton',
                    }),
                ],
            ]);
        });
    });

    describe('getApplePayAvailability()', () => {
        const makeTelemetry = () => ({
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
            walletUnavailable: vi.fn(),
            integratorError: vi.fn(),
            walletUnmount: vi.fn(),
            walletAvailability: vi.fn(),
            walletStep: vi.fn(),
        });

        it('answers without an attached payment, which is the whole point', async () => {
            // It is called to decide whether to render an Apple Pay option at
            // all — before a payment exists, let alone is attached.
            const api = createWalletsApi(makeClient() as never, () => null);

            await expect(api.getApplePayAvailability()).resolves.toEqual({
                available: true,
            });
        });

        it('asks rather than guessing on an Android phone', async () => {
            // The userAgentData.mobile shortcut went with the browser-name
            // gate. Deciding a wallet is unavailable from the user agent is
            // what suppressed Apple Pay on Chrome for iOS, and the shortcut
            // rested on the same assumption about Apple's shim. gw-ui does not
            // guess either: it loads, waits, and lets Apple answer. Android
            // reaches the same verdict, it just costs a script to get there.
            vi.stubGlobal('ApplePaySession', undefined);
            vi.stubGlobal('navigator', {
                ...navigator,
                userAgentData: { mobile: true },
            });
            const api = createWalletsApi(makeClient() as never, () => null);

            const result = await withoutTheSessionWait(() =>
                api.getApplePayAvailability(),
            );

            expect(mockLoadScriptOnce).toHaveBeenCalled();
            expect(result).toEqual({
                available: false,
                reason: 'library-missing',
            });
        });

        it('answers for Chrome on iOS from the session, not the user agent', async () => {
            // The counterpart to the mount above: one rule, one answer. The
            // user agent is Chrome Mobile iOS 153 (Sentry 8dd085c3) and it no
            // longer enters into it — ApplePaySession is present and reports
            // the device can pay, so that is what both callers are told.
            vi.stubGlobal('navigator', {
                ...navigator,
                userAgent: CHROME_IOS_UA,
            });
            const api = createWalletsApi(makeClient() as never, () => null);

            await expect(api.getApplePayAvailability()).resolves.toEqual({
                available: true,
            });
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

            const result = await withoutTheSessionWait(() =>
                api.getApplePayAvailability(),
            );

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

            expect(telemetry.walletAvailability).toHaveBeenCalledWith(
                expect.objectContaining({
                    paymentMethod: 'applepay',
                    available: false,
                    reason: 'unsupported-device',
                }),
            );
            // The caller asked a question and got an answer. An answer is not a
            // failure, so onError must stay clean.
            expect(client.reportError).not.toHaveBeenCalled();
        });

        it('reports the positive too, so the number has a denominator', async () => {
            // gw-ui logs its readyToPay probe whichever way it goes, and this
            // is why: without the successes, "unavailable 200 times" cannot be
            // told apart from "200 out of 210" or "200 out of 20 000".
            const telemetry = makeTelemetry();
            const api = createWalletsApi(
                makeClient() as never,
                () => null,
                telemetry as never,
            );

            await expect(api.getApplePayAvailability()).resolves.toEqual({
                available: true,
            });

            expect(telemetry.walletAvailability).toHaveBeenCalledWith(
                expect.objectContaining({
                    paymentMethod: 'applepay',
                    available: true,
                    reason: undefined,
                }),
            );
            expect(telemetry.walletUnavailable).not.toHaveBeenCalled();
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
        const telemetry = makeTelemetry();
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
        const telemetry = makeTelemetry();
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

    it('lets Google Pay take a 3DS challenge, unlike Apple Pay', async () => {
        // Adding `refuseActionRequired: true` to the Google Pay charge left the
        // whole file green — nothing pinned the difference. It matters:
        // `allowedAuthMethods` includes PAN_ONLY, a card held in the Google
        // account with no device cryptogram, for which a challenge is the
        // correct next step and refusing it would break real payments.
        const threeDsState = {
            state: 'ACTION_REQUIRED',
            action: { redirect_url: 'https://3ds.example.com' },
        };
        const onStateChange = vi.fn();
        const paymentsApi = makePaymentsApi({
            awaitChargeState: vi.fn(
                async (opts: { onStateChange?: (s: unknown) => void }) => {
                    opts.onStateChange?.(threeDsState);
                    return mockChargeState;
                },
            ),
        });
        const api = createWalletsApi(
            makeClient() as never,
            () => paymentsApi as never,
        );

        const ctrl = await api.mountGooglePayButton(container, {
            awaitOptions: { onStateChange },
        });
        await must(capturedOnClick, 'the Google Pay button onClick')();

        // Not forced to manual: the redirect is Google Pay's to take.
        expect(paymentsApi.awaitChargeState).toHaveBeenCalledWith(
            expect.not.objectContaining({ threeDS: { mode: 'manual' } }),
        );
        expect(onStateChange).toHaveBeenCalledWith(
            expect.objectContaining({ state: 'ACTION_REQUIRED' }),
        );
        // And it resolves rather than being refused, which is what Apple Pay
        // does with the same state.
        await expect(ctrl.result).resolves.toEqual(mockChargeState);
    });

    it('names mountGooglePayButton as the function that turned it away', async () => {
        // GPOMA-2668 §4: function_name is what the js_event is filed under.
        mockIsReadyToPay = vi.fn().mockResolvedValue({ result: false });
        const telemetry = makeTelemetry();
        const api = createWalletsApi(
            makeClient() as never,
            () => makePaymentsApi() as never,
            telemetry as never,
        );

        const ctrl = await api.mountGooglePayButton(container);
        ctrl.result.catch(() => {});

        expect(telemetry.walletUnavailable).toHaveBeenCalledWith(
            expect.objectContaining({ functionName: 'mountGooglePayButton' }),
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
