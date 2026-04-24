import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from '../../src/http/client.js';
import { createLinksApi } from '../../src/modules/links/links.module.js';

const makeResponse = (data: unknown, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
    });

const makeEmptyResponse = (status = 204) =>
    new Response(null, { status, statusText: 'No Content' });

const mockLinkDetails = {
    id: 'lnk_200000001',
    url: 'https://go.pay/xfv56td3y5',
    active: true,
    reusable: true,
    expires_at: '2027-04-21T14:30:00',
};

const createParams = {
    reusable: true,
    expires_at: '2027-04-21T14:30:00',
    payment: {
        amount: 1000,
        currency: 'CZK' as const,
        order_number: 'ORDER-LINK-001',
        customer: { email: 'customer@example.com' },
        callback: {
            notification_url: 'https://shop.example.com/notify',
            return_url: 'https://shop.example.com/return',
        },
    },
};

describe('LinksModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let links: ReturnType<typeof createLinksApi>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(makeResponse(mockLinkDetails));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: 'https://example.com' });
        client.tokenStore.set({
            access_token: 'at-test',
            refresh_token: 'rt-test',
            expires_in: 900,
            refresh_expires_in: 86400,
            token_type: 'bearer',
        });
        links = createLinksApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('createPaymentLink()', () => {
        it('sends POST to /eshops/{goid}/links', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockLinkDetails, 201);
            });

            await links.createPaymentLink('goid-123', createParams);

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe(
                'https://example.com/eshops/goid-123/links',
            );
        });

        it('sends JSON body with link params', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(mockLinkDetails, 201);
            });

            await links.createPaymentLink('goid-123', createParams);

            expect(JSON.parse(capturedBody)).toEqual(createParams);
        });

        it('sends Bearer token', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockLinkDetails, 201);
            });

            await links.createPaymentLink('goid-123', createParams);

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns link details', async () => {
            fetchMock.mockResolvedValue(makeResponse(mockLinkDetails, 201));

            const result = await links.createPaymentLink(
                'goid-123',
                createParams,
            );

            expect(result).toEqual(mockLinkDetails);
            expect(result.id).toBe('lnk_200000001');
        });
    });

    describe('linkStatus()', () => {
        it('throws when linkId is empty', async () => {
            await expect(links.linkStatus('')).rejects.toThrow(
                'linkId is required',
            );
        });

        it('sends GET to /links/{link_id}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockLinkDetails);
            });

            await links.linkStatus('lnk_200000001');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/links/lnk_200000001',
            );
        });

        it('returns link details', async () => {
            const result = await links.linkStatus('lnk_200000001');

            expect(result).toEqual(mockLinkDetails);
        });
    });

    describe('disableLink()', () => {
        it('throws when linkId is empty', async () => {
            await expect(links.disableLink('')).rejects.toThrow(
                'linkId is required',
            );
        });

        it('sends DELETE to /links/{link_id}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeEmptyResponse();
            });

            await links.disableLink('lnk_200000001');

            expect(capturedReq.method).toBe('DELETE');
            expect(capturedReq.url).toBe(
                'https://example.com/links/lnk_200000001',
            );
        });

        it('resolves void', async () => {
            fetchMock.mockResolvedValue(makeEmptyResponse());

            const result = await links.disableLink('lnk_200000001');

            expect(result).toBeUndefined();
        });
    });
});
