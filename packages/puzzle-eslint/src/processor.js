// processor.js — the ESLint processor for .pzl files.
//
// Design: this is a PROCESSOR, not a parser. Puzzle .pzl files are not JS, but
// their <script> body IS real JavaScript/TypeScript, byte-for-byte. Rather than
// teach ESLint a new grammar, we extract the <script> body into one virtual JS
// (or TS) file and let the user's existing ESLint rules — and any parser they
// layer on, e.g. @typescript-eslint — lint it.
//
// The virtual file is the ORIGINAL source with every code unit OUTSIDE the
// <script> body replaced by a single space, preserving '\n' and '\r' exactly.
// That keeps offsets, lines, and columns identical to the real file, so message
// positions AND autofix ranges map 1:1 with no remapping. Fixes therefore only
// ever touch bytes inside the <script> body; the rest of the .pzl is untouched.
//
// Section-structure errors (missing <puzzle-view>, duplicate sections, illegal
// section attributes, a body truncated by a stray close tag, …) are collected
// during preprocess and injected as synthetic ESLint messages in postprocess,
// keyed by filename through a module-level Map.

import { splitSections } from './split.js';

// Carries splitter errors from preprocess to postprocess, keyed by filename.
const errorStore = new Map();

// SECTION_RULE_ID is the synthetic rule id attached to injected section errors.
const SECTION_RULE_ID = 'puzzle/no-invalid-sections';

// blankOutside returns a copy of src with every char outside [start, end)
// replaced by a space, except '\n' and '\r' which are preserved so line
// structure is byte-identical.
function blankOutside(src, start, end) {
	const out = new Array(src.length);
	for (let i = 0; i < src.length; i++) {
		if (i >= start && i < end) {
			out[i] = src[i];
		} else {
			const c = src[i];
			out[i] = c === '\n' || c === '\r' ? c : ' ';
		}
	}
	return out.join('');
}

export const processor = {
	meta: {
		name: '@magic-spells/eslint-plugin-puzzle/processor',
		version: '0.1.0',
	},

	supportsAutofix: true,

	preprocess(text, filename) {
		const { sections, errors } = splitSections(text, filename);
		errorStore.set(filename, errors);

		// No <script> section → nothing to lint as JS. Splitter errors are still
		// surfaced in postprocess (which ESLint calls with an empty message set).
		if (!sections.scripts) {
			return [];
		}

		const { contentStart, contentEnd, lang } = sections.scripts;
		const virtual = blankOutside(text, contentStart, contentEnd);
		const ext = lang === 'ts' ? 'ts' : 'js';

		return [{ text: virtual, filename: `0_scripts.${ext}` }];
	},

	postprocess(messages, filename) {
		const injected = errorStore.get(filename) || [];
		errorStore.delete(filename);

		// messages is an array of per-block message arrays. Only block 0 exists
		// (the extracted <script> body), but flatten defensively.
		const flat = [];
		for (const block of messages || []) {
			for (const m of block) flat.push(m);
		}

		for (const e of injected) {
			flat.push({
				ruleId: SECTION_RULE_ID,
				severity: 2,
				message: e.message,
				line: e.line,
				column: e.column,
				endLine: e.line,
				endColumn: e.column + 1,
			});
		}

		return flat;
	},
};

export default processor;
