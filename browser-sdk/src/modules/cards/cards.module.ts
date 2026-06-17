import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
} from '@gopay-internal/core';
import { TRUSTED_CARD_FORM_ORIGINS } from '../../config.js';
import { makeLoadingEmitter } from '../../internal/loading-emitter.js';
import type {
    LoadingState,
    SpinnerConfig,
} from '../../internal/loading-spinner.js';
import { showSpinnerIn } from '../../internal/loading-spinner.js';
import type { components } from '../../types/generated.js';
import type { EncryptedCardPayload } from '../../types/index.js';
import type {
    AwaitChargeOptions,
    createPaymentsApi,
    ThreeDSConfig,
} from '../payments/payments.module.js';
import { DEFAULT_CARD_FORM_THEME } from './card-form-themes.js';
import type {
    CardFormConfig,
    CardFormTheme,
    CardRequestSubmit,
    CardSetLocale,
    CardSetTheme,
    OutboundMessage,
} from './iframe-protocol.js';

type PaymentChargeStatusResponse =
    components['schemas']['Payment-Charge-Status-Response'];

type PaymentsApi = ReturnType<typeof createPaymentsApi>;

export type { CardFormTheme, LoadingState, SpinnerConfig };

export interface CardFormController<R = EncryptedCardPayload> {
    /**
     * Resolves when the form flow completes.
     *
     * flow: 'return-payload' — resolves with `{ encryptedPayload: string }`.
     *   Forward this to your server, which calls `tokenizeEncryptedCard` on the server SDK.
     *
     * flow: 'direct-charge' — resolves with the terminal `PaymentChargeStatusResponse`
     *   after the SDK charges the payment and polls to completion.
     *
     * Rejects with {@link GoPaySDKError} (`CARD_FORM_ERROR`) on iframe errors,
     * or with {@link GoPayHTTPError} on API failures.
     */
    result: Promise<R>;
    /** Send an updated theme to the mounted iframe. No-op if no longer mounted. */
    setTheme: (theme: CardFormTheme) => void;
    /** Send an updated locale to the mounted iframe. No-op if no longer mounted. */
    setLocale: (locale: string) => void;
    /**
     * Trigger form submission from the parent page.
     * Only works in external submit mode (`submitMode: 'external'`).
     */
    submit: () => void;
    /** Current validity state reported by the iframe (external submit mode only). */
    readonly isValid: boolean;
    /**
     * Tear down the mounted iframe, remove the message listener, and reject
     * `result`. Call this when the parent component unmounts or navigates away.
     * No-op if the controller is no longer active.
     */
    unmount: () => void;
}

type DirectChargeOptions = {
    flow: 'direct-charge';
    /** Controls how the SDK handles the 3DS redirect. Defaults to full-page redirect. */
    threeDS?: ThreeDSConfig;
    awaitOptions?: Omit<AwaitChargeOptions, 'threeDS'>;
};

type ReturnPayloadOptions = {
    flow: 'return-payload';
};

type CardFormBaseOptions = {
    theme?: CardFormTheme;
    locale?: string;
    submitMode?: 'internal' | 'external';
    onValidityChange?: (isValid: boolean) => void;
    /** Called on every loading state transition, regardless of the `spinner` setting. */
    onLoadingStateChange?: (state: LoadingState) => void;
    /**
     * Control the built-in spinner.
     * - omitted / `{}` — SDK shows the default spinner; color follows `theme.submitBackgroundColor`.
     * - `{ color }` — override the spinner color.
     * - `{ render }` — replace the built-in spinner entirely; called with the container element,
     *   must return a cleanup function.
     * - `false` — SDK inserts no spinner DOM at all; use `onLoadingStateChange` for your own UI.
     */
    spinner?: SpinnerConfig;
};

export type CardFormOptions = CardFormBaseOptions &
    (DirectChargeOptions | ReturnPayloadOptions);

export function createCardsApi(
    client: HttpClient,
    getPaymentsApi: () => PaymentsApi | null,
) {
    let activeCleanup: (() => void) | undefined;
    let cardFormUrlPromise: Promise<string> | undefined;

    function getCardFormUrl(): Promise<string> {
        if (!cardFormUrlPromise) {
            const shareableKey = client.getShareableKey() ?? '';
            const clientId = client.getClientId();
            const credentials = clientId
                ? globalThis.btoa(`${clientId}:${shareableKey}`)
                : globalThis.btoa(`:${shareableKey}`);
            const p = client
                .get<components['schemas']['Card-Form-URL']>(
                    '/cards/card-form-url',
                    { headers: { Authorization: `Basic ${credentials}` } },
                )
                .then((result) => {
                    if (!result.card_form_url) {
                        throw new GoPaySDKError(
                            '[GoPayBrowserSDK] Card form URL not available. Ensure the shareable key has the required scope.',
                            { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                        );
                    }
                    return result.card_form_url;
                });
            p.catch(() => {
                cardFormUrlPromise = undefined;
            });
            cardFormUrlPromise = p;
        }
        return cardFormUrlPromise;
    }

    return {
        /**
         * Fetch the GoPay-hosted card encryption iframe URL, mount it into
         * `container`, and return a {@link CardFormController}.
         *
         * **flow: 'return-payload'** — after encryption, `result` resolves with
         * `{ encryptedPayload: string }`. Forward this to your server to
         * call `tokenizeEncryptedCard` on the server SDK.
         *
         * **flow: 'direct-charge'** — after encryption, the SDK automatically
         * charges the payment and polls until terminal state. A spinner is shown
         * while waiting; the 3DS iframe mounts in `options.redirectContainer` if
         * needed. `result` resolves with the final `PaymentChargeStatusResponse`.
         * Requires `attachPayment()` to have been called first.
         */
        async mountCardForm(
            container: HTMLElement,
            options: CardFormOptions,
        ): Promise<
            CardFormController<
                EncryptedCardPayload | PaymentChargeStatusResponse
            >
        > {
            if (activeCleanup) {
                const result = Promise.reject<
                    EncryptedCardPayload | PaymentChargeStatusResponse
                >(
                    new GoPaySDKError(
                        '[GoPayBrowserSDK] A card form is already mounted. Call unmount() on the existing controller before mounting a new one.',
                        {
                            errorCode:
                                GoPayErrorCodes.CARD_FORM_ALREADY_MOUNTED,
                        },
                    ),
                );
                result.catch(() => {});
                return {
                    result,
                    setTheme: () => {},
                    setLocale: () => {},
                    submit: () => {},
                    unmount: () => {},
                    isValid: false,
                };
            }

            if (options.flow === 'direct-charge' && !getPaymentsApi()) {
                const result = Promise.reject<EncryptedCardPayload>(
                    new GoPaySDKError(
                        '[GoPayBrowserSDK] Payment not attached. Call attachPayment({ paymentId, paymentSecret }) before mounting with flow: "direct-charge".',
                        { errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED },
                    ),
                );
                result.catch(() => {});
                return {
                    result,
                    setTheme: () => {},
                    setLocale: () => {},
                    submit: () => {},
                    unmount: () => {},
                    isValid: false,
                };
            }

            const spinnerColor =
                options.theme?.submitBackgroundColor ??
                DEFAULT_CARD_FORM_THEME.submitBackgroundColor ??
                '#1899d6';

            // Tracks the currently active spinner cleanup; reassigned on each state transition.
            let spinnerCleanup: () => void = () => {};

            const clearSpinner = () => {
                spinnerCleanup();
                spinnerCleanup = () => {};
            };

            const emitLoadingState = makeLoadingEmitter(
                options.onLoadingStateChange,
            );

            // Show spinner during card-form-url fetch
            container.replaceChildren();
            emitLoadingState('fetching-card-form-url');
            spinnerCleanup = showSpinnerIn(container, {
                color: spinnerColor,
                spinner: options.spinner,
            });

            let iframeSrc: string;
            try {
                iframeSrc = await getCardFormUrl();
            } catch (err) {
                clearSpinner();
                emitLoadingState('idle');
                throw err;
            }

            const expectedOrigin = new URL(iframeSrc, globalThis.location?.href)
                .origin;

            const environment = client.getEnvironment();
            if (environment === 'production') {
                if (
                    !TRUSTED_CARD_FORM_ORIGINS.production.includes(
                        expectedOrigin,
                    )
                ) {
                    clearSpinner();
                    emitLoadingState('idle');
                    throw new GoPaySDKError(
                        `[GoPayBrowserSDK] Card form URL origin is not trusted in production: "${expectedOrigin}". ` +
                            `Allowed: ${TRUSTED_CARD_FORM_ORIGINS.production.join(', ')}`,
                        { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                    );
                }
            }

            // URL obtained — transition to iframe-loading state
            clearSpinner();
            container.replaceChildren();

            const iframe = document.createElement('iframe');
            const iframeUrl = new URL(iframeSrc, globalThis.location?.href);
            iframeUrl.searchParams.set(
                'origin',
                globalThis.location?.origin ?? '',
            );
            iframe.src = iframeUrl.href;
            iframe.setAttribute(
                'sandbox',
                'allow-scripts allow-forms allow-same-origin',
            );
            iframe.style.cssText =
                'width:100%;height:100%;border:none;display:none;';
            iframe.title = 'GoPay';
            container.appendChild(iframe);

            emitLoadingState('iframe-loading');
            spinnerCleanup = showSpinnerIn(container, {
                color: spinnerColor,
                spinner: options.spinner,
            });

            const shareableKey = client.getShareableKey() ?? '';
            const clientId = client.getClientId() ?? '';
            const theme = options.theme ?? DEFAULT_CARD_FORM_THEME;
            const locale =
                options.locale ?? globalThis.navigator?.language ?? 'en';
            const submitMode = options.submitMode ?? 'internal';

            const chargeAbortController = new AbortController();
            let active = true;
            let isValid = false;
            let onMessage:
                | ((e: MessageEvent<OutboundMessage>) => Promise<void>)
                | undefined;

            // Create the result promise before defining cleanup so rejectResult
            // is captured in the activeCleanup closure below.
            let resolveResult!: (
                value: EncryptedCardPayload | PaymentChargeStatusResponse,
            ) => void;
            let rejectResult!: (reason: unknown) => void;
            const result = new Promise<
                EncryptedCardPayload | PaymentChargeStatusResponse
            >((res, rej) => {
                resolveResult = res;
                rejectResult = rej;
            });

            let iframeLoadTimeout: ReturnType<typeof setTimeout> | undefined;

            const cleanup = () => {
                active = false;
                clearTimeout(iframeLoadTimeout);
                clearSpinner();
                emitLoadingState('idle');
                if (onMessage) {
                    window.removeEventListener('message', onMessage);
                }
                iframe.remove();
                activeCleanup = undefined;
            };

            activeCleanup = cleanup;

            iframe.onload = () => {
                clearTimeout(iframeLoadTimeout);
                clearSpinner();
                iframe.style.display = '';
                emitLoadingState('idle');

                iframe.contentWindow?.postMessage(
                    {
                        type: 'GOPAY_CARD_FORM_INIT',
                        environment,
                        shareable_key: shareableKey,
                        client_id: clientId,
                        theme,
                        locale,
                        submitMode,
                    } satisfies CardFormConfig,
                    expectedOrigin,
                );
            };

            iframe.onerror = () => {
                cleanup();
                rejectResult(
                    new GoPaySDKError(
                        '[GoPayBrowserSDK] Card form iframe failed to load.',
                        { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                    ),
                );
            };

            iframeLoadTimeout = setTimeout(() => {
                cleanup();
                rejectResult(
                    new GoPaySDKError(
                        '[GoPayBrowserSDK] Card form iframe timed out.',
                        { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                    ),
                );
            }, 30_000);

            const handleEncryptResult = async (
                encryptedPayload: string,
            ): Promise<void> => {
                if (options.flow === 'return-payload') {
                    resolveResult({ encryptedPayload });
                    return;
                }

                // direct-charge flow — paymentsApi is guaranteed non-null (guarded at mount time)
                const paymentsApi = getPaymentsApi();
                if (!paymentsApi) {
                    rejectResult(
                        new GoPaySDKError(
                            '[GoPayBrowserSDK] Payment detached during card form interaction.',
                            { errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED },
                        ),
                    );
                    return;
                }

                container.replaceChildren();
                emitLoadingState('charging');
                spinnerCleanup = showSpinnerIn(container, {
                    color: spinnerColor,
                    spinner: options.spinner,
                });

                try {
                    const { threeDS, awaitOptions } = options;

                    await paymentsApi.chargePayment({
                        payment_instrument: {
                            payment_instrument: 'PAYMENT_CARD',
                            input: {
                                input_type: 'ENCRYPTED_CARD',
                                payload: encryptedPayload,
                            },
                        },
                    });

                    emitLoadingState('polling-charge-state');

                    const chargeState = await paymentsApi.awaitChargeState({
                        ...awaitOptions,
                        threeDS,
                        signal: chargeAbortController.signal,
                        onStateChange: (state) => {
                            if (
                                state.state === 'ACTION_REQUIRED' &&
                                state.action?.redirect_url
                            ) {
                                clearSpinner();
                                emitLoadingState('idle');
                            }
                            awaitOptions?.onStateChange?.(state);
                        },
                    });

                    clearSpinner();
                    emitLoadingState('idle');
                    resolveResult(chargeState);
                } catch (err) {
                    clearSpinner();
                    emitLoadingState('idle');
                    rejectResult(err);
                }
            };

            onMessage = async (event: MessageEvent<OutboundMessage>) => {
                if (event.source !== iframe.contentWindow) {
                    return;
                }
                if (event.origin !== expectedOrigin) {
                    return;
                }

                if (event.data?.type === 'GOPAY_CARD_FORM_HEIGHT') {
                    const { height } = event.data;
                    if (Number.isFinite(height) && height >= 0) {
                        iframe.style.height = `${height}px`;
                    }
                    return;
                }

                if (event.data?.type === 'GOPAY_CARD_ENCRYPT_READY') {
                    iframe.focus();
                    return;
                }

                if (event.data?.type === 'GOPAY_CARD_FORM_VALIDITY') {
                    if (
                        typeof event.data.isValid === 'boolean' &&
                        event.data.isValid !== isValid
                    ) {
                        isValid = event.data.isValid;
                        options.onValidityChange?.(isValid);
                    }
                    return;
                }

                if (event.data?.type === 'GOPAY_CARD_ENCRYPT_ERROR') {
                    cleanup();
                    rejectResult(
                        new GoPaySDKError(
                            `[GoPayBrowserSDK] Card form error: ${event.data.error}`,
                            { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                        ),
                    );
                    return;
                }

                if (event.data?.type !== 'GOPAY_CARD_ENCRYPT_RESULT') {
                    return;
                }

                cleanup();
                await handleEncryptResult(event.data.card_token);
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
                            '[GoPayBrowserSDK] submit() is only available in external submit mode (submitMode: "external").',
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
                unmount: () => {
                    if (!active) {
                        return;
                    }
                    chargeAbortController.abort();
                    cleanup();
                    const unmountError = new GoPaySDKError(
                        '[GoPayBrowserSDK] Card form unmounted.',
                        { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                    );
                    rejectResult(unmountError);
                    try {
                        client.emitError(unmountError);
                    } catch {
                        // emitError throws after firing onError — swallow here
                    }
                },
            };
        },
    };
}
