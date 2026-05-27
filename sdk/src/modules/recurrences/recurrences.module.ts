import { type HttpClient, requireNonEmptyString } from '@gopay-internal/core';

import type { components } from '../../types/generated.js';

type RecurrenceCreateRequest =
    components['schemas']['Recurrence-Create-Request'];
type RecurrenceDetails = components['schemas']['Recurrence-Details'];
type RecurrenceNextBody = components['schemas']['Payment-Instance-Override'];
type PaymentDetails = components['schemas']['Payment-Details'];

export function createRecurrencesApi(client: HttpClient) {
    return {
        /**
         * Create a recurrence.
         * Requires the `payment:write` OAuth2 scope.
         *
         * POST /eshops/{goid}/recurrences
         *
         * @param goid   - Merchant's GoPay ID (eshop identifier)
         * @param params - Recurrence creation parameters including type, schedule, and payment data
         */
        async createRecurrence(
            goid: string,
            params: RecurrenceCreateRequest,
        ): Promise<RecurrenceDetails> {
            return client.post<RecurrenceDetails>(
                `/eshops/${goid}/recurrences`,
                params,
            );
        },

        /**
         * Recurrence status.
         * Requires the `payment:read` OAuth2 scope.
         *
         * GET /recurrences/{rec_id}
         *
         * @param recId - Recurrence ID returned by {@link createRecurrence}
         */
        async recurrenceStatus(recId: string): Promise<RecurrenceDetails> {
            const rid = requireNonEmptyString(recId, 'recId');
            return client.get<RecurrenceDetails>(`/recurrences/${rid}`);
        },

        /**
         * Stop a recurrence.
         * Requires the `payment:write` OAuth2 scope.
         *
         * DELETE /recurrences/{rec_id}
         *
         * @param recId - Recurrence ID returned by {@link createRecurrence}
         */
        async stopRecurrence(recId: string): Promise<void> {
            const rid = requireNonEmptyString(recId, 'recId');
            return client.delete(`/recurrences/${rid}`);
        },

        /**
         * Start a recurrence.
         * Triggers the first charge of a recurrence that is in the `NEW` state.
         * Requires the `payment:write` OAuth2 scope.
         *
         * POST /recurrences/{rec_id}/start
         *
         * @param recId  - Recurrence ID returned by {@link createRecurrence}
         * @param params - Optional payment overrides (amount, order_number, callback, etc.)
         */
        async startRecurrence(
            recId: string,
            params?: RecurrenceNextBody,
        ): Promise<PaymentDetails> {
            const rid = requireNonEmptyString(recId, 'recId');
            return client.post<PaymentDetails>(
                `/recurrences/${rid}/start`,
                params,
            );
        },

        /**
         * Create a next payment for a recurrence.
         * Charges the next instalment for a recurrence that is already `STARTED`.
         * Requires the `payment:write` OAuth2 scope.
         *
         * POST /recurrences/{rec_id}/next
         *
         * @param recId  - Recurrence ID returned by {@link createRecurrence}
         * @param params - Optional payment overrides (amount, order_number, callback, etc.)
         */
        async recurrenceNext(
            recId: string,
            params?: RecurrenceNextBody,
        ): Promise<PaymentDetails> {
            const rid = requireNonEmptyString(recId, 'recId');
            return client.post<PaymentDetails>(
                `/recurrences/${rid}/next`,
                params,
            );
        },
    };
}
