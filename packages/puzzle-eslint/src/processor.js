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

import {
	splitSections,
	scanBraceGroup,
	scanInlineComment,
	isBlockCommentOpen,
	scanBlockComment,
	isBlockRawOpen,
	scanBlockRaw,
} from './split.js';

// Carries splitter errors from preprocess to postprocess, keyed by filename.
const errorStore = new Map();

// SECTION_RULE_ID is the synthetic rule id attached to injected section errors.
const SECTION_RULE_ID = 'puzzle/no-invalid-sections';

// Carries the component names each file's template renders, keyed by filename,
// from preprocess to the puzzle/uses-template-components rule.
const tagStore = new Map();

// TAG_ROOT reads a tag name's root identifier after '<'. Tag names start like
// the compiler lexer's startsTagName (ASCII letter, '_', or a non-ASCII
// identifier start; never '$'), so <$50 is text. The root stops at the first
// '.', so <Frame.Header> yields Frame, the binding the family tag renders.
// TAG_REST consumes the remainder of the name (D167 name characters).
const TAG_ROOT = /[_\p{ID_Start}]\p{ID_Continue}*/uy;
const TAG_REST = /[\p{ID_Continue}\-:.]*/uy;

// matchAt runs a sticky regex at s[i] and returns the match text or ''.
function matchAt(re, s, i) {
	re.lastIndex = i;
	const m = re.exec(s);
	return m ? m[0] : '';
}

// skipBraceSpan steps over a template construct opening at s[i] === '{': an
// inline {## } or block {#comment} comment, or a balanced {…} group. A
// malformed group advances one char, leaving the rest for the compiler to
// report, as findTemplateClose in split.js does.
function skipBraceSpan(s, i) {
	let res;
	if (s.startsWith('{##', i)) {
		res = scanInlineComment(s, i);
	} else if (isBlockCommentOpen(s, i)) {
		res = scanBlockComment(s, i);
	} else {
		res = scanBraceGroup(s, i);
	}
	return res.err ? i + 1 : res.end;
}

// skipQuotedValue steps from an attribute value's opening quote at s[open] to
// just past its closing quote, mirroring the compiler lexer's lexQuotedValue:
// a \{ or \} escape is two plain chars, and a '{' runs the shared brace scan,
// so a quote inside an expression (title="{ q ? '"' : '' }") does not end the
// value. An unclosed brace group falls back to the next matching quote.
function skipQuotedValue(s, open) {
	const q = s[open];
	for (let i = open + 1; i < s.length;) {
		const c = s[i];
		if (c === '\\' && (s[i + 1] === '{' || s[i + 1] === '}')) {
			i += 2;
		} else if (c === '{') {
			const bg = scanBraceGroup(s, i);
			if (bg.err) {
				const end = s.indexOf(q, i + 1);
				return end < 0 ? s.length : end + 1;
			}
			i = bg.end;
		} else if (c === q) {
			return i + 1;
		} else {
			i++;
		}
	}
	return s.length;
}

// skipOpenTagAttrs steps from just past a tag name to just past the tag's
// closing '>', stepping over quoted attribute values and {…} groups so a '<'
// or '>' inside either is not markup.
function skipOpenTagAttrs(s, i) {
	while (i < s.length) {
		const c = s[i];
		if (c === '>') return i + 1;
		if (c === '"' || c === "'") {
			i = skipQuotedValue(s, i);
		} else if (c === '{') {
			i = skipBraceSpan(s, i);
		} else {
			i++;
		}
	}
	return i;
}

// collectComponentTags adds to names the root of every component tag in the
// template text s. A component tag (D167) is one whose name's first character
// is anything but an ASCII lowercase letter (<Card>, <Élan>, <_Row>, <Ωmega>).
// Only ordinary markup counts: the walk mirrors findTemplateClose in split.js,
// skipping <!-- --> comments, \{ \} escapes, {#raw} spans, template comments
// and {…} expressions, and each open tag's attribute values, so a tag written
// inside any of those (<!-- <Old/> -->, { '<Card>' }, title="<Card>") is not
// a use.
function collectComponentTags(s, names) {
	for (let i = 0; i < s.length;) {
		if (s.startsWith('<!--', i)) {
			const end = s.indexOf('-->', i + 4);
			i = end < 0 ? i + 4 : end + 3;
		} else if (s[i] === '\\' && (s[i + 1] === '{' || s[i + 1] === '}')) {
			i += 2;
		} else if (isBlockRawOpen(s, i)) {
			const raw = scanBlockRaw(s, i);
			i = raw.err ? s.length : raw.end;
		} else if (s[i] === '{') {
			i = skipBraceSpan(s, i);
		} else if (s[i] === '<') {
			const root = matchAt(TAG_ROOT, s, i + 1);
			if (!root) {
				i++;
				continue;
			}
			if (!(root[0] >= 'a' && root[0] <= 'z')) names.add(root);
			const nameEnd = i + 1 + root.length;
			i = skipOpenTagAttrs(s, nameEnd + matchAt(TAG_REST, s, nameEnd).length);
		} else {
			i++;
		}
	}
}

// componentTags returns the root names of every component tag in the
// template sections. Markers (Slot, Children, Snippet, Portal) come along too;
// they are never script bindings, so marking them used is a no-op.
function componentTags(sections) {
	const names = new Set();
	for (const section of [sections.view, sections.skeleton]) {
		if (section) collectComponentTags(section.content, names);
	}
	return names;
}

// blankOutside returns a copy of src with every char outside [start, end)
// replaced by a space, except '\n' and '\r' which are preserved so line
// structure is byte-identical, and a leading BOM (U+FEFF at index 0), which
// is kept so ESLint strips it from the virtual text exactly as it strips it
// from the physical file — otherwise every autofix range lands one code unit
// early.
function blankOutside(src, start, end) {
	const out = new Array(src.length);
	for (let i = 0; i < src.length; i++) {
		if (i >= start && i < end) {
			out[i] = src[i];
		} else {
			const c = src[i];
			out[i] = c === '\n' || c === '\r' || (i === 0 && c === '\uFEFF') ? c : ' ';
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
		tagStore.set(filename, componentTags(sections));

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
		tagStore.delete(filename);

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

// usesTemplateComponents marks every component the template renders as used,
// the way react/jsx-uses-vars does for JSX: <Card> is the only template
// construct that reads a <script> binding, so an import used only as a tag is
// not unused. It never reports. Template expressions (`{ title }`) read view
// data, never script bindings (D176), so they mark nothing.
export const usesTemplateComponents = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Mark components rendered as template tags as used by the <script> body',
		},
		schema: [],
	},
	create(context) {
		return {
			Program() {
				for (const name of tagStore.get(context.physicalFilename) || []) {
					context.sourceCode.markVariableAsUsed(name);
				}
			},
		};
	},
};

export default processor;
