import {
    type ApiCallRecord,
    type GoPayEnvironment,
    type GoPayHTTPError,
    type GoPaySDKError,
    LOGGER_URLS,
    type Telemetry,
} from '@gopay-internal/core';
import { SDK_VERSION } from '../version.js';
import { getTransactionId, newTraceId } from './ids.js';
import { safeErrorMessage, safePageUrl } from './sanitize.js';

/**
 * Braintree's figure, and for the same reason: telemetry that outlives the
 * request it describes is telemetry delaying a payment.
 */
const REQUEST_TIMEOUT_MS = 2_000;

/**
 * Per visit. A page that somehow loops through the SDK cannot turn into a flood
 * against an ingest that answers every POST with 204 and no backpressure.
 */
const MAX_EVENTS_PER_VISIT = 200;

/**
 * `status_code` is nullable in the schema, which leaves three states worth
 * telling apart downstream:
 *
 * - a real HTTP status — the request reached the API and it answered
 * - `null` — the request was issued and produced no response (timeout, network)
 * - `SDK_ERROR_STATUS` — never an HTTP call at all: argument validation, a
 *   config guard, a card form or wallet button giving up
 *
 * The third is gw-ui's convention (`useSdkEventLogger`), reused rather than
 * invented so both producers read the same way in OpenSearch.
 */
const SDK_ERROR_STATUS = 0;

/**
 * Carried by every event. gw-logger requires an attribution key — one of
 * payment_session_id or shareable_key — and rejects a key that is present but
 * empty, so an absent value is left off rather than sent as "".
 */
interface CommonFields {
    shareable_key?: string;
    client_id?: string;
    payment_session_id?: string;
    sdk_version: string;
    integration: string;
    payment_method?: string;
    flow?: string;
    trace_id: string;
    transaction_id: string;
    origin: string;
    duration: number | null;
}

interface ApiCallEvent extends CommonFields {
    event_type: 'api_call';
    action: string;
    target: string;
    status_code: number | null;
    res_body?: string;
}

/**
 * The lifecycle markers. init says the SDK was constructed, navigate (flow
 * `attach`) says it took ownership of a payment session, ready says what it was
 * asked to mount is on the page. A payment that never starts is init without a
 * matching ready — neither event on its own carries that, which is why the
 * failure was invisible before, and the attach in between says which of the two
 * steps it got stuck on.
 */
interface NavigationEvent extends CommonFields {
    event_type: 'navigation';
    navigation_type: 'init' | 'navigate' | 'ready' | 'leave';
    target: string | null;
}

/**
 * The one thing the customer does that the SDK can see. Everything they type
 * happens inside the card form iframe and is deliberately invisible here; what
 * crosses back out is that they submitted and the payload encrypted, which is
 * the step between "the form was on the page" and "a charge was attempted".
 *
 * Without it those two are the only markers, and a checkout that dies in
 * between — the customer never submitting, or the encrypt result never
 * arriving — looks identical to one where the charge itself failed.
 *
 * No payload, no field contents, no keystroke count. `duration` is how long
 * the form was on the page before it was submitted.
 */
interface InteractionEvent extends CommonFields {
    event_type: 'interaction';
    interaction_type: 'submit';
    element_id: string;
}

type GwLoggerEvent = ApiCallEvent | NavigationEvent | InteractionEvent;

/** Omitted rather than sent empty — see CommonFields. */
function orUndefined(value: string | undefined): string | undefined {
    return value ? value : undefined;
}

/**
 * Read through `typeof`, which is the one way to touch a possibly-undeclared
 * identifier without a ReferenceError.
 *
 * The value is a build-time constant, so it has to be declared in every build
 * config that compiles this file — tsup, both vitest configs, and the example's
 * Vite config. Miss one and a bare read throws where `base()` runs, which is
 * now SDK construction: a missing label would take the whole checkout down.
 * That contradicts the rule the rest of this file is built on — logging is
 * never worth a thrown error in a payment flow — so it degrades instead.
 */
const INTEGRATION: string =
    typeof __GOPAY_INTEGRATION__ === 'string'
        ? __GOPAY_INTEGRATION__
        : 'browser-sdk-unknown';

/** `/payments/{id}/charge` → `charge`; gw-ui's action convention. */
function lastSegment(endpoint: string): string {
    const parts = endpoint.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
}

/**
 * The core seam plus the lifecycle events, which only a browser has. Core stays
 * unaware of them on purpose: the server SDK shares the HTTP client and has no
 * page to mount anything on.
 */
export interface BrowserTelemetry extends Telemetry {
    lifecycle(
        navigationType: NavigationEvent['navigation_type'],
        context?: { paymentMethod?: string; flow?: string },
    ): void;
    submit(
        elementId: string,
        context?: {
            paymentMethod?: string;
            flow?: string;
            durationMs?: number | null;
        },
    ): void;
}

/**
 * The default for the module factories, mirroring core's `NO_TELEMETRY`: a call
 * site stays unconditional, and a test that does not care about telemetry does
 * not have to construct one. The single real call site is
 * `createGoPayBrowserSDK`, which always passes the live emitter.
 */
export const NO_BROWSER_TELEMETRY: BrowserTelemetry = {
    apiCall: () => {},
    error: () => {},
    lifecycle: () => {},
    submit: () => {},
};

export function createGwLoggerTelemetry(options: {
    environment: GoPayEnvironment;
    getShareableKey: () => string | undefined;
    getClientId: () => string | undefined;
    getPaymentId: () => string | undefined;
}): BrowserTelemetry {
    const url = `${LOGGER_URLS[options.environment]}/events`;
    let sent = 0;

    /**
     * Fire and forget, in the strict sense: nothing here is awaited by a caller,
     * nothing retries, and every failure path ends in a swallowed rejection.
     *
     * No retry is a decision, not an omission — a retry against an endpoint that
     * answers 204 regardless of whether it accepted the event cannot tell a
     * transient failure from a rejected payload, so it would loop on exactly the
     * events that are never going to be accepted.
     *
     * Uses `fetch` directly rather than the SDK's HTTP client: the client is the
     * thing being measured, so routing telemetry through it would emit an
     * api_call per api_call.
     */
    function post(event: GwLoggerEvent): void {
        if (sent >= MAX_EVENTS_PER_VISIT) {
            return;
        }
        sent += 1;

        try {
            void fetch(
                new Request(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ event }),
                    // Survives the 3DS redirect unloading the page — the charge
                    // result is precisely the event worth not losing.
                    keepalive: true,
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                }),
            ).catch(() => {});
        } catch {
            // AbortSignal.timeout or fetch missing on an older engine. Logging
            // is never worth a thrown error in a payment flow.
        }
    }

    function base(): CommonFields {
        return {
            shareable_key: orUndefined(options.getShareableKey()),
            client_id: orUndefined(options.getClientId()),
            // Known only from attachPayment onwards. The encrypt-only flow
            // never has one, which is why gw-logger stopped requiring it.
            payment_session_id: orUndefined(options.getPaymentId()),
            sdk_version: SDK_VERSION,
            integration: INTEGRATION,
            trace_id: newTraceId(),
            transaction_id: getTransactionId(),
            origin: safePageUrl(),
            duration: null,
        };
    }

    return {
        apiCall(record: ApiCallRecord): void {
            post({
                ...base(),
                event_type: 'api_call',
                action: lastSegment(record.endpoint),
                target: record.endpoint,
                status_code: record.statusCode,
                duration: record.durationMs,
            });
        },

        lifecycle(navigationType, context): void {
            post({
                ...base(),
                event_type: 'navigation',
                navigation_type: navigationType,
                // url.full is a navigation destination; these events describe
                // this page, which origin already carries.
                target: null,
                payment_method: orUndefined(context?.paymentMethod),
                flow: orUndefined(context?.flow),
            });
        },

        submit(elementId, context): void {
            post({
                ...base(),
                event_type: 'interaction',
                interaction_type: 'submit',
                element_id: elementId,
                payment_method: orUndefined(context?.paymentMethod),
                flow: orUndefined(context?.flow),
                duration: context?.durationMs ?? null,
            });
        },

        error(error: GoPaySDKError | GoPayHTTPError): void {
            const code =
                'errorCode' in error && typeof error.errorCode === 'string'
                    ? error.errorCode
                    : 'UNKNOWN';
            post({
                ...base(),
                event_type: 'api_call',
                action: `SDK.${code}`,
                // No endpoint to name: these are raised before a request, or
                // instead of one.
                target: '',
                status_code: SDK_ERROR_STATUS,
                duration: null,
                res_body: safeErrorMessage(error),
            });
        },
    };
}
