/**
 * Two kinds of text leave the page: error messages, and the request and
 * response bodies of the SDK's own API calls.
 *
 * A message is not key-structured, so it cannot be redacted field by field —
 * it is scrubbed and capped ({@link safeErrorMessage}). It is meant to be text
 * the SDK wrote itself, a property the call sites keep true and one that
 * `client.ts` broke for a while by interpolating a foreign error's message;
 * the scrub is the second line, sized for the day the first one slips.
 *
 * A body is redacted by key, the way gw-ui's `sanitizeLogData` does it, so
 * both producers drop the same things and the rows read the same way
 * ({@link serializeBody}). The SDK did not ship bodies at all until GPOMA-2707,
 * for a reason that still holds: a redaction list protects only the fields
 * somebody remembered to list, and the fields here are a card token, a JWE, a
 * payment secret, a wallet's encrypted card data and a 3DS redirect. So the
 * key list is not the only line either. Every string that survives it goes
 * through the message scrub as well — a token under a name nobody predicted
 * still has the shape of a token — and the instrument a charge carries is
 * dropped whole, whatever its fields are called.
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
 * A run long enough to *be* a compact JOSE token. One character class and one
 * quantifier: whether it actually is one is decided in {@link isCompactJose}
 * rather than by the pattern.
 *
 * Splitting it that way is not style. The obvious single regex —
 * `[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,}){2,4}` — backtracks character by
 * character over every long run that turns out to have no dots in it, which
 * is quadratic in the length of the message. The message can carry text from
 * outside this SDK, so that is a denial of service in a payment page, reached
 * by a long enough error string.
 *
 * 26 is the shortest a real one can be: three segments of eight, two dots.
 */
const JOSE_RUN = /[A-Za-z0-9._-]{26,}/gu;

/**
 * Three to five base64url segments, each at least eight characters. Eight is
 * what keeps it off ordinary prose — a version number or a dotted hostname
 * cannot reach it.
 */
function isCompactJose(run: string): boolean {
    const parts = run.split('.');
    return (
        parts.length >= 3 &&
        parts.length <= 5 &&
        parts.every((part) => part.length >= 8)
    );
}

/**
 * Redact a run that turns out to be a token, keeping the punctuation around
 * it.
 *
 * The trimming is the point. `JOSE_RUN` is greedy over dots, so the full stop
 * ending a sentence joins the run, `split` then yields an empty last part and
 * the structural check fails — which quietly stopped redacting any token at
 * the end of a message, the most ordinary shape an error message has. The
 * suite stayed green because its token sat mid-sentence.
 */
function redactJose(run: string): string {
    let start = 0;
    let end = run.length;
    while (start < end && run[start] === '.') {
        start += 1;
    }
    while (end > start && run[end - 1] === '.') {
        end -= 1;
    }
    if (!isCompactJose(run.slice(start, end))) {
        return run;
    }
    return run.slice(0, start) + REDACTED + run.slice(end);
}

/**
 * The domain half of an e-mail address, anchored on the `@`.
 *
 * Anchoring is the whole trick. Any pattern that begins with the local part —
 * `[A-Za-z0-9._%+-]+@` — has to try every position in the message and
 * backtrack the entire run at each one where no `@` follows. Measured on this
 * branch: 1.7 ms for a 2 000-character message, 31 ms for 8 000, which is
 * quadratic and reachable, because a message can carry text from outside this
 * SDK. Starting on the literal `@` lets the engine skip to the next one.
 */
const EMAIL_DOMAIN = /@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gu;

/** What the local part of an address may be built from. */
const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._%+-]/u;

/**
 * An e-mail address is personal data wherever it turns up.
 *
 * The local part is walked backwards from the `@` rather than matched, which
 * keeps the pass linear: the walk stops at the end of the previous match, so
 * every character is visited at most once.
 */
function redactEmails(text: string): string {
    let out = '';
    let last = 0;
    for (const match of text.matchAll(EMAIL_DOMAIN)) {
        const at = match.index;
        let start = at;
        while (start > last && EMAIL_LOCAL_CHAR.test(text[start - 1] ?? '')) {
            start -= 1;
        }
        if (start === at) {
            // An `@` with nothing usable in front of it is not an address.
            continue;
        }
        out += text.slice(last, start) + REDACTED;
        last = at + match[0].length;
    }
    return out + text.slice(last);
}

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
        redactEmails(rawMessage(error))
            .replace(CARD_COMM_URL, `$1${REDACTED}`)
            // Keeps the `?` or `#` so a reader can see what was dropped.
            .replace(QUERY_OR_FRAGMENT, (m) => `${m[0]}${REDACTED}`)
            .replace(SENSITIVE_PAIR, REDACTED)
            .replace(JOSE_RUN, redactJose)
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

/**
 * Keys whose whole value is dropped, matched exactly.
 *
 * gw-ui's list, plus what this SDK's own traffic carries under names that
 * list does not reach: `input` is the instrument of a charge — a card token,
 * or a wallet's encrypted card data under plain names like `data` and
 * `header` — and `customer` is the payer's contact details.
 */
const SENSITIVE_CONTAINER_KEYS = new Set([
    'response',
    'payment',
    'paymentdata',
    'applepaypaymentdata',
    'googlepaymentdata',
    'card',
    'cards',
    'maskedcard',
    'maskedcards',
    'profile',
    'profiles',
    'srcprofile',
    'consumer',
    'consumeridentity',
    'identity',
    'threeds',
    'threedsdata',
    'challenge',
    'acs',
    'acsdata',
    'credential',
    'credentials',
    'checkout',
    'checkoutresponse',
    'checkoutresponsesignature',
    'redirectparams',
    'merchantsession',
    'merchantsessionidentifier',
    'validationdata',
    'encryptedcard',
    'recognitiontoken',
    'idtoken',
    'idtokens',
    'digitalcardid',
    'recipientaddress',
    'accountname',
    'bic',
    // This SDK's own.
    'input',
    'customer',
    'contact',
    'payer',
    'ip',
    'ipaddress',
    'useragent',
]);

/**
 * Fragments that drop any key containing them. gw-ui's list, plus the ones
 * this SDK's traffic needs: `encrypted` for the card form's payload, the
 * signing material of a Google Pay token, and the hosted-gateway URL, which
 * is a link to someone's payment.
 */
const SENSITIVE_KEY_SUBSTRINGS = [
    'pan',
    'token',
    'jwe',
    'cvv',
    'cvc',
    'cryptogram',
    'cavv',
    'secret',
    'signature',
    'password',
    'identityvalue',
    'cardnumber',
    'digitalcardid',
    'authentication',
    'otp',
    'email',
    'phone',
    'mobile',
    'firstname',
    'lastname',
    'accountnumber',
    'iban',
    'redirecturl',
    'maskedvalidationchannel',
    // This SDK's own.
    'encrypted',
    'signedmessage',
    'signedkey',
    'publickey',
    'nonce',
    'gwurl',
    'address',
    'holder',
];

/**
 * Nested deeper than this is dropped whole. gw-ui's bound: nothing worth
 * reading in these payloads sits further down, and a bound is what keeps a
 * hostile structure from costing anything.
 */
const MAX_DEPTH = 4;

/** gw-ui's cap per body. */
const MAX_BODY_LENGTH = 2000;

/**
 * The API is snake_case and gw-ui's lists are camelCase, so a key is
 * compared with its separators removed: `redirect_url` has to hit
 * `redirecturl`, or the 3DS redirect of every charge goes out as it is.
 */
function isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
    return (
        SENSITIVE_CONTAINER_KEYS.has(normalized) ||
        SENSITIVE_KEY_SUBSTRINGS.some((fragment) =>
            normalized.includes(fragment),
        )
    );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    // Only a plain object is safe to walk; a class instance or a DOM node is
    // never serialized.
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * The body with every sensitive key replaced by `[redacted]`, every string
 * left in it scrubbed, and anything nested past {@link MAX_DEPTH} dropped.
 * Structure is otherwise kept, so a reader still sees what was there.
 */
function sanitizeLogData(value: unknown, depth = 0): unknown {
    if (depth >= MAX_DEPTH) {
        return REDACTED;
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeLogData(item, depth + 1));
    }
    if (isPlainObject(value)) {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = isSensitiveKey(key)
                ? REDACTED
                : sanitizeLogData(item, depth + 1);
        }
        return result;
    }
    if (typeof value === 'string') {
        return safeErrorMessage(value);
    }
    if (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function')
    ) {
        return REDACTED;
    }
    return value;
}

/**
 * A request or response body as `req_body` / `res_body` carry it: redacted,
 * then JSON, then cut at {@link MAX_BODY_LENGTH} — gw-ui's `serializeBody`,
 * so a long body reads as the start of itself rather than as nothing.
 *
 * Never throws. A body is only a diagnostic, and the event it rides on is
 * worth more than it is.
 */
export function serializeBody(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    try {
        return JSON.stringify(sanitizeLogData(value)).slice(0, MAX_BODY_LENGTH);
    } catch {
        return undefined;
    }
}
