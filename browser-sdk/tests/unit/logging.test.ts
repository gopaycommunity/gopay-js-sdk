import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
} from '../../src/errors.js';
import { createGoPayBrowserSDK } from '../../src/gopay-browser-sdk.js';
import { createGwLoggerTelemetry } from '../../src/logging/gw-logger.js';
import { getTransactionId, newTraceId } from '../../src/logging/ids.js';
import { registerLeaveBeacon } from '../../src/logging/leave-beacon.js';
import { safeErrorMessage, safePageUrl } from '../../src/logging/sanitize.js';

describe('safeErrorMessage()', () => {
    it('redacts a PAN-shaped digit run', () => {
        expect(
            safeErrorMessage(new Error('card 4111111111111111 declined')),
        ).toBe('card [redacted] declined');
    });

    it('keeps a short digit run that cannot be a PAN', () => {
        expect(safeErrorMessage(new Error('status 404 on attempt 2'))).toBe(
            'status 404 on attempt 2',
        );
    });

    it('drops a query string, which can carry a token or an e-mail', () => {
        expect(
            safeErrorMessage(
                new Error(
                    'failed https://pay.example.com/r?token=abc&email=a@b.cz',
                ),
            ),
        ).toBe('failed https://pay.example.com/r?[redacted]');
    });

    it('keeps the card-comm form type but drops the signed token', () => {
        expect(
            safeErrorMessage(
                new Error('iframe /gp-card-comm/g/eyJhbGciOiJIUzI1'),
            ),
        ).toBe('iframe /gp-card-comm/g/[redacted]');
    });

    it('caps the length', () => {
        expect(safeErrorMessage(new Error('x'.repeat(900)))).toHaveLength(500);
    });

    it('survives a non-Error reason', () => {
        expect(safeErrorMessage({ nope: true })).toBe('Unknown error');
    });
});

describe('safePageUrl()', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps origin and path but never the query or fragment', () => {
        vi.stubGlobal('location', {
            origin: 'https://eshop.example.com',
            pathname: '/checkout',
            search: '?order=12345&email=a@b.cz',
            hash: '#step2',
        });
        expect(safePageUrl()).toBe('https://eshop.example.com/checkout');
    });
});

describe('getTransactionId()', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('is stable across calls', () => {
        expect(getTransactionId()).toBe(getTransactionId());
    });

    it('persists so a 3DS redirect does not split one payment in two', () => {
        // The id survives because it lives in storage, not in a module
        // variable — a reload re-imports the module but not the store.
        const store = new Map<string, string>([
            ['gopay.sdk.transaction_id', 'txn-from-before-the-redirect'],
        ]);
        vi.stubGlobal('sessionStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => store.set(k, v),
        });

        expect(getTransactionId()).toBe('txn-from-before-the-redirect');
    });

    it('still returns an id when storage throws', () => {
        vi.stubGlobal('sessionStorage', {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
        });
        expect(getTransactionId()).toMatch(/\S/u);
    });
});

describe('createGwLoggerTelemetry()', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let requests: Request[];

    /** The event carried by the nth POST. Reads a clone, so it stays repeatable. */
    const eventOf = async (i = 0): Promise<Record<string, unknown>> => {
        const req = requests[i];
        if (!req) {
            throw new Error(`no request at index ${i}`);
        }
        return (
            JSON.parse(await req.clone().text()) as {
                event: Record<string, unknown>;
            }
        ).event;
    };

    const makeTelemetry = (
        overrides: Partial<{
            getShareableKey: () => string | undefined;
            getClientId: () => string | undefined;
            getPaymentId: () => string | undefined;
        }> = {},
    ) =>
        createGwLoggerTelemetry({
            environment: 'sandbox',
            getShareableKey: () => 'pk_test_123',
            getClientId: () => 'client_test_123',
            getPaymentId: () => undefined,
            ...overrides,
        });

    const GET_PAYMENT = {
        method: 'GET',
        endpoint: '/payments/{id}',
        statusCode: 200,
        durationMs: 1,
    } as const;

    beforeEach(() => {
        requests = [];
        fetchMock = vi.fn((req: Request) => {
            requests.push(req);
            return Promise.resolve(new Response(null, { status: 204 }));
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('location', {
            origin: 'https://eshop.example.com',
            pathname: '/checkout',
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('posts an api_call to the sandbox ingest', async () => {
        makeTelemetry().apiCall({
            method: 'POST',
            endpoint: '/payments/{id}/charge',
            statusCode: 200,
            durationMs: 42,
        });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(requests[0]?.url).toBe('https://lx.sandbox.gopay.com/events');
        expect(await eventOf()).toMatchObject({
            event_type: 'api_call',
            shareable_key: 'pk_test_123',
            origin: 'https://eshop.example.com/checkout',
            target: '/payments/{id}/charge',
            action: 'charge',
            status_code: 200,
            duration: 42,
        });
    });

    it('carries no raw id — target is the template the caller was given', async () => {
        makeTelemetry().apiCall({ ...GET_PAYMENT, statusCode: 404 });

        // trace_id and transaction_id are random UUIDs and are excluded on
        // purpose: a UUID contains a run of six digits often enough that
        // scanning them made this assertion fail at random. Every other field
        // is scanned, which is where a leaked payment id would actually land.
        const { trace_id, transaction_id, ...rest } = await eventOf();
        expect(trace_id).toBeDefined();
        expect(transaction_id).toBeDefined();
        expect(JSON.stringify(rest)).not.toMatch(/\d{6,}/u);
    });

    it('sends null status when the request produced no response', async () => {
        makeTelemetry().apiCall({ ...GET_PAYMENT, statusCode: null });

        expect((await eventOf()).status_code).toBeNull();
    });

    it('reports an SDK error as status 0 with a scrubbed message', async () => {
        makeTelemetry().error(
            new GoPaySDKError('[GoPayBrowserSDK] card 4111111111111111 bad', {
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            }),
        );

        const event = await eventOf();
        expect(event).toMatchObject({
            status_code: 0,
            action: `SDK.${GoPayErrorCodes.INVALID_ARGUMENT}`,
            target: '',
            duration: null,
        });
        expect(event.res_body).toBe('[GoPayBrowserSDK] card [redacted] bad');
    });

    it('gives every event the same transaction id and a fresh trace id', async () => {
        const t = makeTelemetry();
        t.apiCall(GET_PAYMENT);
        t.apiCall(GET_PAYMENT);

        const [first, second] = [await eventOf(0), await eventOf(1)];
        expect(first.transaction_id).toBe(second.transaction_id);
        expect(first.trace_id).not.toBe(second.trace_id);
    });

    it('stops at the api_call cap rather than flooding the ingest', () => {
        const t = makeTelemetry();
        for (let i = 0; i < 250; i += 1) {
            t.apiCall(GET_PAYMENT);
        }

        expect(fetchMock).toHaveBeenCalledTimes(200);
    });

    it('still reports the lifecycle after a poll flood has spent the api_call budget', () => {
        const t = makeTelemetry();
        // What a long 3DS looks like: charge-state polling every couple of
        // seconds, for longer than the budget lasts. Under one shared cap the
        // events below — the end of the visit, and the funnel it closes — were
        // the ones thrown away, in exactly the flows worth watching.
        for (let i = 0; i < 250; i += 1) {
            t.apiCall(GET_PAYMENT);
        }
        fetchMock.mockClear();

        t.lifecycle('ready', { paymentMethod: 'card' });
        t.submit('card-form', { paymentMethod: 'card' });
        t.lifecycle('leave');

        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('still reports errors after a poll flood has spent the api_call budget', () => {
        const t = makeTelemetry();
        for (let i = 0; i < 250; i += 1) {
            t.apiCall(GET_PAYMENT);
        }
        fetchMock.mockClear();

        // Errors travel as api_call events (gw-ui's convention, status_code
        // 0), so on a shared counter the flood silenced the one kind of event
        // nobody can afford to lose.
        t.error(
            new GoPaySDKError('[GoPayBrowserSDK] wallet died', {
                errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
            }),
        );

        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('caps the lifecycle side too, so a runaway there cannot flood either', () => {
        const t = makeTelemetry();
        for (let i = 0; i < 80; i += 1) {
            t.lifecycle('ready');
        }

        expect(fetchMock).toHaveBeenCalledTimes(50);
    });

    it('names the action after the last segment that names something', async () => {
        // normalizeEndpoint turns the id into `{id}`, and the status poll is
        // the highest-volume call the SDK makes — `action: "{id}"` would be
        // both meaningless and shared with every other id-terminated path.
        makeTelemetry().apiCall(GET_PAYMENT);

        expect((await eventOf()).action).toBe('payments');
    });

    it('never lets a field getter throw out of the emitter', () => {
        // base() used to be evaluated in the argument position, outside post()'s
        // try — and apiCall is called from a `finally` on the payment path, so
        // a throw here replaced the payment error the caller was about to get.
        const t = createGwLoggerTelemetry({
            environment: 'sandbox',
            getShareableKey: () => {
                throw new Error('exotic embedding');
            },
            getClientId: () => 'client_test_123',
            getPaymentId: () => undefined,
        });

        expect(() => t.apiCall(GET_PAYMENT)).not.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never throws when the ingest rejects — logging cannot break a payment', () => {
        fetchMock.mockImplementation(() =>
            Promise.reject(new Error('ingest unreachable')),
        );

        expect(() => makeTelemetry().apiCall(GET_PAYMENT)).not.toThrow();
    });

    it('never throws when fetch itself is missing', () => {
        vi.stubGlobal('fetch', undefined);

        expect(() => makeTelemetry().apiCall(GET_PAYMENT)).not.toThrow();
    });

    it('does not retry — a 204 ingest cannot tell a reject from an accept', async () => {
        makeTelemetry().apiCall({ ...GET_PAYMENT, statusCode: 500 });
        await new Promise((r) => setTimeout(r, 20));

        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('uses keepalive so the 3DS redirect does not drop the charge result', () => {
        makeTelemetry().apiCall(GET_PAYMENT);

        expect(requests[0]?.keepalive).toBe(true);
    });

    it('routes production to the production ingest', () => {
        createGwLoggerTelemetry({
            environment: 'production',
            getShareableKey: () => 'pk_live',
            getClientId: () => 'client_live',
            getPaymentId: () => undefined,
        }).apiCall(GET_PAYMENT);

        expect(requests[0]?.url).toBe('https://lx.gopay.com/events');
    });

    it('labels an error with no code rather than dropping it', async () => {
        // GoPayHTTPError never reaches error() — the client routes it through
        // apiCall with its real status — but the shape must not throw if it did.
        makeTelemetry().error(new GoPayHTTPError(500, { err: 'x' }));

        expect((await eventOf()).action).toBe('SDK.UNKNOWN');
    });
});

describe('lifecycle events', () => {
    const requests: Request[] = [];
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        requests.length = 0;
        originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
            requests.push(input as Request);
            return Promise.resolve(new Response(null, { status: 204 }));
        }) as unknown as typeof globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    const readEvent = async (index: number) => {
        const req = requests[index];
        if (!req) {
            throw new Error(`no request at ${index}`);
        }
        return (
            JSON.parse(await req.clone().text()) as {
                event: Record<string, unknown>;
            }
        ).event;
    };

    const telemetry = (paymentId?: string) =>
        createGwLoggerTelemetry({
            environment: 'sandbox',
            getShareableKey: () => 'pk_test_123',
            getClientId: () => 'client_test_123',
            getPaymentId: () => paymentId,
        });

    it('sends init as a navigation event the ingest accepts', async () => {
        telemetry().lifecycle('init');

        const event = await readEvent(0);
        expect(event.event_type).toBe('navigation');
        expect(event.navigation_type).toBe('init');
        // Required by the schema and nullable; a lifecycle event has no
        // destination, which origin already describes.
        expect(event.target).toBeNull();
        expect(event.duration).toBeNull();
    });

    it('carries the diagnostic fields on every lifecycle event', async () => {
        telemetry().lifecycle('ready', {
            paymentMethod: 'applepay',
            flow: 'direct-charge',
        });

        const event = await readEvent(0);
        expect(event.payment_method).toBe('applepay');
        expect(event.flow).toBe('direct-charge');
        expect(event.client_id).toBe('client_test_123');
        expect(typeof event.sdk_version).toBe('string');
        expect(typeof event.integration).toBe('string');
    });

    it('omits payment_session_id before attachPayment rather than sending an empty one', async () => {
        telemetry(undefined).lifecycle('init');

        // gw-logger rejects an attribution key that is present but empty, so an
        // absent payment session has to be absent from the payload.
        expect(await readEvent(0)).not.toHaveProperty('payment_session_id');
    });

    it('sends the submit as an interaction event the ingest accepts', async () => {
        telemetry('3273103424').submit('card-form', {
            paymentMethod: 'card',
            flow: 'direct-charge',
            durationMs: 42_000,
        });

        const event = await readEvent(0);
        expect(event.event_type).toBe('interaction');
        expect(event.interaction_type).toBe('submit');
        expect(event.element_id).toBe('card-form');
        expect(event.duration).toBe(42_000);
        expect(event.payment_session_id).toBe('3273103424');
    });

    it('sends a null duration rather than a fabricated zero', async () => {
        telemetry().submit('card-form', { paymentMethod: 'card' });

        // Required by the schema and nullable. Zero would read as an instant
        // submit, which is a different fact from "never measured".
        expect((await readEvent(0)).duration).toBeNull();
    });

    it('carries nothing that could describe what was typed', async () => {
        telemetry().submit('card-form', {
            paymentMethod: 'card',
            flow: 'return-payload',
            durationMs: 1_000,
        });

        // The whole event, field by field: anything not on this list would be
        // a new channel out of the card form, which is the one thing this
        // event must never become.
        expect(Object.keys(await readEvent(0)).sort()).toEqual([
            'client_id',
            'duration',
            'element_id',
            'event_type',
            'flow',
            'integration',
            'interaction_type',
            'origin',
            'payment_method',
            'sdk_version',
            'shareable_key',
            'trace_id',
            'transaction_id',
        ]);
    });

    it('reports payment_session_id once a payment is attached', async () => {
        telemetry('3273103424').lifecycle('ready', { paymentMethod: 'card' });

        expect((await readEvent(0)).payment_session_id).toBe('3273103424');
    });
});

describe('telemetry is not the integrator’s to turn off', () => {
    let posted: Request[];
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        posted = [];
        originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
            posted.push(input as Request);
            return Promise.resolve(new Response(null, { status: 204 }));
        }) as unknown as typeof globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    const initEvents = () =>
        posted.filter((r) => r.url.endsWith('/events')).length;

    it('reports init on construction with nothing but the required config', () => {
        createGoPayBrowserSDK({
            shareableKey: 'pk_test_123',
            clientId: 'client_test_123',
        });

        expect(initEvents()).toBe(1);
    });

    /**
     * The guard on the requirement, not a test of behaviour anyone asked for:
     * the day someone adds `telemetry: false` or reuses an existing flag to
     * gate it, this fails. debugLoggingEnabled is the flag most likely to be
     * mistaken for one — it gates console.debug and nothing else.
     */
    it('still reports init with every config flag set to its quietest value', () => {
        createGoPayBrowserSDK({
            shareableKey: 'pk_test_123',
            clientId: 'client_test_123',
            environment: 'production',
            debugLoggingEnabled: false,
            onError: () => {},
        });

        expect(initEvents()).toBe(1);
    });
});

describe('attachPayment in the logs', () => {
    let posted: Request[];
    let originalFetch: typeof globalThis.fetch;
    let tokenStatus: number;

    beforeEach(() => {
        posted = [];
        tokenStatus = 200;
        originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
            const req = input as Request;
            posted.push(req);
            if (req.url.includes('/oauth2/token')) {
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            access_token: 'tok',
                            expires_in: 600,
                            token_type: 'bearer',
                        }),
                        {
                            status: tokenStatus,
                            headers: { 'Content-Type': 'application/json' },
                        },
                    ),
                );
            }
            return Promise.resolve(new Response(null, { status: 204 }));
        }) as unknown as typeof globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    const events = async () =>
        Promise.all(
            posted
                .filter((r) => r.url.endsWith('/events'))
                .map(
                    async (r) =>
                        (
                            JSON.parse(await r.clone().text()) as {
                                event: Record<string, unknown>;
                            }
                        ).event,
                ),
        );

    const sdk = () =>
        createGoPayBrowserSDK({
            shareableKey: 'pk_test_123',
            clientId: 'client_test_123',
        });

    it('emits a navigate marker so the attach is not just another token call', async () => {
        await sdk().attachPayment({
            paymentId: '3273103424',
            paymentSecret: 'secret',
        });

        const attach = (await events()).find(
            (e) => e.navigation_type === 'navigate',
        );
        expect(attach).toBeDefined();
        expect(attach?.flow).toBe('attach');
        expect(attach?.payment_session_id).toBe('3273103424');
    });

    it('puts the payment id on the token call that performs the attach', async () => {
        await sdk().attachPayment({
            paymentId: '3273103424',
            paymentSecret: 'secret',
        });

        // The exchange is emitted while it runs, so this only holds because the
        // id is set before it rather than after — the regression this pins.
        const token = (await events()).find((e) => e.action === 'token');
        expect(token?.payment_session_id).toBe('3273103424');
        expect(token?.status_code).toBe(200);
    });

    it('keeps the payment id on a failed attach, then stops claiming the session', async () => {
        tokenStatus = 401;
        const api = sdk();

        await expect(
            api.attachPayment({
                paymentId: '3273103424',
                paymentSecret: 'wrong',
            }),
        ).rejects.toThrow();

        const failed = (await events()).find((e) => e.action === 'token');
        expect(failed?.status_code).toBe(401);
        expect(failed?.payment_session_id).toBe('3273103424');
        expect(
            (await events()).some((e) => e.navigation_type === 'navigate'),
        ).toBe(false);

        // Nothing after the failure may be attributed to a session the SDK
        // never got: this argument error is raised before the id is set again.
        posted.length = 0;
        await expect(
            api.attachPayment({ paymentId: '', paymentSecret: 'x' }),
        ).rejects.toThrow();

        const after = await events();
        expect(after).toHaveLength(1);
        expect(after[0]).not.toHaveProperty('payment_session_id');
    });
});

describe('a missing build-time constant', () => {
    /**
     * `__GOPAY_INTEGRATION__` has to be declared in four build configs (tsup,
     * both vitest configs, the example's Vite config) and the unit tests run
     * under one that has it — so they cannot observe another one missing it.
     * The earlier version of this test read a made-up property off globalThis
     * and compared it to a literal written in the test body, which exercised
     * none of the production code and could not fail.
     *
     * What is actually assertable is the guarantee that matters: whatever the
     * label ends up being, it is a usable non-empty string on the wire, and
     * reading it does not throw out of SDK construction.
     */
    it('still yields a usable integration label on every emitted event', async () => {
        const requests: Request[] = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
            requests.push(input as Request);
            return Promise.resolve(new Response(null, { status: 204 }));
        }) as unknown as typeof globalThis.fetch;

        try {
            expect(() =>
                createGoPayBrowserSDK({
                    shareableKey: 'pk_test_123',
                    clientId: 'client_test_123',
                }),
            ).not.toThrow();

            const req = requests[0];
            expect(req).toBeDefined();
            const { event } = JSON.parse(await (req as Request).clone().text());
            // minLength 1 in the schema: an empty string is rejected, so
            // "degrades to a label" has to mean a real one.
            expect(typeof event.integration).toBe('string');
            expect(event.integration.length).toBeGreaterThan(0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe('the leave beacon', () => {
    const leaves = () =>
        telemetrySpy.lifecycle.mock.calls.filter(([t]) => t === 'leave').length;
    let telemetrySpy: {
        apiCall: ReturnType<typeof vi.fn>;
        error: ReturnType<typeof vi.fn>;
        lifecycle: ReturnType<typeof vi.fn>;
        submit: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        telemetrySpy = {
            apiCall: vi.fn(),
            error: vi.fn(),
            lifecycle: vi.fn(),
            submit: vi.fn(),
        };
    });

    it('does not fire when the customer merely switches tabs', () => {
        registerLeaveBeacon(telemetrySpy as never);

        // The shopper opens their banking app for an SMS code. The page is
        // hidden, but the visit has not ended — and the earlier version fired
        // here and then latched, so it reported the wrong moment and could
        // never report the right one.
        Object.defineProperty(globalThis.document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
        });
        globalThis.document.dispatchEvent(new Event('visibilitychange'));

        expect(leaves()).toBe(0);
    });

    it('fires when the document is actually torn down', () => {
        registerLeaveBeacon(telemetrySpy as never);

        globalThis.dispatchEvent(new Event('pagehide'));

        expect(leaves()).toBe(1);
    });

    it('fires once and removes itself, so an SPA cannot accumulate listeners', () => {
        registerLeaveBeacon(telemetrySpy as never);

        globalThis.dispatchEvent(new Event('pagehide'));
        globalThis.dispatchEvent(new Event('pagehide'));

        expect(leaves()).toBe(1);
    });
});

describe('id generation without randomUUID', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('falls back to the crypto byte source, not to Math.random', () => {
        const getRandomValues = vi.fn((a: Uint8Array) => a.fill(0xab));
        vi.stubGlobal('crypto', { getRandomValues });
        const randomSpy = vi.spyOn(Math, 'random');

        const id = newTraceId();

        expect(getRandomValues).toHaveBeenCalled();
        // A PRNG here is not a real weakness — these are correlation keys, not
        // secrets — but a scanner cannot tell the two uses apart, and neither
        // can a reader.
        expect(randomSpy).not.toHaveBeenCalled();
        expect(id).toMatch(/^txn-\d+-(ab){8}$/u);
    });

    it('still yields distinct ids where there is no Web Crypto at all', () => {
        vi.stubGlobal('crypto', undefined);

        const first = newTraceId();
        const second = newTraceId();

        expect(first).not.toBe(second);
        expect(first).toMatch(/^txn-\d+-\d+$/u);
    });
});
