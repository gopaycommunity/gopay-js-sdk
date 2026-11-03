import { GoPayErrorCodes, GoPaySDKError } from '@gopay-internal/core';
import type { GoPayEvent } from '../events/events.module.js';

/** The request body exactly as it arrived; the signature covers these bytes, not parsed JSON. */
export type WebhookBody = string | Uint8Array | ArrayBuffer;

/** `req.headers['x-gopay-signature']` as Node and Express type it. */
export type WebhookSignatureHeader =
    | string
    | readonly string[]
    | null
    | undefined;

interface ParsedSignature {
    /** The protected header exactly as sent: it is part of the signing input. */
    protectedHeader: string;
    kid: string;
    signature: Uint8Array<ArrayBuffer>;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const utf8 = new TextDecoder('utf-8', { fatal: true });

// Messages carry only text this SDK wrote: everything in the request came from whoever sent it.
export function invalidWebhook(reason: string, cause?: unknown): GoPaySDKError {
    return new GoPaySDKError(
        `[GoPaySDK] Not a valid GoPay webhook: ${reason}`,
        {
            errorCode: GoPayErrorCodes.WEBHOOK_INVALID,
            cause,
        },
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | undefined {
    if (!BASE64URL.test(value) || value.length % 4 === 1) {
        return undefined;
    }
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(
        base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='),
    );
    // atob yields one char per byte, 0–255, so the code point is the byte.
    return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
}

/** Unpadded, as the JWS signing input requires (RFC 7515 §2). */
function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCodePoint(
            ...bytes.subarray(offset, offset + 0x8000),
        );
    }
    const base64 = btoa(binary);
    const padding = base64.indexOf('=');
    return (padding === -1 ? base64 : base64.slice(0, padding))
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

export function bodyBytes(rawBody: WebhookBody): Uint8Array {
    if (typeof rawBody === 'string') {
        return new TextEncoder().encode(rawBody);
    }
    if (rawBody instanceof Uint8Array) {
        return rawBody;
    }
    if (rawBody instanceof ArrayBuffer) {
        return new Uint8Array(rawBody);
    }
    // The usual cause is a JSON body parser ahead of the route: the bytes are gone by then.
    throw new GoPaySDKError(
        '[GoPaySDK] rawBody must be the request body as received (string, Buffer, Uint8Array or ArrayBuffer), not parsed JSON',
        { errorCode: GoPayErrorCodes.INVALID_ARGUMENT },
    );
}

/**
 * `X-GoPay-Signature` is a detached JWS (RFC 7515 Appendix F): `<protected header>..<signature>`,
 * the header exactly `{"alg":"RS256","kid":…}`. Anything else is refused rather than guessed at.
 */
export function parseSignatureHeader(
    header: WebhookSignatureHeader,
): ParsedSignature {
    let value: string | undefined;
    if (typeof header === 'string') {
        value = header;
    } else if (header?.length === 1) {
        value = header[0];
    }
    if (!value) {
        throw invalidWebhook(
            'exactly one X-GoPay-Signature header is required',
        );
    }
    const [protectedHeader = '', payload, signaturePart = '', ...rest] =
        value.split('.');
    if (payload !== '' || rest.length > 0) {
        throw invalidWebhook('X-GoPay-Signature is not a detached JWS');
    }
    const headerBytes = base64UrlToBytes(protectedHeader);
    const signature = base64UrlToBytes(signaturePart);
    if (!headerBytes || !signature) {
        throw invalidWebhook('X-GoPay-Signature is not base64url');
    }

    let jose: unknown;
    try {
        jose = JSON.parse(utf8.decode(headerBytes));
    } catch (error) {
        throw invalidWebhook('the JWS header is not JSON', error);
    }
    if (!isRecord(jose) || jose.alg !== 'RS256') {
        throw invalidWebhook('the JWS header is not RS256');
    }
    if (typeof jose.kid !== 'string' || jose.kid === '') {
        throw invalidWebhook('the JWS header names no key');
    }
    // `crit` lists extensions a verifier must understand or refuse (RFC 7515 §4.1.11), and
    // `b64: false` (RFC 7797) would change the signing input; GoPay sends neither.
    if ('crit' in jose || 'b64' in jose) {
        throw invalidWebhook('the JWS header uses an unsupported extension');
    }
    return { protectedHeader, kid: jose.kid, signature };
}

export async function verifySignature(
    key: CryptoKey,
    parsed: ParsedSignature,
    body: Uint8Array,
): Promise<boolean> {
    const input = new TextEncoder().encode(
        `${parsed.protectedHeader}.${bytesToBase64Url(body)}`,
    );
    try {
        return await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            key,
            parsed.signature,
            input,
        );
    } catch {
        return false;
    }
}

/** Checks the fields every event has, so a known `type` can be trusted to carry its `data`. */
export function parseEvent(body: Uint8Array): GoPayEvent {
    let event: unknown;
    try {
        event = JSON.parse(utf8.decode(body));
    } catch (error) {
        throw invalidWebhook('the body is not JSON', error);
    }
    if (
        !isRecord(event) ||
        typeof event.id !== 'string' ||
        typeof event.type !== 'string' ||
        typeof event.occurred_at !== 'string' ||
        !isRecord(event.data)
    ) {
        throw invalidWebhook('the body is not an event');
    }
    return event as GoPayEvent;
}
