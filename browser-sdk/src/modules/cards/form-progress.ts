import type { ParamValue } from '../../logging/gw-logger.js';
import type {
    CardFormErrorCode,
    CardFormErrorTrigger,
    CardFormField,
    CardFormFieldError,
    CardFormFieldState,
} from './iframe-protocol.js';

/**
 * The protocol values the iframe's messages may carry. Declared as records
 * keyed by the union so that adding a field, a code, a state or a trigger to
 * the synced `iframe-protocol.ts` fails the build here instead of silently
 * dropping those messages on the floor — the iframe deploys ahead of the SDK.
 * Lookup goes through sets built from their keys: `in` would also match
 * prototype keys (`{ field: 'toString' }`), and `Object.hasOwn` needs ES2022.
 */
export function enumGuard<T extends string>(
    record: Record<T, true>,
): (value: unknown) => value is T {
    const members = new Set<string>(Object.keys(record));
    return (value): value is T =>
        typeof value === 'string' && members.has(value);
}

const CARD_FORM_FIELDS: Record<CardFormField, true> = {
    pan: true,
    expiry: true,
    cvv: true,
};
const isCardFormField = enumGuard(CARD_FORM_FIELDS);
const isCardFormErrorCode = enumGuard<CardFormErrorCode>({
    required: true,
    pattern: true,
});
const isCardFormFieldState = enumGuard<CardFormFieldState>({
    empty: true,
    partial: true,
    complete: true,
});
const isCardFormErrorTrigger = enumGuard<CardFormErrorTrigger>({
    submit: true,
    input: true,
    blur: true,
});
const FIELDS = Object.keys(CARD_FORM_FIELDS).filter(isCardFormField);

export function isCardFormFieldError(
    entry: unknown,
): entry is CardFormFieldError {
    if (typeof entry !== 'object' || entry === null) {
        return false;
    }
    return (
        isCardFormField(Reflect.get(entry, 'field')) &&
        isCardFormErrorCode(Reflect.get(entry, 'code'))
    );
}

type CardFormProgress = Record<CardFormField, CardFormFieldState>;

/**
 * `GOPAY_CARD_FORM_PROGRESS` as far as the protocol allows it: all three
 * fields, each in one of the three states, or nothing. Projected rather than
 * forwarded, like the field errors — the "states, never values" guarantee is
 * the iframe's, and it is enforced on this side of the boundary too. Built
 * field by field, so a field added to the protocol stops compiling here.
 */
export function projectProgress(fields: unknown): CardFormProgress | null {
    if (typeof fields !== 'object' || fields === null) {
        return null;
    }
    const pan = Reflect.get(fields, 'pan');
    const expiry = Reflect.get(fields, 'expiry');
    const cvv = Reflect.get(fields, 'cvv');
    if (
        !isCardFormFieldState(pan) ||
        !isCardFormFieldState(expiry) ||
        !isCardFormFieldState(cvv)
    ) {
        return null;
    }
    return { pan, expiry, cvv };
}

/**
 * What raised a `GOPAY_CARD_FORM_ERRORS`. Absent from iframes released before
 * it existed, and from anything outside the protocol.
 */
export function projectTrigger(
    trigger: unknown,
): CardFormErrorTrigger | undefined {
    return isCardFormErrorTrigger(trigger) ? trigger : undefined;
}

/** `pan:required,cvv:pattern` — one string, since a param is a primitive. */
function describeErrors(errors: readonly CardFormFieldError[]): string {
    return errors.map(({ field, code }) => `${field}:${code}`).join(',');
}

/** `pan:complete,expiry:partial,cvv:empty`, in the form's own order. */
function describeProgress(progress: CardFormProgress): string {
    return FIELDS.map((field) => `${field}:${progress[field]}`).join(',');
}

/**
 * What one step sends: the params for queries, and an overview for people —
 * gw-logger stores it as `message`, the column read first. The detail stays
 * in the params; the overview only says what kind of moment this was.
 */
interface CardFormStepReport {
    params: Record<string, ParamValue>;
    message: string;
}

/** The form before anyone touches it. */
const UNTOUCHED: CardFormProgress = {
    pan: 'empty',
    expiry: 'empty',
    cvv: 'empty',
};

const roundMs = (ms: number | null): number | null =>
    ms === null ? null : Math.round(ms);

/**
 * What the customer did with one mounted card form, kept for telemetry only.
 *
 * The iframe reports every change — each field moving between states, the
 * errors on show growing and shrinking as the customer types, validity
 * flipping — and almost none of it is news. What is: that they started, that
 * a problem appeared, that they tried to pay, that the card became complete.
 * Those are the steps this reports; everything else only feeds the summary,
 * which answers the same questions in one event for when the steps did not
 * all arrive.
 *
 * Each report carries its params and a short overview of the moment. Every
 * input is a state, a code or a count. Nothing here sees a keystroke.
 */
export function createFormProgress() {
    let progress: CardFormProgress | null = null;
    let started = false;
    let startedMs: number | null = null;
    let filledAtOnce = false;
    let valid = false;
    let becameValid = false;
    let firstValidMs: number | null = null;
    let validityFlips = 0;
    let submitRequests = 0;
    let invalidSubmitRequests = 0;
    let invalidSubmits = 0;
    let errorsRaised = 0;
    /** `field:code` of the errors on show; the form starts with none. */
    let shown = new Set<string>();
    const codesSeen = new Set<string>();

    return {
        /**
         * `started`: the first report of a field that is no longer empty,
         * once per mount, with the states it found. Null for every other
         * change — those are typing, and only the state at the end is kept.
         */
        progress(
            next: CardFormProgress,
            sinceReady: number | null,
        ): CardFormStepReport | null {
            // Straight from empty to complete is a value that arrived whole:
            // an autofill or a paste, never digits typed one by one.
            const previous = progress ?? UNTOUCHED;
            const jumped = FIELDS.some(
                (field) =>
                    previous[field] === 'empty' && next[field] === 'complete',
            );
            filledAtOnce ||= jumped;
            progress = next;
            if (started || FIELDS.every((field) => next[field] === 'empty')) {
                return null;
            }
            started = true;
            startedMs = roundMs(sinceReady);
            return {
                params: { ...next, filled_at_once: jumped },
                message: jumped
                    ? 'started with autofill or paste'
                    : 'started typing',
            };
        },

        /**
         * `completed`: the first time the whole card is valid, once per
         * mount. A form edited back to invalid and completed again is
         * counted, not reported.
         */
        validity(
            nextValid: boolean,
            sinceReady: number | null,
        ): CardFormStepReport | null {
            if (valid && !nextValid) {
                validityFlips += 1;
            }
            valid = nextValid;
            if (!nextValid || becameValid) {
                return null;
            }
            becameValid = true;
            firstValidMs = roundMs(sinceReady);
            const sinceStarted =
                firstValidMs === null || startedMs === null
                    ? null
                    : firstValidMs - startedMs;
            return {
                params: { since_started_ms: sinceStarted },
                message: 'card complete',
            };
        },

        /**
         * `field-errors`, or null when nothing went wrong that was not
         * already showing. A submit is always reported, clean or not: it is
         * an attempt to pay. Otherwise only an error that was not on show
         * before — a number that fails its check, a field left half done.
         * Errors going away while the customer fixes them are progress, not
         * problems, and older iframes repeating the same set on every keyup
         * add nothing.
         */
        fieldErrors(
            errors: readonly CardFormFieldError[],
            trigger: CardFormErrorTrigger | undefined,
        ): CardFormStepReport | null {
            const current = new Set(
                errors.map(({ field, code }) => `${field}:${code}`),
            );
            const raised = [...current].filter((key) => !shown.has(key));
            shown = current;
            errorsRaised += raised.length;
            for (const key of raised) {
                codesSeen.add(key);
            }
            if (trigger === 'submit' && errors.length > 0) {
                invalidSubmits += 1;
            }
            if (trigger !== 'submit' && raised.length === 0) {
                return null;
            }
            let message = 'new field errors';
            if (trigger === 'submit') {
                message = errors.length > 0 ? 'submit errors' : 'submit ok';
            }
            return {
                params: {
                    errors: describeErrors(errors),
                    raised: raised.join(','),
                    count: errors.length,
                    trigger: trigger ?? null,
                },
                message,
            };
        },

        /** `submit-request`: the integrator's pay button. */
        submitRequest(): CardFormStepReport {
            submitRequests += 1;
            if (!valid) {
                invalidSubmitRequests += 1;
            }
            return {
                params: { valid },
                message: valid
                    ? 'pay pressed'
                    : 'pay pressed with incomplete card',
            };
        },

        /** `interaction`: the whole visit, ended the way `ended` says. */
        summary(ended: string): CardFormStepReport {
            let outcome = 'never started';
            if (becameValid) {
                outcome = 'completed';
            } else if (started || (progress === null && errorsRaised > 0)) {
                // An iframe released before `GOPAY_CARD_FORM_PROGRESS` never
                // says a field was touched, so `started` stays false for a
                // customer who typed. The errors it did send are the only
                // trace of that visit.
                outcome = 'not completed';
            }
            return {
                params: {
                    started_ms: startedMs,
                    filled_at_once: filledAtOnce,
                    became_valid: becameValid,
                    valid_at_end: valid,
                    first_valid_ms: firstValidMs,
                    // Valid and then not any more: a card edited after it was
                    // complete, which a customer who is unsure does.
                    validity_flips: validityFlips,
                    submit_requests: submitRequests,
                    invalid_submit_requests: invalidSubmitRequests,
                    // A submit the iframe's own button made with errors on
                    // show — the internal-mode answer to "pressed pay with
                    // half a card", which submit_requests (the integrator's
                    // submit()) cannot see.
                    invalid_submits: invalidSubmits,
                    errors_raised: errorsRaised,
                    error_codes_seen: [...codesSeen]
                        .sort((a, b) => a.localeCompare(b))
                        .join(','),
                    progress_at_end: progress
                        ? describeProgress(progress)
                        : null,
                    ended,
                },
                message: `${ended}: ${outcome}`,
            };
        },
    };
}
