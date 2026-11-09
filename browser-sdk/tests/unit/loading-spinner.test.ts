import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showLoadingSpinner } from '../../src/index.js';
import { showSpinnerIn } from '../../src/internal/loading-spinner.js';

describe('showSpinnerIn()', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
    });

    it('appends a div wrapper to the container', () => {
        showSpinnerIn(container, { color: '#1899d6' });
        const wrapper = container.firstElementChild;
        expect(wrapper?.tagName.toLowerCase()).toBe('div');
    });

    it('wrapper has flex layout styles', () => {
        showSpinnerIn(container, { color: '#1899d6' });
        const wrapper = container.firstElementChild as HTMLElement;
        expect(wrapper.style.display).toBe('flex');
    });

    it('contains an SVG child', () => {
        showSpinnerIn(container, { color: '#ff0000' });
        expect(container.querySelector('svg')).not.toBeNull();
    });

    it('circle stroke uses the provided color', () => {
        const color = '#1234ab';
        showSpinnerIn(container, { color });
        expect(container.querySelector('circle')?.getAttribute('stroke')).toBe(
            color,
        );
    });

    it('spinner: { color } overrides the default color', () => {
        showSpinnerIn(container, {
            color: '#1899d6',
            spinner: { color: '#ff0000' },
        });
        expect(container.querySelector('circle')?.getAttribute('stroke')).toBe(
            '#ff0000',
        );
    });

    it('spinner: false adds no DOM and returns a no-op cleanup', () => {
        const cleanup = showSpinnerIn(container, {
            color: '#1899d6',
            spinner: false,
        });
        expect(container.children).toHaveLength(0);
        expect(() => cleanup()).not.toThrow();
    });

    it('spinner: { render } calls the custom render function with the container', () => {
        const render = vi.fn(() => () => {});
        showSpinnerIn(container, { color: '#1899d6', spinner: { render } });
        expect(render).toHaveBeenCalledWith(container);
    });

    it('spinner: { render } uses the cleanup returned by render', () => {
        const innerCleanup = vi.fn();
        const render = vi.fn(() => innerCleanup);
        const cleanup = showSpinnerIn(container, {
            color: '#1899d6',
            spinner: { render },
        });
        cleanup();
        expect(innerCleanup).toHaveBeenCalledOnce();
    });

    it('spinner: { render } falls back to no-op if render returns non-function', () => {
        const render = vi.fn(() => undefined as unknown as () => void);
        const cleanup = showSpinnerIn(container, {
            color: '#1899d6',
            spinner: { render },
        });
        expect(() => cleanup()).not.toThrow();
    });

    it('cleanup removes the spinner element', () => {
        const cleanup = showSpinnerIn(container, { color: '#1899d6' });
        expect(container.children).toHaveLength(1);
        cleanup();
        expect(container.children).toHaveLength(0);
    });

    it('injects CSS keyframe animation styles into document.head', () => {
        showSpinnerIn(container, { color: '#000' });
        const styles = Array.from(document.head.querySelectorAll('style'));
        const animStyle = styles.find((s) =>
            s.textContent?.includes('gp-spin'),
        );
        expect(animStyle).not.toBeUndefined();
    });

    it('injects the style tag only once on repeated calls', () => {
        showSpinnerIn(container, { color: '#aaa' });
        showSpinnerIn(container, { color: '#bbb' });
        showSpinnerIn(container, { color: '#ccc' });
        const animStyles = Array.from(
            document.head.querySelectorAll('style'),
        ).filter((s) => s.textContent?.includes('gp-spin'));
        expect(animStyles).toHaveLength(1);
    });

    it('caps the spinner at its container, so a 40px wallet slot holds it', () => {
        showSpinnerIn(container, { color: '#1899d6' });
        const svg = container.querySelector('svg') as SVGSVGElement;
        expect(svg.style.maxWidth).toBe('100%');
        expect(svg.style.maxHeight).toBe('100%');
    });
});

describe('showLoadingSpinner()', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
    });

    it('is exported from the package entry', () => {
        expect(typeof showLoadingSpinner).toBe('function');
    });

    it('draws the charge spinner in GoPay blue when no colour is given', () => {
        showLoadingSpinner(container);
        expect(
            container
                .querySelector('[role="status"] circle')
                ?.getAttribute('stroke'),
        ).toBe('#1899d6');
    });

    it('takes the colour from the spinner option the card form takes', () => {
        showLoadingSpinner(container, { color: '#c8102e' });
        expect(container.querySelector('circle')?.getAttribute('stroke')).toBe(
            '#c8102e',
        );
    });

    it('hands the container to a custom render and returns its cleanup', () => {
        const innerCleanup = vi.fn();
        const render = vi.fn(() => innerCleanup);
        const hide = showLoadingSpinner(container, { render });
        expect(render).toHaveBeenCalledWith(container);
        hide();
        expect(innerCleanup).toHaveBeenCalledOnce();
    });

    it('adds nothing for spinner: false', () => {
        const hide = showLoadingSpinner(container, false);
        expect(container.children).toHaveLength(0);
        expect(() => hide()).not.toThrow();
    });

    it('appends next to what the container holds and removes only itself', () => {
        const kept = document.createElement('span');
        container.appendChild(kept);
        const hide = showLoadingSpinner(container);
        expect(container.children).toHaveLength(2);
        hide();
        expect(Array.from(container.children)).toEqual([kept]);
    });
});
