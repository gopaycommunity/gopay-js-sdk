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
const CARD_FORM_FIELDS: Record<CardFormField, true> = {
    pan: true,
    expiry: true,
    cvv: true,
};
const CARD_FORM_ERROR_CODES: Record<CardFormErrorCode, true> = {
    required: true,
    pattern: true,
};
const CARD_FORM_FIELD_STATES: Record<CardFormFieldState, true> = {
    empty: true,
    partial: true,
    complete: true,
};
const CARD_FORM_ERROR_TRIGGERS: Record<CardFormErrorTrigger, true> = {
    submit: true,
    input: true,
    blur: true,
};
const FIELDS = Object.keys(CARD_FORM_FIELDS) as CardFormField[];
const FIELD_NAMES = new Set<string>(FIELDS);
const ERROR_CODES = new Set<string>(Object.keys(CARD_FORM_ERROR_CODES));
const FIELD_STATES = new Set<string>(Object.keys(CARD_FORM_FIELD_STATES));
const ERROR_TRIGGERS = new Set<string>(Object.keys(CARD_FORM_ERROR_TRIGGERS));

export function isCardFormFieldError(
    entry: unknown,
): entry is CardFormFieldError {
    if (typeof entry !== 'object' || entry === null) {
        return false;
    }
    const { field, code } = entry as Record<string, unknown>;
    return (
        typeof field === 'string' &&
        typeof code === 'string' &&
        FIELD_NAMES.has(field) &&
        ERROR_CODES.has(code)
    );
}

type CardFormProgress = Record<CardFormField, CardFormFieldState>;

/**
 * `GOPAY_CARD_FORM_PROGRESS` as far as the protocol allows it: all three
 * fields, each in one of the three states, or nothing. Projected rather than
 * forwarded, like the field errors — the "states, never values" guarantee is
 * the iframe's, and it is enforced on this side of the boundary too.
 */
export function projectProgress(fields: unknown): CardFormProgress | null {
    if (typeof fields !== 'object' || fields === null) {
        return null;
    }
    const source = fields as Record<string, unknown>;
    const projected = {} as CardFormProgress;
    for (const field of FIELDS) {
        const state = source[field];
        if (typeof state !== 'string' || !FIELD_STATES.has(state)) {
            return null;
        }
        projected[field] = state as CardFormFieldState;
    }
    return projected;
}

/**
 * What raised a `GOPAY_CARD_FORM_ERRORS`. Absent from iframes released before
 * it existed, and from anything outside the protocol.
 */
export function projectTrigger(
    trigger: unknown,
): CardFormErrorTrigger | undefined {
    return typeof trigger === 'string' && ERROR_TRIGGERS.has(trigger)
        ? (trigger as CardFormErrorTrigger)
        : undefined;
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
 * What the customer did with one mounted card form, kept for telemetry only:
 * deciding which of the iframe's reports are news, and the summary that
 * answers "did they fill it in, did they try to pay" in one event when the
 * per-step ones did not all arrive.
 *
 * Every input is a state, a code or a count. Nothing here sees a keystroke.
 */
export function createFormProgress() {
    let progress: CardFormProgress | null = null;
    let valid = false;
    let becameValid = false;
    let firstValidMs: number | null = null;
    let submitRequests = 0;
    let invalidSubmitRequests = 0;
    let invalidSubmits = 0;
    // The form starts with nothing on show, so the iframe's first report of
    // no errors — sent on the first keystroke — is not news either.
    let lastErrors = '';
    const codesSeen = new Set<string>();

    return {
        /**
         * The params of a `progress` step, or null when nothing changed —
         * the iframe sends only changes, an older one never sends this at all.
         */
        progress(next: CardFormProgress): Record<string, ParamValue> | null {
            if (
                progress &&
                describeProgress(progress) === describeProgress(next)
            ) {
                return null;
            }
            progress = next;
            return { ...next };
        },

        /** `sinceReady` is when it happened; only the first valid is kept. */
        validity(nextValid: boolean, sinceReady: number | null): void {
            valid = nextValid;
            if (nextValid && !becameValid) {
                becameValid = true;
                firstValidMs =
                    sinceReady === null ? null : Math.round(sinceReady);
            }
        },

        /**
         * The params of a `field-errors` step, or null for a repeat. The
         * same errors twice in a row are not news — older iframes sent them
         * on every keyup — except after a submit, which is a fresh attempt
         * whatever it shows.
         */
        fieldErrors(
            errors: readonly CardFormFieldError[],
            trigger: CardFormErrorTrigger | undefined,
        ): Record<string, ParamValue> | null {
            const described = describeErrors(errors);
            for (const { field, code } of errors) {
                codesSeen.add(`${field}:${code}`);
            }
            if (trigger === 'submit' && errors.length > 0) {
                invalidSubmits += 1;
            }
            if (trigger !== 'submit' && described === lastErrors) {
                return null;
            }
            lastErrors = described;
            return {
                errors: described,
                count: errors.length,
                trigger: trigger ?? null,
            };
        },

        /** The params of a `submit-request` step. */
        submitRequest(): Record<string, ParamValue> {
            submitRequests += 1;
            if (!valid) {
                invalidSubmitRequests += 1;
            }
            return { valid };
        },

        summary(): Record<string, ParamValue> {
            return {
                became_valid: becameValid,
                valid_at_end: valid,
                first_valid_ms: firstValidMs,
                submit_requests: submitRequests,
                invalid_submit_requests: invalidSubmitRequests,
                // A submit the iframe's own button made with errors on show —
                // the internal-mode answer to "pressed pay with half a card",
                // which submit_requests (the integrator's submit()) cannot see.
                invalid_submits: invalidSubmits,
                error_codes_seen: [...codesSeen].sort().join(','),
                progress_at_end: progress ? describeProgress(progress) : null,
            };
        },
    };
}
