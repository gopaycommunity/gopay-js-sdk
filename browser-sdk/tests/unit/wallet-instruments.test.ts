import { describe, expect, it } from 'vitest';
import { GoPayErrorCodes, GoPaySDKError } from '../../src/errors.js';
import {
    extractApplePayInstrument,
    extractGooglePayInstrument,
} from '../../src/modules/wallets/wallet-instruments.js';

const applePayData = {
    data: 'V7OcjttPJnUJaQH7x7OjbIeZSINuc==',
    signature: 'MIAGCSqGSIb3DQEHAqCAM==',
    version: 'EC_v1',
    header: {
        ephemeralPublicKey: 'MFkwEwYHKoZIzj==',
        publicKeyHash: 'L6vppo38t31Q/9npxRy/xbA1+cs13h1LV+pMO/FYwvo=',
        transactionId: '4f4fac7a1a6a8ba2c0e8c5',
    },
};

describe('extractApplePayInstrument()', () => {
    it('sets payment_instrument to PAYMENT_CARD', () => {
        const result = extractApplePayInstrument(applePayData);
        expect(result.payment_instrument).toBe('PAYMENT_CARD');
    });

    it('sets input_type to APPLE_PAY', () => {
        const result = extractApplePayInstrument(applePayData);
        expect(result.input?.input_type).toBe('APPLE_PAY');
    });

    it('forwards data, signature, version, and header fields', () => {
        const result = extractApplePayInstrument(applePayData);
        const input = result.input as typeof applePayData & {
            input_type: string;
        };
        expect(input.data).toBe(applePayData.data);
        expect(input.signature).toBe(applePayData.signature);
        expect(input.version).toBe(applePayData.version);
        expect(input.header).toEqual(applePayData.header);
    });
});

describe('extractGooglePayInstrument()', () => {
    it('sets payment_instrument to PAYMENT_CARD', () => {
        const token = JSON.stringify({
            protocolVersion: 'ECv2',
            signature: 'sig==',
            signedMessage: '{"encryptedMessage":"enc=="}',
        });
        const result = extractGooglePayInstrument({
            tokenizationData: { token },
        });
        expect(result.payment_instrument).toBe('PAYMENT_CARD');
    });

    it('sets input_type to GOOGLE_PAY', () => {
        const token = JSON.stringify({
            protocolVersion: 'ECv2',
            signature: 'sig==',
            signedMessage: '{"encryptedMessage":"enc=="}',
        });
        const result = extractGooglePayInstrument({
            tokenizationData: { token },
        });
        expect(result.input?.input_type).toBe('GOOGLE_PAY');
    });

    it('forwards protocolVersion, signature, and signedMessage', () => {
        const tokenData = {
            protocolVersion: 'ECv2',
            signature: 'sig==',
            signedMessage: '{"encryptedMessage":"enc=="}',
        };
        const result = extractGooglePayInstrument({
            tokenizationData: { token: JSON.stringify(tokenData) },
        });
        const input = result.input as Record<string, unknown>;
        expect(input.protocolVersion).toBe('ECv2');
        expect(input.signature).toBe('sig==');
        expect(input.signedMessage).toBe('{"encryptedMessage":"enc=="}');
    });

    it('includes intermediateSigningKey when present in token', () => {
        const tokenData = {
            protocolVersion: 'ECv2',
            signature: 'sig==',
            intermediateSigningKey: {
                signedKey: '{"keyValue":"key=="}',
                signatures: ['isig=='],
            },
            signedMessage: '{"encryptedMessage":"enc=="}',
        };
        const result = extractGooglePayInstrument({
            tokenizationData: { token: JSON.stringify(tokenData) },
        });
        const input = result.input as Record<string, unknown>;
        expect(input.intermediateSigningKey).toEqual(
            tokenData.intermediateSigningKey,
        );
    });

    it('omits intermediateSigningKey when absent from token', () => {
        const tokenData = {
            protocolVersion: 'ECv1',
            signature: 'sig==',
            signedMessage: '{"encryptedMessage":"enc=="}',
        };
        const result = extractGooglePayInstrument({
            tokenizationData: { token: JSON.stringify(tokenData) },
        });
        const input = result.input as Record<string, unknown>;
        expect('intermediateSigningKey' in input).toBe(false);
    });

    it('throws GoPaySDKError with WALLET_BUTTON_ERROR when token is not valid JSON', () => {
        expect(() =>
            extractGooglePayInstrument({
                tokenizationData: { token: 'not-json' },
            }),
        ).toThrow(GoPaySDKError);
        expect(() =>
            extractGooglePayInstrument({
                tokenizationData: { token: 'not-json' },
            }),
        ).toThrow(
            expect.objectContaining({
                errorCode: GoPayErrorCodes.WALLET_BUTTON_ERROR,
            }),
        );
    });
});
