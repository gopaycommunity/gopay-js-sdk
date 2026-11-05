import { type HttpClient, requirePathSegment } from '@gopay-internal/core';
import type { components } from '../../types/generated.js';
import { SDK_VERSION } from '../../version.js';

type InitSessionRequest = components['schemas']['Init-Session-Request'];

/**
 * POST /payments/{payment_id}/init-session
 *
 * Tells GoPay which client SDK, in which version, works with the payment. The
 * payment's language follows the `Accept-Language` header, which the browser
 * adds on its own — the SDK sets nothing for it.
 *
 * Best effort, and never throws. Nothing in the SDK depends on it, so a failure
 * must not cost the customer the payment: `attachPayment()` does not wait for
 * it, and its failure does not reach `onError` (`quiet`). The common one is not
 * even a fault — the endpoint answers 409 for any payment past `CREATED`, which
 * is every payment a return page attaches to read its status. The call is
 * still recorded in telemetry with its real status.
 */
export async function initSession(
    client: HttpClient,
    paymentId: string,
): Promise<void> {
    const body: InitSessionRequest = {
        client_type: 'SDK_BROWSER',
        client_version: SDK_VERSION,
    };
    try {
        const pid = requirePathSegment(paymentId, 'paymentId');
        await client.post<void>(`/payments/${pid}/init-session`, body, {
            quiet: true,
        });
    } catch {
        // Nothing waits on it. A failed request is in telemetry already; an id
        // requirePathSegment rejects cannot get here — createPaymentsApi has
        // already accepted it in attachPayment().
    }
}
