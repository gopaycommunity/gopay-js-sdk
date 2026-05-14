import { describe, expect, it } from 'vitest';
import { createLoadingSpinner } from '../../src/modules/cards/loading-spinner.js';

describe('createLoadingSpinner()', () => {
    it('returns a div wrapper element', () => {
        const spinner = createLoadingSpinner('#1899d6');
        expect(spinner.tagName.toLowerCase()).toBe('div');
    });

    it('wrapper has flex layout styles', () => {
        const spinner = createLoadingSpinner('#1899d6');
        expect(spinner.style.display).toBe('flex');
    });

    it('contains an SVG child', () => {
        const spinner = createLoadingSpinner('#ff0000');
        expect(spinner.querySelector('svg')).not.toBeNull();
    });

    it('circle stroke uses the provided color', () => {
        const color = '#1234ab';
        const spinner = createLoadingSpinner(color);
        expect(spinner.querySelector('circle')?.getAttribute('stroke')).toBe(
            color,
        );
    });

    it('hourglass path fill uses the provided color', () => {
        const color = '#abcdef';
        const spinner = createLoadingSpinner(color);
        expect(spinner.querySelector('path')?.getAttribute('fill')).toBe(color);
    });

    it('injects CSS keyframe animation styles into document.head', () => {
        createLoadingSpinner('#000');
        const styles = Array.from(document.head.querySelectorAll('style'));
        const animStyle = styles.find((s) =>
            s.textContent?.includes('gp-draw-circle'),
        );
        expect(animStyle).not.toBeUndefined();
        expect(animStyle?.textContent).toContain('gp-flip');
    });

    it('injects the style tag only once on repeated calls', () => {
        createLoadingSpinner('#aaa');
        createLoadingSpinner('#bbb');
        createLoadingSpinner('#ccc');
        const animStyles = Array.from(
            document.head.querySelectorAll('style'),
        ).filter((s) => s.textContent?.includes('gp-draw-circle'));
        expect(animStyles).toHaveLength(1);
    });
});
