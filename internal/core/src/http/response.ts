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
