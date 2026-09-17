/**
 * Collapses a request path into a stable template for monitoring tools.
 *
 * Error trackers group by whatever fields they are handed, so a path carrying a
 * payment id yields one group per payment — thousands of groups for a single
 * fault. Replacing the id-shaped segments with `{id}` collapses those back into
 * one group per endpoint.
 *
 * Only all-digit and UUID segments are rewritten: every literal segment in the
 * v4 API is a word (`payments`, `charge`, `qr-payment`), so neither rule can
 * swallow one, while the ids the SDK puts on the wire are numeric or UUIDs. An
 * id in some other shape is left alone rather than guessed at — a raw segment
 * groups badly, but a wrongly rewritten one hides the endpoint entirely.
 */

const ALL_DIGITS = /^\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeEndpoint(path: string): string {
    const [withoutQuery = ''] = path.split('?');
    const trimmed = withoutQuery.startsWith('/')
        ? withoutQuery.slice(1)
        : withoutQuery;

    const template = trimmed
        .split('/')
        .map((segment) =>
            ALL_DIGITS.test(segment) || UUID.test(segment) ? '{id}' : segment,
        )
        .join('/');

    return `/${template}`;
}
