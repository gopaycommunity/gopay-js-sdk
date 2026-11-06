import {
    GoPayErrorCodes,
    GoPaySDKError,
    type HttpClient,
    requirePathSegment,
} from '@gopay-internal/core';
import type { components, operations } from '../../types/generated.js';

/** One of the twelve event types the API documents, discriminated on `type`. */
export type KnownGoPayEvent = components['schemas']['Event'];
export type GoPayEventType = components['schemas']['Event-Type'];

/** An event of a type added to the API after this SDK version: it arrives as sent, never as an error. */
export interface UnknownGoPayEvent {
    id: string;
    type: string;
    occurred_at: string;
    data: Record<string, unknown>;
}

/**
 * An event of the eshop. Check {@link isKnownEvent} first: TypeScript narrows a switch on
 * `type` only over the known variants, and the unknown one is what is left otherwise.
 */
export type GoPayEvent = KnownGoPayEvent | UnknownGoPayEvent;

// A Record over the whole enum: a type the spec adds, or one listed here that it removes, is a
// compile error at the next codegen rather than a silent `false`.
const KNOWN_EVENT_TYPES: Record<GoPayEventType, true> = {
    'payments.paid': true,
    'payments.canceled': true,
    'payments.timeouted': true,
    'links.payment_created': true,
    'links.disabled': true,
    'refunds.succeeded': true,
    'refunds.failed': true,
    'recurrences.started': true,
    'recurrences.payment_created': true,
    'recurrences.stopped': true,
    'cards.updated': true,
    'cards.deleted': true,
};
const known: ReadonlySet<string> = new Set(Object.keys(KNOWN_EVENT_TYPES));

/** Whether the event is one of the types this SDK version knows, with its `data` typed. */
export function isKnownEvent(event: GoPayEvent): event is KnownGoPayEvent {
    return known.has(event.type);
}

export type EventList = Omit<components['schemas']['Event-List'], 'items'> & {
    items: GoPayEvent[];
};
/** Filters and paging of `GET /eshops/{goid}/events`. */
export type ListEventsParams = NonNullable<
    operations['get-eshops-goid-events']['parameters']['query']
>;

function eventsQuery(params: ListEventsParams = {}): URLSearchParams {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' || typeof value === 'number') {
            query.set(key, String(value));
        }
    }
    return query;
}

function eventsPath(goid: string, params: ListEventsParams = {}): string {
    const search = eventsQuery(params).toString();
    const suffix = search ? `?${search}` : '';
    return `/eshops/${goid}/events${suffix}`;
}

/**
 * The query of `next_page_url`, re-sent through the SDK's own base URL. Following the URL
 * itself would hand the Bearer token to whatever host it names, and its path prefix comes
 * from the gateway's own setting rather than the base URL this SDK was configured with.
 */
function nextPageParams(
    nextPageUrl: string,
    baseUrl: string,
): ListEventsParams {
    const params: Record<string, string> = {};
    for (const [key, value] of new URL(nextPageUrl, baseUrl).searchParams) {
        params[key] = value;
    }
    return params;
}

/** The query a page is fetched with, in one order, so that two cursors naming one page compare equal. */
function pageKey(params: ListEventsParams | undefined): string {
    const query = eventsQuery(params);
    query.sort();
    return query.toString();
}

// NETWORK_ERROR, as for any response of an unexpected shape: a new code would grow the public
// GoPayErrorCodes, and a page the SDK cannot page on is the gateway's fault, not the caller's.
function pagingStuck(reason: string): GoPaySDKError {
    return new GoPaySDKError(`[GoPaySDK] Event paging stopped: ${reason}.`, {
        errorCode: GoPayErrorCodes.NETWORK_ERROR,
    });
}

export function createEventsApi(client: HttpClient) {
    async function listEvents(
        goid: string,
        params?: ListEventsParams,
        options?: { signal?: AbortSignal },
    ): Promise<EventList> {
        const id = requirePathSegment(goid, 'goid');
        // async + await so that a refused argument rejects like a failed request does.
        return await client.get<EventList>(eventsPath(id, params), options);
    }

    return {
        /**
         * One page of the eshop's events, newest first; `next_page_url` is set while older
         * ones remain. Requires the `event:read` OAuth2 scope.
         *
         * GET /eshops/{goid}/events
         *
         * @param goid   - The eshop's GoID
         * @param params - Filters (`type`, `related_type` + `related_id`, `occurred_after`, …) and `max_items`
         */
        listEvents,

        /**
         * One event by its id. Requires the `event:read` OAuth2 scope.
         *
         * GET /eshops/{goid}/events/{event_id}
         *
         * @param goid    - The eshop's GoID
         * @param eventId - The event's `id`, e.g. from a webhook
         */
        async getEvent(
            goid: string,
            eventId: string,
            options?: { signal?: AbortSignal },
        ): Promise<GoPayEvent> {
            const id = requirePathSegment(goid, 'goid');
            const eid = requirePathSegment(eventId, 'eventId');
            return await client.get<GoPayEvent>(
                `/eshops/${id}/events/${eid}`,
                options,
            );
        },

        /**
         * Every event matching `params`, page after page, fetching the next page only when
         * the previous one is used up. Requires the `event:read` OAuth2 scope.
         *
         * ```ts
         * for await (const event of sdk.iterateEvents(goid, { related_type: 'payments', related_id: paymentId })) { … }
         * ```
         */
        async *iterateEvents(
            goid: string,
            params?: ListEventsParams,
            options?: { signal?: AbortSignal },
        ): AsyncGenerator<GoPayEvent, void, undefined> {
            // reportErrors only sees what a call returns; a generator returns before it
            // fetches anything, so a failed page is reported here.
            const fetchPage = async (
                pageParams: ListEventsParams | undefined,
            ): Promise<EventList> => {
                try {
                    return await listEvents(goid, pageParams, options);
                } catch (error) {
                    client.reportError(error);
                    throw error;
                }
            };
            // Page n+1 needs the cursor in page n, so pages are fetched one after another, each
            // only when the previous one is used up. `for await` is that loop; an `await` in a
            // plain loop body would say the same thing and read as a missed Promise.all.
            let nextParams: ListEventsParams | undefined = params;
            let more = true;
            // Every query fetched so far: a cursor that names one of them again, or an empty
            // page that still has a next one, would page forever, a request after a request.
            const fetched = new Set<string>([pageKey(params)]);
            // Raised on the call after the page that showed it, so that page's events still
            // reach the caller.
            let stuck: GoPaySDKError | undefined;
            const pages: AsyncIterable<EventList> = {
                [Symbol.asyncIterator]: () => ({
                    async next() {
                        if (stuck) {
                            client.reportError(stuck);
                            throw stuck;
                        }
                        if (!more) {
                            return { done: true, value: undefined };
                        }
                        const page = await fetchPage(nextParams);
                        if (!Array.isArray(page?.items)) {
                            const unusable = pagingStuck(
                                'the page has no item list',
                            );
                            client.reportError(unusable);
                            throw unusable;
                        }
                        // One condition for both: a cursor that is absent, empty or null ends
                        // the paging, rather than leaving `more` set with nowhere to go.
                        const cursor = page.next_page_url;
                        if (!cursor) {
                            more = false;
                        } else if (page.items.length === 0) {
                            stuck = pagingStuck(
                                'an empty page names a next page, which would page forever',
                            );
                        } else {
                            nextParams = nextPageParams(cursor, client.baseUrl);
                            const key = pageKey(nextParams);
                            if (fetched.has(key)) {
                                stuck = pagingStuck(
                                    'next_page_url names a page already fetched, which would page forever',
                                );
                            }
                            fetched.add(key);
                        }
                        return { done: false, value: page };
                    },
                }),
            };
            for await (const page of pages) {
                yield* page.items;
            }
        },
    };
}
