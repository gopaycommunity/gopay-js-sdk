import {
    type ApiCallRecord,
    type GoPayEnvironment,
    type GoPayHTTPError,
    type GoPaySDKError,
    LOGGER_URLS,
    type Telemetry,
} from '@gopay-internal/core';
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

interface ApiCallEvent {
    event_type: 'api_call';
    shareable_key?: string;
    trace_id: string;
    transaction_id: string;
    origin: string;
    duration: number | null;
    action: string;
    target: string;
    status_code: number | null;
    res_body?: string;
}

/** `/payments/{id}/charge` → `charge`; gw-ui's action convention. */
function lastSegment(endpoint: string): string {
    const parts = endpoint.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
}

export function createGwLoggerTelemetry(options: {
    environment: GoPayEnvironment;
    getShareableKey: () => string | undefined;
}): Telemetry {
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
    function post(event: ApiCallEvent): void {
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

    function base(): Omit<
        ApiCallEvent,
        'action' | 'target' | 'status_code' | 'duration'
    > {
        return {
            event_type: 'api_call',
            shareable_key: options.getShareableKey(),
            trace_id: newTraceId(),
            transaction_id: getTransactionId(),
            origin: safePageUrl(),
        };
    }

    return {
        apiCall(record: ApiCallRecord): void {
            post({
                ...base(),
                action: lastSegment(record.endpoint),
                target: record.endpoint,
                status_code: record.statusCode,
                duration: record.durationMs,
            });
        },

        error(error: GoPaySDKError | GoPayHTTPError): void {
            const code =
                'errorCode' in error && typeof error.errorCode === 'string'
                    ? error.errorCode
                    : 'UNKNOWN';
            post({
                ...base(),
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
