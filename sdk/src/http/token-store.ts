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
    private pendingRefreshToken: string | null = null;

    get(): StoredTokenPair | null {
        return this.tokens;
    }

    getRefreshToken(): string | null {
        return this.tokens?.refresh_token ?? this.pendingRefreshToken;
    }

    set(pair: Omit<StoredTokenPair, 'issued_at'>): void {
        this.pendingRefreshToken = null;
        this.tokens = { ...pair, issued_at: Date.now() };
    }

    setRefreshToken(refreshToken: string): void {
        this.tokens = null;
        this.pendingRefreshToken = refreshToken;
    }

    clear(): void {
        this.tokens = null;
        this.pendingRefreshToken = null;
    }

    hasAccessToken(): boolean {
        return this.tokens !== null;
    }

    hasPendingRefreshToken(): boolean {
        return this.pendingRefreshToken !== null;
    }

    isExpiringSoon(bufferSeconds = 30): boolean {
        if (!this.tokens) return false;
        const expiresAt = this.tokens.issued_at + this.tokens.expires_in * 1000;
        return Date.now() >= expiresAt - bufferSeconds * 1000;
    }
}
