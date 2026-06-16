export type LoadingState =
    | 'idle'
    | 'fetching-card-form-url'
    | 'iframe-loading'
    | 'encrypting'
    | 'charging'
    | 'polling-charge-state';

export type SpinnerConfig =
    | false
    | { color?: string; render?: (container: HTMLElement) => () => void };

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
    svg.style.cssText =
        'animation:gp-spin 0.8s linear infinite;transform-origin:50% 50%;';

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
