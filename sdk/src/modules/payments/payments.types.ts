import type {
  AdditionalParam,
  BankAccountInputType,
  Callback,
  CardScheme,
  CardServiceType,
  ChargeState,
  Currency,
  Customer,
  PaymentCardInputType,
  PaymentChargeActionType,
  PaymentInstrument,
  PaymentState,
} from '../../types/common.js';

// ---------------------------------------------------------------------------
// POST /eshops/{goid}/payments — Create a payment
// ---------------------------------------------------------------------------

export interface PaymentCreateRequest {
  /** Total amount in the smallest currency unit (e.g. cents) */
  amount: number;
  currency: Currency;
  /** Merchant-assigned order reference, max 128 chars */
  order_number: string;
  order_description?: string;
  customer: Customer;
  callback: Callback;
  /** Up to 4 custom key-value pairs */
  additional_params?: AdditionalParam[];
}

export interface PaymentCreateResponse {
  /** Payment session ID */
  id: string;
  order_number: string;
  state: PaymentState;
  amount: number;
  currency: Currency;
  customer: Customer;
  /** Gateway URL — redirect customer here to present the payment page */
  gw_url: string;
}

// ---------------------------------------------------------------------------
// POST /payments/{payment_id}/charge — Charge a payment
// ---------------------------------------------------------------------------

// --- Card charge inputs ---

export interface CardTokenInput {
  input_type: 'CARD_TOKEN';
  card_token: string;
  challenge_preference?: 'CHALLENGE_PREFERRED' | 'NO_CHALLENGE_PREFERRED' | 'AUTO';
}

export interface GooglePayInput {
  input_type: 'GOOGLE_PAY';
  signature: string;
  protocolVersion: string;
  signedMessage: string;
}

export interface ApplePayInput {
  input_type: 'APPLE_PAY';
  data: string;
  signature: string;
  version: string;
  header: Record<string, string>;
}

export type PaymentCardInput = CardTokenInput | GooglePayInput | ApplePayInput;

export interface PaymentCardChargeData {
  payment_instrument: 'PAYMENT_CARD';
  input_type: PaymentCardInputType;
  input: PaymentCardInput;
}

// --- Bank account charge inputs ---

export interface BankAccountTokenInput {
  input_type: 'ACCOUNT_TOKEN';
  account_token: string;
}

export interface BankAccountIbanInput {
  input_type: 'IBAN';
  iban: string;
  bic?: string;
  account_name?: string;
}

export interface BankAccountSwiftInput {
  input_type: 'SWIFT';
  swift: string;
  account_number: string;
  account_name?: string;
  bank_code?: string;
}

export type BankAccountInput = BankAccountTokenInput | BankAccountIbanInput | BankAccountSwiftInput;

export interface BankAccountChargeData {
  payment_instrument: 'BANK_ACCOUNT';
  input_type: BankAccountInputType;
  input: BankAccountInput;
}

// --- Top-level charge request ---

export interface PaymentChargeRequest {
  payment_instrument: PaymentCardChargeData | BankAccountChargeData;
  return_url: string;
}

// --- Charge response ---

export interface PaymentChargeAction {
  action_type: PaymentChargeActionType;
  state: ChargeState;
  redirect_url?: string;
}

export interface PaymentCardDataDetails {
  masked_pan?: string;
  expiration_month?: string;
  expiration_year?: string;
  scheme?: CardScheme;
  fingerprint?: string;
  card_id?: string;
  service_type?: CardServiceType;
}

export interface PaymentCardInstrumentData {
  payment_instrument: 'PAYMENT_CARD';
  details?: PaymentCardDataDetails;
}

export interface BankAccountDataDetails {
  iban?: string;
  bic?: string;
  account_name?: string;
}

export interface BankAccountInstrumentData {
  payment_instrument: 'BANK_ACCOUNT';
  details?: BankAccountDataDetails;
}

export type PaymentInstrumentData = PaymentCardInstrumentData | BankAccountInstrumentData;

export interface PaymentChargeResponse {
  id: string;
  state: ChargeState;
  payment_instrument: PaymentInstrumentData;
  return_url: string;
  action?: PaymentChargeAction;
}

// ---------------------------------------------------------------------------
// GET /payments/{payment_id}/info/google-pay
// ---------------------------------------------------------------------------

export interface GooglePayAllowedPaymentMethod {
  type: string;
  parameters: {
    allowedAuthMethods: string[];
    allowedCardNetworks: string[];
  };
  tokenizationSpecification: {
    type: string;
    parameters: Record<string, string>;
  };
}

export interface GooglePayTransactionInfo {
  currencyCode: string;
  countryCode: string;
  totalPrice: string;
  totalPriceStatus: string;
}

export interface GooglePayMerchantInfo {
  merchantName: string;
  merchantId: string;
}

export interface GooglePayInfoResponse {
  environment: 'PRODUCTION' | 'TEST';
  paymentDataRequest: {
    apiVersion: number;
    apiVersionMinor: number;
    allowedPaymentMethods: GooglePayAllowedPaymentMethod[];
    transactionInfo: GooglePayTransactionInfo;
    merchantInfo: GooglePayMerchantInfo;
    emailRequired?: boolean;
  };
}

// ---------------------------------------------------------------------------
// GET /payments/{payment_id}/apple-pay/info
// ---------------------------------------------------------------------------

export interface ApplePayPaymentRequest {
  merchantCapabilities: string[];
  supportedNetworks: string[];
  countryCode: string;
  currencyCode: string;
  requiredBillingContactFields?: string[];
  requiredShippingContactFields?: string[];
  applicationData?: string;
  total: {
    label: string;
    amount: string;
    type: string;
  };
}

export interface ApplePayInfoResponse {
  applepayVersion: number;
  merchantDisplayName: string;
  merchantIdentifier: string;
  applePayPaymentRequest: ApplePayPaymentRequest;
}

// ---------------------------------------------------------------------------
// POST /payments/{payment_id}/apple-pay/validate
// ---------------------------------------------------------------------------

export interface ValidateMerchantResponse {
  epochTimestamp: number;
  expiresAt: number;
  merchantSessionIdentifier: string;
  nonce: string;
  merchantIdentifier: string;
  domainName: string;
  displayName: string;
  signature: string;
}

// Re-export PaymentInstrument so modules importing from payments.types get it
export type { PaymentInstrument };
