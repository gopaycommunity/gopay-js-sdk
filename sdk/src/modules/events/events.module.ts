import { type HttpClient, requirePathSegment } from '@gopay-internal/core';
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

const KNOWN_EVENT_TYPES = [
    'payments.paid',
    'payments.canceled',
    'payments.timeouted',
    'links.payment_created',
    'links.disabled',
    'refunds.succeeded',
    'refunds.failed',
    'recurrences.started',
    'recurrences.payment_created',
    'recurrences.stopped',
    'cards.updated',
    'cards.deleted',
] as const satisfies readonly GoPayEventType[];

// A type the spec adds turns this into an error at the next codegen, not a silent `false`.
const everyTypeListed: Exclude<
    GoPayEventType,
    (typeof KNOWN_EVENT_TYPES)[number]
> extends never
    ? true
    : never = true;
const known: ReadonlySet<string> = everyTypeListed
    ? new Set(KNOWN_EVENT_TYPES)
    : new Set();

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

function eventsPath(goid: string, params: ListEventsParams = {}): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' || typeof value === 'number') {
            query.set(key, String(value));
        }
    }
    const search = query.toString();
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
                pageParams: () => ListEventsParams | undefined,
            ): Promise<EventList> => {
                try {
                    return await listEvents(goid, pageParams(), options);
                } catch (error) {
                    client.reportError(error);
                    throw error;
                }
            };
            let page = await fetchPage(() => params);
            for (;;) {
                yield* page.items;
                const next = page.next_page_url;
                if (!next) {
                    return;
                }
                page = await fetchPage(() =>
                    nextPageParams(next, client.baseUrl),
                );
            }
        },
    };
}
