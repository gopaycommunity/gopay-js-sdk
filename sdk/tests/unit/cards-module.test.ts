import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCardsApi } from '../../src/modules/cards/cards.module.js';

const makeResponse = (data: unknown, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
    });

const mockCardDetailsResponse = {
    card_id: '8007127320',
    masked_pan: '406821******1234',
    masked_virtual_pan: '489537******6287',
    expiration_month: '01',
    expiration_year: '30',
    scheme: 'VISA',
    corporate: false,
    fingerprint: '73c8d0a48d91def89761...',
    token: 'J7HjFNwzyBOHS+jwIMMktubTwoIRy6qB...',
    card_art_url: 'https://card.art/pic.png',
};

describe('CardsModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: ReturnType<typeof createHttpClient>;
    let cards: ReturnType<typeof createCardsApi>;

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockResolvedValue(makeResponse(mockCardDetailsResponse));
        vi.stubGlobal('fetch', fetchMock);
        client = createHttpClient({ baseUrl: 'https://example.com' });
        client.tokenStore.set({
            access_token: 'at-test',
            refresh_token: 'rt-test',
            expires_in: 900,
            refresh_expires_in: 86400,
            token_type: 'bearer',
        });
        cards = createCardsApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getCardDetails()', () => {
        it('sends GET to /cards/tokens/{cardId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockCardDetailsResponse);
            });

            await cards.getCardDetails('8007127320');

            expect(capturedReq.method).toBe('GET');
            expect(capturedReq.url).toBe(
                'https://example.com/cards/tokens/8007127320',
            );
        });

        it('interpolates cardId correctly into the URL', async () => {
            let capturedUrl = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedUrl = req.url;
                return makeResponse(mockCardDetailsResponse);
            });

            await cards.getCardDetails('card_999');

            expect(capturedUrl).toContain('/cards/tokens/card_999');
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return makeResponse(mockCardDetailsResponse);
            });

            await cards.getCardDetails('8007127320');

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('returns the card details response', async () => {
            const result = await cards.getCardDetails('8007127320');

            expect(result).toEqual(mockCardDetailsResponse);
            expect(result.card_id).toBe('8007127320');
            expect(result.masked_pan).toBe('406821******1234');
            expect(result.scheme).toBe('VISA');
        });

        it('throws when cardId is empty', async () => {
            await expect(cards.getCardDetails('')).rejects.toThrow(
                'cardId is required',
            );
        });
    });

    describe('deleteCard()', () => {
        beforeEach(() => {
            fetchMock.mockReset();
            fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
            vi.stubGlobal('fetch', fetchMock);
        });

        it('sends DELETE to /cards/tokens/{cardId}', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                return new Response(null, { status: 204 });
            });

            await cards.deleteCard('8007127320');

            expect(capturedReq.method).toBe('DELETE');
            expect(capturedReq.url).toBe(
                'https://example.com/cards/tokens/8007127320',
            );
        });

        it('returns void', async () => {
            const result = await cards.deleteCard('8007127320');
            expect(result).toBeUndefined();
        });

        it('throws when cardId is empty', async () => {
            await expect(cards.deleteCard('')).rejects.toThrow(
                'cardId is required',
            );
        });
    });

    describe('tokenizeEncryptedCard()', () => {
        const mockTokenResponse = {
            card_id: 'tok_abc123',
            masked_pan: '411111******1111',
            expiration_month: '12',
            expiration_year: '28',
            scheme: 'VISA',
            corporate: false,
            fingerprint: 'fp_xyz',
            token: 'perm_token',
        };

        beforeEach(() => {
            fetchMock.mockReset();
            fetchMock.mockResolvedValue(makeResponse(mockTokenResponse));
            vi.stubGlobal('fetch', fetchMock);
        });

        it('sends POST to /cards/tokens with the payload', async () => {
            let capturedReq!: Request;
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                capturedBody = await req.text();
                return makeResponse(mockTokenResponse);
            });

            await cards.tokenizeEncryptedCard('jwe.payload.here');

            expect(capturedReq.method).toBe('POST');
            expect(capturedReq.url).toBe('https://example.com/cards/tokens');
            expect(JSON.parse(capturedBody)).toEqual({
                payload: 'jwe.payload.here',
            });
        });

        it('returns the permanent card token details', async () => {
            const result =
                await cards.tokenizeEncryptedCard('jwe.payload.here');
            expect(result).toEqual(mockTokenResponse);
        });

        it('sends Bearer token from token store', async () => {
            let capturedReq!: Request;
            fetchMock.mockImplementation(async (req: Request) => {
                capturedReq = req;
                await req.text();
                return makeResponse(mockTokenResponse);
            });

            await cards.tokenizeEncryptedCard('jwe.payload.here');

            expect(capturedReq.headers.get('Authorization')).toBe(
                'Bearer at-test',
            );
        });

        it('throws when payload is empty', async () => {
            await expect(cards.tokenizeEncryptedCard('')).rejects.toThrow(
                'payload is required',
            );
        });
    });
});
