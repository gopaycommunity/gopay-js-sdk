export const makeResponse = (data: unknown, status = 200, statusText = 'OK') =>
    new Response(JSON.stringify(data), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
    });

export const makeEmptyResponse = (status = 204) =>
    new Response(null, { status, statusText: 'No Content' });
