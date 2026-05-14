import type { components } from './generated.js';

/** Browser context data collected for 3DS / fraud detection. */
export type BrowserData = components['schemas']['Browser-Data'] & {
    ip?: string;
};

export type { GoPayEnvironment } from '@gopay-internal/core';

/** Encrypted card payload returned by mountCardForm with flow: 'return-payload' */
export interface EncryptedCardPayload {
    encryptedPayload: string;
}
