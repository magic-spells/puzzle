/**
 * Read registry/theme/*.css the way the browser does — into one value map per
 * mode — so the tests measure what actually paints. Test-only: the demo reads
 * its colour cards from live computed styles, never from this parser.
 *
 * pieces.css   `@theme { … }` holds the default palette's `light-dark()` pairs;
 *              its medium block is the one whose selector list starts with
 *              `[data-theme='medium']:not([data-scheme])`.
 * <scheme>.css `[data-scheme='x'] { … }` holds the pairs; the medium block's
 *              selector list starts with `[data-scheme='x'][data-theme='medium']`.
 */
import { readFileSync } from 'node:fs';

export const THEME_DIR = new URL('../../registry/theme/', import.meta.url);
export const SCHEMES = ['default', 'dim', 'warm', 'void'];
export const MODES = ['light', 'medium', 'dark'];

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
const mediumBlockPrefix = (scheme) =>
	scheme === 'default' ? `[data-theme='medium']:not([data-scheme])` : `[data-scheme='${scheme}'][data-theme='medium']`;

/** The block holding the palette's light-dark pairs, or null. */
export function pairBlock(scheme, css = readTheme(scheme)) {
	return blocks(css).find((b) => b.selector === pairBlockSelector(scheme)) || null;
}

/** The block holding the palette's medium re-declarations, or null. */
export function mediumBlock(scheme, css = readTheme(scheme)) {
	return blocks(css).find((b) => b.selector.startsWith(mediumBlockPrefix(scheme))) || null;
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
 * `{ light, medium, dark }` for one palette, each a Map prop → raw value with
 * pairs split per mode and the medium block laid over the dark half.
 */
export function modeMaps(scheme, css = readTheme(scheme)) {
	const pairs = pairBlock(scheme, css);
	if (!pairs) throw new Error(`${fileFor(scheme)}: no ${pairBlockSelector(scheme)} block`);
	const medium = mediumBlock(scheme, css);
	const pairDecls = declarations(pairs.body);
	const mediumDecls = medium ? declarations(medium.body) : new Map();

	const light = new Map();
	const dark = new Map();
	const med = new Map();
	for (const [prop, value] of pairDecls) {
		light.set(prop, half(value, 'light'));
		dark.set(prop, half(value, 'dark'));
		med.set(prop, mediumDecls.has(prop) ? mediumDecls.get(prop) : half(value, 'dark'));
	}
	return { light, medium: med, dark };
}

/** Follow `var(--…)` aliases inside one mode map; a hop limit turns a cycle into null. */
export function resolve(map, prop, hops = 0) {
	const value = map.get(prop);
	if (value === undefined) return null;
	const alias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
	if (!alias) return value;
	return hops > 8 ? null : resolve(map, alias[1], hops + 1);
}

/** Every mode map resolved: `{ light, medium, dark }` of Map prop → colour string. */
export function resolvedModes(scheme, css = readTheme(scheme)) {
	const maps = modeMaps(scheme, css);
	const out = {};
	for (const mode of MODES) {
		out[mode] = new Map([...maps[mode].keys()].map((prop) => [prop, resolve(maps[mode], prop)]));
	}
	return out;
}
