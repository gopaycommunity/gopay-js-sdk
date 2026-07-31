import {
    GoPayErrorCodes,
    GoPaySDKError,
    SDK_ACCEPT_HEADER,
} from '@gopay-internal/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectBrowserData } from '../../src/modules/payments/browser-data.js';

describe('collectBrowserData()', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('throws INVALID_CONFIG when navigator is undefined', () => {
        vi.stubGlobal('navigator', undefined);
        expect(() => collectBrowserData()).toThrow(GoPaySDKError);
        expect(() => collectBrowserData()).toThrow(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.INVALID_CONFIG,
            }),
        );
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

    it('throws INVALID_CONFIG when screen is undefined', () => {
        vi.stubGlobal('screen', undefined);
        expect(() => collectBrowserData()).toThrow(GoPaySDKError);
        expect(() => collectBrowserData()).toThrow(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.INVALID_CONFIG,
            }),
        );
    });

    describe('accept_header', () => {
        it('is a JSON-encoded object with accept, accept-encoding and accept-language', () => {
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(Object.keys(parsed).sort()).toEqual([
                'accept',
                'accept-encoding',
                'accept-language',
            ]);
        });

        it('reports the Accept header the SDK sends on its own requests', () => {
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed.accept).toBe('application/json');
            expect(parsed.accept).toBe(SDK_ACCEPT_HEADER);
        });

        it('derives accept-language from navigator.languages with q-values', () => {
            vi.stubGlobal('navigator', {
                language: 'cs-CZ',
                languages: ['cs-CZ', 'cs', 'en'],
                userAgent: 'Agent',
            });
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed['accept-language']).toBe('cs-CZ,cs;q=0.9,en;q=0.8');
        });

        it('falls back to navigator.language when navigator.languages is unavailable', () => {
            vi.stubGlobal('navigator', {
                language: 'cs-CZ',
                userAgent: 'Agent',
            });
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed['accept-language']).toBe('cs-CZ');
        });

        it('never emits a q-value below 0.1', () => {
            const languages = Array.from({ length: 12 }, (_, i) => `l${i}`);
            vi.stubGlobal('navigator', {
                language: 'l0',
                languages,
                userAgent: 'Agent',
            });
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed['accept-language'].endsWith('l11;q=0.1')).toBe(true);
        });

        it('reports the documented accept-encoding approximation', () => {
            const parsed = JSON.parse(collectBrowserData().accept_header);
            expect(parsed['accept-encoding']).toBe('gzip, deflate, br, zstd');
        });
    });
});
