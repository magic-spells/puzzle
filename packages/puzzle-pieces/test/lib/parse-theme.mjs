/**
 * Read registry/theme/*.css the way the browser does — into one value map per
 * style — so the tests measure what actually paints. Test-only: the demo reads
 * its colour cards from live computed styles, never from this parser.
 *
 * pieces.css   `@theme { … }` holds the default palette's `light-dark()` pairs;
 *              its dim / mixed blocks are the ones whose selector list starts
 *              with `[data-theme='dim']:not([data-scheme])` (or 'mixed').
 * <scheme>.css `[data-scheme='x'] { … }` holds the pairs; the dim / mixed
 *              blocks' selector lists start with `[data-scheme='x'][data-theme='dim']`.
 *
 * Dark and light are the two halves of the pairs. DIM lays its block over the
 * dark half (it runs on `color-scheme: dark`); MIXED lays its block over the
 * LIGHT half (`color-scheme: light`, the frame re-declared dark).
 */
import { readFileSync } from 'node:fs';

export const THEME_DIR = new URL('../../registry/theme/', import.meta.url);
export const SCHEMES = ['default', 'cool', 'warm', 'void'];
/** The styles, in picker order (the `data-theme` values). */
export const STYLES = ['dark', 'dim', 'mixed', 'light'];
/** The half of every `light-dark()` pair each style's color-scheme resolves. */
export const BASE_HALF = { dark: 'dark', dim: 'dark', mixed: 'light', light: 'light' };

export const fileFor = (scheme) => (scheme === 'default' ? 'pieces.css' : `${scheme}.css`);
export const readTheme = (scheme) => readFileSync(new URL(fileFor(scheme), THEME_DIR), 'utf8');

/** Strip comments (keeping line structure irrelevant here). */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `--name: value;` in a chunk of CSS, in source order, as a Map. */
export function declarations(css) {
	const map = new Map();
	for (const m of stripComments(css).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
		map.set(m[1], m[2].replace(/\s+/g, ' ').trim());
	}
	return map;
}

/** All top-level `selector { body }` blocks of a stylesheet (no nesting). */
export function blocks(css) {
	const out = [];
	const text = stripComments(css);
	const re = /([^{}]+)\{([^{}]*)\}/g;
	for (const m of text.matchAll(re)) {
		out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
	}
	return out;
}

const pairBlockSelector = (scheme) => (scheme === 'default' ? '@theme' : `[data-scheme='${scheme}']`);
const styleBlockPrefix = (scheme, style) =>
	scheme === 'default' ? `[data-theme='${style}']:not([data-scheme])` : `[data-scheme='${scheme}'][data-theme='${style}']`;

/** The block holding the palette's light-dark pairs, or null. */
export function pairBlock(scheme, css = readTheme(scheme)) {
	return blocks(css).find((b) => b.selector === pairBlockSelector(scheme)) || null;
}

/** The block holding the palette's re-declarations for `dim` or `mixed`, or null. */
export function styleBlock(scheme, style, css = readTheme(scheme)) {
	return blocks(css).find((b) => b.selector.startsWith(styleBlockPrefix(scheme, style))) || null;
}

/** Split on commas NOT inside parentheses — `light-dark(rgb(0 0 0 / 0.2), #fff)`. */
export function splitTopLevel(input) {
	const parts = [];
	let depth = 0;
	let current = '';
	for (const ch of input) {
		if (ch === '(') depth += 1;
		if (ch === ')') depth -= 1;
		if (ch === ',' && depth === 0) {
			parts.push(current.trim());
			current = '';
			continue;
		}
		current += ch;
	}
	parts.push(current.trim());
	return parts;
}

/** One half of a `light-dark()` pair, or the flat value (both halves). */
export function half(value, side) {
	if (!value.startsWith('light-dark(')) return value;
	const inner = value.slice('light-dark('.length, value.lastIndexOf(')'));
	const halves = splitTopLevel(inner);
	if (halves.length !== 2) return value;
	return side === 'light' ? halves[0] : halves[1];
}

/**
 * `{ dark, dim, mixed, light }` for one palette, each a Map prop → raw value
 * with pairs split per style's half and that style's block laid over it.
 */
export function styleMaps(scheme, css = readTheme(scheme)) {
	const pairs = pairBlock(scheme, css);
	if (!pairs) throw new Error(`${fileFor(scheme)}: no ${pairBlockSelector(scheme)} block`);
	const pairDecls = declarations(pairs.body);
	const out = {};
	for (const style of STYLES) {
		const block = style === 'dim' || style === 'mixed' ? styleBlock(scheme, style, css) : null;
		const over = block ? declarations(block.body) : new Map();
		const map = new Map();
		for (const [prop, value] of pairDecls) map.set(prop, over.has(prop) ? over.get(prop) : half(value, BASE_HALF[style]));
		out[style] = map;
	}
	return out;
}

/** Follow `var(--…)` aliases inside one mode map; a hop limit turns a cycle into null. */
export function resolve(map, prop, hops = 0) {
	const value = map.get(prop);
	if (value === undefined) return null;
	const alias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
	if (!alias) return value;
	return hops > 8 ? null : resolve(map, alias[1], hops + 1);
}

/** Every style map resolved: `{ dark, dim, mixed, light }` of Map prop → colour string. */
export function resolvedStyles(scheme, css = readTheme(scheme)) {
	const maps = styleMaps(scheme, css);
	const out = {};
	for (const style of STYLES) {
		out[style] = new Map([...maps[style].keys()].map((prop) => [prop, resolve(maps[style], prop)]));
	}
	return out;
}
