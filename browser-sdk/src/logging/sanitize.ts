/**
 * The SDK never ships request or response bodies to the logger, so the only
 * free-form text that leaves the page is an error message the SDK wrote itself.
 * A message is not key-structured, so it cannot be redacted field by field the
 * way gw-ui's `sanitizeLogData` redacts a payload — it gets scrubbed and capped
 * instead.
 *
 * Not shipping bodies at all is the deliberate part. A redaction list only
 * protects the fields somebody remembered to list, and the fields here would be
 * a card token, a JWE, a payment secret and a 3DS challenge blob. Leaving them
 * on the page is the one approach that cannot be defeated by a field added
 * later under a name nobody predicted.
 */

const REDACTED = '[redacted]';

/** Longest message kept; anything past this is cut. */
const MAX_MESSAGE_LENGTH = 500;

/** A run of 12–19 digits is a PAN in every scheme we accept. */
const PAN_LIKE = /\d{12,19}/gu;

/**
 * Card-comm form URLs carry a signed session token after the form-type letter
 * (`/g/`, `/h/`). Keep the letter, drop the token.
 */
const CARD_COMM_URL = /(\/gp-card-comm\/[a-z0-9]+\/)\S+/giu;

/** Anything that looks like a query string can carry a token or an e-mail. */
const QUERY_STRING = /\?\S*/gu;

/**
 * A message safe to put in a log line: no PAN-shaped digits, no signed form
 * URL, no query string, bounded length.
 */
export function safeErrorMessage(error: unknown): string {
    const raw =
        error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Unknown error';

    return raw
        .replace(CARD_COMM_URL, `$1${REDACTED}`)
        .replace(QUERY_STRING, `?${REDACTED}`)
        .replace(PAN_LIKE, REDACTED)
        .slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * The page the SDK is running on, without the query string or fragment: a
 * merchant checkout routinely carries an order id, an e-mail or a return token
 * there, and none of that belongs in operational data.
 */
export function safePageUrl(): string {
    const loc = globalThis.location;
    if (!loc) {
        return '';
    }
    return `${loc.origin}${loc.pathname}`.slice(0, 2048);
}
