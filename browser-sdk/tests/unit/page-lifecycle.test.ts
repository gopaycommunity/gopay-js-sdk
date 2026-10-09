import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGwLoggerTelemetry } from '../../src/logging/gw-logger.js';

/**
 * page-lifecycle.ts keeps per-page state at module level — the visibility last
 * reported, a discarded document's one report — so every test loads a fresh
 * copy. Listeners an earlier copy registered stay on the jsdom document, but
 * they report to that copy's telemetry, never to the one a test asserts on.
 */
async function freshModules() {
    vi.resetModules();
    const lifecycle = await import('../../src/logging/page-lifecycle.js');
    const beacon = await import('../../src/logging/leave-beacon.js');
    return { ...lifecycle, ...beacon };
}

function spyTelemetry() {
    return {
        apiCall: vi.fn(),
        error: vi.fn(),
        lifecycle: vi.fn(),
        submit: vi.fn(),
        page: vi.fn(),
    };
}

function setVisibility(state: DocumentVisibilityState): void {
    Object.defineProperty(globalThis.document, 'visibilityState', {
        value: state,
        configurable: true,
    });
}

function goVisibility(state: DocumentVisibilityState): void {
    setVisibility(state);
    globalThis.document.dispatchEvent(new Event('visibilitychange'));
}

/**
 * The page's Navigation Timing entry, or none. Shadows whatever jsdom has, and
 * the afterEach deletes the shadow again.
 */
function navigationEntry(entry: Record<string, unknown> | undefined): void {
    Object.defineProperty(performance, 'getEntriesByType', {
        value: (type: string) =>
            type === 'navigation' && entry ? [entry] : [],
        configurable: true,
        writable: true,
    });
}

/** jsdom's PageTransitionEvent support varies; the handlers read only `persisted`. */
function transition(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
    const event = new Event(type);
    Object.defineProperty(event, 'persisted', { value: persisted });
    return event;
}

describe('page lifecycle', () => {
    let now: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        now = vi.spyOn(performance, 'now').mockReturnValue(0);
        setVisibility('visible');
        // No entry unless a test says how the page was reached, so the rest
        // see only the events they cause.
        navigationEntry(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(globalThis.document, 'wasDiscarded');
        Reflect.deleteProperty(globalThis.document, 'prerendering');
        Reflect.deleteProperty(performance, 'getEntriesByType');
    });

    it('says once how the page was reached, and how far into its life the first SDK came', async () => {
        const { registerPageLifecycle } = await freshModules();
        navigationEntry({ type: 'back_forward' });
        const first = spyTelemetry();
        const rerendered = spyTelemetry();
        now.mockReturnValue(2_400.6);
        registerPageLifecycle(first as never);
        // The merchant's checkout re-renders and builds another SDK: the
        // same page, so nothing new to say about how it was reached.
        now.mockReturnValue(30_000);
        registerPageLifecycle(rerendered as never);

        expect(first.page.mock.calls).toEqual([
            [{ state: 'back_forward', durationMs: 2_401 }],
        ]);
        expect(rerendered.page).not.toHaveBeenCalled();
    });

    it('calls a page still being prerendered a prerender, whatever its entry says', async () => {
        const { registerPageLifecycle } = await freshModules();
        navigationEntry({ type: 'navigate', activationStart: 0 });
        Object.defineProperty(globalThis.document, 'prerendering', {
            value: true,
            configurable: true,
        });
        const t = spyTelemetry();
        registerPageLifecycle(t as never);

        expect(t.page.mock.calls[0]?.[0]).toMatchObject({ state: 'prerender' });
    });

    it('calls a prerendered page that has since been shown a prerender too', async () => {
        const { registerPageLifecycle } = await freshModules();
        navigationEntry({ type: 'navigate', activationStart: 812 });
        const t = spyTelemetry();
        registerPageLifecycle(t as never);

        expect(t.page.mock.calls[0]?.[0]).toMatchObject({ state: 'prerender' });
    });

    it('reports an ordinary load as navigate', async () => {
        const { registerPageLifecycle } = await freshModules();
        navigationEntry({ type: 'navigate', activationStart: 0 });
        const t = spyTelemetry();
        registerPageLifecycle(t as never);

        expect(t.page.mock.calls[0]?.[0]).toMatchObject({ state: 'navigate' });
    });

    it('guesses nothing when the entry is missing or unknown', async () => {
        const { registerPageLifecycle } = await freshModules();
        navigationEntry({ type: 'something-new' });
        const t = spyTelemetry();
        registerPageLifecycle(t as never);

        expect(t.page).not.toHaveBeenCalled();
    });

    it('reports the page leaving the screen and coming back, timed in the state it left', async () => {
        const { registerPageLifecycle } = await freshModules();
        const t = spyTelemetry();
        now.mockReturnValue(1_000);
        registerPageLifecycle(t as never);

        // Five seconds on screen, then the shopper opens their banking app.
        now.mockReturnValue(6_000);
        goVisibility('hidden');
        // Fifteen seconds away, then back.
        now.mockReturnValue(21_000);
        goVisibility('visible');

        expect(t.page.mock.calls).toEqual([
            [{ state: 'hidden', durationMs: 5_000 }],
            [{ state: 'visible', durationMs: 15_000 }],
        ]);
    });

    it('reports a state once, however often the browser repeats the event', async () => {
        const { registerPageLifecycle } = await freshModules();
        const t = spyTelemetry();
        registerPageLifecycle(t as never);

        goVisibility('hidden');
        goVisibility('hidden');

        expect(t.page).toHaveBeenCalledTimes(1);
    });

    it('ignores focus and blur, which the card form iframe fires on every tap', async () => {
        const { registerPageLifecycle } = await freshModules();
        const t = spyTelemetry();
        registerPageLifecycle(t as never);

        globalThis.dispatchEvent(new Event('blur'));
        globalThis.dispatchEvent(new Event('focus'));

        expect(t.page).not.toHaveBeenCalled();
    });

    it('listens once per page and reports through the SDK built last', async () => {
        const { registerPageLifecycle } = await freshModules();
        const stale = spyTelemetry();
        const current = spyTelemetry();
        registerPageLifecycle(stale as never);
        registerPageLifecycle(stale as never);
        registerPageLifecycle(current as never);

        goVisibility('hidden');

        expect(stale.page).not.toHaveBeenCalled();
        expect(current.page).toHaveBeenCalledTimes(1);
    });

    it('times a freeze from the page going hidden, and the resume from the freeze', async () => {
        const { registerPageLifecycle } = await freshModules();
        const t = spyTelemetry();
        registerPageLifecycle(t as never);

        now.mockReturnValue(1_000);
        goVisibility('hidden');
        now.mockReturnValue(4_000);
        globalThis.document.dispatchEvent(new Event('freeze'));
        now.mockReturnValue(10_000);
        globalThis.document.dispatchEvent(new Event('resume'));

        expect(t.page.mock.calls.slice(1)).toEqual([
            [{ state: 'freeze', durationMs: 3_000 }],
            [{ state: 'resume', durationMs: 6_000 }],
        ]);
    });

    it('reports a restore from the back/forward cache and re-arms the leave', async () => {
        const { registerPageLifecycle, registerLeaveBeacon } =
            await freshModules();
        const t = spyTelemetry();
        const leaves = () =>
            t.lifecycle.mock.calls.filter(([type]) => type === 'leave').length;
        registerLeaveBeacon(t as never);
        registerPageLifecycle(t as never);

        now.mockReturnValue(1_000);
        globalThis.dispatchEvent(transition('pagehide', true));
        now.mockReturnValue(61_000);
        globalThis.dispatchEvent(transition('pageshow', true));
        // The restored visit ends for real. Nothing rebuilt the SDK, so this
        // leave exists only because the restore put the listener back.
        globalThis.dispatchEvent(transition('pagehide', false));

        expect(t.page).toHaveBeenCalledWith({
            state: 'restored',
            durationMs: 60_000,
        });
        expect(leaves()).toBe(2);
    });

    it('does not take an ordinary page load for a restore', async () => {
        const { registerPageLifecycle } = await freshModules();
        const t = spyTelemetry();
        registerPageLifecycle(t as never);

        globalThis.dispatchEvent(transition('pageshow', false));

        expect(t.page).not.toHaveBeenCalled();
    });

    it('reports the reload of a discarded tab once, however many SDKs it builds', async () => {
        const { registerPageLifecycle } = await freshModules();
        Object.defineProperty(globalThis.document, 'wasDiscarded', {
            value: true,
            configurable: true,
        });
        const first = spyTelemetry();
        const second = spyTelemetry();
        registerPageLifecycle(first as never);
        registerPageLifecycle(second as never);

        expect(first.page.mock.calls).toEqual([
            [{ state: 'discarded', durationMs: null }],
        ]);
        expect(second.page).not.toHaveBeenCalled();
    });

    it('stays silent about a document that was not discarded', async () => {
        const { registerPageLifecycle } = await freshModules();
        const t = spyTelemetry();
        registerPageLifecycle(t as never);

        expect(t.page).not.toHaveBeenCalled();
    });
});

describe('page events on the wire', () => {
    let requests: Request[];

    beforeEach(() => {
        // The sequence is per tab, kept in sessionStorage; this is a new tab.
        globalThis.sessionStorage.clear();
        requests = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((req: Request) => {
                requests.push(req);
                return Promise.resolve(new Response(null, { status: 204 }));
            }),
        );
        vi.stubGlobal('location', {
            origin: 'https://eshop.example.com',
            pathname: '/checkout',
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const telemetry = () =>
        createGwLoggerTelemetry({
            environment: 'sandbox',
            getClientId: () => 'client_test_123',
            getPaymentId: () => '3273103424',
        });
    const eventAt = async (i: number) => {
        const req = requests[i];
        if (!req) {
            throw new Error(`no request at ${i}`);
        }
        return (
            JSON.parse(await req.clone().text()) as {
                event: Record<string, unknown>;
            }
        ).event;
    };

    it('is a js_event named PAGE.<state>, numbered like the rest', async () => {
        const t = telemetry();
        t.lifecycle('init');
        t.page({ state: 'hidden', durationMs: 5_000 });

        expect(await eventAt(1)).toMatchObject({
            event_type: 'js_event',
            function_name: 'PAGE.hidden',
            duration: 5_000,
            payment_session_id: '3273103424',
            seq: 2,
        });
    });

    it('cannot spend the budget the leave needs', async () => {
        // A shopper flicking between apps is two events a switch. They have a
        // budget of their own, so the leave they exist to explain still goes.
        const t = telemetry();
        for (let i = 0; i < 40; i += 1) {
            t.page({
                state: i % 2 === 0 ? 'hidden' : 'visible',
                durationMs: 1,
            });
        }
        t.lifecycle('leave');

        expect(requests).toHaveLength(31);
        expect(await eventAt(30)).toMatchObject({
            event_type: 'navigation',
            navigation_type: 'leave',
        });
    });
});
