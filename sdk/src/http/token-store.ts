export interface StoredTokenPair {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_expires_in: number;
    token_type: 'bearer';
    issued_at: number;
}

export class TokenStore {
    private tokens: StoredTokenPair | null = null;
    private clientId: string | null = null;
    /** Server-side client secret, persisted across token refreshes. Never set in browser flow. */
    private clientSecret: string | null = null;

    get(): StoredTokenPair | null {
        return this.tokens;
    }

    getRefreshToken(): string | null {
        return this.tokens?.refresh_token ?? null;
    }

    getClientId(): string | null {
        return this.clientId;
    }

    getClientSecret(): string | null {
        return this.clientSecret;
    }

    setClientSecret(clientId: string, clientSecret: string): void {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    setClientId(clientId: string): void {
        this.clientId = clientId;
    }

    set(pair: Omit<StoredTokenPair, 'issued_at'>): void {
        this.tokens = { ...pair, issued_at: Date.now() };
    }

    clear(): void {
        this.tokens = null;
        this.clientId = null;
        this.clientSecret = null;
    }

    hasAccessToken(): boolean {
        return this.tokens !== null;
    }

    isExpiringSoon(bufferSeconds = 30): boolean {
        if (!this.tokens) return false;
        const expiresAt = this.tokens.issued_at + this.tokens.expires_in * 1000;
        return Date.now() >= expiresAt - bufferSeconds * 1000;
    }
}
