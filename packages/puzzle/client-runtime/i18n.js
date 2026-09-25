/**
 * The i18n service (D175) — `this.ctx.i18n` in every view and `app.i18n`.
 *
 * The build owns the locale files end to end: it flattens nesting, fills every
 * locale's missing keys from the default locale, and emits one hashed JSON file
 * per locale. So the runtime here is small on purpose: pick a locale, fetch ONE
 * flat, already-filled table (or read it from the prerendered page's island),
 * look keys up, fill `{name}` placeholders in one pass, and choose a plural form
 * with the browser's own `Intl.PluralRules`. No runtime fallback, no merging, no
 * message parser.
 *
 * Every importer (app.js, static/index.js, ssg/index.js) reaches this module only
 * behind the inline `__PUZZLE_HAS_I18N__` probe, so an app without `i18n` in its
 * puzzle.config.js ships none of it.
 */

import manifestData from '@magic-spells/puzzle/i18n/manifest';
import { displayValue } from './display.js';
import { nearestFormatter } from './formatters.js';

/** The localStorage key that remembers a viewer's explicit setLocale() choice. */
export const LOCALE_STORAGE_KEY = '__puzzleLocale';

/**
 * Pick the active locale (D175 Locale selection): the stored choice when it is
 * still configured, then each of the viewer's languages in order — the exact tag
 * (case-insensitively), its base language (`es-CO` → `es`), then the first
 * configured tag with the same base (`pt` → `pt-BR`) — then the default.
 *
 * @param {string[]} tags configured locales, in config order
 * @param {string} defaultLocale
 * @param {?string} stored the remembered choice, if any
 * @param {string[]} [languages] the viewer's preferred languages (navigator.languages)
 * @returns {string} a configured tag
 */
export function selectLocale(tags, defaultLocale, stored, languages = []) {
	const find = (tag) => tags.find((t) => t.toLowerCase() === tag.toLowerCase());
	const baseOf = (tag) => tag.split('-')[0].toLowerCase();
	if (typeof stored === 'string' && stored) {
		const hit = find(stored);
		if (hit) return hit;
	}
	for (const lang of languages) {
		if (typeof lang !== 'string' || !lang) continue;
		const base = baseOf(lang);
		const hit = find(lang) ?? find(base) ?? tags.find((t) => baseOf(t) === base);
		if (hit) return hit;
	}
	return defaultLocale;
}

function readStoredLocale() {
	try {
		return localStorage.getItem(LOCALE_STORAGE_KEY);
	} catch {
		return null;
	}
}

function storeLocale(tag) {
	try {
		localStorage.setItem(LOCALE_STORAGE_KEY, tag);
	} catch {
		// Private mode, blocked storage, no DOM — the choice just is not remembered.
	}
}

function viewerLanguages() {
	if (typeof navigator === 'undefined') return [];
	return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/**
 * The table a prerendered page carries for its build locale
 * (`<script type="application/json" data-puzzle-locale="en">`), or null when the
 * page has none or it is for a different locale.
 */
function readIsland(tag) {
	if (typeof document === 'undefined') return null;
	const el = document.querySelector('script[data-puzzle-locale]');
	if (!el || el.getAttribute('data-puzzle-locale') !== tag) return null;
	try {
		return JSON.parse(el.textContent);
	} catch {
		return null;
	}
}

// Formatter caches, keyed by locale. Module-level: they hold nothing app-specific.
const pluralRules = new Map();
const numberFormats = new Map();

function pluralCategory(locale, count) {
	let rules = pluralRules.get(locale);
	if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(locale)));
	return rules.select(count);
}

function localeCount(locale, n) {
	let format = numberFormats.get(locale);
	if (!format) numberFormats.set(locale, (format = new Intl.NumberFormat(locale)));
	return format.format(n);
}

/**
 * Fill `{name}` placeholders in ONE left-to-right pass, so text that was inserted
 * is never substituted again. The name is the exact text between `{` and `}`. A
 * name missing from `vars` stays visible as written; a present name with a
 * missing value prints nothing (D173 V6, via displayValue). A finite-number
 * `count` prints in the active locale's number format. A `{` with no closing `}`
 * is literal text.
 */
export function fillPlaceholders(text, vars, locale) {
	let out = '';
	let i = 0;
	for (;;) {
		const open = text.indexOf('{', i);
		if (open < 0) break;
		const close = text.indexOf('}', open + 1);
		if (close < 0) break;
		const name = text.slice(open + 1, close);
		out += text.slice(i, open);
		if (Object.hasOwn(vars, name)) {
			const value = vars[name];
			out +=
				name === 'count' && typeof value === 'number' && isFinite(value)
					? localeCount(locale, value)
					: displayValue(value);
		} else {
			out += text.slice(open, close + 1);
		}
		i = close + 1;
	}
	return out + text.slice(i);
}

/**
 * Create the i18n service over the build's locale manifest. Returns null when the
 * build configured no translations (the manifest module exports null).
 *
 * Loading starts immediately: the host creates the service while it wires its
 * other services, so the fetch overlaps `beforeMount`, and awaits `__ready()`
 * before its first render.
 *
 * @param {object} [options]
 * @param {object} [options.manifest] `{ defaultLocale, locales: { tag: path } }`;
 *   defaults to the build's manifest module
 * @param {(path: string) => string} [options.url] resolves a dist-relative
 *   manifest path to a fetchable URL
 * @param {Record<string, object>} [options.tables] preloaded tables by tag — the
 *   prerender and the testing utilities pass these so nothing is fetched
 * @param {string} [options.locale] a forced starting locale (the prerender always
 *   renders the default); skips storage and navigator
 * @param {() => unknown} [options.refresh] re-renders the host after a switch
 * @param {(tag: string) => void} [options.onLocale] called whenever the active
 *   locale changes (the formatter locale hook)
 * @returns {object|null}
 */
export function createI18n(options = {}) {
	const manifest = options.manifest ?? manifestData;
	if (!manifest) return null;
	const tags = Object.keys(manifest.locales);
	const defaultLocale = manifest.defaultLocale;
	const { tables, url = (path) => path, refresh, onLocale } = options;

	let table = null;
	let locale = defaultLocale;
	let token = 0;
	let pending = null;
	let warned;

	// Development-only, warn-once. Every CALL sits behind the inline
	// `__PUZZLE_DEV__` probe too, so production drops the message strings with it.
	const warnOnce = (key, message) => {
		if ((warned ??= new Set()).has(key)) return;
		warned.add(key);
		console.warn(message);
	};

	const load = (tag) => {
		const preloaded = tables?.[tag] ?? readIsland(tag);
		if (preloaded) return Promise.resolve(preloaded);
		return fetch(url(manifest.locales[tag])).then((res) => {
			if (!res.ok) throw new Error(`[puzzle] locale "${tag}" failed to load (HTTP ${res.status})`);
			return res.json();
		});
	};

	// The table, the locale, the formatter locale and <html lang> switch together.
	const apply = (tag, strings) => {
		table = strings;
		locale = tag;
		onLocale?.(tag);
		if (typeof document !== 'undefined') document.documentElement.lang = tag;
	};

	// The startup load: the active locale, falling back ONCE to the default when
	// that file fails. Only a failure of the default too rejects.
	const begin = (tag) => {
		const my = ++token;
		const p = load(tag)
			.catch((err) => {
				if (tag === defaultLocale) throw err;
				if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
					console.warn(`[puzzle] locale "${tag}" failed to load — falling back to "${defaultLocale}"`, err);
				}
				tag = defaultLocale;
				return load(tag);
			})
			.then((strings) => {
				if (my === token) apply(tag, strings);
			});
		// The failure is reported through __ready(); nothing else may observe it.
		p.catch(() => {});
		pending = p;
		return p;
	};

	const canonical = (tag) =>
		typeof tag === 'string' ? tags.find((t) => t.toLowerCase() === tag.toLowerCase()) : undefined;

	const initial =
		canonical(options.locale) ??
		selectLocale(tags, defaultLocale, readStoredLocale(), viewerLanguages());

	const service = {
		/** The active locale tag. */
		get locale() {
			return locale;
		},
		/** Every configured locale, in config order. */
		locales: tags,
		defaultLocale,

		/**
		 * Look `key` up in the active table. A missing key prints the key itself;
		 * `vars` fill `{name}` placeholders, and a `count` picks a plural form.
		 */
		t(key, vars) {
			if (key == null) return '';
			key = String(key);
			if (!table) {
				if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
					warnOnce(
						'\0' + key,
						`[puzzle] t("${key}") ran before the translations loaded — printing the key`
					);
				}
				return key;
			}
			if (!Object.hasOwn(table, key)) {
				if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
					const near = nearestFormatter(table, key);
					warnOnce(
						locale + '\0' + key,
						`[puzzle] translation "${key}" is missing from "${locale}" — printing the key` +
							(near ? ` (did you mean "${near}"?)` : '')
					);
				}
				return key;
			}
			const hasVars = vars !== null && typeof vars === 'object' && !Array.isArray(vars);
			if ((typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) && vars != null && !hasVars) {
				warnOnce(
					'\0vars' + key,
					`[puzzle] t("${key}"): variables must be an object like { name: value } — ignoring them`
				);
			}
			let text = table[key];
			if (typeof text === 'object') {
				const count = hasVars ? vars.count : undefined;
				if (count == null) {
					if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
						warnOnce(
							'\0count' + key,
							`[puzzle] translation "${key}" is a plural entry, but no count was passed — using its "other" form`
						);
					}
					text = text.other;
				} else {
					text = text[pluralCategory(locale, Number(count))] ?? text.other;
				}
			}
			return hasVars ? fillPlaceholders(text, vars, locale) : text;
		},

		/**
		 * Switch to a configured locale. The new table is fetched FIRST; only once it
		 * arrives does anything change, and then the app re-renders once. A failed
		 * fetch rejects and changes nothing. Overlapping calls resolve last-wins.
		 * An unconfigured tag throws a RangeError.
		 */
		setLocale(tag) {
			const match = canonical(tag);
			if (!match) {
				throw new RangeError(
					`[puzzle] setLocale(${JSON.stringify(tag)}): not a configured locale (${tags.join(', ')})`
				);
			}
			const my = ++token;
			const p = load(match).then(
				(strings) => {
					if (my !== token) return;
					apply(match, strings);
					storeLocale(match);
					return refresh?.();
				},
				(err) => {
					// A switch that superseded the startup load and then failed would leave
					// no table at all: restart the startup load behind it.
					if (my === token && !table) begin(initial);
					throw err;
				}
			);
			pending = p;
			return p;
		},

		/**
		 * INTERNAL — settles once the latest load has, following any setLocale()
		 * that superseded the startup load. Rejects only when no table could be
		 * loaded at all (the active locale and the default both failed).
		 */
		async __ready() {
			let p;
			while (p !== pending) {
				p = pending;
				try {
					await p;
				} catch (err) {
					if (p === pending && !table) throw err;
				}
			}
		},
	};

	begin(initial);
	return service;
}

/**
 * Register the service-bound `t` formatter (D175) unless the app registered its
 * own — an app `t` wins, like an app `link` does.
 */
export function installTranslate(registry, i18n) {
	if (!registry.getAll().t) registry.register('t', (key, vars) => i18n.t(key, vars));
}
