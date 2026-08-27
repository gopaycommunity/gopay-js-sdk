import {
    createHttpClient,
    GoPayErrorCodes,
    GoPaySDKError,
    SDK_ACCEPT_HEADER,
} from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    collectBrowserData,
    fetchBrowserData,
} from '../../src/modules/payments/browser-data.js';

describe('collectBrowserData()', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('throws INVALID_CONFIG when navigator is undefined', () => {
        vi.stubGlobal('navigator', undefined);
        expect(() => collectBrowserData()).toThrow(GoPaySDKError);
        expect(() => collectBrowserData()).toThrow(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.INVALID_CONFIG,
            }),
        );
    });

    it('sets javascript_enabled to true', () => {
        const data = collectBrowserData();
        expect(data.javascript_enabled).toBe(true);
    });

    it('reads language from navigator.language', () => {
        vi.stubGlobal('navigator', {
            ...navigator,
            language: 'cs-CZ',
            userAgent: 'Agent',
        });
        expect(collectBrowserData().language).toBe('cs-CZ');
    });

    it('reads user_agent from navigator.userAgent', () => {
        vi.stubGlobal('navigator', {
            language: 'en',
            userAgent: 'TestBrowser/3.0',
        });
        expect(collectBrowserData().user_agent).toBe('TestBrowser/3.0');
    });

    it('returns timezone offset as a number', () => {
        expect(typeof collectBrowserData().timezone).toBe('number');
    });

    it('includes screen dimensions when screen is available', () => {
        const data = collectBrowserData();
        expect(typeof data.screen_width).toBe('number');
        expect(typeof data.screen_height).toBe('number');
        expect(typeof data.color_depth).toBe('number');
    });

    it('throws INVALID_CONFIG when screen is undefined', () => {
        vi.stubGlobal('screen', undefined);
        expect(() => collectBrowserData()).toThrow(GoPaySDKError);
        expect(() => collectBrowserData()).toThrow(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.INVALID_CONFIG,
            }),
        );
    });

    describe('accept_header', () => {
        it('is a JSON-encoded object with accept, accept-encoding and accept-language', () => {
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(Object.keys(parsed).sort()).toEqual([
                'accept',
                'accept-encoding',
                'accept-language',
            ]);
        });

        it('reports the Accept header the SDK sends on its own requests', () => {
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed.accept).toBe('application/json');
            expect(parsed.accept).toBe(SDK_ACCEPT_HEADER);
        });

        it('derives accept-language from navigator.languages with q-values', () => {
            vi.stubGlobal('navigator', {
                language: 'cs-CZ',
                languages: ['cs-CZ', 'cs', 'en'],
                userAgent: 'Agent',
            });
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed['accept-language']).toBe('cs-CZ,cs;q=0.9,en;q=0.8');
        });

        it('falls back to navigator.language when navigator.languages is unavailable', () => {
            vi.stubGlobal('navigator', {
                language: 'cs-CZ',
                userAgent: 'Agent',
            });
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed['accept-language']).toBe('cs-CZ');
        });

        it('never emits a q-value below 0.1', () => {
            const languages = Array.from({ length: 12 }, (_, i) => `l${i}`);
            vi.stubGlobal('navigator', {
                language: 'l0',
                languages,
                userAgent: 'Agent',
            });
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed['accept-language'].endsWith('l11;q=0.1')).toBe(true);
        });

        it('reports the documented accept-encoding approximation', () => {
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed['accept-encoding']).toBe('gzip, deflate, br, zstd');
        });
    });
});

describe('fetchBrowserData()', () => {
    const makeResponse = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
            status,
            headers: { 'content-type': 'application/json' },
        });

    const DETECTED = {
        ip: '192.0.2.42',
        user_agent: 'Real/1.0 (as seen by the API)',
        accept_header: '{"accept":"application/json"}',
    };

    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse(DETECTED));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({
            baseUrl: 'https://example.com',
            shareableKey: 'pk_test',
        });
        client.setClientId('cid_test');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('GETs /cards/browser-data and merges the response over the local fields', async () => {
        vi.stubGlobal('navigator', {
            language: 'cs-CZ',
            userAgent: 'LocalGuess/9.9',
        });

        let capturedReq!: Request;
        fetchMock.mockImplementation(async (req: Request) => {
            capturedReq = req;
            return makeResponse(DETECTED);
        });

        const data = await fetchBrowserData(client);

        expect(capturedReq.method).toBe('GET');
        expect(capturedReq.url).toBe('https://example.com/cards/browser-data');
        // the endpoint is authoritative for all three connection fields
        expect(data.ip).toBe(DETECTED.ip);
        expect(data.user_agent).toBe(DETECTED.user_agent);
        expect(data.accept_header).toBe(DETECTED.accept_header);
        // locally readable fields survive
        expect(data.language).toBe('cs-CZ');
        expect(data.javascript_enabled).toBe(true);
    });

    it('authenticates with the shareable key, not a stored payment token', async () => {
        // The endpoint is secured by shareable_key alone — a Bearer token from
        // attachPayment() would be rejected.
        client.setToken({
            access_token: 'payment-scoped-jwt',
            expires_in: 900,
            token_type: 'bearer',
        });

        let capturedReq!: Request;
        fetchMock.mockImplementation(async (req: Request) => {
            capturedReq = req;
            return makeResponse(DETECTED);
        });

        await fetchBrowserData(client);

        expect(capturedReq.headers.get('Authorization')).toBe(
            `Basic ${globalThis.btoa('cid_test:pk_test')}`,
        );
    });

    it('throws INVALID_CONFIG when no shareable key is configured', async () => {
        const keyless = createHttpClient({ baseUrl: 'https://example.com' });
        const err = await fetchBrowserData(keyless).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(GoPaySDKError);
        expect((err as GoPaySDKError).errorCode).toBe(
            GoPayErrorCodes.INVALID_CONFIG,
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('forwards the abort signal to the request', async () => {
        const controller = new AbortController();
        let capturedReq!: Request;
        fetchMock.mockImplementation(async (req: Request) => {
            capturedReq = req;
            return makeResponse(DETECTED);
        });

        await fetchBrowserData(client, { signal: controller.signal });

        expect(capturedReq.signal.aborted).toBe(false);
        // aborting the caller's controller must reach the in-flight request,
        // which is how unmount() cancels the fetch that precedes a charge
        controller.abort();
        expect(capturedReq.signal.aborted).toBe(true);
    });
});
