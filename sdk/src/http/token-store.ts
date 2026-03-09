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

    get(): StoredTokenPair | null {
        return this.tokens;
    }

    set(pair: Omit<StoredTokenPair, 'issued_at'>): void {
        this.tokens = { ...pair, issued_at: Date.now() };
    }

    clear(): void {
        this.tokens = null;
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
