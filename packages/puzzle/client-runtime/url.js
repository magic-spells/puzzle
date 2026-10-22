import { displayValue } from './display.js';
import { decodeRefs } from './sanitize.js';

/**
 * Compiler-only URL binding guard (D186), shared by browser and prerender.
 * Keep the original value and its attribute semantics unless a URL is blocked.
 * @param {any} value
 * @param {number} [mode] bit 1: image data allowed; bit 2: URL candidate list;
 *   bit 4: `;`-separated animation values
 * @returns {any}
 */
export function urlValue(value, mode = 0) {
	if (typeof value !== 'string' && !Array.isArray(value)) return value;
	const url = decodeRefs(displayValue(value, 0, ' ')).replace(/[\t\n\r]/g, '');
	for (const part of mode & 2 ? url.split(/[\s\x00-\x20,]+/) : mode & 4 ? url.split(';') : [url]) {
		const scheme = /^[\s\x00-\x20\x7f-\x9f]*(?:(?:java|vb)script|(data)):/i.exec(part);
		if (scheme && !(scheme[1] && mode & 1)) {
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
				console.warn('[puzzle] blocked unsafe URL in a dynamic attribute');
			return null;
		}
	}
	return value;
}
