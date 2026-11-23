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
 * Best effort, and never throws. Nothing in the SDK depends on its answer, so
 * a failure must not cost the customer the payment, and it does not reach
 * `onError` (`quiet`). The common failure is not even a fault — the endpoint
 * answers 409 for any payment past `CREATED`, which is every payment a return
 * page attaches to read its status. The call is still recorded in telemetry
 * with its real status.
 */
async function initSession(
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
        // A failed request is in telemetry already.
        //
        // TODO(GPOMA-2842, GPMAIN-9813): GoPay is to answer a request that
        // overlapped another on the same payment with an error of its own.
        // Once that error has a code, retry the refused call once — here and
        // for the page's own calls on the payment.
    }
}

/**
 * Opens a payment's session for `attachPayment()`, which waits for it.
 *
 * GoPay does not cope with init-session overlapping another request on a
 * payment nothing has touched yet: such a payment could go on to fail every
 * later charge. So init-session has to be the first request the payment sees
 * and to be answered before the next one — and that includes another
 * init-session. A page that attaches the same payment twice in a row (a double
 * click, an effect React runs twice) gets one request: while it is under way,
 * every attach of that payment waits for the same one.
 *
 * The returned promise never rejects, and resolves after `maxWaitMs` at the
 * latest; the request is then left to finish on its own, still the only one
 * for its payment until it does.
 */
export function createSessionOpener(
    client: HttpClient,
    maxWaitMs: number = INIT_SESSION_WAIT_MS,
) {
    const underWay = new Map<string, Promise<void>>();

    return function openSession(paymentId: string): Promise<void> {
        let answered = underWay.get(paymentId);
        if (!answered) {
            answered = initSession(client, paymentId).finally(() => {
                underWay.delete(paymentId);
            });
            underWay.set(paymentId, answered);
        }
        let giveUp: ReturnType<typeof setTimeout> | undefined;
        const waitedEnough = new Promise<void>((resolve) => {
            giveUp = setTimeout(resolve, maxWaitMs);
        });
        return Promise.race([answered, waitedEnough]).finally(() =>
            clearTimeout(giveUp),
        );
    };
}
