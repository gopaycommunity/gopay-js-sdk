import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectBrowserData } from '../../src/modules/payments/browser-data.js';

const mockNavigator = {
    language: 'cs-CZ',
    userAgent:
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
};

const mockScreen = {
    width: 434,
    height: 965,
    colorDepth: 24,
};

describe('collectBrowserData()', () => {
    beforeEach(() => {
        vi.stubGlobal('navigator', mockNavigator);
        vi.stubGlobal('screen', mockScreen);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns an empty object when navigator is undefined', () => {
        vi.stubGlobal('navigator', undefined);
        expect(collectBrowserData()).toEqual({});
    });

    it('collects language from navigator.language', () => {
        expect(collectBrowserData().language).toBe('cs-CZ');
    });

    it('collects user_agent from navigator.userAgent', () => {
        expect(collectBrowserData().user_agent).toBe(mockNavigator.userAgent);
    });

    it('collects screen dimensions and color depth', () => {
        const data = collectBrowserData();
        expect(data.screen_width).toBe(434);
        expect(data.screen_height).toBe(965);
        expect(data.color_depth).toBe(24);
    });

    it('collects timezone offset from Date', () => {
        const offset = new Date().getTimezoneOffset();
        expect(collectBrowserData().timezone).toBe(offset);
    });

    it('always sets javascript_enabled to true', () => {
        expect(collectBrowserData().javascript_enabled).toBe(true);
    });

    it('always sets java_enabled to false', () => {
        expect(collectBrowserData().java_enabled).toBe(false);
    });

    it('does not include ip or accept_header', () => {
        const data = collectBrowserData();
        expect(data).not.toHaveProperty('ip');
        expect(data).not.toHaveProperty('accept_header');
    });
});
