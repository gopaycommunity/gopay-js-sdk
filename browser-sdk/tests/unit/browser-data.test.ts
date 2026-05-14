import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectBrowserData } from '../../src/modules/payments/browser-data.js';

describe('collectBrowserData()', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns empty object when navigator is undefined', () => {
        vi.stubGlobal('navigator', undefined);
        expect(collectBrowserData()).toEqual({});
    });

    it('sets javascript_enabled to true', () => {
        const data = collectBrowserData();
        expect(data.javascript_enabled).toBe(true);
    });

    it('reads language from navigator.language', () => {
        vi.stubGlobal('navigator', {
            ...navigator,
            language: 'cs-CZ',
            userAgent: 'Agent',
        });
        expect(collectBrowserData().language).toBe('cs-CZ');
    });

    it('reads user_agent from navigator.userAgent', () => {
        vi.stubGlobal('navigator', {
            language: 'en',
            userAgent: 'TestBrowser/3.0',
        });
        expect(collectBrowserData().user_agent).toBe('TestBrowser/3.0');
    });

    it('returns timezone offset as a number', () => {
        expect(typeof collectBrowserData().timezone).toBe('number');
    });

    it('includes screen dimensions when screen is available', () => {
        const data = collectBrowserData();
        expect(typeof data.screen_width).toBe('number');
        expect(typeof data.screen_height).toBe('number');
        expect(typeof data.color_depth).toBe('number');
    });

    it('omits screen fields when screen is undefined', () => {
        vi.stubGlobal('screen', undefined);
        const data = collectBrowserData();
        expect(data.screen_width).toBeUndefined();
        expect(data.screen_height).toBeUndefined();
        expect(data.color_depth).toBeUndefined();
    });
});
