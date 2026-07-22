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
import { escape, raw, noescape } from './formatters/builtins.js';

const requiredBuiltins = { escape, raw, noescape };

// Levenshtein edit distance — tight two-row DP, no dependency. Powers the
// did-you-mean suggestion in the unknown-formatter guard (D43).
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
			if (!this._warnedMissing.has(name)) {
				this._warnedMissing.add(name);
				const suggestion = this._nearestFormatter(name);
				const hint = suggestion ? ` (did you mean "${suggestion}"?)` : '';
				console.error(
					`[puzzle] unknown formatter "${name}" — value passed through unchanged${hint}`,
				);
			}
			return (v) => v;
		};
	}

	register(name, fn) {
		this.formatters[name] = fn;
	}

	// Nearest registered formatter name within edit distance ≤ 2, or null when
	// nothing is close (D43 did-you-mean). First match wins on ties.
	_nearestFormatter(name) {
		let best = null;
		let bestDist = 3; // strictly-less-than test below accepts ≤ 2
		for (const key of Object.keys(this.formatters)) {
			if (key === '__missing') continue;
			const d = editDistance(name, key);
			if (d < bestDist) {
				bestDist = d;
				best = key;
			}
		}
		return best;
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

export default FormatterRegistry;
