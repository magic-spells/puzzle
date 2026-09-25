/**
 * FormatterRegistry — template formatters for display-only data transformation.
 *
 * Formatters are the `{ value | name(args) }` pipeline in templates (constellation/doc/DOC-SPEC.md §6).
 * Compiled render code receives the RAW function map (getAll()), never the registry
 * instance: it calls `__formatters.escape(...)` and, for every formatter call,
 * `(__formatters.name || __formatters.__missing('name'))(...)` directly — the
 * __missing typo-guard (v1.12, D43).
 *
 * Renamed from FilterRegistry (constellation/doc/DOC-DECISIONS.md D7) with fixes from
 * constellation/doc/DOC-CODE-REVIEW.md §2.6: null/undefined render as '', `round` returns a
 * number, `replace` replaces all occurrences, `number_with_delimiter` keeps
 * decimals.
 */

import manifestFormatters from '@magic-spells/puzzle/formatters/manifest';
import { escape, raw } from './formatters/builtins.js';

const requiredBuiltins = { escape, raw };

// The standard formatter set (D174): the names Sites implements with the same
// arguments and meaning. An app formatter registered under one of these draws a
// development warning, because the app's templates no longer mean what the
// standard name means. PuzzleKit-only built-ins (`link`, `timeago`,
// `in_timezone`) are deliberately absent — overriding those is ordinary.
// Referenced only behind `__PUZZLE_DEV__`, so production tree-shakes it.
export const STANDARD_FORMATTERS = [
	'abs', 'ceil', 'floor', 'plus', 'minus', 'times', 'divided_by', 'modulo', 'round',
	'currency', 'percentage',
	'downcase', 'upcase', 'capitalize', 'trim', 'strip', 'truncate', 'replace', 'split',
	'strip_html', 'strip_newlines',
	'escape', 'raw', 'newline_to_br',
	'default', 'size', 'join', 'json',
	'date', 'time', 'datetime', 'number_with_delimiter', 'compact_number', 'pluralize',
];

// Removed built-ins (D174) and what replaces each, for the unknown-name guard.
// List shaping is JavaScript in PuzzleKit. Dev-only, like STANDARD_FORMATTERS.
const REMOVED_FORMATTERS = {
	sort: 'sort the list in data() and loop over that field',
	where: 'filter the list in data() and loop over that field',
	map: 'map the list in data() and loop over that field',
	uniq: 'dedupe the list in data() and loop over that field',
	reverse: 'reverse the list in data() and loop over that field',
	compact: 'filter the list in data() (for a short count, use compact_number)',
	first: 'use items[0] in the expression',
	last: 'use items.at(-1) in the expression',
	noescape: 'use raw',
};

// Levenshtein edit distance — tight two-row DP, no dependency. Powers the
// did-you-mean suggestion in the unknown-formatter guard (D43). Module-level (not a
// method) and referenced ONLY from behind the `__PUZZLE_DEV__` guard in __missing,
// so a production build (where __PUZZLE_DEV__ folds to false) DCE's that branch and
// tree-shakes both this and nearestFormatter out — ~0.5 KB that no longer ships dead.
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
	constructor(seedMap = manifestFormatters) {
		this.formatters = Object.create(null);
		// Warn-once ledger for the unknown-formatter guard (D43). Instance-level,
		// not module-level: warnings are scoped to a registry's lifetime, so each
		// PuzzleApp reports its own typos and test cases don't leak a "warned"
		// flag into one another (a module-level Set would silence a second app or
		// a second test that hits the same name). Matches the malformed-animation /
		// duplicate-key warn-once pattern.
		this._warnedMissing = new Set();

		for (const [name, fn] of Object.entries(seedMap || {})) {
			this.register(name, fn);
		}
		for (const [name, fn] of Object.entries(requiredBuiltins)) {
			if (!this.formatters[name]) this.register(name, fn);
		}

		// Unknown-formatter guard (v1.12, D43): __missing is a FACTORY. Codegen
		// emits `(__f.name || __f.__missing('name'))(value, …)`, so an unregistered
		// name lands here with its own spelling. We log ONE console.error per
		// unknown name (with a did-you-mean when a registered name is within edit
		// distance ≤ 2) and return a pass-through formatter, so a display-only typo
		// renders the raw value instead of taking down the render loop. See §6.
		this.formatters.__missing = (name) => {
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
							"[puzzle] the t formatter needs translations — add i18n: { locales: ['en'], defaultLocale: 'en' } to puzzle.config.js and app/locales/en.json; the key passes through unchanged",
						);
						return (v) => v;
					}
					if (Object.hasOwn(REMOVED_FORMATTERS, name)) {
						console.error(
							`[puzzle] formatter "${name}" was removed — ${REMOVED_FORMATTERS[name]}; value passed through unchanged`,
						);
						return (v) => v;
					}
					const suggestion = nearestFormatter(this.formatters, name);
					const hint = suggestion ? ` (did you mean "${suggestion}"?)` : '';
					console.error(
						`[puzzle] unknown formatter "${name}" — value passed through unchanged${hint}`,
					);
				}
			}
			return (v) => v;
		};
	}

	register(name, fn) {
		if (typeof name !== 'string' || name === '') {
			throw new Error('[puzzle] formatter name must be a non-empty string');
		}
		if (typeof fn !== 'function') {
			throw new Error(`[puzzle] formatter "${name}" must be a function (got ${typeof fn})`);
		}
		this.formatters[name] = fn;
	}

	get(name) {
		// Stay consistent with the compiled call form (D43): return a callable for
		// unknown names too — the __missing factory logs once and yields a
		// pass-through formatter.
		return this.formatters[name] || this.formatters.__missing(name);
	}

	// The raw function map — this is what compiled render code receives
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
 * @param {(path: string) => string} [url] mode-aware route URL encoder
 * @returns {FormatterRegistry}
 */
export function makeFormatterRegistry(customFormatters = {}, url) {
	const registry = new FormatterRegistry();
	for (const [name, fn] of Object.entries(customFormatters)) {
		// Shadowing a standard name is allowed — the app's function wins — but it
		// is worth a development warning (D174). Never a throw.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (STANDARD_FORMATTERS.includes(name)) {
				console.warn(
					`[puzzle] app formatter "${name}" shadows the standard formatter of the same name; templates using "${name}" now get the app's function`,
				);
			}
		}
		registry.register(name, fn);
	}
	if (!registry.getAll().link && typeof url === 'function') {
		registry.register('link', (value) => {
			if (value == null) return '';
			return url(String(value));
		});
	}
	return registry;
}

export default FormatterRegistry;
