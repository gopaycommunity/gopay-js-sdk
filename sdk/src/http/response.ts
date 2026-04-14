/**
 * Reads the response body. For JSON content-type, tries JSON.parse with a
 * raw-text fallback so GoPayHTTPError.body is always populated. For all other
 * content-types (text/plain, etc.) the raw string is returned as-is.
 */
export async function parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
        return text;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
