import {
    awaitPaymentStatus,
    type AwaitPaymentStatusOptions as CoreAwaitPaymentStatusOptions,
    type HttpClient,
    requireNonEmptyString,
} from '@gopay-internal/core';
import type { components } from '../../types/generated.js';

type RecurrenceCreateRequest =
    components['schemas']['Recurrence-Create-Request'];
type RecurrenceDetails = components['schemas']['Recurrence-Details'];
type PaymentInstanceOverride =
    components['schemas']['Payment-Instance-Override'];
type PaymentDetails = components['schemas']['Payment-Details'];

/** Options for {@link awaitRecurrenceState}. */
export type AwaitRecurrenceStateOptions =
    CoreAwaitPaymentStatusOptions<RecurrenceDetails>;

/**
 * A recurrence has settled once it reaches one of these. `NEW` and `REQUESTED`
 * are both transient: `NEW` is waiting for {@link startRecurrence}, `REQUESTED`
 * is waiting for the customer to pay the first payment.
 */
const RECURRENCE_TERMINAL_STATES = ['STARTED', 'STOPPED'];

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
         * `schedule`, and an `ON_DEMAND` one must not.
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
            const id = requireNonEmptyString(goid, 'goid');
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
            const rid = requireNonEmptyString(recId, 'recId');
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
            const rid = requireNonEmptyString(recId, 'recId');
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
            const rid = requireNonEmptyString(recId, 'recId');
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
            const rid = requireNonEmptyString(recId, 'recId');
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
            const rid = requireNonEmptyString(recId, 'recId');
            return awaitPaymentStatus(
                () =>
                    client.get<RecurrenceDetails>(`/recurrences/${rid}`, {
                        signal: options?.signal,
                    }),
                {
                    ...options,
                    terminalStates:
                        options?.terminalStates ?? RECURRENCE_TERMINAL_STATES,
                },
            );
        },
    };
}
