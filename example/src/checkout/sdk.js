import { createGoPaySDK } from '@gopaycz/gopay-js-sdk';
import {
    clientId as _clientId,
    clientSecret as _clientSecret,
    goid as _goid,
    shareableKey as _shareableKey,
} from '../sdk.js';

export const clientId = _clientId ?? 'SDK';
export const clientSecret = _clientSecret ?? 'cs_rGs9t5mV';
export const goid = _goid ?? '8761908826';
export const shareableKey =
    _shareableKey ?? 'sk_TyN57UuHPdu9hKdR3fEu5HRLTMYr33Qv';

const baseUrl =
    window._gpConfig?.baseUrl ??
    import.meta.env.GP_GW_JS_SDK_BASE_URL ??
    'https://gw.jmuller.dev.gopay.com/api/merchant/payments/4.0';

export const sdk = createGoPaySDK({ baseUrl });
