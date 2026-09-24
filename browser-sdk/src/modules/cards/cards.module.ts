import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
    nowMs,
} from '@gopay-internal/core';
import { TRUSTED_CARD_FORM_ORIGINS } from '../../config.js';
import { callIntegrator } from '../../internal/integrator-callback.js';
import { makeLoadingEmitter } from '../../internal/loading-emitter.js';
import type {
    LoadingState,
    SpinnerConfig,
} from '../../internal/loading-spinner.js';
import { showSpinnerIn } from '../../internal/loading-spinner.js';
import {
    type BrowserTelemetry,
    NO_BROWSER_TELEMETRY,
} from '../../logging/gw-logger.js';
import type { components } from '../../types/generated.js';
import type { EncryptedCardPayload } from '../../types/index.js';
import type {
    AwaitChargeOptions,
    createPaymentsApi,
    ThreeDSConfig,
} from '../payments/payments.module.js';
import { DEFAULT_CARD_FORM_THEME } from './card-form-themes.js';
import { createHeightTracker } from './height-tracker.js';
import type {
    CardFormConfig,
    CardFormErrorCode,
    CardFormField,
    CardFormFieldError,
    CardFormTheme,
    CardRequestSubmit,
    CardSetLocale,
    CardSetTheme,
    OutboundMessage,
} from './iframe-protocol.js';

type PaymentChargeStatusResponse =
    components['schemas']['Payment-Charge-Status-Response'];

type PaymentsApi = ReturnType<typeof createPaymentsApi>;

/** How a mounted card form went away; carried by its height summary. */
type CardFormEnd =
    | 'encrypted'
    | 'encrypt-error'
    | 'load-error'
    | 'timeout'
    | 'unmount'
    | 'leave';

/**
 * The protocol values `GOPAY_CARD_FORM_ERRORS` may carry. Declared as records
 * keyed by the union so that adding a field or a code to the synced
 * `iframe-protocol.ts` fails the build here instead of silently dropping those
 * errors on the floor — the iframe deploys ahead of the SDK. Lookup goes
 * through sets built from their keys: `in` would also match prototype keys
 * (`{ field: 'toString' }`), and `Object.hasOwn` needs ES2022.
 */
const CARD_FORM_FIELDS: Record<CardFormField, true> = {
    pan: true,
    expiry: true,
    cvv: true,
};
const CARD_FORM_ERROR_CODES: Record<CardFormErrorCode, true> = {
    required: true,
    pattern: true,
};
const FIELD_NAMES = new Set<string>(Object.keys(CARD_FORM_FIELDS));
const ERROR_CODES = new Set<string>(Object.keys(CARD_FORM_ERROR_CODES));

function isCardFormFieldError(entry: unknown): entry is CardFormFieldError {
    if (typeof entry !== 'object' || entry === null) {
        return false;
    }
    const { field, code } = entry as Record<string, unknown>;
    return (
        typeof field === 'string' &&
        typeof code === 'string' &&
        FIELD_NAMES.has(field) &&
        ERROR_CODES.has(code)
    );
}

export type {
    CardFormErrorCode,
    CardFormField,
    CardFormFieldError,
    CardFormTheme,
    LoadingState,
    SpinnerConfig,
};

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
     * Tear down the mounted iframe, remove the message listener, abort an
     * in-flight charge together with its state polling, and reject `result`.
     * Call this when the parent component unmounts or navigates away.
     *
     * Valid at every point of the flow, including after the card has been
     * encrypted and the direct-charge is already running — the iframe is gone
     * by then, but the charge is not. Idempotent, and a no-op once `result`
     * has settled.
     *
     * Aborting the request does not roll back a charge the API has already
     * accepted: if `unmount()` lands after the POST reached GoPay, `result`
     * rejects while the payment can still end up `SUCCEEDED`. After an unmount
     * rejection, confirm the real outcome server-side with `getChargeState()`
     * before treating the order as unpaid.
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
    /**
     * Called on every validation run the iframe performs, with one entry per
     * invalid field; an empty array means the form validated cleanly.
     *
     * Only field names and codes are reported — the entered value never leaves
     * the iframe. Use this to render your own messages when the built-in error
     * text is hidden via `theme.errorHidden`.
     */
    onFieldErrors?: (errors: CardFormFieldError[]) => void;
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
    telemetry: BrowserTelemetry = NO_BROWSER_TELEMETRY,
) {
    /**
     * The mount that currently owns the card form, as an identity token rather
     * than a boolean. A direct-charge flow tears its iframe down as soon as the
     * card is encrypted and keeps running, so a later `unmount()` on it must not
     * release a session another mount has since taken — GPOMA-2512 made that
     * `unmount()` reachable.
     */
    let activeCardFormSession: symbol | null = null;
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
        isCardFormMounted: () => activeCardFormSession !== null,

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
            if (activeCardFormSession !== null) {
                const alreadyMounted = new GoPaySDKError(
                    '[GoPayBrowserSDK] A card form is already mounted. Call unmount() on the existing controller before mounting a new one.',
                    { errorCode: GoPayErrorCodes.CARD_FORM_ALREADY_MOUNTED },
                );
                // Reported here rather than in rejectResult: this guard returns
                // its own already-rejected promise and never reaches the funnel.
                client.reportError(alreadyMounted);
                const result = Promise.reject<
                    EncryptedCardPayload | PaymentChargeStatusResponse
                >(alreadyMounted);
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
                const notAttached = new GoPaySDKError(
                    '[GoPayBrowserSDK] Payment not attached. Call attachPayment({ paymentId, paymentSecret }) before mounting with flow: "direct-charge".',
                    { errorCode: GoPayErrorCodes.PAYMENT_NOT_ATTACHED },
                );
                client.reportError(notAttached);
                const result =
                    Promise.reject<EncryptedCardPayload>(notAttached);
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

            const session = Symbol('gopay-card-form-session');
            activeCardFormSession = session;
            /** Releases the session only while this mount still owns it. */
            const releaseSession = () => {
                if (activeCardFormSession === session) {
                    activeCardFormSession = null;
                }
            };

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
                telemetry,
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
                releaseSession();
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
                    releaseSession();
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
            /**
             * Whether the iframe and its message listener are still mounted.
             * The direct-charge flow tears them down as soon as the card is
             * encrypted and keeps running, so this must never gate `unmount()`.
             */
            let iframeMounted = true;
            /**
             * Whether `result` has settled. This is what makes `unmount()` a
             * no-op: the flow is over, rather than merely detached from the
             * iframe.
             */
            let settled = false;
            let isValid = false;
            /**
             * When the form became usable, so the submit can report how long
             * it took. Monotonic, not wall clock: an NTP correction while the
             * customer fills the form would otherwise ship a negative duration
             * or one off by hours.
             */
            let readyAt: number | null = null;
            /**
             * Whether the direct-charge flow has handed the card to the charge.
             * Read by unmount(), which is the one point where tearing down
             * leaves the outcome unknown: the charge can still succeed at
             * GoPay after `result` rejects. Cleared only once the outcome is
             * known — before the terminal `idle`, whose callback runs ahead of
             * `result` settling and may call unmount() itself.
             */
            let charging = false;
            let onMessage:
                | ((e: MessageEvent<OutboundMessage>) => Promise<void>)
                | undefined;

            // Create the result promise before defining cleanup so rejectResult
            // is captured in the cleanup closure below.
            let resolveResult!: (
                value: EncryptedCardPayload | PaymentChargeStatusResponse,
            ) => void;
            let rejectResult!: (
                reason: unknown,
                reportOptions?: { telemetry?: boolean },
            ) => void;
            const result = new Promise<
                EncryptedCardPayload | PaymentChargeStatusResponse
            >((res, rej) => {
                // Settling twice is a no-op, so an aborted charge rejecting
                // late cannot overwrite the unmount error, and vice versa.
                resolveResult = (value) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    res(value);
                };
                rejectResult = (reason, reportOptions) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    // The card form reports every failure by rejecting `result`
                    // rather than by throwing, so without this the errors an
                    // integrator most wants to be alerted on — the card form
                    // itself failing — are the ones onError never sees.
                    // `reportOptions` carries the telemetry opt-out, passed
                    // only when there is one, as the wallets do.
                    if (reportOptions) {
                        client.reportError(reason, reportOptions);
                    } else {
                        client.reportError(reason);
                    }
                    rej(reason);
                };
            });

            /**
             * The heights the iframe reports, tracked for telemetry only —
             * applying them is unchanged. See height-tracker.ts.
             */
            let heights = createHeightTracker(nowMs);
            let heightSummarySent = false;
            /**
             * Whether a pageshow listener is waiting for a back/forward-cache
             * restore, so teardown removes only what was added — every
             * listener this module adds is balanced by exactly one removal.
             */
            let restoreArmed = false;

            const sinceReady = () =>
                readyAt === null ? null : nowMs() - readyAt;

            /**
             * The frame itself, not just the messages: its width is what the
             * form wraps its text to, and a fractional one is what GWUICC4-24
             * turned out to be. The pixel ratio carries the browser zoom,
             * which is what GWUICC4-26 needed to reproduce.
             */
            const heightMeasurements = () => ({
                ...heights.stats(),
                iframe_width:
                    Math.round(iframe.getBoundingClientRect().width * 100) /
                    100,
                device_pixel_ratio: globalThis.devicePixelRatio ?? null,
            });

            /**
             * Once per mount, and only for a form that reached the page: one
             * that never loaded has no height to describe, and its failure is
             * reported on its own.
             */
            const sendHeightSummary = (ended: CardFormEnd) => {
                window.removeEventListener('pagehide', onHeightPageHide);
                if (heightSummarySent || readyAt === null) {
                    return;
                }
                heightSummarySent = true;
                telemetry.cardFormHeight({
                    phase: 'summary',
                    flow: options.flow,
                    durationMs: sinceReady(),
                    measurements: { ...heightMeasurements(), ended },
                });
            };

            /**
             * A customer who leaves with the form still mounted never reaches
             * cleanup(), and that visit is as likely as any to be the one where
             * the height misbehaved. Registered per mount and removed with it,
             * unlike the page-wide leave beacon: it describes this form, not
             * the page.
             */
            const onHeightPageHide = (event: PageTransitionEvent) => {
                sendHeightSummary('leave');
                if (event.persisted) {
                    restoreArmed = true;
                    window.addEventListener('pageshow', onHeightPageShow, {
                        once: true,
                    });
                }
            };

            /**
             * Back from the back/forward cache with the form still mounted.
             * The summary already went out at pagehide and can be the last
             * word if the page is never restored, so it stays; what follows is
             * a second visit — the leave beacon reads it the same way — with
             * its own heights and its own summary. Without this the `once`
             * listener was spent and heightSummarySent latched, so the real
             * end of the visit and every height after the restore went
             * unreported.
             */
            const onHeightPageShow = (event: PageTransitionEvent) => {
                restoreArmed = false;
                if (!event.persisted || !iframeMounted) {
                    return;
                }
                heights = createHeightTracker(nowMs);
                heightSummarySent = false;
                window.addEventListener('pagehide', onHeightPageHide, {
                    once: true,
                });
            };

            window.addEventListener('pagehide', onHeightPageHide, {
                once: true,
            });

            let iframeLoadTimeout: ReturnType<typeof setTimeout> | undefined;

            const cleanup = (ended: CardFormEnd) => {
                // First, while the iframe is still in the document to measure.
                sendHeightSummary(ended);
                if (restoreArmed) {
                    restoreArmed = false;
                    window.removeEventListener('pageshow', onHeightPageShow);
                }
                iframeMounted = false;
                releaseSession();
                clearTimeout(iframeLoadTimeout);
                clearSpinner();
                emitLoadingState('idle');
                if (onMessage) {
                    window.removeEventListener('message', onMessage);
                }
                iframe.remove();
            };

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

                // The other half of the init/ready pair. Deliberately the load
                // event and not an acknowledgement from the iframe: an ack
                // would need a new message in the postMessage protocol, and
                // that protocol is shared with gw-ui-cc-v4. "The form is on the
                // page" is what this claims, and it is what it can prove.
                readyAt = nowMs();
                telemetry.lifecycle('ready', {
                    paymentMethod: 'card',
                    flow: options.flow,
                });
            };

            iframe.onerror = () => {
                cleanup('load-error');
                rejectResult(
                    new GoPaySDKError(
                        '[GoPayBrowserSDK] Card form iframe failed to load.',
                        { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                    ),
                );
            };

            iframeLoadTimeout = setTimeout(() => {
                cleanup('timeout');
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
                // Reported before the branch, so both flows mark it. It is the
                // only proof the customer got as far as submitting: the
                // encrypt-only flow makes no request at all after this, and
                // the direct-charge flow's next event is the charge, which
                // cannot say whether a missing charge means no submit or a
                // submit that never reached here.
                //
                // The payload is deliberately not touched — not its length,
                // not a hash, nothing. What leaves is that a submit happened
                // and how long the form had been on the page.
                telemetry.submit('card-form', {
                    paymentMethod: 'card',
                    flow: options.flow,
                    durationMs:
                        readyAt === null ? null : Math.round(nowMs() - readyAt),
                });

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

                charging = true;
                try {
                    const { threeDS, awaitOptions } = options;

                    await paymentsApi.chargePayment(
                        {
                            payment_instrument: {
                                payment_instrument: 'PAYMENT_CARD',
                                input: {
                                    input_type: 'ENCRYPTED_CARD',
                                    payload: encryptedPayload,
                                },
                            },
                        },
                        { signal: chargeAbortController.signal },
                    );

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
                            callIntegrator(
                                'onStateChange',
                                () => {
                                    awaitOptions?.onStateChange?.(state);
                                },
                                telemetry,
                            );
                        },
                    });

                    clearSpinner();
                    charging = false;
                    emitLoadingState('idle');
                    resolveResult(chargeState);
                } catch (err) {
                    clearSpinner();
                    // Only a terminal FAILED carries the state it failed in.
                    // An abort, a timeout or a failed request does not, and
                    // for those the charge may still complete at GoPay.
                    if (
                        err instanceof GoPaySDKError &&
                        err.chargeState !== undefined
                    ) {
                        charging = false;
                    }
                    emitLoadingState('idle');
                    rejectResult(err);
                }
            };

            const handleHeightMessage = (height: number) => {
                if (Number.isFinite(height) && height >= 0) {
                    iframe.style.height = `${height}px`;
                    // After the resize, so nothing here can delay or block it.
                    if (heights.record(height)) {
                        telemetry.cardFormHeight({
                            phase: 'oscillation',
                            flow: options.flow,
                            durationMs: sinceReady(),
                            measurements: heightMeasurements(),
                        });
                    }
                }
            };

            const handleValidityMessage = (nextValid: boolean) => {
                if (typeof nextValid !== 'boolean' || nextValid === isValid) {
                    return;
                }
                isValid = nextValid;
                callIntegrator(
                    'onValidityChange',
                    () => {
                        options.onValidityChange?.(isValid);
                    },
                    telemetry,
                );
            };

            const handleFieldErrorsMessage = (errors: readonly unknown[]) => {
                if (!Array.isArray(errors)) {
                    return;
                }
                // Projected rather than forwarded: the card form is deployed
                // independently of this SDK, so the "codes only, never values"
                // guarantee is enforced on this side of the boundary too. Each
                // entry is validated against the protocol values, which also
                // keeps the callback's declared union honest — a consumer's
                // exhaustive switch can rely on it. Entries outside the
                // protocol are dropped; a value added on the iframe side needs
                // the synced protocol file (and this map) updated with it.
                const projected: CardFormFieldError[] = errors
                    .filter(isCardFormFieldError)
                    .map(({ field, code }) => ({ field, code }));
                callIntegrator(
                    'onFieldErrors',
                    () => {
                        options.onFieldErrors?.(projected);
                    },
                    telemetry,
                );
            };

            onMessage = async (event: MessageEvent<OutboundMessage>) => {
                if (
                    event.source !== iframe.contentWindow ||
                    event.origin !== expectedOrigin
                ) {
                    return;
                }

                switch (event.data?.type) {
                    case 'GOPAY_CARD_FORM_HEIGHT':
                        handleHeightMessage(event.data.height);
                        return;
                    case 'GOPAY_CARD_ENCRYPT_READY':
                        iframe.focus();
                        return;
                    case 'GOPAY_CARD_FORM_VALIDITY':
                        handleValidityMessage(event.data.isValid);
                        return;
                    case 'GOPAY_CARD_FORM_ERRORS':
                        handleFieldErrorsMessage(event.data.errors);
                        return;
                    case 'GOPAY_CARD_ENCRYPT_ERROR':
                        cleanup('encrypt-error');
                        rejectResult(
                            new GoPaySDKError(
                                `[GoPayBrowserSDK] Card form error: ${event.data.error}`,
                                { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                            ),
                        );
                        return;
                    case 'GOPAY_CARD_ENCRYPT_RESULT':
                        cleanup('encrypted');
                        await handleEncryptResult(event.data.card_token);
                        return;
                    default:
                        return;
                }
            };

            window.addEventListener('message', onMessage);

            return {
                result,
                setTheme: (t: CardFormTheme) => {
                    if (iframeMounted) {
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
                    if (iframeMounted) {
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
                        // emitError, not reportError: the controller is not run
                        // through reportErrors (its isValid is a live getter),
                        // and this has to keep throwing to its caller.
                        client.emitError(
                            new GoPaySDKError(
                                '[GoPayBrowserSDK] submit() is only available in external submit mode (submitMode: "external").',
                                { errorCode: GoPayErrorCodes.INVALID_ARGUMENT },
                            ),
                        );
                    }
                    if (iframeMounted) {
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
                    if (settled) {
                        return;
                    }
                    // Its own event rather than the rejection below: tearing the
                    // form down on purpose is not a failure, and read as
                    // SDK.CARD_FORM_ERROR it was indistinguishable from an
                    // iframe that never loaded. The wallet buttons do the same
                    // since GPOMA-2668.
                    telemetry.unmount({
                        paymentMethod: 'card',
                        sheetOpen: false,
                        chargeInFlight: charging,
                    });
                    chargeAbortController.abort();
                    cleanup('unmount');
                    // The integrator still hears about it through onError and
                    // the rejection; only the operational error event is
                    // suppressed, so one teardown is one event.
                    rejectResult(
                        new GoPaySDKError(
                            '[GoPayBrowserSDK] Card form unmounted.',
                            { errorCode: GoPayErrorCodes.CARD_FORM_ERROR },
                        ),
                        { telemetry: false },
                    );
                },
            };
        },
    };
}
