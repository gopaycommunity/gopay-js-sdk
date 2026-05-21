// ─── postMessage protocol ─────────────────────────────────────────────────────
// This file is intentionally duplicated between two repos. Keep both in sync:
//   gp-gw-js-sdk  ›  browser-sdk/src/modules/cards/iframe-protocol.ts
//   gw-ui-cc-v4   ›  src/iframe-protocol.ts
//
// To sync: copy-paste the entire file content between repos. Do not add
// imports, re-exports, or logic here — types and type aliases only.
// ─────────────────────────────────────────────────────────────────────────────

type Environment = 'sandbox' | 'production';

export interface CardFormConfig {
    type: 'GOPAY_CARD_FORM_INIT';
    environment: Environment;
    /** Publishable key used by the iframe for Basic auth on GET /cards/public-key. */
    publishable_key: string;
    /** Merchant OAuth client_id — embedded in the encrypted card JWE payload. */
    client_id: string;
    /** Initial theme applied before the form is first painted. */
    theme?: CardFormTheme;
    /** BCP 47 locale for the initial form labels. */
    locale?: string;
    /**
     * 'internal' (default) — iframe renders its own submit button.
     * 'external' — iframe hides the submit button; the parent controls
     *   submission via `GOPAY_CARD_REQUEST_SUBMIT` and receives validity
     *   state via `GOPAY_CARD_FORM_VALIDITY`.
     */
    submitMode?: 'internal' | 'external';
}

/**
 * Structured theme sent from the SDK to the GoPay-hosted card form iframe via
 * the `GOPAY_CARD_SET_THEME` postMessage. All fields are optional; the iframe
 * applies built-in defaults for any omitted field.
 *
 * CSS generation happens exclusively inside the iframe — never in the SDK.
 */
export interface CardFormTheme {
    // ── Typography ───────────────────────────────────────────────────────────
    /**
     * CSS font-family stack applied to all form text (labels, inputs, errors,
     * submit button). Use system font stacks to avoid loading external fonts.
     * Example: "Inter, system-ui, sans-serif"
     * Default: system-ui, sans-serif
     */
    fontFamily?: string;

    // ── Labels ───────────────────────────────────────────────────────────────
    /** Color of field labels. Default: #4b5e68 */
    labelColor?: string;
    /** Font size of field labels in px. Default: 11 */
    labelFontSize?: number;
    /** Font weight of field labels. Default: 600 */
    labelFontWeight?: number | string;
    /** Whether field labels are uppercased. Default: true */
    labelUppercase?: boolean;

    // ── Input text ───────────────────────────────────────────────────────────
    /** Color of input text. Default: #4b5e68 */
    inputTextColor?: string;
    /** Font size of input text in px. Default: 14 */
    inputFontSize?: number;

    // ── Input border ─────────────────────────────────────────────────────────
    /** Bottom border color of unfocused, valid inputs. Default: #698492 */
    inputBorderColor?: string;
    /** Border width in px. Default: 1 (underline style) */
    inputBorderWidth?: number;
    /** Background color of the input area. Default: transparent */
    inputBackgroundColor?: string;
    /** Vertical padding inside inputs in px. Default: 6 */
    inputPaddingVertical?: number;
    /** Border radius of inputs in px. Default: 0 (underline style) */
    inputBorderRadius?: number;

    // ── Focus underline gradient ──────────────────────────────────────────────
    /** Start color (left) of the animated focus underline gradient. Default: #19C7D6 */
    focusGradientStart?: string;
    /** End color (right) of the animated focus underline gradient. Default: #1899D6 */
    focusGradientEnd?: string;

    // ── Validation errors ────────────────────────────────────────────────────
    /** Border color of inputs in error state. Default: #ea3c55 */
    inputErrorBorderColor?: string;
    /** Color of error text below inputs. Default: #cc0000 */
    errorTextColor?: string;
    /** Font size of error text in px. Default: 11 */
    errorFontSize?: number;

    // ── Layout ───────────────────────────────────────────────────────────────
    /** Gap between field groups (e.g. card row vs expiry+cvv row) in px. Default: 16 */
    groupSpacing?: number;
    /** Gap between the label and input within a single field in px. Default: 4 */
    fieldSpacing?: number;
    /** Padding around the entire form in px. Default: 16 */
    formPadding?: number;
    /** Background color of the form container. Default: transparent */
    formBackgroundColor?: string;

    // ── Submit button ─────────────────────────────────────────────────────────
    /** Background color of the submit button. Default: #1899d6 */
    submitBackgroundColor?: string;
    /** Background color of the submit button on hover. Default: #1482ba */
    submitHoverBackgroundColor?: string;
    /** Background color of the submit button when disabled. Default: #a8b6bd */
    submitDisabledBackgroundColor?: string;
    /** Text color of the submit button. Default: #ffffff */
    submitTextColor?: string;
    /** Text color of the submit button when disabled. Default: #ffffff */
    submitDisabledTextColor?: string;
    /** Border radius of the submit button in px. Default: 4 */
    submitBorderRadius?: number;
    /** Font size of the submit button in px. Default: 14 */
    submitFontSize?: number;
}

export interface CardSetTheme {
    type: 'GOPAY_CARD_SET_THEME';
    theme: CardFormTheme;
}

export interface CardSetLocale {
    type: 'GOPAY_CARD_SET_LOCALE';
    /** BCP 47 language tag, e.g. "cs-CZ" or "en". Unknown locales fall back to English. */
    locale: string;
}

/** Sent by the parent to trigger form submission in external submit mode. */
export interface CardRequestSubmit {
    type: 'GOPAY_CARD_REQUEST_SUBMIT';
}

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
    | { type: 'GOPAY_CARD_FORM_HEIGHT'; height: number }
    /** Sent in external submit mode whenever the form's overall validity changes. */
    | { type: 'GOPAY_CARD_FORM_VALIDITY'; isValid: boolean };
