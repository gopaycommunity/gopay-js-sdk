export type {
    BrowserData,
    BrowserDataDetected,
    GoPayEnvironment,
} from '@gopay-internal/core';

import type { CardMetadata } from '../modules/cards/iframe-protocol.js';

/** Encrypted card payload returned by mountCardForm with flow: 'return-payload' */
export interface EncryptedCardPayload {
    encryptedPayload: string;
}

/**
 * Encrypted card payload and the card's BIN details, returned by mountCardForm
 * with flow: 'payload-with-metadata'.
 */
export interface EncryptedCardPayloadWithMetadata extends EncryptedCardPayload {
    /**
     * What GoPay knows about the card from the first eight digits of its
     * number, or `null` when the lookup failed, timed out or GoPay knows
     * nothing of the BIN (it answers only for Visa and Mastercard).
     */
    cardMetadata: CardMetadata | null;
}
