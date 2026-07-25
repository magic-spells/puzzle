// Client-side docs search over the same config that drives the sidebar and the
// /components index — no build step and no index file to ship.
//
// The demo builds as a single-page hash SPA (one dist/index.html), so a crawler
// like Pagefind has nothing to walk. What it does have is nav.js: every piece
// with its title, registry name, section, and the description lifted straight
// from its piece.json. Those descriptions are dense and specific, which makes
// them a genuinely good search surface — "outside click", "aria-activedescendant"
// and "clipboard" all find the right piece.
//
// Scope: piece metadata, not page prose or code samples. If `puzzle build
// --static` ever works here, the dialog can swap this module for Pagefind
// without touching its UI.

import { GETTING_STARTED, SECTIONS } from './nav.js';
import { DEMOS } from './demos.js';

// Points per term, highest signal first. A title hit should always outrank a
// description hit no matter how many times the term appears in the prose.
const SCORE = {
	titleExact: 100,
	titlePrefix: 60,
	titleWord: 40,
	title: 25,
	name: 20,
	description: 10,
	section: 5,
};

function normalize(value) {
	return String(value || '').toLowerCase();
}

// Word-boundary test without a per-term RegExp allocation in the hot loop.
function hasWordAt(haystack, term, from) {
	const at = haystack.indexOf(term, from);
	if (at < 0) return -1;
	const before = at === 0 ? ' ' : haystack[at - 1];
	return /[a-z0-9]/.test(before) ? hasWordAt(haystack, term, at + 1) : at;
}

function buildIndex() {
	const entries = [];

	for (const page of GETTING_STARTED) {
		entries.push({
			title: page.title,
			path: page.path,
			kind: 'Page',
			section: 'Getting started',
			description: '',
			name: '',
		});
	}

	for (const group of SECTIONS) {
		for (const item of group.items) {
			entries.push({
				title: item.title,
				path: item.path,
				kind: 'Component',
				section: group.label,
				description: item.description || '',
				name: item.name || '',
			});
		}
	}

	for (const demo of DEMOS) {
		entries.push({
			title: demo.title,
			path: demo.path,
			kind: 'Demo',
			section: 'Demos',
			description: demo.description || '',
			name: '',
		});
	}

	// Precompute the lowercase fields once — search() runs on every keystroke.
	return entries.map((entry) => ({
		...entry,
		_title: normalize(entry.title),
		_name: normalize(entry.name),
		_description: normalize(entry.description),
		_section: normalize(entry.section),
	}));
}

const INDEX = buildIndex();

export const SEARCH_COUNT = INDEX.length;

// Scores one entry against one term. Returns 0 when the term is absent, which
// is what makes the caller's AND semantics work.
function scoreTerm(entry, term) {
	let score = 0;

	if (entry._title === term) score += SCORE.titleExact;
	else if (entry._title.startsWith(term)) score += SCORE.titlePrefix;
	else if (hasWordAt(entry._title, term, 0) >= 0) score += SCORE.titleWord;
	else if (entry._title.includes(term)) score += SCORE.title;

	if (!score && entry._name.includes(term)) score += SCORE.name;
	if (entry._description.includes(term)) score += SCORE.description;
	if (entry._section.includes(term)) score += SCORE.section;

	return score;
}

/**
 * Rank the docs index against a query.
 *
 * Multi-word queries are AND: every term has to land somewhere on the entry, so
 * "date range" does not drag in every piece that merely mentions a date.
 *
 * @param {string} query raw input value
 * @param {number} limit maximum results
 * @returns {Array<{title,path,kind,section,description}>}
 */
export function searchDocs(query, limit = 12) {
	const terms = normalize(query)
		.split(/\s+/)
		.filter(Boolean);
	if (!terms.length) return [];

	const hits = [];
	for (const entry of INDEX) {
		let total = 0;
		let matchedAll = true;
		for (const term of terms) {
			const score = scoreTerm(entry, term);
			if (!score) {
				matchedAll = false;
				break;
			}
			total += score;
		}
		if (matchedAll) hits.push({ entry, score: total });
	}

	hits.sort((a, b) => b.score - a.score || a.entry._title.localeCompare(b.entry._title));

	return hits.slice(0, limit).map(({ entry }) => ({
		title: entry.title,
		path: entry.path,
		kind: entry.kind,
		section: entry.section,
		description: entry.description,
	}));
}
