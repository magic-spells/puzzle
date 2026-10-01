/**
 * Colour maths for the theme tests. Pure functions, no DOM.
 *
 * Values in and out are CSS strings — `#rrggbb`, `#rrggbbaa`, `rgb(r g b / a)`,
 * `rgba(r, g, b, a)` — or `{ r, g, b, a }` channel objects (0–255, alpha 0–1).
 * Anything else (a `var(--…)`, a `light-dark(…)`, a keyword) parses to null;
 * callers resolve aliases first. The contrast ratio and the alpha flattening
 * are ported from Pyramid's `web/scripts/contrast-tokens.test.mjs` /
 * `web/app/lib/contrast.js` so the package holds every palette to the same
 * bar the apps already do.
 */

/** `#abc` / `#aabbcc` / `#aabbccdd` → `{ r, g, b, a }`, or null. */
export function parseHex(value) {
	const m = /^#([0-9a-f]{3,8})$/i.exec(String(value).trim());
	if (!m) return null;
	let hex = m[1];
	if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
	if (hex.length !== 6 && hex.length !== 8) return null;
	const n = (i) => parseInt(hex.slice(i, i + 2), 16);
	return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
}

/** Any supported CSS colour string → `{ r, g, b, a }`, or null. */
export function parseColor(value) {
	if (value && typeof value === 'object' && 'r' in value) return { a: 1, ...value };
	const text = String(value).trim();
	if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
	const hex = parseHex(text);
	if (hex) return hex;
	const fn = /^rgba?\(([^)]+)\)$/i.exec(text);
	if (!fn) return null;
	// Both notations: legacy `rgba(r, g, b, a)` and modern `rgb(r g b / a)`.
	const [channels, alpha] = fn[1].split('/');
	const parts = channels.trim().split(/[\s,]+/).map(Number);
	if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
	let a = alpha !== undefined ? alpha.trim() : parts[3];
	if (typeof a === 'string' && a.endsWith('%')) a = Number(a.slice(0, -1)) / 100;
	a = a === undefined || a === '' ? 1 : Number(a);
	return { r: parts[0], g: parts[1], b: parts[2], a: Number.isNaN(a) ? 1 : a };
}

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** `{ r, g, b }` → `#rrggbb` (alpha is dropped — flatten first). */
export function toHex({ r, g, b }) {
	return '#' + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('');
}

/** A translucent colour painted over an opaque one, as the browser composites it. */
export function flatten(top, ground) {
	const t = parseColor(top);
	const g = parseColor(ground);
	if (!t || !g) return null;
	const mix = (ch) => t[ch] * t.a + g[ch] * (1 - t.a);
	return toHex({ r: mix('r'), g: mix('g'), b: mix('b') });
}

const linear = (c) => {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an opaque colour. */
export function relativeLuminance(value) {
	const c = parseColor(value);
	if (!c) return NaN;
	return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/** WCAG 2.x contrast ratio between two OPAQUE colours (1–21); NaN if either is translucent. */
export function contrastRatio(a, b) {
	const ca = parseColor(a);
	const cb = parseColor(b);
	if (!ca || !cb || ca.a < 1 || cb.a < 1) return NaN;
	const la = relativeLuminance(ca);
	const lb = relativeLuminance(cb);
	const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

/** Opaque colour → OKLCH `{ l, c, h }` (l 0–1, h degrees). Björn Ottosson's matrices. */
export function toOklch(value) {
	const rgb = parseColor(value);
	if (!rgb) return null;
	const r = linear(rgb.r);
	const g = linear(rgb.g);
	const b = linear(rgb.b);
	const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
	const c = Math.hypot(A, B);
	let h = (Math.atan2(B, A) * 180) / Math.PI;
	if (h < 0) h += 360;
	return { l: L, c, h: c < 1e-6 ? 0 : h };
}
