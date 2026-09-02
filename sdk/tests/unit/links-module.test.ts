import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import { createLinksApi } from '../../src/modules/links/links.module.js';
import { makeEmptyResponse, makeResponse } from './helpers.js';

const GOID = '8123456789';

// `as const` so `currency` keeps its literal type: inferred as `string` it does
// not satisfy the Currency union, which sdk/tsconfig.tests.json now checks.
const mockPayment = {
    amount: 15000,
    currency: 'CZK',
    order_number: '2026-00042',
    customer: { email: 'payer@example.com' },
    callback: {
        notification_url: 'https://eshop.example.com/gopay/notify',
        return_url: 'https://eshop.example.com/gopay/return',
    },
} as const;

const mockLinkDetails = {
    id: '3405871122',
    url: 'https://gate.gopay.com/gp-gw/l/Xk8mQ2pR7t',
    active: true,
    reusable: true,
    payment: mockPayment,
};

describe('LinksModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let links: ReturnType<typeof createLinksApi>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse(mockLinkDetails));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: 'https://example.com' });
        client.setToken({
            access_token: 'test-token',
            expires_in: 3600,
            token_type: 'bearer',
        });
        links = createLinksApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // createPaymentLink()
    // -------------------------------------------------------------------------

    describe('createPaymentLink()', () => {
        it('sends POST to /eshops/{goid}/links', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockLinkDetails, 201, 'Created');
            });

            await links.createPaymentLink(GOID, { payment: mockPayment });

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                `https://example.com/eshops/${GOID}/links`,
            );
        });

        it('sends the payment data as the JSON body', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockLinkDetails, 201, 'Created');
            });

            await links.createPaymentLink(GOID, {
                payment: mockPayment,
                expires_in: 3600,
                reusable: false,
            });

            expect(JSON.parse(capturedBody)).toEqual({
                payment: mockPayment,
                expires_in: 3600,
                reusable: false,
            });
        });

        it('omits reusable from the body when the caller omits it', async () => {
            // The gateway defaults reusable to true. Sending an explicit value
            // the caller never asked for would silently pin the default, so a
            // later server-side change of it would not reach this SDK's users.
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockLinkDetails, 201, 'Created');
            });

            await links.createPaymentLink(GOID, { payment: mockPayment });

            expect(JSON.parse(capturedBody)).not.toHaveProperty('reusable');
        });

        it('sends Bearer token', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockLinkDetails, 201, 'Created');
            });

            await links.createPaymentLink(GOID, { payment: mockPayment });

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer test-token',
            );
        });

        it('returns the link details, including id and url', async () => {
            const result = await links.createPaymentLink(GOID, {
                payment: mockPayment,
            });
            expect(result).toEqual(mockLinkDetails);
        });

        it('throws INVALID_ARGUMENT when goid is empty', async () => {
            const err = await links
                .createPaymentLink('', { payment: mockPayment })
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // getPaymentLink()
    // -------------------------------------------------------------------------

    describe('getPaymentLink()', () => {
        it('sends GET to /eshops/{goid}/links/{linkId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockLinkDetails);
            });

            await links.getPaymentLink(GOID, '3405871122');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                `https://example.com/eshops/${GOID}/links/3405871122`,
            );
        });

        it('returns link details', async () => {
            const result = await links.getPaymentLink(GOID, '3405871122');
            expect(result).toEqual(mockLinkDetails);
        });

        it('reports an expired link as inactive with a stop_reason', async () => {
            // Expiry is evaluated on read, so a caller never has to compare
            // expires_at against the clock — this asserts the SDK passes that
            // server-side verdict through untouched.
            fetchMock.mockResolvedValue(
                makeResponse({
                    ...mockLinkDetails,
                    active: false,
                    expires_at: '2026-08-18T14:35:12Z',
                    stop_reason: 'EXPIRED',
                }),
            );

            const result = await links.getPaymentLink(GOID, '3405871122');

            expect(result.active).toBe(false);
            expect(result.stop_reason).toBe('EXPIRED');
        });

        it('throws INVALID_ARGUMENT when goid is empty', async () => {
            const err = await links
                .getPaymentLink('', '3405871122')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
        });

        it('throws INVALID_ARGUMENT when linkId is empty', async () => {
            const err = await links
                .getPaymentLink(GOID, '')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // disablePaymentLink()
    // -------------------------------------------------------------------------

    describe('disablePaymentLink()', () => {
        it('sends DELETE to /eshops/{goid}/links/{linkId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeEmptyResponse();
            });

            await links.disablePaymentLink(GOID, '3405871122');

            expect(capturedReq.method).toBe('DELETE');
            expect(capturedReq.url).toBe(
                `https://example.com/eshops/${GOID}/links/3405871122`,
            );
        });

        it('resolves with void on 204', async () => {
            fetchMock.mockResolvedValue(makeEmptyResponse());
            await expect(
                links.disablePaymentLink(GOID, '3405871122'),
            ).resolves.toBeUndefined();
        });

        it('throws INVALID_ARGUMENT when goid is empty', async () => {
            const err = await links
                .disablePaymentLink('', '3405871122')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('throws INVALID_ARGUMENT when linkId is empty', async () => {
            const err = await links
                .disablePaymentLink(GOID, '')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe(
                GoPayErrorCodes.INVALID_ARGUMENT,
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });
});
