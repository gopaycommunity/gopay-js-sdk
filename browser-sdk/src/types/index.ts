export type {
    BrowserData,
    BrowserDataDetected,
    BrowserDeviceData,
    GoPayEnvironment,
} from '@gopay-internal/core';

/** Encrypted card payload returned by mountCardForm with flow: 'return-payload' */
export interface EncryptedCardPayload {
    encryptedPayload: string;
}
