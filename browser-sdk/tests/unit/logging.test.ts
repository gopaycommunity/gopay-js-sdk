import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    GoPaySDKError,
} from '../../src/errors.js';
import { createGoPayBrowserSDK } from '../../src/gopay-browser-sdk.js';
import { createGwLoggerTelemetry } from '../../src/logging/gw-logger.js';
import { getTransactionId } from '../../src/logging/ids.js';
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

    it('stops at the per-visit cap rather than flooding the ingest', () => {
        const t = makeTelemetry();
        for (let i = 0; i < 250; i += 1) {
            t.apiCall(GET_PAYMENT);
        }

        expect(fetchMock).toHaveBeenCalledTimes(200);
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
