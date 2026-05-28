export interface StoredTokenPair {
    access_token: string;
    expires_in: number;
    token_type: 'bearer';
    issued_at: number;
}

export function createTokenStore() {
    let tokens: StoredTokenPair | null = null;
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    let scope: string | null = null;

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

        setClientId(id: string): void {
            clientId = id;
            clientSecret = null;
            scope = null;
            tokens = null;
        },

        set(pair: Omit<StoredTokenPair, 'issued_at'>): void {
            tokens = { ...pair, issued_at: Date.now() };
        },

        clear(): void {
            tokens = null;
            clientId = null;
            clientSecret = null;
            scope = null;
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
