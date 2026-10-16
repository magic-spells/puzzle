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
import { Linter } from 'eslint';

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
const BINDING_NAME = '[$_\\p{ID_Start}][$_\\u200c\\u200d\\p{ID_Continue}]*';
const FOR_ITEM = new RegExp(`^#for\\s+(${BINDING_NAME})\\s+in\\s+`, 'u');
const FOR_COUNTER = new RegExp(`,\\s*(${BINDING_NAME})\\s*$`, 'u');
const selectorLinter = new Linter();

// Only <Component>'s is selector reads module bindings. Use ESLint's own parser
// and scope analysis to find their free names: property keys, quoted text and
// arrow parameters are not reads. Enclosing template bindings are parameters
// of the wrapper, so a loop item or snippet parameter shadows a module name.
function collectSelectorBindings(expr, names, localScopes) {
	const locals = [...new Set(localScopes.flatMap((scope) => scope.names))];
	const messages = selectorLinter.verify(`(${locals.join(',')}) => (${expr})`, {});
	if (messages.some((message) => message.fatal)) return; // compiler owns syntax errors
	for (const reference of selectorLinter.getSourceCode().scopeManager.globalScope.through) {
		names.add(reference.identifier.name);
	}
}

// Read an opening tag without interpreting ordinary template expressions. The
// same brace/quote skips used for tag discovery also protect spread values
// containing markup or a section-close sentinel.
function readOpenTagAttrs(s, i) {
	const attrs = [];
	while (i < s.length) {
		if (s[i] === '>') return { attrs, end: i + 1, selfClosing: false };
		if (s.startsWith('/>', i)) return { attrs, end: i + 2, selfClosing: true };
		if (/\s/u.test(s[i])) { i++; continue; }
		if (s[i] === '{') { i = skipBraceSpan(s, i); continue; }
		const name = /^[^\s=/>{'"]+/u.exec(s.slice(i))?.[0];
		if (!name) { i++; continue; }
		i += name.length;
		while (i < s.length && /\s/u.test(s[i])) i++;
		const expressions = [];
		const bare = s[i] !== '=';
		if (!bare) {
			i++;
			while (i < s.length && /\s/u.test(s[i])) i++;
			if (s[i] === '{') {
				const group = scanBraceGroup(s, i);
				if (!group.err) expressions.push(group.inner);
				i = group.err ? i + 1 : group.end;
			} else if (s[i] === '"' || s[i] === "'") {
				const end = skipQuotedValue(s, i);
				for (let valueAt = i + 1; valueAt < end - 1;) {
					if (s[valueAt] === '\\' && (s[valueAt + 1] === '{' || s[valueAt + 1] === '}')) {
						valueAt += 2;
					} else if (s[valueAt] === '{') {
						const group = scanBraceGroup(s, valueAt);
						if (!group.err) expressions.push(group.inner);
						valueAt = group.err ? valueAt + 1 : group.end;
					} else valueAt++;
				}
				i = end;
			} else {
				while (i < s.length && !/[\s>]/u.test(s[i]) && !s.startsWith('/>', i)) i++;
			}
		}
		attrs.push({ name, bare, expressions });
	}
	return { attrs, end: i, selfClosing: false };
}

function popLocalScope(localScopes, kind) {
	const at = localScopes.findLastIndex((scope) => scope.kind === kind);
	if (at >= 0) localScopes.splice(at);
}

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
	const localScopes = [];
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
			const group = scanBraceGroup(s, i);
			if (!group.err) {
				const inner = group.inner.trim();
				if (/^#for\s/u.test(inner)) {
					const locals = [FOR_ITEM.exec(inner)?.[1], FOR_COUNTER.exec(inner)?.[1]].filter(Boolean);
					localScopes.push({ kind: 'for', names: locals });
				} else if (/^\/\s*for\s*$/u.test(inner)) popLocalScope(localScopes, 'for');
			}
			i = skipBraceSpan(s, i);
		} else if (s[i] === '<') {
			if (s.startsWith('</Snippet', i) && /[\s>]/u.test(s[i + 9] || '')) {
				popLocalScope(localScopes, 'snippet');
			}
			const root = matchAt(TAG_ROOT, s, i + 1);
			if (!root) {
				i++;
				continue;
			}
			const nameEnd = i + 1 + root.length;
			const rest = matchAt(TAG_REST, s, nameEnd);
			if (!(root[0] >= 'a' && root[0] <= 'z') && root !== 'Component') names.add(root);
			if ((root === 'Component' || root === 'Snippet') && !rest) {
				const tag = readOpenTagAttrs(s, nameEnd);
				if (root === 'Component') {
					for (const attr of tag.attrs) {
						if (attr.name !== 'is') continue;
						for (const expr of attr.expressions) collectSelectorBindings(expr, names, localScopes);
					}
				} else if (!tag.selfClosing) {
					localScopes.push({ kind: 'snippet', names: tag.attrs.filter((attr) => attr.bare).map((attr) => attr.name) });
				}
				i = tag.end;
			} else i = skipOpenTagAttrs(s, nameEnd + rest.length);
		} else {
			i++;
		}
	}
}

// componentTags returns the root names of every component tag in the
// template sections and the free names in <Component is={...}>. Markers
// (Slot, Children, Snippet, Portal) come along too;
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
// the way react/jsx-uses-vars does for JSX. The <Component> is selector also reads
// module bindings; ordinary expressions (`{ title }`) read view data (D176),
// so they mark nothing. Reserved Component tags never use a same-named import.
export const usesTemplateComponents = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Mark template component tags and the dynamic Component is selector as script binding uses',
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
