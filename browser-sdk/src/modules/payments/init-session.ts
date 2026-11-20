import { type HttpClient, requirePathSegment } from '@gopay-internal/core';
import type { components } from '../../types/generated.js';
import { SDK_VERSION } from '../../version.js';

type InitSessionRequest = components['schemas']['Init-Session-Request'];

/**
 * How long `attachPayment()` waits for init-session. Past this the attach
 * resolves without it: a request that hangs must not take the checkout down
 * with it.
 */
const INIT_SESSION_WAIT_MS = 2_000;

/**
 * POST /payments/{payment_id}/init-session
 *
 * Tells GoPay which client SDK, in which version, works with the payment. The
 * payment's language follows the `Accept-Language` header, which the browser
 * adds on its own — the SDK sets nothing for it.
 *
 * `attachPayment()` waits for it, so that it is the first request to reach the
 * payment and has been answered before the next one: GoPay does not cope with
 * init-session overlapping another call on a payment nothing has touched yet,
 * and such a payment could go on to fail every later charge.
 *
 * Best effort all the same, and never throws. Nothing in the SDK depends on its
 * answer, so a failure must not cost the customer the payment: it does not
 * reach `onError` (`quiet`), and the returned promise resolves whatever
 * happens, after `maxWaitMs` at the latest — the request is left to finish on
 * its own then. The common failure is not even a fault — the endpoint answers
 * 409 for any payment past `CREATED`, which is every payment a return page
 * attaches to read its status. The call is still recorded in telemetry with
 * its real status.
 */
export function initSession(
    client: HttpClient,
    paymentId: string,
    maxWaitMs: number = INIT_SESSION_WAIT_MS,
): Promise<void> {
    const body: InitSessionRequest = {
        client_type: 'SDK_BROWSER',
        client_version: SDK_VERSION,
    };
    const answered = (async () => {
        try {
            const pid = requirePathSegment(paymentId, 'paymentId');
            await client.post<void>(`/payments/${pid}/init-session`, body, {
                quiet: true,
            });
        } catch {
            // A failed request is in telemetry already. An id
            // requirePathSegment rejects (`.`, `..`) sends nothing; the
            // attach then fails on it in createPaymentsApi, loudly.
        }
    })();
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const waitedEnough = new Promise<void>((resolve) => {
        giveUp = setTimeout(resolve, maxWaitMs);
    });
    return Promise.race([answered, waitedEnough]).finally(() =>
        clearTimeout(giveUp),
    );
}
