import { BASE_URLS, type CoreConfig } from '../config.js';

export function resolveBaseUrl(
    config: Pick<CoreConfig, 'baseUrl' | 'environment'>,
): string {
    const rawBaseUrl =
        config.baseUrl ?? BASE_URLS[config.environment ?? 'sandbox'];

    if (config.baseUrl) {
        let parsed: URL;
        try {
            parsed = new URL(config.baseUrl);
        } catch {
            throw new Error(
                `[GoPaySDK] config.baseUrl is not a valid URL: "${config.baseUrl}"`,
            );
        }
        const isLocalhost =
            parsed.hostname === 'localhost' ||
            parsed.hostname === '127.0.0.1' ||
            parsed.hostname === '::1';
        const isInsecureAllowed =
            (config.environment ?? 'sandbox') === 'sandbox' && isLocalhost;
        if (parsed.protocol !== 'https:' && !isInsecureAllowed) {
            throw new Error(
                `[GoPaySDK] config.baseUrl must use HTTPS. Got "${config.baseUrl}". ` +
                    `Plain HTTP is only permitted for localhost in the sandbox environment.`,
            );
        }
    }

    return rawBaseUrl;
}

/** Concatenates a path onto a base URL, normalising leading/trailing slashes. */
export function buildUrl(baseUrl: string, path: string): string {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const relative = path.startsWith('/') ? path.slice(1) : path;
    return new URL(relative, base).toString();
}
