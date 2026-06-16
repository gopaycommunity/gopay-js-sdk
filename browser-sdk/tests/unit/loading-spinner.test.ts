import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
