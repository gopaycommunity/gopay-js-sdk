// ─── postMessage protocol ─────────────────────────────────────────────────────
// This file is intentionally duplicated between two repos. Keep both in sync:
//   gp-gw-js-sdk  ›  sdk/src/modules/cards/iframe-protocol.ts
//   gw-ui-cc-v4   ›  src/iframe-protocol.ts
//
// To sync: copy-paste the entire file content between repos. Do not add
// imports, re-exports, or logic here — types and type aliases only.
// ─────────────────────────────────────────────────────────────────────────────

export type Environment = 'sandbox' | 'production';

export interface CardFormConfig {
    type: 'GOPAY_CARD_FORM_INIT';
    environment: Environment;
    access_token: string;
    refresh_token: string;
    /** Seconds until access_token expires */
    expires_in: number;
    /** Seconds until refresh_token expires */
    refresh_expires_in: number;
    client_id: string;
}

export interface CardSetStyles {
    type: 'GOPAY_CARD_SET_STYLES';
    styles: string;
}

export interface CardFormLabels {
    cardNumber: string;
    expiry: string;
    cvv: string;
    cardNumberPlaceholder: string;
    expiryPlaceholder: string;
    cvvPlaceholder: string;
    pay: string;
    invalidCardNumber: string;
    invalidExpiry: string;
    invalidCvv: string;
}

export interface CardSetLabels {
    type: 'GOPAY_CARD_SET_LABELS';
    labels: CardFormLabels;
}

export type InboundMessage = CardFormConfig | CardSetStyles | CardSetLabels;

export type EncryptErrorCode =
    | 'PUBLIC_KEY_FETCH_FAILED'
    | 'KEY_IMPORT_FAILED'
    | 'ENCRYPTION_FAILED'
    | 'INIT_FAILED';

export type OutboundMessage =
    | { type: 'GOPAY_CARD_ENCRYPT_READY' }
    | { type: 'GOPAY_CARD_ENCRYPT_RESULT'; card_token: string }
    | {
          type: 'GOPAY_CARD_ENCRYPT_ERROR';
          error: string;
          code: EncryptErrorCode;
      }
    | { type: 'GOPAY_CARD_FORM_HEIGHT'; height: number };
