import { createHttpClient } from '@gopay-internal/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoPayErrorCodes, GoPayHTTPError } from '../../src/errors.js';
import {
    createGoPaySDK,
    type GoPayEvent,
    isKnownEvent,
} from '../../src/index.js';
import { createEventsApi } from '../../src/modules/events/events.module.js';
import { makeResponse } from './helpers.js';

const BASE_URL = 'https://gw.example.com/api/merchant/payments/4.0';
const GOID = '8761908826';

const makeEvent = (id: string) => ({
    id,
    type: 'payments.paid',
    occurred_at: '2026-10-27T14:37:27.167Z',
    data: { payment_id: '7639814693' },
});

describe('EventsModule', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let events: ReturnType<typeof createEventsApi>;
    const requests = () => fetchMock.mock.calls.map(([req]) => req as Request);

    beforeEach(() => {
        fetchMock = vi
            .fn()
            .mockImplementation(async () => makeResponse({ items: [] }));
        vi.stubGlobal('fetch', fetchMock);
        const client = createHttpClient({ baseUrl: BASE_URL });
        client.setToken({
            access_token: 'test-token',
            expires_in: 3600,
            token_type: 'bearer',
        });
        events = createEventsApi(client);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('listEvents()', () => {
        it('sends GET /eshops/{goid}/events with the filters as the query', async () => {
            await events.listEvents(GOID, {
                related_type: 'payments',
                related_id: '7639814693',
                max_items: 5,
                type: undefined,
            });

            const [req] = requests();
            const url = new URL(req?.url ?? '');
            expect(req?.method).toBe('GET');
            expect(`${url.origin}${url.pathname}`).toBe(
                `${BASE_URL}/eshops/${GOID}/events`,
            );
            expect(Object.fromEntries(url.searchParams)).toEqual({
                related_type: 'payments',
                related_id: '7639814693',
                max_items: '5',
            });
            expect(req?.headers.get('Authorization')).toBe('Bearer test-token');
        });

        it('sends no query without filters', async () => {
            await events.listEvents(GOID);

            expect(requests()[0]?.url).toBe(
                `${BASE_URL}/eshops/${GOID}/events`,
            );
        });

        it('returns the page as the API sent it', async () => {
            const page = {
                items: [makeEvent('e1')],
                next_page_url: `${BASE_URL}/eshops/${GOID}/events?prev_item=e1`,
            };
            fetchMock.mockImplementation(async () => makeResponse(page));

            await expect(events.listEvents(GOID)).resolves.toEqual(page);
        });

        it('rejects an empty goid', async () => {
            await expect(events.listEvents('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe('getEvent()', () => {
        it('sends GET /eshops/{goid}/events/{event_id}', async () => {
            fetchMock.mockImplementation(async () =>
                makeResponse(makeEvent('01M5YWPW')),
            );

            await expect(events.getEvent(GOID, '01M5YWPW')).resolves.toEqual(
                makeEvent('01M5YWPW'),
            );
            expect(requests()[0]?.url).toBe(
                `${BASE_URL}/eshops/${GOID}/events/01M5YWPW`,
            );
        });

        it.each([
            ['goid', '', 'e1'],
            ['eventId', GOID, ''],
        ])('rejects an empty %s', async (_field, goid, eventId) => {
            await expect(events.getEvent(goid, eventId)).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('throws GoPayHTTPError on 404', async () => {
            fetchMock.mockImplementation(async () =>
                makeResponse({ errors: [] }, 404),
            );

            await expect(
                events.getEvent(GOID, 'missing'),
            ).rejects.toBeInstanceOf(GoPayHTTPError);
        });
    });

    describe('iterateEvents()', () => {
        it('yields every page, sending the cursor to the configured base URL only', async () => {
            // The gateway builds next_page_url from its own setting: another prefix here, and
            // a host the token must never reach.
            fetchMock
                .mockImplementationOnce(async () =>
                    makeResponse({
                        items: [makeEvent('e1'), makeEvent('e2')],
                        next_page_url: `https://elsewhere.example/gp-gw/api/4.0/eshops/${GOID}/events?related_type=payments&max_items=2&prev_item=e2`,
                    }),
                )
                .mockImplementationOnce(async () =>
                    makeResponse({ items: [makeEvent('e3')] }),
                );

            const seen: string[] = [];
            for await (const event of events.iterateEvents(GOID, {
                related_type: 'payments',
                max_items: 2,
            })) {
                seen.push(event.id);
            }

            expect(seen).toEqual(['e1', 'e2', 'e3']);
            const second = new URL(requests()[1]?.url ?? '');
            expect(`${second.origin}${second.pathname}`).toBe(
                `${BASE_URL}/eshops/${GOID}/events`,
            );
            expect(Object.fromEntries(second.searchParams)).toEqual({
                related_type: 'payments',
                max_items: '2',
                prev_item: 'e2',
            });
            expect(
                requests().every(
                    (req) =>
                        new URL(req.url).origin === new URL(BASE_URL).origin,
                ),
            ).toBe(true);
        });

        it('accepts a relative next_page_url', async () => {
            fetchMock
                .mockImplementationOnce(async () =>
                    makeResponse({
                        items: [makeEvent('e1')],
                        next_page_url: `/eshops/${GOID}/events?prev_item=e1`,
                    }),
                )
                .mockImplementationOnce(async () =>
                    makeResponse({ items: [] }),
                );

            for await (const _ of events.iterateEvents(GOID)) {
                // drain
            }

            expect(
                new URL(requests()[1]?.url ?? '').searchParams.get('prev_item'),
            ).toBe('e1');
        });

        it('fetches the next page only once the previous one is used up', async () => {
            fetchMock.mockImplementation(async () =>
                makeResponse({
                    items: [makeEvent('e1')],
                    next_page_url: `${BASE_URL}/eshops/${GOID}/events?prev_item=e1`,
                }),
            );

            for await (const _ of events.iterateEvents(GOID)) {
                break;
            }

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    // reportErrors cannot see into a generator, and the HTTP client reports only what fails
    // in a request; a page refused before one goes out is iterateEvents' own to report.
    it.each([
        ['a page refused before any request', ''],
        ['a page that failed in the request', GOID],
    ])('reports %s to onError, once', async (_case, goid) => {
        const onError = vi.fn();
        const sdk = createGoPaySDK({ baseUrl: BASE_URL, onError });

        const drain = async () => {
            for await (const _ of sdk.iterateEvents(goid)) {
                // drain
            }
        };

        const error = await drain().then(
            () => undefined,
            (reason: unknown) => reason,
        );
        expect(error).toBeDefined();
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0]?.[0]).toBe(error);
    });
});

// Compile-time: `yarn ci` type-checks the tests. Past the guard a known `case` narrows `data`
// to its own shape, and an unknown event still has a readable `type`.
function describeEvent(event: GoPayEvent): string {
    if (!isKnownEvent(event)) {
        return `unknown ${event.type}`;
    }
    switch (event.type) {
        case 'payments.paid':
            return event.data.payment_id;
        case 'refunds.succeeded':
            return event.data.refund_id;
        default:
            return event.type;
    }
}

describe('isKnownEvent', () => {
    it('tells the twelve documented types from one added later', () => {
        const paid = makeEvent('e1') as GoPayEvent;
        const added = JSON.parse(
            '{"id":"e2","type":"payments.something_new","occurred_at":"2026-11-04T08:00:00Z","data":{}}',
        ) as GoPayEvent;

        expect(describeEvent(paid)).toBe('7639814693');
        expect(describeEvent(added)).toBe('unknown payments.something_new');
    });
});
