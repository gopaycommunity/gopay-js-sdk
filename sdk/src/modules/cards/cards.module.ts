import { GoPayErrorCodes, GoPaySDKError } from '../../errors.js';
import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';
import { DEFAULT_CARD_FORM_THEME } from './card-form-themes.js';
import type {
    CardFormConfig,
    CardFormTheme,
    CardRequestSubmit,
    CardSetLocale,
    CardSetTheme,
    OutboundMessage,
} from './iframe-protocol.js';

type CardTokenRequest =
    components['requestBodies']['Card-Token-Request']['content']['application/json'];
type CardTokenResponse =
    components['responses']['Card-Token-Response']['content']['application/json'];

export interface CardFormController {
    /** Resolves with the card token when the user submits the form; rejects on error or cancellation. */
    result: Promise<CardTokenResponse>;
    /** Send an updated theme to the mounted iframe. No-op if the form is no longer mounted. */
    setTheme: (theme: CardFormTheme) => void;
    /** Send an updated locale to the mounted iframe. No-op if the form is no longer mounted. */
    setLocale: (locale: string) => void;
    /**
     * Trigger form submission from the parent page. Only works in external submit mode
     * (`submitMode: 'external'`). Throws a `GoPaySDKError` in internal submit mode.
     * No-op if the form is no longer mounted.
     */
    submit: () => void;
    /** Current validity state reported by the iframe. Always `false` until the first
     *  `GOPAY_CARD_FORM_VALIDITY` message arrives (only sent in external submit mode). */
    readonly isValid: boolean;
}

export class CardsModule {
    constructor(private readonly client: HttpClient) {}

    /**
     * Fetch the URL of the GoPay-hosted card encryption iframe from the API.
     * Called internally by {@link mountCardForm}.
     * Requires the `card:save` OAuth2 scope.
     */
    private async getCardFormUrl(): Promise<string> {
        const result = await this.client.get<
            components['schemas']['Card-Form-URL']
        >('/encryption/card-form-url');
        if (!result.card_form_url) {
            throw new GoPaySDKError(
                '[GoPaySDK] Card form URL not available. Ensure the token has the card:save scope.',
                { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
            );
        }
        return result.card_form_url;
    }

    /**
     * Fetch the GoPay-hosted card encryption iframe URL from the API, mount it
     * into `container`, and return a {@link CardFormController} that exposes the
     * token promise and runtime controls for updating the theme and locale.
     *
     * The iframe communicates via `postMessage`:
     * - `GOPAY_CARD_ENCRYPT_READY`  — iframe loaded, form is interactive
     * - `GOPAY_CARD_ENCRYPT_RESULT` — user submitted; carries the JWE payload
     *
     * The SDK listens for the result, calls `POST /cards/tokens` internally,
     * and resolves `result` with the tokenization response. The message
     * listener is removed automatically on completion.
     *
     * Requires the `card:save` OAuth2 scope.
     *
     * @param container - DOM element to append the iframe to
     */
    async mountCardForm(
        container: HTMLElement,
        options?: {
            theme?: CardFormTheme;
            locale?: string;
            submitMode?: 'internal' | 'external';
            /** Whether to create a permanent (reusable) card token. Defaults to `false` (single-use). */
            permanent?: boolean;
            onValidityChange?: (isValid: boolean) => void;
        },
    ): Promise<CardFormController> {
        const tokens = this.client.getTokens();
        if (!tokens) {
            const result = Promise.reject<CardTokenResponse>(
                new GoPaySDKError(
                    '[GoPaySDK] No access token available. Call setClientToken() before mounting the card form.',
                    { errorCode: GoPayErrorCodes.AUTH_TOKEN_MISSING },
                ),
            );
            result.catch(() => {}); // prevent unhandled-rejection warnings
            return {
                result,
                setTheme: () => {},
                setLocale: () => {},
                submit: () => {},
                isValid: false,
            };
        }

        const iframeSrc = await this.getCardFormUrl();

        container.replaceChildren();

        const iframe = document.createElement('iframe');
        const iframeUrl = new URL(iframeSrc, globalThis.location?.href);
        iframeUrl.searchParams.set('origin', globalThis.location?.origin ?? '');
        iframe.src = iframeUrl.href;
        iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
        iframe.style.cssText = 'width:100%;height:100%;border:none;';
        container.appendChild(iframe);

        const expectedOrigin = new URL(iframeSrc, globalThis.location?.href)
            .origin;
        const environment = this.client.getEnvironment();
        const elapsedSeconds = Math.floor(
            (Date.now() - tokens.issued_at) / 1000,
        );
        const clientId = this.extractClientId(tokens.access_token);
        const theme = options?.theme ?? DEFAULT_CARD_FORM_THEME;
        const locale =
            options?.locale ?? globalThis.navigator?.language ?? 'en';
        const submitMode = options?.submitMode ?? 'internal';

        let active = true;
        let isValid = false;
        let onMessage:
            | ((e: MessageEvent<OutboundMessage>) => Promise<void>)
            | undefined;

        const cleanup = () => {
            active = false;
            if (onMessage) window.removeEventListener('message', onMessage);
            iframe.remove();
        };

        let resolveResult!: (value: CardTokenResponse) => void;
        let rejectResult!: (reason: unknown) => void;
        const result = new Promise<CardTokenResponse>((res, rej) => {
            resolveResult = res;
            rejectResult = rej;
        });

        iframe.onload = () => {
            // The iframe is sandboxed without allow-same-origin, so its origin is the
            // opaque "null" origin. postMessage with a specific targetOrigin would be
            // silently dropped; '*' is required. The message is still only delivered to
            // this specific contentWindow — '*' means "skip origin check on recipient",
            // not "broadcast to all windows".
            iframe.contentWindow?.postMessage(
                {
                    type: 'GOPAY_CARD_FORM_INIT',
                    environment,
                    client_id: clientId ?? '',
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_in: Math.max(0, tokens.expires_in - elapsedSeconds),
                    refresh_expires_in: Math.max(
                        0,
                        tokens.refresh_expires_in - elapsedSeconds,
                    ),
                    theme,
                    locale,
                    submitMode,
                } satisfies CardFormConfig,
                '*',
            );
        };

        onMessage = async (event: MessageEvent<OutboundMessage>) => {
            // Sandboxed iframes (no allow-same-origin) report event.origin === 'null'.
            // Checking the source window is a stronger guarantee than origin alone.
            if (event.source !== iframe.contentWindow) return;
            if (event.origin !== 'null' && event.origin !== expectedOrigin)
                return;

            if (event.data?.type === 'GOPAY_CARD_FORM_HEIGHT') {
                if (typeof event.data.height === 'number') {
                    iframe.style.height = `${event.data.height}px`;
                }
                return;
            }

            if (event.data?.type === 'GOPAY_CARD_ENCRYPT_READY') {
                return;
            }

            if (event.data?.type === 'GOPAY_CARD_FORM_VALIDITY') {
                if (typeof event.data.isValid === 'boolean') {
                    const prev = isValid;
                    isValid = event.data.isValid;
                    if (isValid !== prev) {
                        options?.onValidityChange?.(isValid);
                    }
                }
                return;
            }

            if (event.data?.type === 'GOPAY_CARD_ENCRYPT_ERROR') {
                cleanup();
                rejectResult(
                    new GoPaySDKError(
                        `[GoPaySDK] Card form error: ${event.data.error}`,
                        { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                    ),
                );
                return;
            }

            if (event.data?.type !== 'GOPAY_CARD_ENCRYPT_RESULT') return;

            cleanup();
            try {
                resolveResult(
                    await this.createToken({
                        payload: event.data.card_token,
                        permanent: options?.permanent ?? false,
                    }),
                );
            } catch (err) {
                rejectResult(err);
            }
        };

        window.addEventListener('message', onMessage);

        return {
            result,
            setTheme: (t: CardFormTheme) => {
                if (active) {
                    iframe.contentWindow?.postMessage(
                        {
                            type: 'GOPAY_CARD_SET_THEME',
                            theme: t,
                        } satisfies CardSetTheme,
                        '*',
                    );
                }
            },
            setLocale: (l: string) => {
                if (active) {
                    iframe.contentWindow?.postMessage(
                        {
                            type: 'GOPAY_CARD_SET_LOCALE',
                            locale: l,
                        } satisfies CardSetLocale,
                        '*',
                    );
                }
            },
            submit: () => {
                if (submitMode !== 'external') {
                    throw new GoPaySDKError(
                        '[GoPaySDK] submit() is only available in external submit mode (submitMode: "external").',
                        { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                    );
                }
                if (active) {
                    iframe.contentWindow?.postMessage(
                        {
                            type: 'GOPAY_CARD_REQUEST_SUBMIT',
                        } satisfies CardRequestSubmit,
                        '*',
                    );
                }
            },
            get isValid() {
                return isValid;
            },
        };
    }

    private extractClientId(accessToken: string): string | null {
        try {
            const payload = JSON.parse(
                globalThis.atob(accessToken.split('.')[1]),
            ) as Record<string, unknown>;
            if (typeof payload.sub === 'string') {
                return payload.sub;
            }
            return null;
        } catch {
            return null;
        }
    }

    private async createToken(
        params: CardTokenRequest,
    ): Promise<CardTokenResponse> {
        return this.client.post<CardTokenResponse>('/cards/tokens', params);
    }
}
