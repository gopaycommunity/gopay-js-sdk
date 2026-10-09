import {
    type ApiCallRecord,
    type GoPayEnvironment,
    type GoPayHTTPError,
    type GoPaySDKError,
    LOGGER_URLS,
    nowMs,
    safeErrorLabel,
    type Telemetry,
    timeoutSignal,
} from '@gopay-internal/core';
import { SDK_VERSION } from '../version.js';
import {
    getTransactionId,
    lastSequence,
    newInstanceId,
    newTraceId,
    recordSequence,
} from './ids.js';
import { markLeft } from './leave-latch.js';
import { safeErrorMessage, safePageUrl, serializeBody } from './sanitize.js';

/**
 * How long one event's upload may take before it is given up.
 *
 * It was 2 s, Braintree's figure, on the reasoning that telemetry outliving
 * the request it describes delays a payment. It cannot: nothing awaits these
 * requests. What it did instead was cut uploads on a slow connection — ALB
 * logged them as 460, client closed, with 26–58 bytes of body received — and
 * those events vanished without a trace anywhere.
 *
 * Still bounded rather than dropped. The requests are `keepalive`, and the
 * browser caps the bodies of all keepalive requests in flight at 64 KiB: an
 * ingest that hangs would hold every one of them open until that quota was
 * spent, and every later event — the leave and the charge result among them —
 * would then be refused outright.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The payment method an event is about, in gw-ui's vocabulary
 * (`PaymentMethodKey`). It prefixes `function_name` — `APPLE_PAY.ready`,
 * `GPAY.checkout` — which is how `useSdkEventLogger` names its events, so one
 * query on event.action reads both producers.
 */
const METHOD_KEY = {
    applepay: 'APPLE_PAY',
    googlepay: 'GPAY',
    card: 'PAYMENT_CARD',
} as const;

type PaymentMethod = keyof typeof METHOD_KEY;

/** `APPLE_PAY.<step>`; an unknown method keeps its own name rather than none. */
function actionName(paymentMethod: string, step: string): string {
    const key = METHOD_KEY[paymentMethod as PaymentMethod] ?? paymentMethod;
    return `${key}.${step}`;
}

/** The schema's duration is whole milliseconds. */
function msSince(start: number | undefined): number | null {
    return start === undefined ? null : Math.round(nowMs() - start);
}

/**
 * Per SDK instance, and split on purpose.
 *
 * A page that somehow loops through the SDK must not turn into a flood against
 * an ingest that answers every POST with 204 and no backpressure — but one
 * shared cap made the flood eat the funnel. Charge-state polling emits an
 * api_call every couple of seconds and 3DS has no time limit, so a slow
 * authentication would spend the whole budget on identical poll records and
 * then silently drop the `leave` and the terminal charge — the events the
 * feature exists for, lost in exactly the flows most worth watching.
 *
 * The lifecycle side — init, attach, ready, submit, unmount, leave — is
 * bounded by design (a handful of markers per mount), so its own small budget
 * both caps a runaway and guarantees it can never be crowded out by traffic.
 *
 * Wallet steps sit apart from it. They repeat with the shopper rather than
 * with the mount: every tap that ends in a cancel is a begin and a cancel, and
 * a shopper opening and dismissing the sheet a dozen times used to spend the
 * lifecycle budget and silence the leave. The steps get room for that, and
 * the funnel markers keep theirs whatever the steps do.
 *
 * Errors get a budget of their own for the same reason and with more force: on
 * a shared counter a flood of polls would have silenced the one kind of event
 * nobody can afford to lose.
 *
 * Page transitions too. They repeat with the shopper — every switch to the
 * banking app and back is two of them — so on the lifecycle budget a restless
 * shopper would silence the leave they exist to explain.
 */
const EVENT_BUDGET = {
    api_call: 200,
    lifecycle: 50,
    step: 150,
    error: 50,
    page: 30,
} as const;

type BudgetKind = keyof typeof EVENT_BUDGET;

/**
 * Carried by every event. gw-logger requires an attribution key — one of
 * payment_session_id or client_id — and rejects a key that is present but
 * empty, so an absent value is left off rather than sent as "".
 *
 * No shareable_key. It was the attribution key while client_id rode along
 * beside it; client_id identifies the merchant just as well, and the
 * shareable key is the one of the two that authorises calls.
 */
interface CommonFields {
    client_id?: string;
    payment_session_id?: string;
    /** One SDK instance; see {@link createGwLoggerTelemetry}. */
    sdk_instance_id: string;
    /** The tab's event number, set when the event is actually sent; see ids.ts. */
    seq?: number;
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
    /** Redacted by key and scrubbed — see `serializeBody`. */
    req_body?: string;
    res_body?: string;
}

/**
 * The page-level markers, and only those: init says the SDK was constructed,
 * navigate (flow `attach`) says it took ownership of a payment session, leave
 * says the page went away. `navigation_type` is an enum in gw-logger and gw-ui
 * sends exactly these three.
 *
 * `ready` used to be one of them. It describes a card form or a wallet button
 * reaching the page rather than the page itself, so it is a js_event now —
 * `<METHOD>.ready`, beside the method's other steps. A payment that never
 * starts is still init without a matching ready.
 */
interface NavigationEvent extends CommonFields {
    event_type: 'navigation';
    navigation_type: 'init' | 'navigate' | 'leave';
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
 * Something the SDK did that was not an HTTP call: a step of a payment method,
 * a failure, or a callback the integrator supplied that threw.
 *
 * gw-logger maps `function_name` to ECS `event.action`, `params` to
 * `labels.params`, `return_value` to `message` and `error_code` to
 * `error.code`.
 *
 * gw-ui logs its wallet steps as api_calls with status code 0 or 200 and an
 * empty target, for calls that never happened; GPOMA-2716 moves them here, to
 * this shape. So this is the shape both producers converge on: the step in
 * `function_name`, its outcome in `params.status` (start / success / failure /
 * info), the detail in `return_value`.
 */
interface JsEvent extends CommonFields {
    event_type: 'js_event';
    /**
     * What ran. A payment method's step is `<METHOD>.<step>` — `APPLE_PAY.begin`,
     * `GPAY.checkout`, `PAYMENT_CARD.ready` — which is gw-ui's naming, so the
     * method is in the name rather than in `payment_method`. An SDK error is
     * its error code, an integrator callback its name.
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

/**
 * What a failed step's `return_value` says: the error code the SDK gave it,
 * the HTTP status of a request that failed, or the class of anything else.
 *
 * Never the message. A wallet rejects with text its vendor wrote and a
 * merchant callback with text the merchant wrote, and neither is ours to
 * ship; a code or a class name says enough to group by.
 */
export function describeFailure(error: unknown): string {
    if (error !== null && typeof error === 'object') {
        if ('errorCode' in error && typeof error.errorCode === 'string') {
            return error.errorCode;
        }
        if ('status' in error && typeof error.status === 'number') {
            return `HTTP_${error.status}`;
        }
        // Google Pay rejects with a plain object carrying its own code.
        if ('statusCode' in error && typeof error.statusCode === 'string') {
            return error.statusCode;
        }
    }
    return safeErrorLabel(error);
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

/** gw-ui's outcome of a step: `useSdkEventLogger`'s `SdkEventStatus`. */
type StepStatus = 'start' | 'success' | 'failure' | 'info';

/**
 * What happened to the page itself, reported as `PAGE.<state>` — see
 * page-lifecycle.ts for what each one tells apart.
 */
export type PageState =
    | 'hidden'
    | 'visible'
    | 'freeze'
    | 'resume'
    | 'restored'
    | 'discarded'
    | PageArrival;

/**
 * How the document was reached, in Navigation Timing's own words — a new
 * navigation, a reload, the back or forward button — plus `prerender` for a
 * page the browser loaded speculatively before anyone asked to see it.
 */
export type PageArrival = 'navigate' | 'reload' | 'back_forward' | 'prerender';

/**
 * The core seam plus the lifecycle events, which only a browser has. Core stays
 * unaware of them on purpose: the server SDK shares the HTTP client and has no
 * page to mount anything on.
 *
 * Every timed event takes the `nowMs()` its step began at rather than a
 * duration, so the arithmetic happens in one place and a call site cannot get
 * the unit wrong.
 */
export interface BrowserTelemetry extends Telemetry {
    lifecycle(
        navigationType: NavigationEvent['navigation_type'],
        context?: { paymentMethod?: string; flow?: string },
    ): void;
    /**
     * The page is about to be sent to a 3DS challenge.
     *
     * Reported as the visit's `leave`, ahead of the navigation, so the one
     * departure that is part of a payment is told apart from the shopper
     * closing the tab: `flow` names it and `target` is where they went —
     * origin and path only, since an ACS URL carries its transaction in the
     * query. The `pagehide` that follows then sends nothing, or every 3DS
     * payment would count as abandoned as well.
     */
    redirect(context: { target: string; flow: string }): void;
    /**
     * What the integrator mounted is on the page and usable: the card form
     * loaded, a wallet button drawn. `<METHOD>.ready`, timed from the SDK's
     * init — how long a shopper waited for a way to pay.
     */
    ready(context: { paymentMethod: PaymentMethod; flow?: string }): void;
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
     * error object — no payment method, which is the one thing this question
     * needs. The unavailable path is also not a failure in the payment sense:
     * on a genuinely unsupported device it is the correct outcome, and burying
     * it in `SDK.WALLET_BUTTON_ERROR` is what made "Apple Pay never showed"
     * indistinguishable from "Google Pay never showed" in the data.
     *
     * Reported as `<METHOD>.readyToPay`, gw-ui's name for the same answer, with
     * the function that reached it in `params.caller`.
     */
    walletUnavailable(context: {
        /**
         * The SDK function that decided there would be no button. The mount
         * and the availability probe both report this answer with the same
         * reason codes, and without the name they are one undifferentiated
         * pile — a merchant asking first cannot be told apart from a merchant
         * whose button failed to draw.
         */
        functionName: string;
        paymentMethod: PaymentMethod;
        reason: string;
        capabilities?: Record<string, ParamValue>;
        /** When the mount began. */
        startedAt?: number;
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
     * A step in a wallet flow that is neither a request nor a failure the SDK
     * reports elsewhere.
     *
     * gw-ui logs its wallet SDKs step by step — load, begin, validateMerchant,
     * paymentAuthorized, completePayment, cancel, checkout — and that is what
     * lets it see where a payment stopped. `<METHOD>.<step>` with gw-ui's step
     * names, so the two read the same way; `status` is its start / success /
     * failure / info, in `params.status` because a js_event has no status code.
     */
    walletStep(context: {
        paymentMethod: PaymentMethod;
        step: string;
        status: StepStatus;
        /** Into `return_value`; the status itself when there is nothing more. */
        detail?: string;
        /** When the step began; its `start` event has none. */
        startedAt?: number;
        params?: Record<string, ParamValue>;
    }): void;
    /**
     * The answer an availability probe reached — whichever way it went.
     *
     * Reported on success as well as refusal, which is gw-ui's shape
     * (`readyToPay` in useSdkEventLogger, logged with `available` either way)
     * and the reason it can state an availability *rate*. Only ever emitting
     * the negative gives a numerator with no denominator: "Apple Pay
     * unavailable 200 times" reads the same whether that is out of 210 probes
     * or out of 20 000.
     */
    walletAvailability(context: {
        functionName: string;
        paymentMethod: PaymentMethod;
        available: boolean;
        /** Why not, when it is not. */
        reason?: string;
        capabilities?: Record<string, ParamValue>;
        /** When the probe began. */
        startedAt?: number;
    }): void;
    /**
     * A wallet button or the card form torn down by the integrator.
     *
     * A deliberate teardown is not a failure, so it is reported here and the
     * error event for the same unmount is suppressed at the call site: one
     * teardown is one event. It also completes a pair — `ready` says the
     * button or form reached the page and this says it left, timed from that
     * ready. A `ready` with neither a terminal charge nor an unmount after it
     * is the funnel gap worth looking at.
     */
    unmount(context: {
        paymentMethod: PaymentMethod;
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
    /**
     * The form inside the card iframe is built and listening — the iframe's own
     * `GOPAY_CARD_ENCRYPT_READY`, timed from the frame's load.
     *
     * `ready` cannot say this. It fires on the iframe's load event, which also
     * fires for a document that never ran its script, failed it, or never
     * received the init message, so "ready but nothing after" was a form that
     * might or might not have been on the customer's screen. This one comes
     * from the form itself, after it has rendered, and needs nothing new in the
     * postMessage protocol: the message has always been sent.
     */
    cardFormRendered(context: {
        flow: string;
        /** When the frame loaded — the same moment `ready` reports. */
        loadedAt: number | null;
    }): void;
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
    /**
     * The page changed state around the SDK: hidden or shown again, frozen or
     * resumed by the browser, restored from the back/forward cache, or the
     * reload of a tab the browser discarded. `PAGE.<state>`, with how long the
     * page spent in the state it left — on `visible`, how long the shopper was
     * away. Once per document, also how the page was reached
     * ({@link PageArrival}), with how far into the page's life the first SDK
     * was built. Page-level, so registerPageLifecycle reports it through the
     * SDK built last.
     */
    page(context: { state: PageState; durationMs: number | null }): void;
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
    redirect: () => {},
    ready: () => {},
    submit: () => {},
    walletUnavailable: () => {},
    integratorError: () => {},
    unmount: () => {},
    walletAvailability: () => {},
    walletStep: () => {},
    cardFormRendered: () => {},
    cardFormHeight: () => {},
    page: () => {},
};

/**
 * Where a redirect sent the page, as far as it may be recorded: origin and
 * path, scrubbed like a message so a token sitting in the path does not ride
 * along either. Null for something that does not parse — the leave is still
 * worth sending without it.
 */
function safeTarget(url: string): string | null {
    try {
        const parsed = new URL(url);
        return safeErrorMessage(`${parsed.origin}${parsed.pathname}`);
    } catch {
        return null;
    }
}

export function createGwLoggerTelemetry(options: {
    environment: GoPayEnvironment;
    getClientId: () => string | undefined;
    getPaymentId: () => string | undefined;
}): BrowserTelemetry {
    const url = `${LOGGER_URLS[options.environment]}/events`;
    const spent: Record<BudgetKind, number> = {
        api_call: 0,
        lifecycle: 0,
        step: 0,
        error: 0,
        page: 0,
    };
    /**
     * One per SDK instance — what ties an init to the payments made through
     * it. mixit.fr rebuilds the SDK and creates a new payment when its
     * checkout re-renders, so one checkout spreads across several payment
     * session ids; this is what tells one instance's events from the next
     * one's on the same page and in the same transaction.
     */
    const instanceId = newInstanceId();
    /** The SDK's construction, which is what `ready` is timed from. */
    const createdAt = nowMs();
    /** The last `ready` per method, which is what `unmount` is timed from. */
    const readyAt: Partial<Record<PaymentMethod, number>> = {};

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
    /** True when the event was handed to `fetch`; false when it was refused or failed to build. */
    function post(budget: BudgetKind, build: () => GwLoggerEvent): boolean {
        try {
            if (spent[budget] >= EVENT_BUDGET[budget]) {
                return false;
            }
            // Built inside the try, not passed in already built. `base()` reads
            // the page URL and the callers' getters, and an emitter is called
            // from a `finally` on the payment path — a throw while assembling
            // the event would replace the payment error the caller was about
            // to receive with a telemetry error. Logging is never worth that.
            const event = build();
            // The tab's numbering, not this instance's — see lastSequence().
            // Spent only once the request exists, so a refused or unbuildable
            // event leaves no gap.
            const next = lastSequence() + 1;
            const request = new Request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: { ...event, seq: next } }),
                // Survives the 3DS redirect unloading the page — the charge
                // result is precisely the event worth not losing.
                keepalive: true,
                // Guarded: AbortSignal.timeout is newer than some of the
                // browsers this runs in, and a throw here dropped the event.
                signal: timeoutSignal(REQUEST_TIMEOUT_MS).signal,
            });
            recordSequence(next);
            spent[budget] += 1;
            void fetch(request).catch(() => {});
            return true;
        } catch {
            // A field getter throwing, or fetch missing on an older engine.
            // Logging is never worth a thrown error in a payment flow.
            return false;
        }
    }

    function base(): CommonFields {
        return {
            client_id: orUndefined(options.getClientId()),
            // Known only from attachPayment onwards. The encrypt-only flow
            // never has one, which is why gw-logger stopped requiring it.
            payment_session_id: orUndefined(options.getPaymentId()),
            sdk_instance_id: instanceId,
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
                req_body: serializeBody(record.requestBody),
                res_body: serializeBody(record.responseBody),
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

        redirect({ target, flow }): void {
            const sent = post('lifecycle', () => ({
                ...base(),
                event_type: 'navigation',
                navigation_type: 'leave',
                target: safeTarget(target),
                flow,
            }));
            // Only a leave that actually went out stands in for the pagehide
            // one; a refused or unbuildable one must leave it its chance.
            if (sent) {
                markLeft();
            }
        },

        ready({ paymentMethod, flow }): void {
            readyAt[paymentMethod] = nowMs();
            post('lifecycle', () => ({
                ...base(),
                event_type: 'js_event',
                function_name: actionName(paymentMethod, 'ready'),
                duration: msSince(createdAt),
                flow: orUndefined(flow),
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
            startedAt,
        }): void {
            post('error', () => ({
                ...base(),
                event_type: 'js_event',
                function_name: actionName(paymentMethod, 'readyToPay'),
                duration: msSince(startedAt),
                // The reason is the answer to "why was there no button", so it
                // goes where a js_event's message lives rather than into a
                // label nobody reads by default.
                return_value: safeErrorMessage(reason),
                params: describeParams({
                    caller: functionName,
                    available: false,
                    ...capabilities,
                }),
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

        walletStep({
            paymentMethod,
            step,
            status,
            detail,
            startedAt,
            params,
        }): void {
            post('step', () => ({
                ...base(),
                event_type: 'js_event',
                function_name: actionName(paymentMethod, step),
                duration: msSince(startedAt),
                return_value: safeErrorMessage(detail ?? status),
                params: describeParams({ status, ...params }),
            }));
        },

        walletAvailability({
            functionName,
            paymentMethod,
            available,
            reason,
            capabilities,
            startedAt,
        }): void {
            // The step budget: a probe is an ordinary step, and an answer of
            // "no" is the correct outcome on a device that cannot pay — not a
            // failure, and not something to spend the error budget on.
            post('step', () => ({
                ...base(),
                event_type: 'js_event',
                function_name: actionName(paymentMethod, 'readyToPay'),
                duration: msSince(startedAt),
                // `available` on its own would need a second field to say why
                // not; the reason is the more useful of the two and carries
                // the answer with it.
                return_value: available
                    ? 'available'
                    : safeErrorMessage(reason ?? 'unavailable'),
                params: describeParams({
                    caller: functionName,
                    available,
                    ...capabilities,
                }),
            }));
        },

        unmount({ paymentMethod, sheetOpen, chargeInFlight }): void {
            // The lifecycle budget, not the error one: this is a bounded
            // marker — a handful per mount — and it is emitted precisely
            // because a teardown is not a failure.
            post('lifecycle', () => ({
                ...base(),
                event_type: 'js_event',
                // The function the integrator actually called, under the
                // method it was called on.
                function_name: actionName(paymentMethod, 'unmount'),
                duration: msSince(readyAt[paymentMethod]),
                return_value: describeUnmount(sheetOpen, chargeInFlight),
                params: describeParams({
                    sheet_open: sheetOpen,
                    charge_in_flight: chargeInFlight,
                }),
            }));
        },

        cardFormRendered({ flow, loadedAt }): void {
            // The lifecycle budget, beside the `ready` it completes: one per
            // load of the frame.
            post('lifecycle', () => ({
                ...base(),
                event_type: 'js_event',
                function_name: actionName('card', 'rendered'),
                duration: msSince(loadedAt ?? undefined),
                flow: orUndefined(flow),
            }));
        },

        cardFormHeight({ phase, flow, durationMs, measurements }): void {
            // The step budget: at most two of these per mount, and a form
            // remounted in a loop is exactly what must not silence the funnel.
            post('step', () => ({
                ...base(),
                event_type: 'js_event',
                // The protocol message being described. The suffix is the name
                // GPOMA-2679's queries already match on.
                function_name: actionName('card', 'card-form-height'),
                // The schema's duration is an integer.
                duration: durationMs === null ? null : Math.round(durationMs),
                flow: orUndefined(flow),
                return_value: phase,
                params: describeParams(measurements),
            }));
        },

        page({ state, durationMs }): void {
            post('page', () => ({
                ...base(),
                event_type: 'js_event',
                // gw-ui's `<METHOD>.<step>` shape with the page as the subject,
                // so `PAGE.*` reads beside `PAYMENT_CARD.*` on event.action.
                function_name: `PAGE.${state}`,
                duration: durationMs,
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
