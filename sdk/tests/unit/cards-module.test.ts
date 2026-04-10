// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayHTTPError, GoPaySDKError } from '../../src/errors.js';
import { HttpClient } from '../../src/http/client.js';
import type { TokenStore } from '../../src/http/token-store.js';
import { DEFAULT_CARD_FORM_THEME } from '../../src/modules/cards/card-form-themes.js';
import { CardsModule } from '../../src/modules/cards/cards.module.js';
import type { CardFormTheme } from '../../src/modules/cards/iframe-protocol.js';

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
        // First call: GET /encryption/card-form-url; subsequent calls: POST /cards/tokens
        fetchMock = vi
            .fn()
            .mockResolvedValueOnce(makeResponse({ card_form_url: IFRAME_SRC }))
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
        // ── card form URL fetching ─────────────────────────────────────────────

        describe('card form URL fetching', () => {
            it('fetches from GET /encryption/card-form-url', async () => {
                await cards.mountCardForm(container);
                const req = fetchMock.mock.calls[0][0] as Request;
                expect(req.method).toBe('GET');
                expect(req.url).toContain('/encryption/card-form-url');
            });

            it('uses the returned card_form_url as the iframe src', async () => {
                await cards.mountCardForm(container);
                const url = new URL(getIframe().src);
                expect(`${url.origin}${url.pathname}`).toBe(IFRAME_SRC);
            });

            it('rejects when card_form_url is missing from response', async () => {
                fetchMock.mockReset();
                fetchMock.mockResolvedValue(makeResponse({}));
                const err = await cards
                    .mountCardForm(container)
                    .catch((e: unknown) => e);
                expect(err).toBeInstanceOf(GoPaySDKError);
            });
        });

        // ── iframe mounting ───────────────────────────────────────────────────

        it('appends an iframe into the container with the correct base src', async () => {
            await cards.mountCardForm(container);
            const iframe = getIframe();
            expect(iframe).not.toBeNull();
            const url = new URL(iframe.src);
            expect(`${url.origin}${url.pathname}`).toBe(IFRAME_SRC);
        });

        it('appends ?origin=<page-origin> to the iframe src', async () => {
            vi.stubGlobal('location', {
                origin: 'https://merchant.example.com',
                href: 'https://merchant.example.com/checkout',
            });
            await cards.mountCardForm(container);
            const url = new URL(getIframe().src);
            expect(url.searchParams.get('origin')).toBe(
                'https://merchant.example.com',
            );
            vi.unstubAllGlobals();
        });

        it('appends ?origin= as empty string when location.origin is not available', async () => {
            vi.stubGlobal('location', {
                href: 'https://merchant.example.com/checkout',
            });
            await cards.mountCardForm(container);
            const url = new URL(getIframe().src);
            expect(url.searchParams.get('origin')).toBe('');
            vi.unstubAllGlobals();
        });

        it('replaces existing children before mounting', async () => {
            container.appendChild(document.createElement('div'));
            await cards.mountCardForm(container);
            expect(container.children).toHaveLength(1);
            expect(container.querySelector('iframe')).not.toBeNull();
        });

        it('resolves result with the token response when GOPAY_CARD_ENCRYPT_RESULT arrives', async () => {
            const { result } = await cards.mountCardForm(container);
            const iframe = getIframe();
            dispatchCardMessage(iframe);
            expect(await result).toEqual(MOCK_TOKEN_RESPONSE);
        });

        it('POSTs the JWE payload to /cards/tokens', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/encryption/card-form-url')) {
                    return makeResponse({ card_form_url: IFRAME_SRC });
                }
                capturedBody = await req.text();
                return makeResponse(MOCK_TOKEN_RESPONSE);
            });

            const { result } = await cards.mountCardForm(container);
            dispatchCardMessage(getIframe());
            await result;

            const tokensReq = fetchMock.mock.calls[1][0] as Request;
            expect(tokensReq.method).toBe('POST');
            expect(tokensReq.url).toContain('/cards/tokens');
            expect(JSON.parse(capturedBody)).toEqual({
                payload: MOCK_JWE,
                permanent: false,
            });
        });

        it('removes the iframe and listener after completion', async () => {
            const { result } = await cards.mountCardForm(container);
            const iframe = getIframe();
            dispatchCardMessage(iframe);
            await result;
            expect(container.querySelector('iframe')).toBeNull();
        });

        it('ignores messages from a different origin', async () => {
            const { result } = await cards.mountCardForm(container);
            dispatchCardMessage(getIframe(), { origin: 'https://evil.com' });

            let settled = false;
            result
                .then(() => {
                    settled = true;
                })
                .catch(() => {
                    settled = true;
                });
            await new Promise((r) => setTimeout(r, 20));
            expect(settled).toBe(false);
            // Only getCardFormUrl was called — createToken was not
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('ignores messages from a different source', async () => {
            const { result } = await cards.mountCardForm(container);
            dispatchCardMessage(getIframe(), { source: window });

            let settled = false;
            result
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
            const { result } = await cards.mountCardForm(container);
            dispatchCardMessage(getIframe(), { type: 'UNKNOWN_MSG' });

            let settled = false;
            result
                .then(() => {
                    settled = true;
                })
                .catch(() => {
                    settled = true;
                });
            await new Promise((r) => setTimeout(r, 20));
            expect(settled).toBe(false);
        });

        it('returns a rejected result immediately when no client token is set', async () => {
            const freshClient = new HttpClient({
                baseUrl: 'https://example.com',
            });
            const freshCards = new CardsModule(freshClient);
            const controller = await freshCards.mountCardForm(container);
            const err = await controller.result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).errorCode).toBe('AUTH_TOKEN_MISSING');
            // No-op controller methods should not throw
            expect(() =>
                controller.setTheme(DEFAULT_CARD_FORM_THEME),
            ).not.toThrow();
            expect(() => controller.setLocale('en')).not.toThrow();
            expect(() => controller.submit()).not.toThrow();
            expect(controller.isValid).toBe(false);
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('GOPAY_CARD_ENCRYPT_READY message does not settle result', async () => {
            const { result } = await cards.mountCardForm(container);
            dispatchCardMessage(getIframe(), {
                type: 'GOPAY_CARD_ENCRYPT_READY',
            });

            let settled = false;
            result
                .then(() => {
                    settled = true;
                })
                .catch(() => {
                    settled = true;
                });
            await new Promise((r) => setTimeout(r, 20));
            expect(settled).toBe(false);
        });

        it('GOPAY_CARD_ENCRYPT_ERROR rejects result with GoPaySDKError', async () => {
            const { result } = await cards.mountCardForm(container);
            window.dispatchEvent(
                new MessageEvent('message', {
                    data: {
                        type: 'GOPAY_CARD_ENCRYPT_ERROR',
                        error: 'User cancelled',
                    },
                    origin: IFRAME_ORIGIN,
                    source: getIframe().contentWindow,
                }),
            );

            const err = await result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPaySDKError);
            expect((err as GoPaySDKError).message).toContain('User cancelled');
            expect((err as GoPaySDKError).errorCode).toBe('CARD_FORM_ERROR');
        });

        it('removes the iframe on GOPAY_CARD_ENCRYPT_ERROR', async () => {
            const { result } = await cards.mountCardForm(container);
            window.dispatchEvent(
                new MessageEvent('message', {
                    data: { type: 'GOPAY_CARD_ENCRYPT_ERROR', error: 'fail' },
                    origin: IFRAME_ORIGIN,
                    source: getIframe().contentWindow,
                }),
            );
            await result.catch(() => {});
            expect(container.querySelector('iframe')).toBeNull();
        });

        it('GOPAY_CARD_FORM_HEIGHT resizes the iframe', async () => {
            await cards.mountCardForm(container);
            const iframe = getIframe();
            window.dispatchEvent(
                new MessageEvent('message', {
                    data: { type: 'GOPAY_CARD_FORM_HEIGHT', height: 350 },
                    origin: IFRAME_ORIGIN,
                    source: iframe.contentWindow,
                }),
            );
            expect(iframe.style.height).toBe('350px');
        });

        it('ignores GOPAY_CARD_FORM_HEIGHT when height is not a number', async () => {
            await cards.mountCardForm(container);
            const iframe = getIframe();
            const originalHeight = iframe.style.height;
            window.dispatchEvent(
                new MessageEvent('message', {
                    data: { type: 'GOPAY_CARD_FORM_HEIGHT', height: 'tall' },
                    origin: IFRAME_ORIGIN,
                    source: iframe.contentWindow,
                }),
            );
            expect(iframe.style.height).toBe(originalHeight);
        });

        it('ignores GOPAY_CARD_FORM_VALIDITY when isValid is not a boolean', async () => {
            const cb = vi.fn();
            await cards.mountCardForm(container, { onValidityChange: cb });
            window.dispatchEvent(
                new MessageEvent('message', {
                    data: { type: 'GOPAY_CARD_FORM_VALIDITY', isValid: 'yes' },
                    origin: IFRAME_ORIGIN,
                    source: getIframe().contentWindow,
                }),
            );
            expect(cb).not.toHaveBeenCalled();
        });

        it('rejects result when the /cards/tokens API call fails', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                if (req.url.includes('/encryption/card-form-url')) {
                    return makeResponse({ card_form_url: IFRAME_SRC });
                }
                await req.text();
                return makeResponse({ error: 'FORBIDDEN' }, 403, 'Forbidden');
            });

            const { result } = await cards.mountCardForm(container);
            dispatchCardMessage(getIframe());

            const err = await result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(403);
        });

        // ── Helper: mount with a postMessage spy wired onto the iframe ────────

        async function mountWithPostMessageSpy(options?: {
            theme?: CardFormTheme;
            locale?: string;
            submitMode?: 'internal' | 'external';
        }) {
            const postMessageSpy = vi.fn();
            const contentWindowMock = { postMessage: postMessageSpy };
            const realCreate = document.createElement.bind(document);
            vi.spyOn(document, 'createElement').mockImplementation(
                (tag: string) => {
                    const node = realCreate(tag);
                    if (tag === 'iframe') {
                        Object.defineProperty(node, 'contentWindow', {
                            get: () => contentWindowMock,
                        });
                    }
                    return node;
                },
            );
            const controller = await cards.mountCardForm(container, options);
            const iframe = getIframe();
            iframe.onload?.(new Event('load'));
            return { postMessageSpy, controller };
        }

        // ── GOPAY_CARD_FORM_INIT carries initial theme and locale ─────────────

        describe('GOPAY_CARD_FORM_INIT', () => {
            it('includes DEFAULT_CARD_FORM_THEME in INIT when no theme option given', async () => {
                const { postMessageSpy } = await mountWithPostMessageSpy();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        theme: DEFAULT_CARD_FORM_THEME,
                    }),
                    '*',
                );
            });

            it('includes the provided custom theme in INIT', async () => {
                const customTheme: CardFormTheme = {
                    labelColor: '#ff0000',
                    submitBorderRadius: 8,
                };
                const { postMessageSpy } = await mountWithPostMessageSpy({
                    theme: customTheme,
                });
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        theme: customTheme,
                    }),
                    '*',
                );
            });

            it('includes navigator.language as locale in INIT when no locale option given', async () => {
                vi.stubGlobal('navigator', { language: 'cs-CZ' });
                const { postMessageSpy } = await mountWithPostMessageSpy();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        locale: 'cs-CZ',
                    }),
                    '*',
                );
                vi.unstubAllGlobals();
            });

            it('includes the provided locale override in INIT', async () => {
                const { postMessageSpy } = await mountWithPostMessageSpy({
                    locale: 'de-DE',
                });
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        locale: 'de-DE',
                    }),
                    '*',
                );
            });

            it('sends client_id as empty string when JWT payload has no string sub claim', async () => {
                // 'e30=' is btoa('{}') — valid base64 JSON with no sub claim
                tokenStore(client).set({
                    access_token: 'header.e30=.sig',
                    refresh_token: 'rt-test',
                    expires_in: 900,
                    refresh_expires_in: 86400,
                    token_type: 'bearer',
                });
                const { postMessageSpy } = await mountWithPostMessageSpy();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        client_id: '',
                    }),
                    '*',
                );
            });

            it('extracts client_id from JWT sub claim when present', async () => {
                // btoa('{"sub":"merchant-123"}')
                tokenStore(client).set({
                    access_token: 'header.eyJzdWIiOiJtZXJjaGFudC0xMjMifQ==.sig',
                    refresh_token: 'rt-test',
                    expires_in: 900,
                    refresh_expires_in: 86400,
                    token_type: 'bearer',
                });
                const { postMessageSpy } = await mountWithPostMessageSpy();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        client_id: 'merchant-123',
                    }),
                    '*',
                );
            });

            it('defaults locale to "en" when navigator has no language', async () => {
                vi.stubGlobal('navigator', {});
                const { postMessageSpy } = await mountWithPostMessageSpy();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        locale: 'en',
                    }),
                    '*',
                );
                vi.unstubAllGlobals();
            });
        });

        // ── setTheme() / setLocale() controller methods ───────────────────────

        describe('setTheme()', () => {
            it('sends GOPAY_CARD_SET_THEME to the iframe', async () => {
                const { postMessageSpy, controller } =
                    await mountWithPostMessageSpy();
                postMessageSpy.mockClear();
                const newTheme: CardFormTheme = { labelColor: '#00ff00' };
                controller.setTheme(newTheme);
                expect(postMessageSpy).toHaveBeenCalledOnce();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    { type: 'GOPAY_CARD_SET_THEME', theme: newTheme },
                    '*',
                );
            });

            it('is a no-op after the form completes', async () => {
                const { postMessageSpy, controller } =
                    await mountWithPostMessageSpy();
                dispatchCardMessage(getIframe());
                await controller.result;
                postMessageSpy.mockClear();
                controller.setTheme({ labelColor: '#ff0000' });
                expect(postMessageSpy).not.toHaveBeenCalled();
            });
        });

        describe('setLocale()', () => {
            it('sends GOPAY_CARD_SET_LOCALE to the iframe', async () => {
                const { postMessageSpy, controller } =
                    await mountWithPostMessageSpy();
                postMessageSpy.mockClear();
                controller.setLocale('cs');
                expect(postMessageSpy).toHaveBeenCalledOnce();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    { type: 'GOPAY_CARD_SET_LOCALE', locale: 'cs' },
                    '*',
                );
            });

            it('is a no-op after the form completes', async () => {
                const { postMessageSpy, controller } =
                    await mountWithPostMessageSpy();
                dispatchCardMessage(getIframe());
                await controller.result;
                postMessageSpy.mockClear();
                controller.setLocale('de');
                expect(postMessageSpy).not.toHaveBeenCalled();
            });
        });

        // ── External submit mode ──────────────────────────────────────────────

        describe('submitMode', () => {
            it('includes submitMode: "external" in INIT when option is passed', async () => {
                const { postMessageSpy } = await mountWithPostMessageSpy({
                    submitMode: 'external',
                });
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        submitMode: 'external',
                    }),
                    '*',
                );
            });

            it('defaults to submitMode: "internal" in INIT when no option is passed', async () => {
                const { postMessageSpy } = await mountWithPostMessageSpy();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        submitMode: 'internal',
                    }),
                    '*',
                );
            });

            it('submit() posts GOPAY_CARD_REQUEST_SUBMIT in external submit', async () => {
                const { postMessageSpy, controller } =
                    await mountWithPostMessageSpy({
                        submitMode: 'external',
                    });
                postMessageSpy.mockClear();
                controller.submit();
                expect(postMessageSpy).toHaveBeenCalledOnce();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    { type: 'GOPAY_CARD_REQUEST_SUBMIT' },
                    '*',
                );
            });

            it('submit() throws in internal submit', async () => {
                const { controller } = await mountWithPostMessageSpy();
                expect(() => controller.submit()).toThrow(
                    /external submit mode/,
                );
            });

            it('submit() is a no-op after the form completes', async () => {
                const { postMessageSpy, controller } =
                    await mountWithPostMessageSpy({
                        submitMode: 'external',
                    });
                dispatchCardMessage(getIframe());
                await controller.result;
                postMessageSpy.mockClear();
                controller.submit();
                expect(postMessageSpy).not.toHaveBeenCalled();
            });

            it('GOPAY_CARD_FORM_VALIDITY updates controller.isValid', async () => {
                const controller = await cards.mountCardForm(container, {
                    submitMode: 'external',
                });
                expect(controller.isValid).toBe(false);
                window.dispatchEvent(
                    new MessageEvent('message', {
                        data: {
                            type: 'GOPAY_CARD_FORM_VALIDITY',
                            isValid: true,
                        },
                        origin: IFRAME_ORIGIN,
                        source: getIframe().contentWindow,
                    }),
                );
                expect(controller.isValid).toBe(true);
            });

            it('onValidityChange fires when validity changes', async () => {
                const cb = vi.fn();
                await cards.mountCardForm(container, {
                    submitMode: 'external',
                    onValidityChange: cb,
                });
                window.dispatchEvent(
                    new MessageEvent('message', {
                        data: {
                            type: 'GOPAY_CARD_FORM_VALIDITY',
                            isValid: true,
                        },
                        origin: IFRAME_ORIGIN,
                        source: getIframe().contentWindow,
                    }),
                );
                expect(cb).toHaveBeenCalledOnce();
                expect(cb).toHaveBeenCalledWith(true);
            });

            it('onValidityChange deduplicates identical consecutive values', async () => {
                const cb = vi.fn();
                await cards.mountCardForm(container, {
                    submitMode: 'external',
                    onValidityChange: cb,
                });
                const dispatchValidity = (isValid: boolean) =>
                    window.dispatchEvent(
                        new MessageEvent('message', {
                            data: { type: 'GOPAY_CARD_FORM_VALIDITY', isValid },
                            origin: IFRAME_ORIGIN,
                            source: getIframe().contentWindow,
                        }),
                    );
                dispatchValidity(true);
                dispatchValidity(true);
                dispatchValidity(false);
                expect(cb).toHaveBeenCalledTimes(2);
                expect(cb).toHaveBeenNthCalledWith(1, true);
                expect(cb).toHaveBeenNthCalledWith(2, false);
            });
        });
    });
});
