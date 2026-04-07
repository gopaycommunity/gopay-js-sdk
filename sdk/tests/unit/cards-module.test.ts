// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayHTTPError } from '../../src/errors.js';
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

        it('resolves result with the token response when GOPAY_CARD_ENCRYPT_RESULT arrives', async () => {
            const { result } = cards.mountCardForm(container, IFRAME_SRC);
            const iframe = getIframe();
            dispatchCardMessage(iframe);
            expect(await result).toEqual(MOCK_TOKEN_RESPONSE);
        });

        it('POSTs the JWE payload to /cards/tokens', async () => {
            let capturedBody = '';
            fetchMock.mockImplementation(async (req: Request) => {
                capturedBody = await req.text();
                return makeResponse(MOCK_TOKEN_RESPONSE);
            });

            const { result } = cards.mountCardForm(container, IFRAME_SRC);
            dispatchCardMessage(getIframe());
            await result;

            const req = fetchMock.mock.calls[0][0] as Request;
            expect(req.method).toBe('POST');
            expect(req.url).toContain('/cards/tokens');
            expect(JSON.parse(capturedBody)).toEqual({ payload: MOCK_JWE });
        });

        it('removes the iframe and listener after completion', async () => {
            const { result } = cards.mountCardForm(container, IFRAME_SRC);
            const iframe = getIframe();
            dispatchCardMessage(iframe);
            await result;
            expect(container.querySelector('iframe')).toBeNull();
        });

        it('ignores messages from a different origin', async () => {
            const { result } = cards.mountCardForm(container, IFRAME_SRC);
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
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('ignores messages from a different source', async () => {
            const { result } = cards.mountCardForm(container, IFRAME_SRC);
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
            const { result } = cards.mountCardForm(container, IFRAME_SRC);
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

        it('rejects result when the /cards/tokens API call fails', async () => {
            fetchMock.mockImplementation(async (req: Request) => {
                await req.text();
                return makeResponse({ error: 'FORBIDDEN' }, 403, 'Forbidden');
            });

            const { result } = cards.mountCardForm(container, IFRAME_SRC);
            dispatchCardMessage(getIframe());

            const err = await result.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect((err as GoPayHTTPError).status).toBe(403);
        });

        // ── Helper: mount with a postMessage spy wired onto the iframe ────────

        function mountWithPostMessageSpy(options?: {
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
            const controller = cards.mountCardForm(
                container,
                IFRAME_SRC,
                options,
            );
            const iframe = getIframe();
            iframe.onload?.(new Event('load'));
            return { postMessageSpy, controller };
        }

        // ── GOPAY_CARD_FORM_INIT carries initial theme and locale ─────────────

        describe('GOPAY_CARD_FORM_INIT', () => {
            it('includes DEFAULT_CARD_FORM_THEME in INIT when no theme option given', () => {
                const { postMessageSpy } = mountWithPostMessageSpy();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        theme: DEFAULT_CARD_FORM_THEME,
                    }),
                    IFRAME_ORIGIN,
                );
            });

            it('includes the provided custom theme in INIT', () => {
                const customTheme: CardFormTheme = {
                    labelColor: '#ff0000',
                    submitBorderRadius: 8,
                };
                const { postMessageSpy } = mountWithPostMessageSpy({
                    theme: customTheme,
                });
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        theme: customTheme,
                    }),
                    IFRAME_ORIGIN,
                );
            });

            it('includes navigator.language as locale in INIT when no locale option given', () => {
                vi.stubGlobal('navigator', { language: 'cs-CZ' });
                const { postMessageSpy } = mountWithPostMessageSpy();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        locale: 'cs-CZ',
                    }),
                    IFRAME_ORIGIN,
                );
                vi.unstubAllGlobals();
            });

            it('includes the provided locale override in INIT', () => {
                const { postMessageSpy } = mountWithPostMessageSpy({
                    locale: 'de-DE',
                });
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        locale: 'de-DE',
                    }),
                    IFRAME_ORIGIN,
                );
            });
        });

        // ── setTheme() / setLocale() controller methods ───────────────────────

        describe('setTheme()', () => {
            it('sends GOPAY_CARD_SET_THEME to the iframe', () => {
                const { postMessageSpy, controller } =
                    mountWithPostMessageSpy();
                postMessageSpy.mockClear();
                const newTheme: CardFormTheme = { labelColor: '#00ff00' };
                controller.setTheme(newTheme);
                expect(postMessageSpy).toHaveBeenCalledOnce();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    { type: 'GOPAY_CARD_SET_THEME', theme: newTheme },
                    IFRAME_ORIGIN,
                );
            });

            it('is a no-op after the form completes', async () => {
                const { postMessageSpy, controller } =
                    mountWithPostMessageSpy();
                dispatchCardMessage(getIframe());
                await controller.result;
                postMessageSpy.mockClear();
                controller.setTheme({ labelColor: '#ff0000' });
                expect(postMessageSpy).not.toHaveBeenCalled();
            });
        });

        describe('setLocale()', () => {
            it('sends GOPAY_CARD_SET_LOCALE to the iframe', () => {
                const { postMessageSpy, controller } =
                    mountWithPostMessageSpy();
                postMessageSpy.mockClear();
                controller.setLocale('cs');
                expect(postMessageSpy).toHaveBeenCalledOnce();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    { type: 'GOPAY_CARD_SET_LOCALE', locale: 'cs' },
                    IFRAME_ORIGIN,
                );
            });

            it('is a no-op after the form completes', async () => {
                const { postMessageSpy, controller } =
                    mountWithPostMessageSpy();
                dispatchCardMessage(getIframe());
                await controller.result;
                postMessageSpy.mockClear();
                controller.setLocale('de');
                expect(postMessageSpy).not.toHaveBeenCalled();
            });
        });

        // ── External submit mode ──────────────────────────────────────────────

        describe('submitMode', () => {
            it('includes submitMode: "external" in INIT when option is passed', () => {
                const { postMessageSpy } = mountWithPostMessageSpy({
                    submitMode: 'external',
                });
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        submitMode: 'external',
                    }),
                    IFRAME_ORIGIN,
                );
            });

            it('defaults to submitMode: "internal" in INIT when no option is passed', () => {
                const { postMessageSpy } = mountWithPostMessageSpy();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'GOPAY_CARD_FORM_INIT',
                        submitMode: 'internal',
                    }),
                    IFRAME_ORIGIN,
                );
            });

            it('submit() posts GOPAY_CARD_REQUEST_SUBMIT in external submit', () => {
                const { postMessageSpy, controller } = mountWithPostMessageSpy({
                    submitMode: 'external',
                });
                postMessageSpy.mockClear();
                controller.submit();
                expect(postMessageSpy).toHaveBeenCalledOnce();
                expect(postMessageSpy).toHaveBeenCalledWith(
                    { type: 'GOPAY_CARD_REQUEST_SUBMIT' },
                    IFRAME_ORIGIN,
                );
            });

            it('submit() throws in internal submit', () => {
                const { controller } = mountWithPostMessageSpy();
                expect(() => controller.submit()).toThrow(
                    /external submit mode/,
                );
            });

            it('submit() is a no-op after the form completes', async () => {
                const { postMessageSpy, controller } = mountWithPostMessageSpy({
                    submitMode: 'external',
                });
                dispatchCardMessage(getIframe());
                await controller.result;
                postMessageSpy.mockClear();
                controller.submit();
                expect(postMessageSpy).not.toHaveBeenCalled();
            });

            it('GOPAY_CARD_FORM_VALIDITY updates controller.isValid', () => {
                const controller = cards.mountCardForm(container, IFRAME_SRC, {
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

            it('onValidityChange fires when validity changes', () => {
                const cb = vi.fn();
                cards.mountCardForm(container, IFRAME_SRC, {
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

            it('onValidityChange deduplicates identical consecutive values', () => {
                const cb = vi.fn();
                cards.mountCardForm(container, IFRAME_SRC, {
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
