import type { HttpClient } from '../../http/client.js';
import type { components } from '../../types/generated.js';

type CardTokenRequest =
    components['requestBodies']['Card-Token-Request']['content']['application/json'];
type CardTokenResponse =
    components['responses']['Card-Token-Response']['content']['application/json'];

export class CardsModule {
    constructor(private readonly client: HttpClient) {}

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
    ): Promise<CardTokenResponse> {
        return new Promise((resolve, reject) => {
            container.replaceChildren();

            const iframe = document.createElement('iframe');
            iframe.src = iframeSrc;
            iframe.style.cssText = 'width:100%;height:100%;border:none;';
            container.appendChild(iframe);

            const expectedOrigin = new URL(iframeSrc, globalThis.location?.href)
                .origin;

            const cleanup = () => {
                window.removeEventListener('message', onMessage);
                iframe.remove();
            };

            const onMessage = async (event: MessageEvent) => {
                if (event.origin !== expectedOrigin) return;
                if (event.source !== iframe.contentWindow) return;
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

    private async createToken(
        params: CardTokenRequest,
    ): Promise<CardTokenResponse> {
        return this.client.post<CardTokenResponse>('/cards/tokens', params);
    }
}
