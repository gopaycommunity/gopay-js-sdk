/**
 * What the card form's reported height did while it was on the page.
 *
 * The iframe sizes itself by sending GOPAY_CARD_FORM_HEIGHT, and the SDK
 * applies every value as it arrives. Nothing recorded those values, so a height
 * that jumps up and down — suspected while the customer fills the form, and the
 * kind of thing a scrollbar that appears and disappears with the height it
 * causes would produce — was invisible in the data. Every report of a
 * scrollbar in the card form so far (GWUICC4-24, -25, -26) had to be
 * reproduced by hand before anyone could measure it.
 *
 * Pure bookkeeping on purpose: no DOM, no telemetry, and the clock injected,
 * so the thresholds can be tested without a browser or real time.
 */

/**
 * Direction reversals within {@link OSCILLATION_WINDOW_MS} that count as the
 * height oscillating. One reversal is ordinary — a validation message raised
 * and then cleared again — and two can still be a customer correcting a field.
 * A feedback loop reverses on every frame, far above this.
 */
const OSCILLATION_REVERSALS = 3;
const OSCILLATION_WINDOW_MS = 1_000;

/**
 * How many distinct consecutive values `recent` keeps. Enough to show the
 * pattern of an oscillation (178,194,178,194 swings by 16px, a classic
 * scrollbar's height, where 178,179,178 is a rounding question), small
 * enough to stay far below gw-logger's 4096-character cap on `params`.
 */
const RECENT_VALUES = 16;

/**
 * Flat and primitive-valued, which is what the logger's `params` takes. `min`,
 * `max` and `last` are null until the first message, and the logger drops
 * nulls rather than rendering them.
 */
interface HeightStats {
    /** Height messages received, including ones that repeated the last value. */
    messages: number;
    /** Messages that actually moved the height. */
    changes: number;
    /** Changes that went the opposite way to the one before. */
    reversals: number;
    min: number | null;
    max: number | null;
    last: number | null;
    /** The most recent distinct values, oldest first, comma-separated. */
    recent: string;
    /** Whether the reversal threshold was crossed at any point. */
    oscillated: boolean;
}

interface HeightTracker {
    /**
     * Records one reported height. Returns true exactly once per tracker: on
     * the message that crosses the oscillation threshold, so the caller can
     * report it the moment it happens rather than only at teardown.
     */
    record(height: number): boolean;
    stats(): HeightStats;
}

export function createHeightTracker(now: () => number): HeightTracker {
    let messages = 0;
    let changes = 0;
    let reversals = 0;
    let min: number | null = null;
    let max: number | null = null;
    let last: number | null = null;
    let direction: 1 | -1 | 0 = 0;
    let oscillated = false;
    const recent: number[] = [];
    let reversalTimes: number[] = [];

    return {
        record(height) {
            messages += 1;
            min = min === null ? height : Math.min(min, height);
            max = max === null ? height : Math.max(max, height);

            const previous = last;
            last = height;
            if (previous === height) {
                return false;
            }
            // Rounded, because `recent` travels as a string and every string
            // in `params` goes through the PAN scrub: under page zoom a height
            // arrives as 178.3333282470703, whose 13 fraction digits read as a
            // card number and came out as `[redacted]` — the pattern lost in
            // exactly the zoom case it exists for. Two places keep a
            // sub-pixel difference visible and cannot form a 12-digit run.
            recent.push(Math.round(height * 100) / 100);
            if (recent.length > RECENT_VALUES) {
                recent.shift();
            }
            if (previous === null) {
                return false;
            }

            changes += 1;
            const next = height > previous ? 1 : -1;
            const reversed = direction !== 0 && next !== direction;
            direction = next;
            if (!reversed) {
                return false;
            }

            reversals += 1;
            const at = now();
            reversalTimes = reversalTimes.filter(
                (t) => at - t < OSCILLATION_WINDOW_MS,
            );
            reversalTimes.push(at);
            if (oscillated || reversalTimes.length < OSCILLATION_REVERSALS) {
                return false;
            }
            oscillated = true;
            return true;
        },

        stats() {
            return {
                messages,
                changes,
                reversals,
                min,
                max,
                last,
                recent: recent.join(','),
                oscillated,
            };
        },
    };
}
