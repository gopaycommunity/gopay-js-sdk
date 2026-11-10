export type LoadingState =
    | 'idle'
    | 'fetching-card-form-url'
    | 'iframe-loading'
    | 'charging'
    | 'polling-charge-state';

export type SpinnerConfig =
    | false
    | { color?: string; render?: (container: HTMLElement) => () => void };

/** GoPay blue — the spinner's colour when neither a theme nor `spinner.color` names one. */
export const DEFAULT_SPINNER_COLOR = '#1899d6';

let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = '@keyframes gp-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
}

function createLoadingSpinner(color: string): HTMLElement {
    injectStyles();
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
        'display:flex;align-items:center;justify-content:center;width:100%;height:100%;';
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.setAttribute('aria-label', 'Loading');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 50 50');
    svg.setAttribute('width', '48');
    svg.setAttribute('height', '48');
    svg.setAttribute('aria-hidden', 'true');
    // Capped by the container, so a slot shorter than 48px — a wallet button's, typically 40 —
    // gets a smaller spinner instead of one spilling over what sits around it.
    svg.style.cssText =
        'animation:gp-spin 0.8s linear infinite;transform-origin:50% 50%;max-width:100%;max-height:100%;';

    const circle = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle',
    );
    circle.setAttribute('cx', '25');
    circle.setAttribute('cy', '25');
    circle.setAttribute('r', '20');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '4');
    circle.setAttribute('stroke-dasharray', '94 32');
    circle.setAttribute('stroke-linecap', 'round');

    svg.appendChild(circle);
    wrapper.appendChild(svg);
    return wrapper;
}

/**
 * Append a spinner into `container` and return a cleanup function that removes it.
 * Respects the `spinner` config: `false` → no-op, `{ render }` → custom render,
 * `{ color }` → override color, omitted → use `color`.
 */
export function showSpinnerIn(
    container: HTMLElement,
    opts: { color: string; spinner?: SpinnerConfig },
): () => void {
    const { color, spinner } = opts;
    if (spinner === false) {
        return () => {};
    }
    if (spinner?.render) {
        const cleanup = spinner.render(container);
        return typeof cleanup === 'function' ? cleanup : () => {};
    }
    const el = createLoadingSpinner(spinner?.color ?? color);
    container.appendChild(el);
    return () => {
        el.remove();
    };
}

/**
 * Show the loading spinner the card form and the wallet buttons show while they charge, in
 * `container`, for a step the SDK does not run itself — typically a charge your server makes,
 * such as one with a saved card, while the page waits for it. Returns a function that removes it.
 *
 * Takes no theme: it draws in GoPay blue unless `spinner` says otherwise, while the card form and
 * the wallet buttons take the colour from `theme.submitBackgroundColor`. If you theme them, pass
 * that colour as `{ color: theme.submitBackgroundColor }`, or give all three the same `spinner`
 * option. The spinner is appended, not swapped in: what else the container holds is left to you.
 *
 * ```ts
 * const hide = showLoadingSpinner(container, { color: theme.submitBackgroundColor });
 * try {
 *     await fetch('/api/charge-saved-card', { method: 'POST', body });
 * } finally {
 *     hide();
 * }
 * ```
 */
export function showLoadingSpinner(
    container: HTMLElement,
    spinner?: SpinnerConfig,
): () => void {
    return showSpinnerIn(container, { color: DEFAULT_SPINNER_COLOR, spinner });
}
