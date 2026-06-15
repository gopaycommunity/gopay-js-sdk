import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaymentsApi } from '../../src/modules/payments/payments.module.js';
import { makeHttpClient, makeResponse } from './_helpers.js';

const ITERATIONS = 100;

// mockResolvedValue reuses the same Response whose body is consumed after the
// first .json() call. Use mockImplementation to return a fresh Response per call.
const processingFetch = () =>
    vi
        .fn()
        .mockImplementation(() =>
            Promise.resolve(makeResponse({ state: 'PROCESSING' })),
        );
const succeededFetch = () =>
    vi
        .fn()
        .mockImplementation(() =>
            Promise.resolve(makeResponse({ state: 'SUCCEEDED' })),
        );

describe('awaitChargeState polling — stress / timer leak detection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // -------------------------------------------------------------------------
    // Abort before the first poll fetch resolves (initial timer cleared,
    // no interval timer ever scheduled).
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× abort-immediately: no timers leak`, async () => {
        vi.stubGlobal('fetch', processingFetch());

        const client = makeHttpClient();
        const paymentsApi = createPaymentsApi(client, 'pay_test');

        for (let i = 0; i < ITERATIONS; i++) {
            const controller = new AbortController();
            const promise = paymentsApi.awaitChargeState({
                signal: controller.signal,
                threeDS: { mode: 'manual' },
                intervalMs: 500,
                initialTimeoutMs: 5_000,
            });
            promise.catch(() => {});

            // Abort synchronously before any timer or microtask fires
            controller.abort();
            await Promise.resolve();
            await Promise.resolve();

            // Drain any remaining timers for this iteration
            await vi.runAllTimersAsync();
        }

        expect(vi.getTimerCount()).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Abort after first poll interval fires (interval timer is scheduled and
    // then must drain to no-op).
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× abort-after-first-interval: timers drain cleanly`, async () => {
        vi.stubGlobal('fetch', processingFetch());

        const client = makeHttpClient();
        const paymentsApi = createPaymentsApi(client, 'pay_test');

        for (let i = 0; i < ITERATIONS; i++) {
            const controller = new AbortController();
            const promise = paymentsApi.awaitChargeState({
                signal: controller.signal,
                threeDS: { mode: 'manual' },
                intervalMs: 100,
                initialTimeoutMs: 5_000,
            });
            promise.catch(() => {});

            // Let the first doPoll run: fetch resolves and schedules the interval
            // timer. With fake timers, flush microtask queue with multiple awaits.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            // Advance past one interval (schedules second doPoll)
            await vi.advanceTimersByTimeAsync(100);

            // Abort: stops the loop; the scheduled doPoll fires as a no-op
            controller.abort();
            await Promise.resolve();

            // Drain remaining: doPoll fires, checks stopped, exits
            await vi.runAllTimersAsync();
        }

        expect(vi.getTimerCount()).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Initial timeout fires instead of abort — timeout clears itself.
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× initial-timeout: no timers leak after timeout`, async () => {
        vi.stubGlobal('fetch', processingFetch());

        const client = makeHttpClient();
        const paymentsApi = createPaymentsApi(client, 'pay_test');

        for (let i = 0; i < ITERATIONS; i++) {
            const promise = paymentsApi.awaitChargeState({
                threeDS: { mode: 'manual' },
                intervalMs: 500,
                initialTimeoutMs: 200,
            });
            promise.catch(() => {});

            // Advance past the initial timeout
            await vi.advanceTimersByTimeAsync(200);

            // Drain any interval-scheduled polls
            await vi.runAllTimersAsync();
        }

        expect(vi.getTimerCount()).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Successful poll: SUCCEEDED state resolves and leaves no timers.
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× successful-poll: timers cleared on SUCCEEDED`, async () => {
        vi.stubGlobal('fetch', succeededFetch());

        const client = makeHttpClient();
        const paymentsApi = createPaymentsApi(client, 'pay_test');

        for (let i = 0; i < ITERATIONS; i++) {
            const promise = paymentsApi.awaitChargeState({
                threeDS: { mode: 'manual' },
                intervalMs: 100,
                initialTimeoutMs: 5_000,
            });

            // doPoll fires synchronously; flush the fetch + .then chain
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await promise;
        }

        // clearTimeout(initialTimer) is called by stop() on SUCCEEDED
        expect(vi.getTimerCount()).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Mixed: N aborts, verify fetch call count is bounded (no runaway polls).
    // -------------------------------------------------------------------------

    it(`${ITERATIONS}× abort: fetch call count is bounded by abort timing`, async () => {
        const fetchMock = processingFetch();
        vi.stubGlobal('fetch', fetchMock);

        const client = makeHttpClient();
        const paymentsApi = createPaymentsApi(client, 'pay_test');

        const fetchBefore = fetchMock.mock.calls.length;

        for (let i = 0; i < ITERATIONS; i++) {
            const controller = new AbortController();
            const promise = paymentsApi.awaitChargeState({
                signal: controller.signal,
                threeDS: { mode: 'manual' },
                intervalMs: 500,
                initialTimeoutMs: 5_000,
            });
            promise.catch(() => {});

            controller.abort();
            await Promise.resolve();
            await vi.runAllTimersAsync();
        }

        const fetchAfter = fetchMock.mock.calls.length;
        // Each iteration fires at most 1 fetch (the initial doPoll).
        // If abort races before fetch resolves, 0 fetches. Upper bound = ITERATIONS.
        expect(fetchAfter - fetchBefore).toBeLessThanOrEqual(ITERATIONS);
    });
});
