export interface StoredTokenPair {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_expires_in: number;
    token_type: 'bearer';
    issued_at: number;
}

export function createTokenStore() {
    let tokens: StoredTokenPair | null = null;
    let clientId: string | null = null;
    /** Server-side client secret, persisted across token refreshes. Never set in browser flow. */
    let clientSecret: string | null = null;

    return {
        get(): StoredTokenPair | null {
            return tokens;
        },

        getRefreshToken(): string | null {
            return tokens?.refresh_token ?? null;
        },

        getClientId(): string | null {
            return clientId;
        },

        getClientSecret(): string | null {
            return clientSecret;
        },

        setClientSecret(id: string, secret: string): void {
            clientId = id;
            clientSecret = secret;
        },

        setClientId(id: string): void {
            clientId = id;
        },

        set(pair: Omit<StoredTokenPair, 'issued_at'>): void {
            tokens = { ...pair, issued_at: Date.now() };
        },

        clear(): void {
            tokens = null;
            clientId = null;
            clientSecret = null;
        },

        hasAccessToken(): boolean {
            return tokens !== null;
        },

        isExpiringSoon(bufferSeconds = 30): boolean {
            if (!tokens) return false;
            const expiresAt = tokens.issued_at + tokens.expires_in * 1000;
            return Date.now() >= expiresAt - bufferSeconds * 1000;
        },
    };
}

export type TokenStore = ReturnType<typeof createTokenStore>;
