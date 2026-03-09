import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../src/http/token-store.js';

const pair = {
    access_token: 'at',
    refresh_token: 'rt',
    expires_in: 900,
    refresh_expires_in: 86400,
    token_type: 'bearer' as const,
};

describe('TokenStore', () => {
    it('starts empty', () => {
        const store = new TokenStore();
        expect(store.get()).toBeNull();
        expect(store.hasAccessToken()).toBe(false);
    });

    it('stores and retrieves a token pair', () => {
        const store = new TokenStore();
        store.set(pair);
        expect(store.get()).toMatchObject(pair);
        expect(store.hasAccessToken()).toBe(true);
    });

    it('stamps issued_at on set', () => {
        const before = Date.now();
        const store = new TokenStore();
        store.set(pair);
        const after = Date.now();
        const issuedAt = store.get()?.issued_at ?? 0;
        expect(issuedAt).toBeGreaterThanOrEqual(before);
        expect(issuedAt).toBeLessThanOrEqual(after);
    });

    it('clears tokens', () => {
        const store = new TokenStore();
        store.set(pair);
        store.clear();
        expect(store.get()).toBeNull();
        expect(store.hasAccessToken()).toBe(false);
    });

    it('overwrites with a new pair', () => {
        const store = new TokenStore();
        store.set(pair);
        const updated = { ...pair, access_token: 'at2' };
        store.set(updated);
        expect(store.get()?.access_token).toBe('at2');
    });

    // -------------------------------------------------------------------------
    // isExpiringSoon()
    // -------------------------------------------------------------------------

    describe('isExpiringSoon()', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('returns false when store is empty', () => {
            const store = new TokenStore();
            expect(store.isExpiringSoon()).toBe(false);
        });

        it('returns false when token has plenty of time left', () => {
            const store = new TokenStore();
            store.set(pair); // issued_at = 0 (fake time)
            vi.advanceTimersByTime(1_000); // 1 second elapsed
            expect(store.isExpiringSoon()).toBe(false);
        });

        it('returns true when within default 30s buffer', () => {
            const store = new TokenStore();
            store.set(pair); // expires_in = 900s
            vi.advanceTimersByTime(871_000); // 871s elapsed → 29s left
            expect(store.isExpiringSoon()).toBe(true);
        });

        it('returns false when 1ms before the buffer boundary', () => {
            const store = new TokenStore();
            store.set(pair);
            vi.advanceTimersByTime(869_999); // 1ms before buffer starts
            expect(store.isExpiringSoon()).toBe(false);
        });

        it('returns true when exactly at the buffer boundary', () => {
            const store = new TokenStore();
            store.set(pair);
            vi.advanceTimersByTime(870_000); // exactly 30s left
            expect(store.isExpiringSoon()).toBe(true);
        });

        it('returns true when token is already expired', () => {
            const store = new TokenStore();
            store.set(pair);
            vi.advanceTimersByTime(901_000); // past expiry
            expect(store.isExpiringSoon()).toBe(true);
        });

        it('respects a custom buffer', () => {
            const store = new TokenStore();
            store.set(pair); // expires_in = 900s
            vi.advanceTimersByTime(841_000); // 59s left
            expect(store.isExpiringSoon(60)).toBe(true);
            expect(store.isExpiringSoon(30)).toBe(false);
        });
    });
});
