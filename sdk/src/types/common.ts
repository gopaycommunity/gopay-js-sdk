// ---------------------------------------------------------------------------
// Shared enums and value objects derived from the GoPay Payments API v4.0
// ---------------------------------------------------------------------------

export type GoPayEnvironment = 'sandbox' | 'production';

export type TokenScope = 'card:save' | 'card:read' | 'payment:create' | 'payment:read';

export type Currency =
  | 'CZK'
  | 'EUR'
  | 'USD'
  | 'GBP'
  | 'HUF'
  | 'PLN'
  | 'RON'
  | 'HRK'
  | 'BGN'
  | string; // allow unlisted codes

export type PaymentInstrument = 'PAYMENT_CARD' | 'BANK_ACCOUNT';

export type CardScheme = 'VISA' | 'MASTERCARD' | 'MAESTRO' | 'AMEX' | 'DINERS' | 'JCB' | string;

export type CardServiceType = 'DEBIT' | 'CREDIT' | 'PREPAID' | string;

export type BankAccountInputType = 'ACCOUNT_TOKEN' | 'IBAN' | 'SWIFT';

export type PaymentCardInputType = 'CARD_TOKEN' | 'APPLE_PAY' | 'GOOGLE_PAY';

export type PaymentChargeActionType = 'EMV3DS' | 'PSD2' | 'REDIRECT' | string;

export type ChargeState = 'CREATED' | 'REQUESTED' | 'PAID' | 'FAILED' | string;

export type PaymentState =
  | 'CREATED'
  | 'PAYMENT_METHOD_CHOSEN'
  | 'PAID'
  | 'AUTHORIZED'
  | 'CANCELED'
  | 'TIMEOUTED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | string;

export interface Customer {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  city?: string;
  street?: string;
  postal_code?: string;
  country_code?: string;
  customer_id?: string;
}

export interface AdditionalParam {
  name: string;
  value: string;
}

export interface Callback {
  notification_url: string;
  return_url: string;
}
