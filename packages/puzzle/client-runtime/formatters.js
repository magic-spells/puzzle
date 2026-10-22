/**
 * FormatterRegistry — the function library (D176 §4): the built-in functions and
 * the app's own, which a template calls as `name(value, …args)` for display-only
 * transforms (constellation/doc/DOC-SPEC.md §6). Apps register theirs through
 * the `formatters` config map, which keeps its name.
 *
 * Compiled render code receives the RAW function map (getAll()), never the registry
 * instance: it calls `__formatters.escape(...)` and, for every library call,
 * `(__formatters.name || __formatters.__missing('name'))(...)` directly — the
 * __missing typo-guard (v1.12, D43).
 *
 * Renamed from FilterRegistry (D7), with the prototype's bugs fixed: null/undefined
 * render as '', `round` returns a number, `number_with_delimiter` keeps decimals.
 */

import manifestFormatters from '@magic-spells/puzzle/formatters/manifest';
import { escape } from './formatters/builtins.js';

/** @import { Formatter, LinkOptions } from '../types/index.js' */

// `raw` is no longer seeded here (D174): templates reach it only through the
// live-HTML node, never through the registry, and seeding it would pull the
// sanitizer into every bundle.
const requiredBuiltins = { escape };

// The standard library (D174, D176 §4): the names Sites implements with the
// same arguments and meaning. An app function registered under one of these
// draws a development warning, because the app's templates no longer mean what
// the standard name means. The PuzzleKit-only built-ins (`link`, `timeago`) are
// deliberately absent — overriding those is ordinary. `t` is standard (D175) but
// not a built-in: the i18n service registers it when the app configures
// translations. `in_timezone` joined the standard set with D176: no JavaScript
// in the expression language re-expresses an instant in another zone. What a
// JavaScript method or `Math` global covers is not in it (REMOVED_FORMATTERS
// names each replacement), and `round` stays because nothing in JavaScript
// rounds to places in one call.
// Referenced only behind `__PUZZLE_DEV__`, so production tree-shakes it.
export const STANDARD_FORMATTERS = [
	'round', 'currency', 'percentage', 'number_with_delimiter', 'compact_number', 'pluralize',
	'capitalize', 'truncate', 'strip_html', 'strip_newlines',
	'escape', 'raw', 'newline_to_br', 'json',
	'date', 'time', 'datetime', 'in_timezone',
	't',
];

// The PuzzleKit-only library names — built in, but not standard (D174). Dev-only.
const PUZZLEKIT_FORMATTERS = ['link', 'timeago'];

// Removed built-ins (D174, D176) and what replaces each, for the unknown-name
// guard: a list is shaped and counted with array methods and `.length`,
// arithmetic is the operators, a fallback is `??`, and a string or number
// transform JavaScript already has is its method or `Math` global (D176 §3–4).
// Dev-only, like STANDARD_FORMATTERS.
const OPERATOR_HINT = 'use the operator (`a + b`, `a - b`, `a * b`, `a / b`, `a % b`)';
/** @type {Record<string, string>} */
const REMOVED_FORMATTERS = {
	sort: 'use `.toSorted()` (`items.toSorted((a, b) => a.rank - b.rank)`)',
	where: 'use `.filter()` (`items.filter((item) => item.done)`)',
	map: 'use `.map()` (`items.map((item) => item.name)`)',
	uniq: 'dedupe the list in data() and loop over that field',
	reverse: 'use `.toReversed()`',
	compact: 'use `.filter()` (`items.filter((item) => item != null)`); for a short count, compact_number',
	first: 'use `items[0]` or `items.at(0)`',
	last: 'use `items.at(-1)`',
	// 0.7's noescape printed its value as text; raw() renders sanitized HTML.
	noescape: 'print it with a plain `{ value }` — raw() is only for HTML you mean to render',
	size: 'use the `.length` property (`items.length`)',
	plus: OPERATOR_HINT,
	minus: OPERATOR_HINT,
	times: OPERATOR_HINT,
	divided_by: OPERATOR_HINT,
	modulo: OPERATOR_HINT,
	default: "use `??` (`{ name ?? 'fallback' }`)",
	split: "use `.split()` (`tags.split(',')`)",
	upcase: 'use `.toUpperCase()` (`name.toUpperCase()`)',
	downcase: 'use `.toLowerCase()` (`name.toLowerCase()`)',
	trim: 'use `.trim()`',
	strip: 'use `.trim()`',
	replace:
		"use `.replaceAll(search, replacement)` for plain strings, or `.split(search).join(replacement ?? '')`, which is what this did — `.join()` with no argument joins with ','",
	join: "use `.join(', ')` — this joined with ', ' by default, and `.join()` with no argument joins with ','",
	abs: 'use `Math.abs(x)`',
	ceil: 'use `Math.ceil(x)`',
	floor: 'use `Math.floor(x)`',
};

// Levenshtein edit distance — tight two-row DP, no dependency. Powers the
// did-you-mean suggestion in the unknown-formatter guard (D43). Module-level (not a
// method) and referenced ONLY from behind the `__PUZZLE_DEV__` guard in __missing,
// so a production build (where __PUZZLE_DEV__ folds to false) DCE's that branch and
// tree-shakes both this and nearestFormatter out — ~0.5 KB that no longer ships dead.
/** @param {string} a @param {string} b @returns {number} */
function editDistance(a, b) {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	let prev = new Array(n + 1);
	let curr = new Array(n + 1);
	for (let j = 0; j <= n; j++) prev[j] = j;
	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		const tmp = prev;
		prev = curr;
		curr = tmp;
	}
	return prev[n];
}

// Nearest registered formatter name within edit distance ≤ 2, or null when nothing
// is close (D43 did-you-mean). First match wins on ties. Module-level for the same
// tree-shaking reason as editDistance above. Also the i18n service's did-you-mean
// over a locale table's keys (D175), from behind the same development probe.
/**
 * @param {Record<string, unknown>} formatters the names to search (its keys)
 * @param {string} name the unknown name
 * @returns {string | null}
 */
export function nearestFormatter(formatters, name) {
	let best = null;
	let bestDist = 3; // strictly-less-than test below accepts ≤ 2
	for (const key of Object.keys(formatters)) {
		if (key === '__missing') continue;
		const d = editDistance(name, key);
		if (d < bestDist) {
			bestDist = d;
			best = key;
		}
	}
	return best;
}

export class FormatterRegistry {
	/** @param {Record<string, Formatter>} [seedMap] */
	constructor(seedMap = manifestFormatters) {
		/**
		 * The raw function map, plus the `__missing` factory: `(name) => Formatter`.
		 * @type {Record<string, Formatter>}
		 */
		this.formatters = Object.create(null);
		// Warn-once ledger for the unknown-formatter guard (D43). Instance-level,
		// not module-level: warnings are scoped to a registry's lifetime, so each
		// PuzzleApp reports its own typos and test cases don't leak a "warned"
		// flag into one another (a module-level Set would silence a second app or
		// a second test that hits the same name). Matches the malformed-animation /
		// duplicate-key warn-once pattern.
		/** @type {Set<string>} */
		this._warnedMissing = new Set();

		for (const [name, fn] of Object.entries(seedMap || {})) {
			this.register(name, fn);
		}
		for (const [name, fn] of Object.entries(requiredBuiltins)) {
			if (!this.formatters[name]) this.register(name, fn);
		}

		// Unknown-function guard (v1.12, D43): __missing is a FACTORY. Codegen
		// emits `(__f.name || __f.__missing('name'))(value, …)`, so an unregistered
		// name lands here with its own spelling. We log ONE console.error per
		// unknown name (with a did-you-mean when a registered name is within edit
		// distance ≤ 2) and return a pass-through function, so a display-only typo
		// renders the raw value instead of taking down the render loop. See §6.
		this.formatters.__missing = /** @param {string} name @returns {Formatter} */ (name) => {
			// Dev-only: report the typo ONCE (with a did-you-mean). Wrapped in the
			// __PUZZLE_DEV__ guard so a production build DCE's the whole block — and with
			// it nearestFormatter + editDistance (the warn-once ledger only exists to
			// dedupe this console output, which prod strips anyway). Undefined guard →
			// treat as dev (tests / bare node run without the define).
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				if (!this._warnedMissing.has(name)) {
					this._warnedMissing.add(name);
					// `t` is service-bound (D175): it exists only when the app configures
					// translations, so the useful hint is how to turn them on.
					if (name === 't') {
						console.error(
							"[puzzle] t() needs translations — add i18n: { locales: ['en'], defaultLocale: 'en' } to puzzle.config.js and app/locales/en.json; the key passes through unchanged",
						);
						return (v) => v;
					}
					if (Object.hasOwn(REMOVED_FORMATTERS, name)) {
						console.error(
							`[puzzle] "${name}" was removed from the function library — ${REMOVED_FORMATTERS[name]}; value passed through unchanged`,
						);
						return (v) => v;
					}
					const suggestion = nearestFormatter(this.formatters, name);
					const hint = suggestion ? ` (did you mean "${suggestion}"?)` : '';
					console.error(
						`[puzzle] unknown function "${name}" — value passed through unchanged${hint}`,
					);
				}
			}
			return (v) => v;
		};
	}

	/** @param {string} name @param {Formatter} fn */
	register(name, fn) {
		if (typeof name !== 'string' || name === '') {
			throw new Error('[puzzle] formatter name must be a non-empty string');
		}
		if (typeof fn !== 'function') {
			throw new Error(`[puzzle] formatter "${name}" must be a function (got ${typeof fn})`);
		}
		this.formatters[name] = fn;
	}

	/** @param {string} name @returns {Formatter} */
	get(name) {
		// Stay consistent with the compiled call form (D43): return a callable for
		// unknown names too — the __missing factory logs once and yields a
		// pass-through formatter.
		return this.formatters[name] || this.formatters.__missing(name);
	}

	// The raw function map — this is what compiled render code receives
	/** @returns {Record<string, Formatter>} */
	getAll() {
		return this.formatters;
	}
}

/**
 * Build the application formatter registry in one place: manifest-selected
 * built-ins first, app formatters over them, then the router-backed `link`
 * formatter only when the app did not provide its own implementation.
 *
 * @param {object} [customFormatters] name → formatter function
 * @param {(path: string, options?: LinkOptions) => string} [url] mode-aware route URL
 *   encoder; `options` reaches it only under locale prefix routing (D177)
 * @returns {FormatterRegistry}
 */
export function makeFormatterRegistry(customFormatters = {}, url) {
	const registry = new FormatterRegistry();
	for (const [name, fn] of Object.entries(customFormatters)) {
		// Shadowing a standard name is allowed — the app's function wins — but it
		// is worth a development warning (D174). Never a throw.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (name === 'raw' || name === 'newline_to_br') {
				// The markup pair is lowered by the compiler (D174): templates never call
				// the registry for either name, so the app's function is unreachable there.
				console.warn(
					`[puzzle] app function "${name}" is never called from templates — "${name}" renders through the built-in sanitizer`,
				);
			} else if (STANDARD_FORMATTERS.includes(name)) {
				console.warn(
					`[puzzle] app function "${name}" shadows the standard function of the same name; templates calling ${name}() now get the app's`,
				);
			}
		}
		registry.register(name, fn);
	}
	if (!registry.getAll().link && typeof url === 'function') {
		registry.register(
			'link',
			// Locale prefix routing (D177) passes `options` ({ locale: 'es' } or
			// { locale: false }) through to the encoder; without it the second
			// argument is not even read, so those apps ship the one-argument form.
			typeof __PUZZLE_HAS_LOCALE_ROUTING__ === 'undefined' || __PUZZLE_HAS_LOCALE_ROUTING__
				? (value, options) => (value == null ? '' : url(String(value), options))
				: (value) => {
						if (value == null) return '';
						return url(String(value));
					}
		);
	}
	return registry;
}

// Warn-once ledger for warnHandlerShadows, keyed by view and handler name.
/** @type {Set<string> | undefined} */
let warnedShadows;

/**
 * Development only (D176 §4): warn once per view and name when an `@event`
 * handler shares its name with a library function. Inside an `@event` value a
 * bare `save(…)` calls the view's handler; everywhere else it calls the library,
 * so one name would mean two things in one template. The library here is the
 * standard and PuzzleKit-only names plus whatever this app registered (its own
 * functions, `t`, `link`). PuzzleView.mount() calls this from behind the inline
 * `__PUZZLE_DEV__` probe, so production drops it.
 *
 * @param {{ events?: any, ctx?: any, constructor?: { __pzlModule?: string, name?: string } }} view
 *   a PuzzleView instance (reads `events` and `ctx.formatters`)
 */
export function warnHandlerShadows(view) {
	const events = view.events;
	if (events === null || typeof events !== 'object') return;
	const registered = view.ctx?.formatters?.getAll?.();
	for (const name of Object.keys(events)) {
		if (name === '__missing') continue;
		const registeredHere = registered != null && Object.hasOwn(registered, name);
		const inLibrary =
			registeredHere || STANDARD_FORMATTERS.includes(name) || PUZZLEKIT_FORMATTERS.includes(name);
		if (!inLibrary) continue;
		const where = view.constructor?.__pzlModule || view.constructor?.name || 'a view';
		const key = where + '\0' + name;
		if ((warnedShadows ??= new Set()).has(key)) continue;
		warnedShadows.add(key);
		console.warn(
			`[puzzle] ${where}: handler \`${name}\` shadows the library function \`${name}\` inside @event — ${name}(…) in an @event value calls the handler, and the library function everywhere else; rename the handler to keep one meaning per name`,
		);
	}
}

export default FormatterRegistry;
