import { TRUSTED_CARD_FORM_ORIGINS } from '../../config.js';
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

type CardTokenRequest = components['schemas']['Card-Token-Request'];
type CardTokenResponse =
    components['responses']['Card-Token-Response']['content']['application/json'];
type CardDetailsResponse =
    components['responses']['Card-Token-Details-Response']['content']['application/json'];

function requireCardId(cardId: string): void {
    if (!cardId) {
        throw new Error('cardId is required');
    }
}

export interface CardFormController {
    /**
     * Resolves with the card token when the user submits the form.
     * Rejects with {@link GoPaySDKError} (`CARD_FORM_ERROR`) if the iframe
     * reports an encryption error, or with {@link GoPayHTTPError} if
     * `POST /cards/tokens` fails.
     */
    result: Promise<CardTokenResponse>;
    /** Send an updated theme to the mounted iframe. No-op if the form is no longer mounted. */
    setTheme: (theme: CardFormTheme) => void;
    /** Send an updated locale to the mounted iframe. No-op if the form is no longer mounted. */
    setLocale: (locale: string) => void;
    /**
     * Trigger form submission from the parent page. Only works in external submit mode
     * (`submitMode: 'external'`). No-op if the form is no longer mounted.
     *
     * @throws {@link GoPaySDKError} with `CARD_FORM_ERROR` if called when
     *   `submitMode` is `'internal'`.
     */
    submit: () => void;
    /** Current validity state reported by the iframe. Always `false` until the first
     *  `GOPAY_CARD_FORM_VALIDITY` message arrives (only sent in external submit mode). */
    readonly isValid: boolean;
}

/**
 * Manages card tokenization via the GoPay-hosted iframe and stored card tokens.
 *
 * All methods that call the API may additionally throw {@link GoPayHTTPError}
 * (non-2xx response) or {@link GoPaySDKError} (auth / network failures —
 * see {@link GoPayErrorCodes}).
 */
export class CardsModule {
    /** Cleanup function for the currently active card-form mount, if any. */
    private activeCleanup: (() => void) | undefined;

    constructor(private readonly client: HttpClient) {}

    /**
     * Retrieve details of a stored permanent card token.
     * Requires the `card:read` OAuth2 scope.
     *
     * GET /cards/tokens/{card_id}
     *
     * @param cardId - Unique identifier of the stored card token
     */
    async getDetails(cardId: string): Promise<CardDetailsResponse> {
        requireCardId(cardId);
        return this.client.get<CardDetailsResponse>(`/cards/tokens/${cardId}`);
    }

    /**
     * Delete a stored permanent card token.
     *
     * DELETE /cards/tokens/{card_id}
     *
     * @param cardId - Unique identifier of the stored card token
     */
    async deleteCard(cardId: string): Promise<void> {
        requireCardId(cardId);
        return this.client.delete(`/cards/tokens/${cardId}`);
    }

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
     *
     * @throws {@link GoPaySDKError} with `CARD_FORM_ERROR` if the card form
     *   URL is unavailable (e.g. token missing the `card:save` scope).
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

        // Tear down any previous mount that never received a terminal message
        // (ENCRYPT_RESULT / ENCRYPT_ERROR). Without this, re-mounting would leave
        // the old message listener dangling (a memory leak — benign because
        // event.source guards it, but still an observable footgun).
        this.activeCleanup?.();
        this.activeCleanup = undefined;

        const iframeSrc = await this.getCardFormUrl();

        // Compute expectedOrigin before touching the DOM so we can validate
        // it against the allowlist before the iframe is ever appended.
        const expectedOrigin = new URL(iframeSrc, globalThis.location?.href)
            .origin;

        // In production, reject iframe URLs whose origin is not explicitly
        // trusted. This prevents token leakage if the API or DNS were ever
        // compromised. Sandbox is left permissive to support local/staging setups.
        const env = this.client.getEnvironment();
        if (env === 'production') {
            if (
                !TRUSTED_CARD_FORM_ORIGINS.production.includes(expectedOrigin)
            ) {
                throw new GoPaySDKError(
                    `[GoPaySDK] Card form URL origin is not trusted in production: "${expectedOrigin}". ` +
                        `Allowed origins: ${TRUSTED_CARD_FORM_ORIGINS.production.join(', ')}`,
                    { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                );
            }
        }

        container.replaceChildren();

        const iframe = document.createElement('iframe');
        const iframeUrl = new URL(iframeSrc, globalThis.location?.href);
        iframeUrl.searchParams.set('origin', globalThis.location?.origin ?? '');
        iframe.src = iframeUrl.href;
        iframe.setAttribute(
            'sandbox',
            'allow-scripts allow-forms allow-same-origin',
        );
        iframe.style.cssText = 'width:100%;height:100%;border:none;';
        container.appendChild(iframe);
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
            this.activeCleanup = undefined;
        };
        this.activeCleanup = cleanup;

        let resolveResult!: (value: CardTokenResponse) => void;
        let rejectResult!: (reason: unknown) => void;
        const result = new Promise<CardTokenResponse>((res, rej) => {
            resolveResult = res;
            rejectResult = rej;
        });

        iframe.onload = () => {
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
                expectedOrigin,
            );
        };

        onMessage = async (event: MessageEvent<OutboundMessage>) => {
            if (event.source !== iframe.contentWindow) return;
            if (event.origin !== expectedOrigin) return;

            if (event.data?.type === 'GOPAY_CARD_FORM_HEIGHT') {
                const { height } = event.data;
                // Clamp to prevent a defective or compromised iframe from
                // setting an arbitrarily large height and breaking the host layout.
                if (typeof height === 'number' && !Number.isNaN(height)) {
                    iframe.style.height = `${Math.max(0, Math.min(500, height))}px`;
                }
                return;
            }

            if (event.data?.type === 'GOPAY_CARD_ENCRYPT_READY') {
                return;
            }

            if (event.data?.type === 'GOPAY_CARD_FORM_VALIDITY') {
                if (
                    typeof event.data.isValid === 'boolean' &&
                    event.data.isValid !== isValid
                ) {
                    isValid = event.data.isValid;
                    options?.onValidityChange?.(isValid);
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
                        expectedOrigin,
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
                        expectedOrigin,
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
                        expectedOrigin,
                    );
                }
            },
            get isValid() {
                return isValid;
            },
        };
    }

    private extractClientId(accessToken: string): string | null {
        // Trusted decode: this token was just received from our own authenticated
        // API call over TLS. We only read the `sub` claim for client_id telemetry.
        // Do NOT copy this pattern for tokens received from untrusted sources —
        // signature verification would be required in that case.
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
