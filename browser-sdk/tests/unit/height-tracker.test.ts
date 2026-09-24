import { describe, expect, it } from 'vitest';
import { safeErrorMessage } from '../../src/logging/sanitize.js';
import { createHeightTracker } from '../../src/modules/cards/height-tracker.js';

/** A clock the test moves by hand, so the one-second window is exact. */
function makeClock() {
    let t = 0;
    return {
        now: () => t,
        advance: (ms: number) => {
            t += ms;
        },
    };
}

/**
 * The tracker decides what counts as the height oscillating, so its edges are
 * what these pin: a validation message raised and cleared is not an
 * oscillation, three reversals spread over seconds are not either, and one
 * that is gets reported once however long it goes on.
 */
describe('createHeightTracker()', () => {
    it('reports nothing for a form whose height never arrived', () => {
        expect(createHeightTracker(() => 0).stats()).toEqual({
            messages: 0,
            changes: 0,
            reversals: 0,
            min: null,
            max: null,
            last: null,
            recent: '',
            oscillated: false,
        });
    });

    it('counts a repeated height as a message but not as a change', () => {
        // cc-v4 reports from its ResizeObserver and from four explicit call
        // sites, so the same value arriving twice is routine.
        const tracker = createHeightTracker(() => 0);
        tracker.record(178);
        tracker.record(178);
        tracker.record(178);

        expect(tracker.stats()).toMatchObject({
            messages: 3,
            changes: 0,
            reversals: 0,
            recent: '178',
        });
    });

    it('does not count growth in one direction as reversing', () => {
        const tracker = createHeightTracker(() => 0);
        for (const height of [100, 120, 140, 160]) {
            tracker.record(height);
        }

        expect(tracker.stats()).toMatchObject({
            changes: 3,
            reversals: 0,
            min: 100,
            max: 160,
            last: 160,
        });
    });

    it('treats a validation message raised and cleared as one reversal, not an oscillation', () => {
        const tracker = createHeightTracker(() => 0);

        expect(tracker.record(178)).toBe(false);
        expect(tracker.record(218)).toBe(false);
        expect(tracker.record(178)).toBe(false);
        expect(tracker.stats()).toMatchObject({
            changes: 2,
            reversals: 1,
            min: 178,
            max: 218,
            recent: '178,218,178',
            oscillated: false,
        });
    });

    it('reports an oscillation once, on the message that crosses the threshold', () => {
        const tracker = createHeightTracker(() => 0);
        const reported = [178, 194, 178, 194, 178, 194, 178].map((h) =>
            tracker.record(h),
        );

        // The fifth value is the third reversal. Everything after it belongs to
        // the same oscillation and must not be reported again.
        expect(reported).toEqual([
            false,
            false,
            false,
            false,
            true,
            false,
            false,
        ]);
        expect(tracker.stats()).toMatchObject({
            reversals: 5,
            oscillated: true,
        });
    });

    it('does not call three reversals spread over more than a second an oscillation', () => {
        const clock = makeClock();
        const tracker = createHeightTracker(clock.now);
        tracker.record(178);
        tracker.record(194);
        for (const height of [178, 194, 178]) {
            clock.advance(600);
            expect(tracker.record(height)).toBe(false);
        }

        expect(tracker.stats()).toMatchObject({
            reversals: 3,
            oscillated: false,
        });
    });

    it('keeps a zoomed, fractional height readable through the PAN scrub', () => {
        // What a page zoom produces. Thirteen fraction digits are a PAN to the
        // scrub every `params` string goes through, so unrounded this whole
        // pattern would arrive as [redacted].
        const tracker = createHeightTracker(() => 0);
        tracker.record(178.3333282470703);
        tracker.record(194);
        tracker.record(178.3333282470703);

        const { recent, last } = tracker.stats();
        expect(recent).toBe('178.33,194,178.33');
        expect(safeErrorMessage(recent)).toBe(recent);
        // The number fields are not strings and are never scrubbed.
        expect(last).toBe(178.3333282470703);
    });

    it('keeps only the most recent values, oldest first', () => {
        const tracker = createHeightTracker(() => 0);
        for (let i = 0; i < 20; i += 1) {
            tracker.record(100 + i);
        }

        const recent = tracker.stats().recent.split(',');
        expect(recent).toHaveLength(16);
        expect(recent[0]).toBe('104');
        expect(recent[recent.length - 1]).toBe('119');
    });
});
