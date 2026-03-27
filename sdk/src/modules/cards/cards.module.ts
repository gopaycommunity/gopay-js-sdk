import { GoPayErrorCodes, GoPaySDKError } from '../../errors.js';
import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';
import { DEFAULT_CARD_FORM_STYLES } from './card-form-styles.js';

type CardTokenRequest =
    components['requestBodies']['Card-Token-Request']['content']['application/json'];
type CardTokenResponse =
    components['responses']['Card-Token-Response']['content']['application/json'];

export class CardsModule {
    constructor(private readonly client: HttpClient) {}

    /**
     * Fetch the URL of the GoPay-hosted card encryption iframe.
     * TODO: change to real endpoint once available; for now this is hardcoded in the example app.
     * Requires the `card:save` OAuth2 scope.
     */
    async getCardFormUrl(): Promise<string> {
        const result = await this.client.get<{ url: string }>(
            '/cards/form-url',
        );
        return result.url;
    }

    /**
     * Mount the GoPay card encryption iframe into `container` and return the
     * resulting card token once the user submits the form.
     *
     * The iframe must be the GoPay-hosted card encryption page (never a
     * merchant-controlled origin). It communicates via `postMessage`:
     * - `GOPAY_CARD_ENCRYPT_READY`  — iframe loaded, form is interactive
     * - `GOPAY_CARD_ENCRYPT_RESULT` — user submitted; carries the JWE payload
     *
     * The SDK listens for the result, calls `POST /cards/tokens` internally,
     * and resolves with the tokenization response. The message listener is
     * removed automatically on completion.
     *
     * Requires the `card:save` OAuth2 scope.
     *
     * @param container - DOM element to append the iframe to
     * @param iframeSrc - URL of the GoPay card encryption iframe
     */
    mountCardForm(
        container: HTMLElement,
        iframeSrc: string,
        options?: { styles?: string },
    ): Promise<CardTokenResponse> {
        return new Promise((resolve, reject) => {
            const tokens = this.client.getTokens();
            if (!tokens) {
                reject(
                    new GoPaySDKError(
                        '[GoPaySDK] No access token available. Call setClientToken() before mounting the card form.',
                        { errorCode: GoPayErrorCodes.AUTH_TOKEN_MISSING },
                    ),
                );
                return;
            }

            container.replaceChildren();

            const iframe = document.createElement('iframe');
            iframe.src = iframeSrc;
            iframe.style.cssText = 'width:100%;height:100%;border:none;';
            container.appendChild(iframe);

            const expectedOrigin = new URL(iframeSrc, globalThis.location?.href)
                .origin;
            const environment = this.client.getEnvironment();
            const elapsedSeconds = Math.floor(
                (Date.now() - tokens.issued_at) / 1000,
            );

            const clientId = this.extractClientId(tokens.access_token);

            const cleanup = () => {
                window.removeEventListener('message', onMessage);
                iframe.remove();
            };

            const styles = options?.styles ?? DEFAULT_CARD_FORM_STYLES;

            iframe.onload = () => {
                iframe.contentWindow?.postMessage(
                    { type: 'GOPAY_CARD_SET_STYLES', styles },
                    expectedOrigin,
                );
                iframe.contentWindow?.postMessage(
                    {
                        type: 'GOPAY_CARD_FORM_INIT',
                        environment,
                        client_id: clientId,
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        expires_in: Math.max(
                            0,
                            tokens.expires_in - elapsedSeconds,
                        ),
                        refresh_expires_in: Math.max(
                            0,
                            tokens.refresh_expires_in - elapsedSeconds,
                        ),
                    },
                    expectedOrigin,
                );
            };

            const onMessage = async (event: MessageEvent) => {
                if (event.origin !== expectedOrigin) return;
                if (event.source !== iframe.contentWindow) return;

                if (event.data?.type === 'GOPAY_CARD_FORM_HEIGHT') {
                    if (typeof event.data.height === 'number') {
                        iframe.style.height = `${event.data.height}px`;
                    }
                    return;
                }

                if (event.data?.type === 'GOPAY_CARD_ENCRYPT_READY') {
                    // Form is rendered and interactive — nothing to do here.
                    return;
                }

                if (event.data?.type === 'GOPAY_CARD_ENCRYPT_ERROR') {
                    cleanup();
                    reject(
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
                    resolve(
                        await this.createToken({
                            payload: event.data.card_token,
                        }),
                    );
                } catch (err) {
                    reject(err);
                }
            };

            window.addEventListener('message', onMessage);
        });
    }

    private extractClientId(accessToken: string): string | null {
        try {
            const payload = JSON.parse(
                globalThis.atob(accessToken.split('.')[1]),
            ) as Record<string, unknown>;
            return typeof payload.sub === 'string' ? payload.sub : null;
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
