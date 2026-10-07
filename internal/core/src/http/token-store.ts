export interface StoredTokenPair {
    access_token: string;
    expires_in: number;
    token_type: 'bearer';
    issued_at: number;
}

/**
 * What the browser SDK exchanges for a payment-scoped token. The token lives
 * fifteen minutes and the grant issues no refresh token, so re-running this
 * exchange is the only way to keep a long checkout authenticated — the same
 * thing the iOS and Android SDKs do. Held in memory only, for as long as the
 * payment stays attached.
 */
export interface PaymentCredentials {
    paymentId: string;
    paymentSecret: string;
    scope: string;
}

export function createTokenStore() {
    let tokens: StoredTokenPair | null = null;
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    let scope: string | null = null;
    let paymentCredentials: PaymentCredentials | null = null;

    return {
        get(): StoredTokenPair | null {
            return tokens;
        },

        getClientId(): string | null {
            return clientId;
        },

        getClientSecret(): string | null {
            return clientSecret;
        },

        getScope(): string | null {
            return scope;
        },

        setClientSecret(id: string, secret: string, tokenScope?: string): void {
            clientId = id;
            clientSecret = secret;
            scope = tokenScope ?? null;
            tokens = null;
        },

        getPaymentCredentials(): PaymentCredentials | null {
            return paymentCredentials;
        },

        setPaymentCredentials(credentials: PaymentCredentials | null): void {
            paymentCredentials = credentials;
        },

        setClientId(id: string): void {
            clientId = id;
            clientSecret = null;
            scope = null;
            tokens = null;
        },

        set(pair: Omit<StoredTokenPair, 'issued_at'>): void {
            tokens = { ...pair, issued_at: Date.now() };
        },

        /** Drop the access token alone, keeping whatever can obtain another. */
        clearToken(): void {
            tokens = null;
        },

        clear(): void {
            tokens = null;
            clientId = null;
            clientSecret = null;
            scope = null;
            paymentCredentials = null;
        },

        hasAccessToken(): boolean {
            return tokens !== null;
        },

        isExpiringSoon(bufferSeconds = 30): boolean {
            if (!tokens) {
                return false;
            }
            const expiresAt = tokens.issued_at + tokens.expires_in * 1000;
            return Date.now() >= expiresAt - bufferSeconds * 1000;
        },
    };
}

export type TokenStore = ReturnType<typeof createTokenStore>;
