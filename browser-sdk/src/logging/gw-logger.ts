import {
    type ApiCallRecord,
    type GoPayEnvironment,
    type GoPayHTTPError,
    type GoPaySDKError,
    LOGGER_URLS,
    safeErrorLabel,
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
 * Per SDK instance, and split in two on purpose.
 *
 * A page that somehow loops through the SDK must not turn into a flood against
 * an ingest that answers every POST with 204 and no backpressure — but one
 * shared cap made the flood eat the funnel. Charge-state polling emits an
 * api_call every couple of seconds and 3DS has no time limit, so a slow
 * authentication would spend the whole budget on identical poll records and
 * then silently drop the `leave` and the terminal charge — the events the
 * feature exists for, lost in exactly the flows most worth watching.
 *
 * The lifecycle side is bounded by design (a handful of markers per mount), so
 * its own small budget both caps a runaway and guarantees it can never be
 * crowded out by traffic. Errors get a third budget for the same reason and
 * with more force: on a shared counter a flood of polls would have silenced
 * the one kind of event nobody can afford to lose.
 */
const EVENT_BUDGET = {
    api_call: 200,
    lifecycle: 50,
    error: 50,
} as const;

type BudgetKind = keyof typeof EVENT_BUDGET;

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

/**
 * A request the SDK actually issued — and, since GPOMA-2668, nothing else.
 *
 * Three other things used to travel as `api_call` (gw-ui's convention: status
 * code 0, empty target) although none of them touched the network: an SDK
 * error, an unavailable wallet, and an integrator callback that threw. That
 * put them in the one event type built for HTTP, where every aggregation over
 * it — API error rate, calls per session — counted them, and where the only
 * field carrying anything useful was the one a request-shaped column layout
 * does not show. They are {@link JsEvent} now.
 */
interface ApiCallEvent extends CommonFields {
    event_type: 'api_call';
    action: string;
    /** Every event of this type is a real request, so the verb is known. */
    http_method: string;
    target: string;
    /**
     * A real HTTP status, or `null` when the request was issued and produced
     * no response at all (timeout, network). There is no third state: `0`
     * used to mean "never a request", and nothing reports that here any more.
     */
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

/**
 * Something the SDK did that was not an HTTP call: it failed, it refused to
 * offer a wallet, or a callback the integrator supplied threw.
 *
 * gw-ui's shape, reused rather than invented (`sendEvent` in its gp-api
 * component) so both producers read the same way in OpenSearch. gw-logger maps
 * `function_name` to ECS `event.action`, `params` to `labels.params`,
 * `return_value` to `message` and `error_code` to `error.code`.
 *
 * `event.action` is the same field an api_call's `action` lands in, so the
 * three of these that used to be api_calls are still found the same way —
 * what changes is that an aggregation over api_call no longer counts them.
 */
interface JsEvent extends CommonFields {
    event_type: 'js_event';
    /**
     * What ran: the SDK function for the wallet and callback events, the error
     * code for an SDK error. gw-ui puts plain function names in the same
     * field, so this reads the same way across both producers.
     */
    function_name: string;
    /** The machine-readable half of an error, in the field ECS has for it. */
    error_code?: string;
    params?: string;
    return_value?: string;
}

type GwLoggerEvent =
    | ApiCallEvent
    | NavigationEvent
    | InteractionEvent
    | JsEvent;

/** Omitted rather than sent empty — see CommonFields. */
function orUndefined(value: string | undefined): string | undefined {
    return value || undefined;
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

/** The schema's cap on `params`. */
const MAX_PARAMS_LENGTH = 4096;

/**
 * One value in a `params` object: primitives only, so describeParams can scrub
 * the strings and pass the rest through as they are. `null` means the browser
 * did not answer, and is dropped rather than rendered.
 */
export type ParamValue = string | number | boolean | null;

/**
 * A JSON object, which is gw-ui's shape for `params` and therefore ours:
 * `JSON.stringify({ origin, messageType })` in its gp-api component. One
 * shape means one way to read `labels.params` in OpenSearch whichever
 * producer wrote the row.
 *
 * Absent values are dropped rather than rendered, so a capability the browser
 * would not answer reads as missing instead of as the string "null" — which
 * in a query is indistinguishable from `false`.
 *
 * String values go through the message scrub; numbers and booleans cannot
 * carry anything to scrub. Nothing here is free-form today, but that is what
 * keeps a field added later from silently widening what leaves the page.
 */
function describeParams(
    fields: Record<string, ParamValue | undefined>,
): string | undefined {
    const kept: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(fields)) {
        if (value === null || value === undefined) {
            continue;
        }
        kept[key] = typeof value === 'string' ? safeErrorMessage(value) : value;
    }
    if (Object.keys(kept).length === 0) {
        return undefined;
    }
    const json = JSON.stringify(kept);
    // Cutting JSON at a byte offset produces something no reader can parse,
    // so an over-long object reports its size instead of half of itself.
    return json.length <= MAX_PARAMS_LENGTH
        ? json
        : JSON.stringify({ truncated: json.length });
}

/**
 * The context an error carries in its own fields and the api_call shape had
 * nowhere to put.
 *
 * A GoPayHTTPError knows the status, the verb and the id-collapsed endpoint of
 * the request that failed; all three were dropped on the way out, because
 * `target` was hardcoded empty and `status_code` to 0. A 409 on charge reached
 * OpenSearch as `SDK.CHARGE_FAILED` with no 409 and no `/payments/{id}/charge`
 * anywhere on the row.
 *
 * Read by shape rather than by `instanceof`: this is handed whatever was
 * reported, and a cross-realm error (an iframe, a bundled second copy of core)
 * fails an identity check while still carrying the fields.
 *
 * Only values the SDK itself produced — never a message, and never the cause's
 * own message: those hold whatever their author put in them. The cause is
 * named by class, through the same allowlist core uses.
 */
function describeErrorContext(
    error: GoPaySDKError | GoPayHTTPError,
): string | undefined {
    const fields: Record<string, string | number | undefined> = {};
    if ('status' in error && typeof error.status === 'number') {
        fields.status = error.status;
    }
    if ('method' in error && typeof error.method === 'string') {
        fields.method = error.method;
    }
    if ('endpoint' in error && typeof error.endpoint === 'string') {
        fields.endpoint = error.endpoint;
    }
    if ('cause' in error && error.cause !== undefined) {
        fields.cause = safeErrorLabel(error.cause);
    }
    return describeParams(fields);
}

/**
 * What the teardown interrupted, most significant first.
 *
 * Written out rather than chained: CLAUDE.md does not allow chained ternaries,
 * and the order is the point — a sheet open in front of the shopper outranks a
 * charge they can no longer see.
 */
function describeUnmount(sheetOpen: boolean, chargeInFlight: boolean): string {
    if (sheetOpen) {
        return 'sheet-aborted';
    }
    if (chargeInFlight) {
        return 'charge-aborted';
    }
    return 'idle';
}

/** `/payments/{id}/charge` → `charge`; gw-ui's action convention. */
function lastSegment(endpoint: string): string {
    const parts = endpoint.split('/').filter(Boolean);
    // Skipping the `{id}` normalizeEndpoint leaves behind is the whole point.
    // `GET /payments/{id}` — the charge-state poll, the highest-volume call the
    // SDK makes — would otherwise be reported under the action `{id}`, which
    // names nothing and collides with every other id-terminated path.
    for (let i = parts.length - 1; i >= 0; i -= 1) {
        const part = parts[i];
        if (part && !part.startsWith('{')) {
            return part;
        }
    }
    return '';
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
    /**
     * A wallet button that was asked for and could not be offered.
     *
     * Separate from `error` because that seam is core's and carries only the
     * error object — no `payment_method`, which is the one field this question
     * needs. The unavailable path is also not a failure in the payment sense:
     * on a genuinely unsupported device it is the correct outcome, and burying
     * it in `SDK.WALLET_BUTTON_ERROR` is what made "Apple Pay never showed"
     * indistinguishable from "Google Pay never showed" in the data.
     */
    walletUnavailable(context: {
        /**
         * The SDK function that decided there would be no button. The mount
         * and the availability probe both report this event with the same
         * reason codes, and without the name they are one undifferentiated
         * pile — a merchant asking first cannot be told apart from a merchant
         * whose button failed to draw.
         */
        functionName: string;
        paymentMethod: string;
        reason: string;
        capabilities?: Record<string, ParamValue>;
    }): void;
    /**
     * A callback the integrator supplied threw.
     *
     * Deliberately not routed through `error()`, which also reaches
     * `config.onError`: that channel means "the SDK hit a problem", and
     * filling it with bugs in the merchant's own callbacks would make it
     * useless as a signal about the SDK. They hear about it from their own
     * global handler instead — see `callIntegrator`.
     *
     * Carries the callback name and the error's constructor name, nothing
     * else. The message is written by the merchant's code and can hold their
     * data; a class name cannot.
     */
    integratorError(label: string, errorName: string): void;
    /**
     * A step in a wallet flow that is neither a request nor a failure.
     *
     * gw-ui logs its wallet SDKs step by step — begin, cancel,
     * validateMerchant, paymentAuthorized, completePayment, abort — and that
     * is what lets it see where a payment stopped. This SDK reported the ends
     * of the flow and almost nothing in between, so the case this ticket opened
     * with was invisible in the data: the shopper tapped the button, no sheet
     * came up, and nothing anywhere recorded that a tap had happened at all.
     *
     * `step` uses gw-ui's vocabulary so the two read the same way; `status` is
     * its start / success / failure / info. Failures that already have an event
     * of their own — an SDK error, an unavailable wallet, a teardown — are not
     * repeated here.
     */
    walletStep(context: {
        paymentMethod: string;
        step: string;
        status: 'start' | 'success' | 'failure' | 'info';
        detail?: string;
    }): void;
    /**
     * The answer an availability probe reached — whichever way it went.
     *
     * Reported on success as well as refusal, which is gw-ui's shape
     * (`readyToPay` in useSdkEventLogger, logged with `available` either way)
     * and the reason it can state an availability *rate*. Only ever emitting
     * the negative, as this did, gives a numerator with no denominator:
     * "Apple Pay unavailable 200 times" reads the same whether that is out of
     * 210 probes or out of 20 000.
     *
     * Kept a js_event rather than gw-ui's api_call envelope: that one carries
     * status_code 0 and an empty target for a call that never happened, which
     * is what GPOMA-2668 removed.
     */
    walletAvailability(context: {
        functionName: string;
        paymentMethod: string;
        available: boolean;
        /** Why not, when it is not. */
        reason?: string;
        capabilities?: Record<string, ParamValue>;
    }): void;
    /**
     * A wallet button or the card form torn down by the integrator.
     *
     * It was already reaching gw-logger before this existed — as
     * `SDK.WALLET_BUTTON_ERROR` or `SDK.CARD_FORM_ERROR`, because the teardown
     * rejects the controller's promise and every rejection is reported. So a
     * merchant unmounting the button when the shopper steps back through the
     * checkout was indistinguishable from a sheet that genuinely broke, and it
     * spent the error budget doing it. The card form kept doing that after the
     * wallets stopped (GPOMA-2668) until GPOMA-2679.
     *
     * A deliberate teardown is not a failure. It is reported here instead, and
     * the error event for the same unmount is suppressed at the call site, so
     * one teardown is one event.
     *
     * It also completes a pair: `ready` says the button or form reached the
     * page, and until now nothing said it left. A `ready` with neither a
     * terminal charge nor an unmount after it is the funnel gap worth looking
     * at.
     */
    unmount(context: {
        paymentMethod: string;
        /**
         * A payment sheet was open and has been aborted. Always false for the
         * card form, which has no sheet — kept so one query reads all three.
         */
        sheetOpen: boolean;
        /** A charge was in flight and has been aborted. */
        chargeInFlight: boolean;
    }): void;
    /**
     * What the card form's reported height did while it was mounted.
     *
     * Two phases, both bounded to one per visit: `oscillation` the moment the
     * height starts reversing direction faster than a customer could cause,
     * and `summary` when the form goes away. A visit is one mount, or the
     * part of it after a restore from the back/forward cache, which starts
     * another with its own pair. Never one event per height
     * message — a height that genuinely oscillates would send dozens a second
     * and spend the lifecycle budget the funnel markers need.
     *
     * Layout measurements only. The iframe's height moves with validation
     * messages and text wrapping, never with what was typed into a field, and
     * the values are the ones the SDK itself writes into `iframe.style.height`.
     */
    cardFormHeight(context: {
        phase: 'oscillation' | 'summary';
        flow: string;
        /**
         * Since the form became ready, or since the restore that started this
         * visit; null when it never became ready.
         */
        durationMs: number | null;
        measurements: Record<string, ParamValue>;
    }): void;
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
    walletUnavailable: () => {},
    integratorError: () => {},
    unmount: () => {},
    walletAvailability: () => {},
    walletStep: () => {},
    cardFormHeight: () => {},
};

export function createGwLoggerTelemetry(options: {
    environment: GoPayEnvironment;
    getShareableKey: () => string | undefined;
    getClientId: () => string | undefined;
    getPaymentId: () => string | undefined;
}): BrowserTelemetry {
    const url = `${LOGGER_URLS[options.environment]}/events`;
    const spent: Record<BudgetKind, number> = {
        api_call: 0,
        lifecycle: 0,
        error: 0,
    };

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
    function post(budget: BudgetKind, build: () => GwLoggerEvent): void {
        try {
            if (spent[budget] >= EVENT_BUDGET[budget]) {
                return;
            }
            // Built inside the try, not passed in already built. `base()` reads
            // the page URL and the callers' getters, and an emitter is called
            // from a `finally` on the payment path — a throw while assembling
            // the event would replace the payment error the caller was about
            // to receive with a telemetry error. Logging is never worth that.
            const event = build();
            spent[budget] += 1;

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
            // A field getter throwing, or AbortSignal.timeout / fetch missing
            // on an older engine. Logging is never worth a thrown error in a
            // payment flow.
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
            post('api_call', () => ({
                ...base(),
                event_type: 'api_call',
                action: lastSegment(record.endpoint),
                // Without it the POST that starts a charge and the GETs that
                // poll its result are three rows with one action and one
                // target between them, told apart only by their duration.
                http_method: record.method,
                target: record.endpoint,
                status_code: record.statusCode,
                duration: record.durationMs,
            }));
        },

        lifecycle(navigationType, context): void {
            post('lifecycle', () => ({
                ...base(),
                event_type: 'navigation',
                navigation_type: navigationType,
                // url.full is a navigation destination; these events describe
                // this page, which origin already carries.
                target: null,
                payment_method: orUndefined(context?.paymentMethod),
                flow: orUndefined(context?.flow),
            }));
        },

        submit(elementId, context): void {
            post('lifecycle', () => ({
                ...base(),
                event_type: 'interaction',
                interaction_type: 'submit',
                element_id: elementId,
                payment_method: orUndefined(context?.paymentMethod),
                flow: orUndefined(context?.flow),
                duration: context?.durationMs ?? null,
            }));
        },

        walletUnavailable({
            functionName,
            paymentMethod,
            reason,
            capabilities,
        }): void {
            post('error', () => ({
                ...base(),
                event_type: 'js_event',
                function_name: functionName,
                duration: null,
                payment_method: orUndefined(paymentMethod),
                // The reason is the answer to "why was there no button", so it
                // goes where a js_event's message lives rather than into a
                // label nobody reads by default.
                return_value: safeErrorMessage(reason),
                params: describeParams(capabilities ?? {}),
            }));
        },

        integratorError(label, errorName): void {
            post('error', () => ({
                ...base(),
                event_type: 'js_event',
                // The callback the merchant supplied — the function that threw
                // really is the subject of this event, which is exactly what
                // the field is for.
                function_name: label,
                duration: null,
                return_value: errorName,
            }));
        },

        walletStep({ paymentMethod, step, status, detail }): void {
            post('lifecycle', () => ({
                ...base(),
                event_type: 'js_event',
                // gw-ui writes `<sdk>.<step>` into the same ECS field and
                // carries the wallet separately too; the step alone keeps
                // event.action readable and payment_method does that job here.
                function_name: step,
                duration: null,
                payment_method: orUndefined(paymentMethod),
                return_value: safeErrorMessage(detail ?? status),
                params: describeParams({ status }),
            }));
        },

        walletAvailability({
            functionName,
            paymentMethod,
            available,
            reason,
            capabilities,
        }): void {
            // The lifecycle budget: a probe is a bounded, ordinary step, and
            // an answer of "no" is the correct outcome on a device that
            // cannot pay — not a failure, and not something to spend the
            // error budget on.
            post('lifecycle', () => ({
                ...base(),
                event_type: 'js_event',
                function_name: functionName,
                duration: null,
                payment_method: orUndefined(paymentMethod),
                // `available` on its own would need a second field to say why
                // not; the reason is the more useful of the two and carries
                // the answer with it.
                return_value: available
                    ? 'available'
                    : safeErrorMessage(reason ?? 'unavailable'),
                params: describeParams({ available, ...capabilities }),
            }));
        },

        unmount({ paymentMethod, sheetOpen, chargeInFlight }): void {
            // The lifecycle budget, not the error one: this is a bounded
            // marker — a handful per mount — and it is emitted precisely
            // because a teardown is not a failure.
            post('lifecycle', () => ({
                ...base(),
                event_type: 'js_event',
                // The function the integrator actually called. Which wallet —
                // or the card form — it was is payment_method's job, as
                // everywhere else.
                function_name: 'unmount',
                duration: null,
                payment_method: orUndefined(paymentMethod),
                return_value: describeUnmount(sheetOpen, chargeInFlight),
                params: describeParams({
                    sheet_open: sheetOpen,
                    charge_in_flight: chargeInFlight,
                }),
            }));
        },

        cardFormHeight({ phase, flow, durationMs, measurements }): void {
            // The lifecycle budget: at most two of these per mount, and the
            // oscillation is exactly the case the budget split exists for — a
            // flood of anything must not silence the funnel.
            post('lifecycle', () => ({
                ...base(),
                event_type: 'js_event',
                // The protocol message being described, in the field gw-ui
                // fills with a function name; one name for both phases keeps
                // them in one query.
                function_name: 'card-form-height',
                // The schema's duration is an integer.
                duration: durationMs === null ? null : Math.round(durationMs),
                payment_method: 'card',
                flow: orUndefined(flow),
                return_value: phase,
                params: describeParams(measurements),
            }));
        },

        error(error: GoPaySDKError | GoPayHTTPError): void {
            const code =
                'errorCode' in error && typeof error.errorCode === 'string'
                    ? error.errorCode
                    : 'UNKNOWN';
            post('error', () => ({
                ...base(),
                event_type: 'js_event',
                // Bare, not the `SDK.` prefix the api_call `action` carried.
                // The prefix would have bought continuity for dashboards
                // matching `SDK.*` on event.action — but any such dashboard
                // also filters on the event type, and that filter breaks here
                // whatever this field says. So it buys nothing, and gw-ui
                // writes plain names into the same field.
                function_name: code,
                // The same value in the field ECS has for it (error.code),
                // which is where a machine should read it from.
                error_code: code,
                duration: null,
                params: describeErrorContext(error),
                return_value: safeErrorMessage(error),
            }));
        },
    };
}
