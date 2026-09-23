import { afterEach, describe, expect, it, vi } from 'vitest';
import { callIntegrator } from '../../src/internal/integrator-callback.js';

/**
 * The contract has three halves that pull against each other: a throwing
 * callback must not break the payment, must not vanish, and must not be
 * mistaken for a failure of the SDK.
 */
describe('callIntegrator()', () => {
    const makeTelemetry = () => ({
        apiCall: vi.fn(),
        error: vi.fn(),
        lifecycle: vi.fn(),
        submit: vi.fn(),
        walletUnavailable: vi.fn(),
        integratorError: vi.fn(),
        walletUnmount: vi.fn(),
        walletAvailability: vi.fn(),
        walletStep: vi.fn(),
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not let the integrator’s bug reach the caller', () => {
        vi.useFakeTimers();

        expect(() =>
            callIntegrator('onStateChange', () => {
                throw new TypeError('their bug');
            }),
        ).not.toThrow();
    });

    it('rethrows on a later task, so the page’s own handler still sees it', () => {
        vi.useFakeTimers();
        const boom = new TypeError('their bug');

        callIntegrator('onStateChange', () => {
            throw boom;
        });

        // By the time this runs the SDK is out of the call stack, so nothing
        // downstream is affected — but it surfaces through window.onerror
        // with the original stack, which is the right owner for a bug in the
        // page's own code. Swallowing it is what made these invisible.
        expect(() => vi.runAllTimers()).toThrow(boom);
    });

    it('reports the callback and the error class, and nothing else', () => {
        vi.useFakeTimers();
        const telemetry = makeTelemetry();

        callIntegrator(
            'onValidityChange',
            () => {
                throw new TypeError('user@example.com is not a function');
            },
            telemetry,
        );

        expect(telemetry.integratorError).toHaveBeenCalledWith(
            'onValidityChange',
            'TypeError',
        );
        // The message belongs to the merchant's code and can carry their
        // data — this one deliberately looks like it does.
        expect(
            JSON.stringify(telemetry.integratorError.mock.calls),
        ).not.toContain('user@example.com');
    });

    it('does not trust a name the callback chose for its own error', () => {
        vi.useFakeTimers();
        const telemetry = makeTelemetry();
        const tampered = new Error('boom');
        // `Error.name` is writable, and a custom error class can be named
        // anything. Reporting it verbatim would be the same leak the message
        // is withheld to prevent, just through a field that looks constant.
        tampered.name = 'customer-4213@merchant.test';

        callIntegrator(
            'onStateChange',
            () => {
                throw tampered;
            },
            telemetry,
        );

        expect(telemetry.integratorError).toHaveBeenCalledWith(
            'onStateChange',
            'Error',
        );
        expect(
            JSON.stringify(telemetry.integratorError.mock.calls),
        ).not.toContain('merchant.test');
    });

    it('keeps the real class name when it is a built-in', () => {
        vi.useFakeTimers();
        const telemetry = makeTelemetry();

        callIntegrator(
            'onCancel',
            () => {
                throw new RangeError('out of range');
            },
            telemetry,
        );

        expect(telemetry.integratorError).toHaveBeenCalledWith(
            'onCancel',
            'RangeError',
        );
    });

    it('never reports an integrator bug as an SDK error', () => {
        vi.useFakeTimers();
        const telemetry = makeTelemetry();

        callIntegrator(
            'onFieldErrors',
            () => {
                throw new Error('their bug');
            },
            telemetry,
        );

        // `error()` also reaches config.onError, which means "the SDK hit a
        // problem". Filling it with the merchant's own bugs would make it
        // useless as a signal about the SDK.
        expect(telemetry.error).not.toHaveBeenCalled();
        expect(telemetry.apiCall).not.toHaveBeenCalled();
    });

    it('runs the callback and reports nothing when it behaves', () => {
        const telemetry = makeTelemetry();
        const cb = vi.fn();

        callIntegrator('onCancel', cb, telemetry);

        expect(cb).toHaveBeenCalledOnce();
        expect(telemetry.integratorError).not.toHaveBeenCalled();
    });
});
