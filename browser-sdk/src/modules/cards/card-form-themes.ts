import type { CardFormTheme } from './iframe-protocol.js';

/**
 * Default light theme for the GoPay card form.
 * Pass as `options.theme` to `mountCardForm()`.
 */
export const DEFAULT_CARD_FORM_THEME: CardFormTheme = {
    labelColor: '#4b5e68',
    labelFontSize: 11,
    labelFontWeight: 600,
    labelUppercase: true,
    inputTextColor: '#4b5e68',
    inputFontSize: 14,
    inputBorderColor: '#698492',
    inputBorderWidth: 1,
    inputBackgroundColor: 'transparent',
    inputPaddingVertical: 6,
    inputBorderRadius: 0,
    focusGradientStart: '#19C7D6',
    focusGradientEnd: '#1899D6',
    inputErrorBorderColor: '#ea3c55',
    errorTextColor: '#cc0000',
    errorFontSize: 11,
    groupSpacing: 16,
    fieldSpacing: 4,
    formPadding: 16,
    formBackgroundColor: 'transparent',
    submitBackgroundColor: '#1899d6',
    submitHoverBackgroundColor: '#1482ba',
    submitDisabledBackgroundColor: '#a8b6bd',
    submitTextColor: '#ffffff',
    submitDisabledTextColor: '#ffffff',
    submitBorderRadius: 4,
    submitFontSize: 14,
};

/**
 * Dark theme for the GoPay card form.
 * Pass as `options.theme` to `mountCardForm()`.
 */
export const DARK_CARD_FORM_THEME: CardFormTheme = {
    ...DEFAULT_CARD_FORM_THEME,
    labelColor: '#94a3b8',
    inputTextColor: '#e2e8f0',
    inputBorderColor: '#334155',
    formBackgroundColor: '#1a1f2e',
    errorTextColor: '#f87171',
    submitDisabledBackgroundColor: '#334155',
    submitDisabledTextColor: '#64748b',
};
