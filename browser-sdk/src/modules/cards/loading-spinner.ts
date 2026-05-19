// Hourglass SVG path from gw-ui IconCircleWaitingCore.
const HOURGLASS_PATH =
    'M29.04 48.4H3.226a3.22 3.22 0 0 1-3.2-2.814 3.22 3.22 0 0 1 2.393-3.525V38.4a8.86 8.86 0 0 1 3.1-6.738l7.914-6.782c.18-.154.28-.377.28-.613v-.13c0-.235-.103-.46-.28-.612L5.52 16.743c-1.97-1.684-3.102-4.146-3.1-6.737V6.342A3.22 3.22 0 0 1 .026 2.817a3.22 3.22 0 0 1 3.2-2.814H29.04a3.22 3.22 0 0 1 .808 6.339V10a8.86 8.86 0 0 1-3.1 6.738l-7.913 6.78a.8.8 0 0 0-.281.613v.13c0 .235.103.46.28.612l7.913 6.783a8.86 8.86 0 0 1 3.1 6.737v3.664a3.22 3.22 0 0 1-.802 6.339zm-27.43-3.226c0 .428.17.838.472 1.14s.713.472 1.14.472H29.04c.89-.001 1.612-.722 1.613-1.613s-.722-1.613-1.613-1.613H3.225c-.9 0-1.61.72-1.613 1.6zm7.583-7.33c-1.624.796-3.37 1.318-5.163 1.545v2.557h24.2V39.4c-1.794-.227-3.54-.75-5.163-1.545a14.66 14.66 0 0 0-6.938-1.544q-.2 0-.38 0c-2.273-.001-4.516.526-6.55 1.54zm14.53-1.474a14.95 14.95 0 0 0 4.475 1.392 7.24 7.24 0 0 0-2.5-4.877l-7.913-6.784c-.537-.46-.846-1.13-.846-1.837v-.13a2.42 2.42 0 0 1 .844-1.837l7.913-6.782.2-.19H6.373l.2.188 7.913 6.784a2.41 2.41 0 0 1 .846 1.837v.13a2.42 2.42 0 0 1-.846 1.837l-7.913 6.782c-1.44 1.236-2.337 2.987-2.5 4.877 1.556-.226 3.066-.696 4.476-1.392a16.19 16.19 0 0 1 7.591-1.684h.394a16.2 16.2 0 0 1 7.191 1.682zM4.032 10c-.001 1.306.352 2.59 1.02 3.71h22.163c.668-1.123 1.02-2.405 1.02-3.71V6.45h-24.2zm-2.42-6.775c0 .428.17.838.472 1.14s.713.472 1.14.472H29.04c.89-.001 1.612-.722 1.613-1.613s-.722-1.612-1.613-1.613H3.225c-.428 0-.84.17-1.14.473s-.472.714-.472 1.142zm13.714 30.652v-1.613h1.613v1.613zm0-3.226v-1.613h1.613v1.613zm0-3.227V25.81h1.613v1.613z';

let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent =
        '@keyframes gp-draw-circle{0%{stroke-dashoffset:385}100%{stroke-dashoffset:0}}' +
        '@keyframes gp-flip{0%{transform:rotate(0)}8%,50%{transform:rotate(180deg)}58%,100%{transform:rotate(360deg)}}' +
        '@keyframes gp-opacity{0%{opacity:0}100%{opacity:1}}';
    document.head.appendChild(style);
}

export function createLoadingSpinner(color: string): HTMLElement {
    injectStyles();
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
        'display:flex;align-items:center;justify-content:center;width:100%;height:100%;';
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.setAttribute('aria-label', 'Loading');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 126 126');
    svg.setAttribute('width', '80');
    svg.setAttribute('height', '80');
    svg.setAttribute('aria-hidden', 'true');

    const circle = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle',
    );
    circle.setAttribute('cx', '63');
    circle.setAttribute('cy', '63');
    circle.setAttribute('r', '61');
    circle.setAttribute('fill', 'transparent');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '4');
    circle.setAttribute('stroke-dasharray', '385');
    circle.setAttribute('stroke-dashoffset', '385');
    circle.setAttribute('stroke-linecap', 'round');
    circle.style.animation =
        'gp-draw-circle cubic-bezier(0.77,0,0.175,1) 500ms both';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', 'translate(48 40)');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', HOURGLASS_PATH);
    path.setAttribute('fill', color);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '1');
    path.style.cssText =
        'animation:gp-flip 5000ms linear infinite both,gp-opacity 400ms 500ms linear both;transform-origin:16px 24px;';

    g.appendChild(path);
    svg.appendChild(circle);
    svg.appendChild(g);
    wrapper.appendChild(svg);
    return wrapper;
}
