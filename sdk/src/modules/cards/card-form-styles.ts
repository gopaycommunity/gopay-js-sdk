/**
 * Default CSS injected into the GoPay-hosted card form iframe via the
 * `GOPAY_CARD_SET_STYLES` postMessage.
 *
 * Pass your own string as `options.styles` to `mountCardForm()` to replace
 * these defaults entirely.
 */
export const DEFAULT_CARD_FORM_STYLES = `
    *, *::before, *::after { box-sizing: border-box; }
    .gp-form { display: flex; flex-direction: column; gap: 16px; padding: 16px; font-family: inherit; }
    .gp-field { display: flex; flex-direction: column; gap: 4px; }
    .gp-field label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #4b5e68; }
    .gp-row { display: flex; gap: 16px; }
    .gp-row .gp-field { flex: 1; }
    .gp-input { padding: 6px 0; border: none; border-bottom: 1px solid #698492; background: linear-gradient(to right, #19C7D6 0%, #1899D6 100%) no-repeat bottom / 0 2px; font-size: 14px; color: #4b5e68; width: 100%; outline: none; transition: background-size 0.3s ease-out, border-color 0.2s ease; }
    .gp-input:focus { border-bottom-color: transparent; background-size: 100% 2px; }
    .gp-input.error { border-bottom-color: #ea3c55; background-size: 0 2px; }
    .gp-error { font-size: 11px; color: #cc0000; min-height: 14px; }
    .gp-submit { padding: 10px 24px; background: #1899d6; color: #fff; border: none; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s ease; }
    .gp-submit:hover { background: #1482ba; }
    .gp-submit:disabled { background: #a8b6bd; cursor: not-allowed; }
`.trim();
