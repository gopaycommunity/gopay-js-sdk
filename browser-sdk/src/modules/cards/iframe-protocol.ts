// ─── postMessage protocol ─────────────────────────────────────────────────────
// This file is intentionally duplicated between two repos. Keep both in sync:
//   gp-gw-js-sdk  ›  browser-sdk/src/modules/cards/iframe-protocol.ts
//   gw-ui-cc-v4   ›  src/iframe-protocol.ts
//
// To sync: copy-paste the entire file content between repos. Do not add
// imports, re-exports, or logic here — types and type aliases only.
// ─────────────────────────────────────────────────────────────────────────────

export type Environment = 'sandbox' | 'production';

export interface CardFormConfig {
    type: 'GOPAY_CARD_FORM_INIT';
    environment: Environment;
    /** Shareable key used by the iframe for Basic auth on GET /cards/public-key. */
    shareable_key: string;
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
     * submit button).
     *
     * Only names are accepted, so the usable fonts are the ones already present
     * on the cardholder's system. The card form deliberately provides no way to
     * supply a font file or a URL: a URL would need the form's CSP to permit
     * arbitrary hosts and makes `@font-face` `unicode-range` a channel that
     * reports which characters were rendered in the card fields, and a file
     * would feed attacker-controlled binary to the browser's font parser inside
     * the cardholder-data environment. Neither is worth a typeface.
     *
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
    /**
     * Line height of field labels in px. Left unset the browser derives it from
     * the font metrics, which makes the label box a couple of pixels taller than
     * a design that states one — MUI's own field label is 12px on 12.
     * Default: unset
     */
    labelLineHeight?: number;
    /** Whether field labels are uppercased. Default: true */
    labelUppercase?: boolean;
    /**
     * Letter spacing of field labels, in px. Left unset, the historical
     * `0.06em` is kept — an em value, so it tracks the label font size; supply a
     * number only if a fixed px spacing is wanted instead.
     */
    labelLetterSpacing?: number;
    /**
     * Hides labels visually while keeping them in the DOM and in the
     * accessibility tree, so screen readers still announce each field. They
     * occupy no vertical space. Default: false
     */
    labelHidden?: boolean;

    // ── Input text ───────────────────────────────────────────────────────────
    /** Color of input text. Default: #4b5e68 */
    inputTextColor?: string;
    /** Font size of input text in px. Default: 14 */
    inputFontSize?: number;
    /**
     * Font weight of input text. Left unset the value renders at the browser's
     * default, so a form whose design asks for a semibold value could not have
     * one — the label had a weight of its own and the value did not.
     * Default: unset
     */
    inputFontWeight?: number | string;
    /**
     * Line height of input text in px. Setting it together with `inputHeight`
     * makes the field height deterministic; left unset, each browser derives it
     * from the font metrics and the rendered height varies between engines.
     * Default: unset
     */
    inputLineHeight?: number;
    /** Letter spacing of input text in px. Default: unset */
    inputLetterSpacing?: number;
    /**
     * Fixed height of the input in px. Takes precedence over the height implied
     * by padding, font size and border, so changing the font size no longer
     * requires recomputing the padding. Default: unset
     */
    inputHeight?: number;
    /** Color of input placeholder text. Default: the browser's own. */
    placeholderColor?: string;

    // ── Input border ─────────────────────────────────────────────────────────
    /**
     * Border style of inputs.
     * 'underline' (default) — only a bottom border, with an animated focus
     *   gradient underline.
     * 'boxed' — a full border on all sides; the border color changes on focus
     *   (using focusGradientStart) and in the error state (using
     *   inputErrorBorderColor).
     * Default: 'underline'
     */
    inputBorderStyle?: 'underline' | 'boxed';
    /** Bottom border color of unfocused, valid inputs. Default: #698492 */
    inputBorderColor?: string;
    /** Border width in px. Default: 1 (underline style) */
    inputBorderWidth?: number;
    /** Background color of the input area. Default: transparent */
    inputBackgroundColor?: string;
    /** Vertical padding inside inputs in px. Default: 6 */
    inputPaddingVertical?: number;
    /** Horizontal padding inside inputs in px. Default: 0 */
    inputPaddingHorizontal?: number;
    /** Border radius of inputs in px. Default: 0 (underline style) */
    inputBorderRadius?: number;
    /**
     * Collapses the borders of adjacent inputs into a single shared line, so
     * the fields read as one block instead of stacking two borders where they
     * meet. Only applies to `inputBorderStyle: 'boxed'`.
     *
     * It pulls whole fields together, and a field is label + input + error, so
     * a single merged block needs the rest of that vertical space gone too:
     *
     * ```
     * inputBorderStyle: 'boxed',
     * inputBorderCollapse: true,
     * groupSpacing: 0,
     * fieldSpacing: 0,
     * labelHidden: true,
     * errorHidden: true,
     * errorMinHeight: 0,
     * ```
     *
     * `inputBorderRadius` then rounds only the outer corners of the block.
     * Default: false
     */
    inputBorderCollapse?: boolean;

    // ── Focus ring ───────────────────────────────────────────────────────────
    /**
     * Width in px of a focus ring drawn outside the input border, as a
     * `box-shadow`. Requires `focusRingColor`. Default: unset (no ring)
     */
    focusRingWidth?: number;
    /** Color of the focus ring. Default: unset (no ring) */
    focusRingColor?: string;

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
    /**
     * Reserved vertical space for the error line in px, which keeps the layout
     * from shifting when a message appears. Set to 0 to remove it. Default: 14
     */
    errorMinHeight?: number;
    /**
     * Distance from the input to the error line in px, when it should differ from
     * `fieldSpacing`. A field spaces its label, input and error on one gap, so
     * without this the error sits as far below the input as the label sits above
     * it — where MUI's own field puts 16px under the label and 3px under the
     * input. Default: unset, i.e. `fieldSpacing`
     */
    errorSpacing?: number;
    /**
     * Hides error messages visually while keeping them in the DOM and in the
     * accessibility tree, so screen readers still announce them. They occupy no
     * vertical space.
     *
     * The cardholder then gets no visible feedback, so the parent page should
     * render its own messages from `GOPAY_CARD_FORM_ERRORS`. Default: false
     */
    errorHidden?: boolean;

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

/** Fields that can carry a validation error, as reported to the parent. */
export type CardFormField = 'pan' | 'expiry' | 'cvv';

/**
 * Why a field failed validation. Codes only — the iframe never sends the
 * entered value, or any part of it, to the parent.
 */
export type CardFormErrorCode = 'required' | 'pattern';

export interface CardFormFieldError {
    field: CardFormField;
    code: CardFormErrorCode;
}

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
    | { type: 'GOPAY_CARD_FORM_VALIDITY'; isValid: boolean }
    /**
     * Sent on every validation run, so a parent that hides the built-in error
     * text (`errorHidden`) can render its own. An empty array means the form
     * validated cleanly.
     */
    | { type: 'GOPAY_CARD_FORM_ERRORS'; errors: CardFormFieldError[] };
