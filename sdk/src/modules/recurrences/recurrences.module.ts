import {
    awaitPaymentStatus,
    type AwaitPaymentStatusOptions as CoreAwaitPaymentStatusOptions,
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
    requirePathSegment,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

/**
 * Body for {@link createRecurrence} — a discriminated union on `type`.
 *
 * Exported because TypeScript only excess-property-checks fresh object
 * literals: a request built in a variable first loses the `schedule`
 * enforcement unless the variable is annotated with this type.
 */
export type RecurrenceCreateRequest =
    components['schemas']['Recurrence-Create-Request'];
/** The `AUTO` variant of {@link RecurrenceCreateRequest} — carries a `schedule`. */
export type RecurrenceCreateAuto =
    components['schemas']['Recurrence-Create-Auto'];
/** The `ON_DEMAND` variant of {@link RecurrenceCreateRequest} — must not carry a `schedule`. */
export type RecurrenceCreateOnDemand =
    components['schemas']['Recurrence-Create-On-Demand'];
/** State of a recurrence and the payment it carries. */
export type RecurrenceDetails = components['schemas']['Recurrence-Details'];
/** Per-payment overrides accepted by {@link startRecurrence} and {@link createNextPayment}. */
export type PaymentInstanceOverride =
    components['schemas']['Payment-Instance-Override'];

type PaymentDetails = components['schemas']['Payment-Details'];

/** Options for {@link awaitRecurrenceState}. */
export type AwaitRecurrenceStateOptions =
    CoreAwaitPaymentStatusOptions<RecurrenceDetails>;

/**
 * A recurrence has settled once it reaches one of these. `REQUESTED` is
 * transient — it is waiting for the customer to pay the first payment.
 */
const RECURRENCE_TERMINAL_STATES = ['STARTED', 'STOPPED'];

/**
 * States of the carried payment from which the recurrence can never reach
 * `STARTED`, because the payment that would have started it is finished and
 * unpaid.
 *
 * Without this the wait outlives the thing it is waiting for: an abandoned
 * first payment leaves the recurrence in `REQUESTED` until `recurrence_date_to`
 * — typically a year or more out — so a poll every few seconds would run for
 * months against an outcome that can no longer happen.
 */
const UNPAYABLE_PAYMENT_STATES = new Set(['CANCELED', 'TIMEOUTED']);

export function createRecurrencesApi(client: HttpClient) {
    return {
        /**
         * Create a recurrence.
         * Requires the `payment:write` OAuth2 scope.
         *
         * POST /eshops/{goid}/recurrences
         *
         * Creating a recurrence charges nothing and creates no payment — it
         * stores a payment template and a schedule. Call
         * {@link startRecurrence} to create the first payment.
         *
         * `params` is a discriminated union on `type`, so the compiler enforces
         * what the API enforces at runtime: an `AUTO` recurrence must carry a
         * `schedule`, and an `ON_DEMAND` one must not. Note that TypeScript
         * only excess-property-checks fresh object literals — build the request
         * in a variable and you lose that check unless the variable is
         * annotated `RecurrenceCreateRequest`, which is exported for this.
         *
         * @param goid   - Merchant's GoPay ID (eshop identifier)
         * @param params - Recurrence parameters. `recurrence_date_to` is
         *                 mandatory and must be a plain `yyyy-MM-dd` date — a
         *                 value carrying a time component is rejected with `400`
         */
        async createRecurrence(
            goid: string,
            params: RecurrenceCreateRequest,
            options?: { signal?: AbortSignal },
        ): Promise<RecurrenceDetails> {
            const id = requirePathSegment(goid, 'goid');
            return client.post<RecurrenceDetails>(
                `/eshops/${id}/recurrences`,
                params,
                options,
            );
        },

        /**
         * Retrieve the current state of a recurrence and the payment it carries.
         * Requires the `payment:read` OAuth2 scope.
         *
         * GET /recurrences/{rec_id}
         *
         * @param recId - Recurrence ID returned by {@link createRecurrence}
         */
        async getRecurrence(
            recId: string,
            options?: { signal?: AbortSignal },
        ): Promise<RecurrenceDetails> {
            const rid = requirePathSegment(recId, 'recId');
            return client.get<RecurrenceDetails>(
                `/recurrences/${rid}`,
                options,
            );
        },

        /**
         * Create the first payment of a recurrence.
         * Requires the `payment:write` OAuth2 scope.
         *
         * POST /recurrences/{rec_id}/start
         *
         * Moves the recurrence to `REQUESTED` and returns the created payment.
         * The customer pays it at the returned `gw_url`; only once they have
         * does the recurrence become `STARTED` and accept
         * {@link createNextPayment}. Starting an already-started recurrence is
         * rejected with `409`.
         *
         * @param recId    - Recurrence ID returned by {@link createRecurrence}
         * @param override - Optional per-payment overrides of the stored
         *                   template. `customer` is merged field by field, not
         *                   replaced; an unknown field is rejected with `400`
         */
        async startRecurrence(
            recId: string,
            override?: PaymentInstanceOverride,
            options?: { signal?: AbortSignal },
        ): Promise<PaymentDetails> {
            const rid = requirePathSegment(recId, 'recId');
            return client.post<PaymentDetails>(
                `/recurrences/${rid}/start`,
                override,
                options,
            );
        },

        /**
         * Create the next payment of a recurrence.
         * Requires the `payment:write` OAuth2 scope.
         *
         * POST /recurrences/{rec_id}/next
         *
         * Only valid once the recurrence is `STARTED` — that is, once the
         * customer has paid the payment created by {@link startRecurrence}.
         * Called any earlier it is rejected with `409`; {@link awaitRecurrenceState}
         * is the supported way to wait for that moment.
         *
         * @param recId    - Recurrence ID returned by {@link createRecurrence}
         * @param override - Optional per-payment overrides of the stored
         *                   template, as for {@link startRecurrence}
         */
        async createNextPayment(
            recId: string,
            override?: PaymentInstanceOverride,
            options?: { signal?: AbortSignal },
        ): Promise<PaymentDetails> {
            const rid = requirePathSegment(recId, 'recId');
            return client.post<PaymentDetails>(
                `/recurrences/${rid}/next`,
                override,
                options,
            );
        },

        /**
         * Stop a recurrence so it creates no further payments.
         * Requires the `payment:write` OAuth2 scope.
         *
         * DELETE /recurrences/{rec_id}
         *
         * The recurrence stays readable through {@link getRecurrence}, in state
         * `STOPPED` with `stop_reason: 'CANCELLED_VIA_API'`. Stopping an
         * already-stopped recurrence is rejected with `409`.
         *
         * @param recId - Recurrence ID returned by {@link createRecurrence}
         */
        async stopRecurrence(
            recId: string,
            options?: { signal?: AbortSignal },
        ): Promise<void> {
            const rid = requirePathSegment(recId, 'recId');
            return client.delete(`/recurrences/${rid}`, options);
        },

        /**
         * Poll a recurrence until it settles.
         *
         * {@link startRecurrence} leaves the recurrence in `REQUESTED` — the
         * first payment exists but nobody has paid it yet — and
         * {@link createNextPayment} keeps returning `409` until they do, so
         * callers otherwise have to write this loop themselves.
         *
         * Resolves once the recurrence reaches `STARTED` or `STOPPED`. Note that
         * `STOPPED` resolves rather than rejects: it is a legitimate outcome the
         * caller has to inspect, via `stop_reason`.
         *
         * No client-side timeout by default — the customer may take as long as
         * they like to pay. Pass `options.timeoutMs` for a ceiling, or
         * `options.signal` to abort.
         *
         * @param recId   - Recurrence ID returned by {@link createRecurrence}
         * @param options - Polling configuration and callbacks
         */
        awaitRecurrenceState(
            recId: string,
            options?: AwaitRecurrenceStateOptions,
        ): Promise<RecurrenceDetails> {
            const rid = requirePathSegment(recId, 'recId');
            const usingDefaultTerminals = options?.terminalStates === undefined;
            return awaitPaymentStatus(
                async () => {
                    const rec = await client.get<RecurrenceDetails>(
                        `/recurrences/${rid}`,
                        { signal: options?.signal },
                    );
                    if (usingDefaultTerminals) {
                        assertStateStillReachable(rec);
                    }
                    return rec;
                },
                {
                    ...options,
                    terminalStates:
                        options?.terminalStates ?? RECURRENCE_TERMINAL_STATES,
                },
            );
        },
    };
}

/**
 * Reject a wait that can no longer end.
 *
 * Two states are dead ends rather than stages, and polling through either of
 * them never terminates:
 *
 * - `NEW` — only {@link createRecurrencesApi}'s own `startRecurrence` moves a
 *   recurrence out of `NEW`. No customer, scheduler or back office will do it,
 *   so waiting for it to happen on its own waits forever.
 * - `REQUESTED` with a finished, unpaid payment — the payment that would have
 *   moved the recurrence to `STARTED` is gone; see
 *   {@link UNPAYABLE_PAYMENT_STATES}.
 *
 * Throwing from inside the poll surfaces the reason and stops the loop, rather
 * than leaving the caller with a promise that cannot settle.
 */
function assertStateStillReachable(rec: RecurrenceDetails): void {
    if (rec.state === 'NEW') {
        throw new GoPaySDKError(
            '[GoPaySDK] Recurrence is still NEW — call startRecurrence() first, ' +
                'nothing else moves it out of this state.',
            { errorCode: GoPayErrorCodes.INVALID_ARGUMENT },
        );
    }
    const paymentState = rec.payment?.state;
    if (
        rec.state === 'REQUESTED' &&
        paymentState !== undefined &&
        UNPAYABLE_PAYMENT_STATES.has(paymentState)
    ) {
        throw new GoPaySDKError(
            `[GoPaySDK] The recurrence's first payment is ${paymentState}, so the ` +
                'recurrence can no longer reach STARTED.',
            { errorCode: GoPayErrorCodes.CHARGE_FAILED },
        );
    }
}
