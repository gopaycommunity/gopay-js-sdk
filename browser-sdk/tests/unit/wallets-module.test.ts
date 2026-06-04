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
                _origin: string,
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

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        applePayCtorArgs = [];
        MockApplePaySession.canMakePayments.mockReturnValue(true);
        vi.stubGlobal('ApplePaySession', MockApplePaySession);
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
        vi.unstubAllGlobals();
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
        container.querySelector<HTMLElement>('apple-pay-button')!.click();

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
        );
        expect(result).toEqual(mockChargeState);
    });

    it('calls completePayment(STATUS_SUCCESS) on successful authorisation', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        await api.mountApplePayButton(container);
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
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
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
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
        container.querySelector<HTMLElement>('apple-pay-button')!.click();
        lastSession.onpaymentauthorized!({
            payment: { token: { paymentData: validApplePaymentData } },
        });
        await ctrl.result;

        expect(() => ctrl.unmount()).not.toThrow();
        expect(client.emitError).not.toHaveBeenCalled();
    });

    it('second mountApplePayButton call rejects the previous result', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const first = await api.mountApplePayButton(container);
        await api.mountApplePayButton(container);

        const err = await first.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
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
        await capturedOnClick!();

        expect(paymentsApi.chargePayment).toHaveBeenCalledWith(
            expect.objectContaining({
                payment_instrument: expect.objectContaining({
                    input: expect.objectContaining({
                        input_type: 'GOOGLE_PAY',
                    }),
                }),
            }),
        );
        const result = await ctrl.result;
        expect(result).toEqual(mockChargeState);
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
        await capturedOnClick!();

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
        await capturedOnClick!();

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
        await capturedOnClick!();

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
        await capturedOnClick!();

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
        await capturedOnClick!();

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
        await capturedOnClick!();
        await ctrl.result;

        expect(() => ctrl.unmount()).not.toThrow();
        expect(client.emitError).not.toHaveBeenCalled();
    });

    it('second mountGooglePayButton call rejects the previous result', async () => {
        const paymentsApi = makePaymentsApi();
        const client = makeClient();
        const api = createWalletsApi(
            client as never,
            () => paymentsApi as never,
        );

        const first = await api.mountGooglePayButton(container);
        await api.mountGooglePayButton(container);

        const err = await first.result.catch((e: unknown) => e);

        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.WALLET_BUTTON_ERROR,
        );
    });
});
