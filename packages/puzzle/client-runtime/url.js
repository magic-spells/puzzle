import { displayValue } from './display.js';
import { decodeRefs } from './sanitize.js';

/**
 * Compiler-only URL binding guard (D186), shared by browser and prerender.
 * Keep the original value and its attribute semantics unless a URL is blocked.
 * @param {any} value
 * @param {number} [mode] bit 1: image data allowed; bit 2: URL candidate list
 * @returns {any}
 */
export function urlValue(value, mode = 0) {
	if (typeof value !== 'string' && !Array.isArray(value)) return value;
	const url = decodeRefs(displayValue(value, 0, ' '))
		.replace(/[\t\n\r]/g, '').replace(/^[\s\x00-\x20\x7f-\x9f]+/, '');
	for (const part of mode & 2 ? url.split(/[\s\x00-\x20,]+/) : [url]) {
		if (/^(?:javascript|vbscript):/i.test(part) || (!(mode & 1) && /^data:/i.test(part))) {
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
				console.warn('[puzzle] blocked unsafe URL in a dynamic attribute');
			return null;
		}
	}
	return value;
}
