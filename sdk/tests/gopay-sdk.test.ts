import { describe, expect, it } from 'vitest';
import { GoPaySDK } from '../src/index.js';

describe('GoPaySDK', () => {
  it('instantiates with default config', () => {
    const sdk = new GoPaySDK();
    expect(sdk).toBeInstanceOf(GoPaySDK);
  });

  it('exposes all sub-modules', () => {
    const sdk = new GoPaySDK({ environment: 'sandbox' });
    expect(sdk.auth).toBeDefined();
    expect(sdk.payments).toBeDefined();
    expect(sdk.cards).toBeDefined();
    expect(sdk.encryption).toBeDefined();
  });

  describe('AuthModule', () => {
    it('exposes authenticate()', () => {
      const sdk = new GoPaySDK();
      expect(typeof sdk.auth.authenticate).toBe('function');
    });

    it('authenticate() throws Not implemented', async () => {
      const sdk = new GoPaySDK();
      await expect(
        sdk.auth.authenticate({ grant_type: 'client_credentials', scope: 'payment:create' }),
      ).rejects.toThrow('Not implemented');
    });
  });

  describe('EncryptionModule', () => {
    it('exposes fetchPublicKey()', () => {
      const sdk = new GoPaySDK();
      expect(typeof sdk.encryption.fetchPublicKey).toBe('function');
    });

    it('fetchPublicKey() throws Not implemented', async () => {
      const sdk = new GoPaySDK();
      await expect(sdk.encryption.fetchPublicKey()).rejects.toThrow('Not implemented');
    });
  });

  describe('CardsModule', () => {
    it('exposes createToken()', () => {
      const sdk = new GoPaySDK();
      expect(typeof sdk.cards.createToken).toBe('function');
    });

    it('createToken() throws Not implemented', async () => {
      const sdk = new GoPaySDK();
      await expect(sdk.cards.createToken({ payload: 'encrypted' })).rejects.toThrow(
        'Not implemented',
      );
    });
  });

  describe('PaymentsModule', () => {
    const paymentMethods = [
      'create',
      'charge',
      'getGooglePayInfo',
      'getApplePayInfo',
      'validateApplePayMerchant',
    ] as const;

    it.each(paymentMethods)('exposes %s()', (method) => {
      const sdk = new GoPaySDK();
      expect(typeof sdk.payments[method]).toBe('function');
    });

    it('create() throws Not implemented', async () => {
      const sdk = new GoPaySDK();
      await expect(
        sdk.payments.create('test-goid', {
          amount: 1000,
          currency: 'CZK',
          order_number: 'ORDER-001',
          customer: { email: 'test@example.com' },
          callback: {
            notification_url: 'https://example.com/notify',
            return_url: 'https://example.com/return',
          },
        }),
      ).rejects.toThrow('Not implemented');
    });

    it('charge() throws Not implemented', async () => {
      const sdk = new GoPaySDK();
      await expect(
        sdk.payments.charge('payment-123', {
          payment_instrument: {
            payment_instrument: 'PAYMENT_CARD',
            input_type: 'CARD_TOKEN',
            input: { input_type: 'CARD_TOKEN', card_token: 'tok_123' },
          },
          return_url: 'https://example.com/return',
        }),
      ).rejects.toThrow('Not implemented');
    });

    it('getGooglePayInfo() throws Not implemented', async () => {
      const sdk = new GoPaySDK();
      await expect(sdk.payments.getGooglePayInfo('payment-123')).rejects.toThrow('Not implemented');
    });

    it('getApplePayInfo() throws Not implemented', async () => {
      const sdk = new GoPaySDK();
      await expect(sdk.payments.getApplePayInfo('payment-123')).rejects.toThrow('Not implemented');
    });

    it('validateApplePayMerchant() throws Not implemented', async () => {
      const sdk = new GoPaySDK();
      await expect(
        sdk.payments.validateApplePayMerchant('payment-123', 'https://shop.example.com'),
      ).rejects.toThrow('Not implemented');
    });
  });
});
