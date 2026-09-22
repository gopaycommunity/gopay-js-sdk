/**
 * The SDK never ships request or response bodies to the logger, so the only
 * free-form text that leaves the page is an error message the SDK wrote
 * itself — a property the call sites have to keep true, and one that
 * `client.ts` broke for a while by interpolating a foreign error's message.
 * The scrub below is the second line, sized for the day the first one slips.
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

/**
 * A query string or a fragment can carry a token or an e-mail. The fragment
 * is not the lesser half: an OAuth implicit response puts the access token
 * there precisely because a fragment is not sent to the server, so it is the
 * one place a token is most likely to be sitting.
 */
const QUERY_OR_FRAGMENT = /[?#]\S*/gu;

/**
 * A compact JWS/JWE: three to five base64url segments joined by dots. The
 * card payload is one of these, and so is an access token.
 *
 * Eight characters minimum per segment is what keeps it off ordinary prose —
 * a version number or a dotted hostname cannot reach it.
 */
const COMPACT_JOSE = /[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,}){2,4}/gu;

/** An e-mail address is personal data wherever it turns up. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;

/**
 * `name=value` for the names worth never printing, with no `?` in front of
 * them. 3DS posts `MD` and `PaRes` as form fields, so they reach a message as
 * a bare pair — which is how they slipped past a query-string-only rule.
 */
const SENSITIVE_PAIR =
    /\b(?:MD|PaRes|CRes|creq|paymentSecret|payment_secret|client_secret|access_token|id_token|refresh_token|authorization|password|token)\s*=\s*\S+/giu;

/**
 * A message safe to put in a log line: no PAN-shaped digits, no signed form
 * URL, no query string or fragment, no compact JOSE token, no e-mail, no
 * `name=value` pair for a name worth never printing, bounded length.
 *
 * Defence in depth, not the only defence. What the SDK sends is meant to be
 * text the SDK wrote itself — the call sites enforce that, and the one place
 * that quietly stopped doing so is what made this list necessary rather than
 * merely prudent.
 */
function rawMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : 'Unknown error';
}

export function safeErrorMessage(error: unknown): string {
    return (
        rawMessage(error)
            .replace(CARD_COMM_URL, `$1${REDACTED}`)
            // Keeps the `?` or `#` so a reader can see what was dropped.
            .replace(QUERY_OR_FRAGMENT, (m) => `${m[0]}${REDACTED}`)
            .replace(SENSITIVE_PAIR, REDACTED)
            .replace(COMPACT_JOSE, REDACTED)
            .replace(EMAIL, REDACTED)
            // Last: the rules above leave `[redacted]` behind, and a PAN can
            // still be sitting in whatever text they did not match.
            .replace(PAN_LIKE, REDACTED)
            .slice(0, MAX_MESSAGE_LENGTH)
    );
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
