/**
 * Colour maths for the themes demo — parse, flatten, contrast, format.
 *
 * This MIRRORS the package's test math in `test/lib/color.mjs` (same WCAG 2.2
 * relative-luminance formula, same alpha compositing, same parsing rules) but
 * is a SEPARATE COPY on purpose: the demo app is a browser bundle and may not
 * import anything from `test/`. If the maths changes in one place, change it in
 * the other — the theme tests and the cards on screen must never disagree.
 *
 * Everything here takes what `getComputedStyle` actually hands back — `rgb(r,
 * g, b)`, `rgba(r, g, b, a)`, the modern `rgb(r g b / a)`, `color(srgb r g b /
 * a)` — plus plain hex and `{ r, g, b, a }` channel objects (r/g/b 0–255,
 * a 0–1). Anything else (a `var(--…)`, a `light-dark(…)`, a keyword) parses to
 * null; callers resolve those through a live probe element first.
 */

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** `#abc` / `#aabbcc` / `#aabbccdd` → `{ r, g, b, a }`, or null. */
function parseHex(value) {
	const m = /^#([0-9a-f]{3,8})$/i.exec(String(value).trim());
	if (!m) return null;
	let hex = m[1];
	if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
	if (hex.length !== 6 && hex.length !== 8) return null;
	const n = (i) => parseInt(hex.slice(i, i + 2), 16);
	return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
}

/** `50%` → 0.5, `0.5` → 0.5, absent → 1. */
function parseAlpha(raw) {
	if (raw === undefined || raw === null) return 1;
	const text = String(raw).trim();
	if (text === '' || text === 'none') return 1;
	const value = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
	return Number.isNaN(value) ? 1 : Math.max(0, Math.min(1, value));
}

/** One channel of a legacy/modern rgb() — `128` or `50%` → 0–255. */
function parseChannel(raw) {
	const text = String(raw).trim();
	if (text.endsWith('%')) return (Number(text.slice(0, -1)) / 100) * 255;
	return Number(text);
}

/**
 * Any colour string a computed style can produce → `{ r, g, b, a }`, or null.
 *
 * @param {string|{r:number,g:number,b:number,a?:number}} value
 * @returns {{ r: number, g: number, b: number, a: number }|null}
 */
export function parseColor(value) {
	if (value && typeof value === 'object' && 'r' in value) return { a: 1, ...value };
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	if (text === '') return null;
	if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

	const hex = parseHex(text);
	if (hex) return hex;

	// `color(srgb 0.1 0.2 0.3 / 0.5)` — Chrome returns this for colours a
	// stylesheet wrote in a wide-gamut or relative-colour syntax.
	const srgb = /^color\(\s*srgb\s+([^)]+)\)$/i.exec(text);
	if (srgb) {
		const [channels, alpha] = srgb[1].split('/');
		const parts = channels.trim().split(/[\s,]+/);
		if (parts.length < 3) return null;
		const chans = parts.slice(0, 3).map((p) => (String(p).trim().endsWith('%') ? Number(String(p).trim().slice(0, -1)) / 100 : Number(p)));
		if (chans.some(Number.isNaN)) return null;
		return { r: chans[0] * 255, g: chans[1] * 255, b: chans[2] * 255, a: parseAlpha(alpha) };
	}

	// Both notations: legacy `rgba(r, g, b, a)` and modern `rgb(r g b / a)`.
	const fn = /^rgba?\(([^)]+)\)$/i.exec(text);
	if (!fn) return null;
	const [channels, alpha] = fn[1].split('/');
	const parts = channels.trim().split(/[\s,]+/);
	if (parts.length < 3) return null;
	const chans = parts.slice(0, 3).map(parseChannel);
	if (chans.some(Number.isNaN)) return null;
	const a = alpha !== undefined ? parseAlpha(alpha) : parseAlpha(parts[3]);
	return { r: chans[0], g: chans[1], b: chans[2], a };
}

/**
 * `{ r, g, b, a }` → `#rrggbb`, or `#rrggbbaa` when the colour is translucent.
 * @param {{r:number,g:number,b:number,a?:number}} c
 */
export function toHex(c) {
	const hex = (n) => clamp255(n).toString(16).padStart(2, '0');
	const base = '#' + hex(c.r) + hex(c.g) + hex(c.b);
	const a = c.a === undefined ? 1 : c.a;
	return a < 1 ? base + hex(a * 255) : base;
}

/**
 * A translucent colour painted over an opaque one, as the browser composites
 * it. Returns `{ r, g, b, a: 1 }`, or null when either side will not parse.
 */
export function flatten(fg, bg) {
	const t = parseColor(fg);
	const g = parseColor(bg);
	if (!t || !g) return null;
	const mix = (ch) => t[ch] * t.a + g[ch] * (1 - t.a);
	return { r: mix('r'), g: mix('g'), b: mix('b'), a: 1 };
}

const linear = (c) => {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an opaque colour, or NaN. */
export function relativeLuminance(value) {
	const c = parseColor(value);
	if (!c) return NaN;
	return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/**
 * WCAG 2.2 contrast ratio (1–21) between a foreground and a ground. A
 * translucent foreground is composited over the ground first — that is what
 * the eye sees, and it is what the theme tests measure. NaN when either side
 * will not parse or the GROUND is itself translucent (nothing to composite on).
 */
export function contrastRatio(fg, bg) {
	const top = parseColor(fg);
	const ground = parseColor(bg);
	if (!top || !ground || ground.a < 1) return NaN;
	const front = top.a < 1 ? flatten(top, ground) : top;
	if (!front) return NaN;
	const la = relativeLuminance(front);
	const lb = relativeLuminance(ground);
	const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * A compact display string for a card: hex when the colour is opaque,
 * `rgb(r g b / a)` when it is translucent, and the original string untouched
 * when it is not a colour at all (a composed `box-shadow`, say).
 */
export function formatValue(value) {
	const c = parseColor(value);
	if (!c) return value === null || value === undefined ? '' : String(value).trim();
	if (c.a >= 1) return toHex({ ...c, a: 1 });
	const round = (n) => clamp255(n);
	const alpha = Math.round(c.a * 1000) / 1000;
	return 'rgb(' + round(c.r) + ' ' + round(c.g) + ' ' + round(c.b) + ' / ' + alpha + ')';
}
