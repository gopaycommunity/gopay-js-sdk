// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayHTTPError } from '../src/errors.js';
import { HttpClient } from '../src/http/client.js';
import type { TokenStore } from '../src/http/token-store.js';
import { CardsModule } from '../src/modules/cards/cards.module.js';

const tokenStore = (client: HttpClient) =>
    (client as unknown as { tokenStore: TokenStore }).tokenStore;

const makeResponse = (data: unknown, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
    });

const IFRAME_SRC = 'https://gopay.com/card-encrypt.html';
const IFRAME_ORIGIN = 'https://gopay.com';
const MOCK_TOKEN_RESPONSE = {
    token: 'card-token-abc123',
    masked_pan: '411111******1111',
};
const MOCK_JWE = 'jwe-payload-xyz';

function dispatchCardMessage(
    iframe: HTMLIFrameElement,
    overrides: {
        origin?: string;
        source?: MessageEventSource | null;
        type?: string;
    } = {},
) {
    window.dispatchEvent(
        new MessageEvent('message', {
            data: {
                type: overrides.type ?? 'GOPAY_CARD_ENCRYPT_RESULT',
                card_token: MOCK_JWE,
            },
            origin: overrides.origin ?? IFRAME_ORIGIN,
            source:
                'source' in overrides ? overrides.source : iframe.contentWindow,
        }),
    );
}

describe('CardsModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: HttpClient;
    let cards: CardsModule;
    let container: HTMLDivElement;

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockResolvedValue(makeResponse(MOCK_TOKEN_RESPONSE));
        vi.stubGlobal('fetch', fetchMock);
        client = new HttpClient({ baseUrl: 'https://example.com' });
        tokenStore(client).set({
            access_token: 'at-test',
            refresh_token: 'rt-test',
            expires_in: 900,
            refresh_expires_in: 86400,
            token_type: 'bearer',
        });
        cards = new CardsModule(client);
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
    });

    function getIframe(): HTMLIFrameElement {
        const el = container.querySelector('iframe');
        if (!el) throw new Error('iframe not found in container');
        return el as HTMLIFrameElement;
    }

    describe('mountCardForm()', () => {
        it('appends an iframe with the given src into the container', () => {
            cards.mountCardForm(container, IFRAME_SRC);
            const iframe = getIframe();
            expect(iframe).not.toBeNull();
            expect(iframe?.src).toBe(IFRAME_SRC);
        });

        it('replaces existing children before mounting', () => {
            container.appendChild(document.createElement('div'));
            cards.mountCardForm(container, IFRAME_SRC);
            expect(container.children).toHaveLength(1);
            expect(container.querySelector('iframe')).not.toBeNull();
        });

        it('resolves with the token response when GOPAY_CARD_ENCRYPT_RESULT arrives', async () => {
            const promise = cards.mountCardForm(container, IFRAME_SRC);
            const iframe = getIframe();
            dispatchCardMessage(iframe);
            const result = await promise;
            expect(result).toEqual(MOCK_TOKEN_RESPONSE);
        });

        it('POSTs the JWE payload to /cards/tokens', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(MOCK_TOKEN_RESPONSE);
            });

            const promise = cards.mountCardForm(container, IFRAME_SRC);
            dispatchCardMessage(getIframe());
            await promise;

            const req = fetchMock.mock.calls[0][0] as Request;
            expect(req.method).toBe('POST');
            expect(req.url).toContain('/cards/tokens');
            expect(JSON.parse(capturedBody)).toEqual({ payload: MOCK_JWE });
        });

        it('removes the iframe and listener after completion', async () => {
            const promise = cards.mountCardForm(container, IFRAME_SRC);
            const iframe = getIframe();
            dispatchCardMessage(iframe);
            await promise;
            expect(container.querySelector('iframe')).toBeNull();
        });

        it('ignores messages from a different origin', async () => {
            const promise = cards.mountCardForm(container, IFRAME_SRC);
            dispatchCardMessage(getIframe(), { origin: 'https://evil.com' });

            let settled = false;
            promise
                .then(() => {
                    settled = true;
                })
                .catch(() => {
                    settled = true;
                });
            await new Promise((r) => setTimeout(r, 20));
            expect(settled).toBe(false);
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('ignores messages from a different source', async () => {
            const promise = cards.mountCardForm(container, IFRAME_SRC);
            dispatchCardMessage(getIframe(), { source: window });

            let settled = false;
            promise
                .then(() => {
                    settled = true;
                })
                .catch(() => {
                    settled = true;
                });
            await new Promise((r) => setTimeout(r, 20));
            expect(settled).toBe(false);
        });

        it('ignores messages with an unrecognised type', async () => {
            const promise = cards.mountCardForm(container, IFRAME_SRC);
            dispatchCardMessage(getIframe(), { type: 'UNKNOWN_MSG' });

            let settled = false;
            promise
                .then(() => {
                    settled = true;
                })
                .catch(() => {
                    settled = true;
                });
            await new Promise((r) => setTimeout(r, 20));
            expect(settled).toBe(false);
        });

        it('rejects when the /cards/tokens API call fails', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse({ error: 'FORBIDDEN' }, 403, 'Forbidden');
            });

            const promise = cards.mountCardForm(container, IFRAME_SRC);
            dispatchCardMessage(getIframe());

            const err = await promise.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(403);
        });
    });
});
