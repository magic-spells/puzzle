// split.js — a faithful JavaScript port of the Puzzle compiler's .pzl section
// splitter (compiler/internal/parser/sections.go). It carves a .pzl file into its
// <puzzle-view> (required, exactly one), optional <puzzle-skeleton>, optional
// <script>, and optional <style> sections, tolerant of whitespace, order, and
// top-level HTML comments. The <script>/<style> close scans are language-aware
// so a literal close tag hidden in a comment/string/template does not truncate a
// body; the template close scan skips brace groups and HTML comments the same
// way. sections.go is the source of truth — this mirror is kept deliberately
// close to it. Errors carry a { loc: { start: { line, column } } } so Prettier
// surfaces a file-accurate position.
import {
	isSpaceByte,
	lexSkip,
	lexPlainEndsExpr,
	scanBraceGroup,
	scanInlineComment,
	scanBlockComment,
	isBlockCommentOpen,
} from './lex.js';

const SECTION_NAMES = ['puzzle-view', 'puzzle-skeleton', 'script', 'style'];

// A parse error Prettier can attribute to a position in the source.
class PzlSyntaxError extends SyntaxError {
	constructor(message, line, column) {
		super(message);
		this.name = 'PzlSyntaxError';
		// Prettier reads either `loc` or `{ line, column }`; provide both spellings.
		this.loc = { start: { line, column } };
	}
}

function lineCol(src, off) {
	if (off > src.length) off = src.length;
	let line = 1;
	let col = 1;
	for (let i = 0; i < off; i++) {
		if (src[i] === '\n') {
			line++;
			col = 1;
		} else {
			col++;
		}
	}
	return { line, col };
}

function posErr(src, off, msg) {
	const { line, col } = lineCol(src, off);
	return new PzlSyntaxError(msg, line, col);
}

function isBoundary(c) {
	return isSpaceByte(c) || c === '>' || c === '/';
}

// sectionTagAt reports whether src at i begins a section open or close tag.
function sectionTagAt(src, i) {
	if (src.startsWith('</', i)) {
		for (const n of SECTION_NAMES) {
			if (src.startsWith('</' + n, i)) return { name: n, isClose: true };
		}
		return { name: '', isClose: false };
	}
	for (const n of SECTION_NAMES) {
		if (src.startsWith('<' + n, i)) {
			const after = i + 1 + n.length;
			if (after >= src.length || isBoundary(src[after])) return { name: n, isClose: false };
		}
	}
	return { name: '', isClose: false };
}

// misnamedSectionTagAt recognizes the plural near-miss section names so the
// top-level scanner points at the correct spelling instead of falling through to
// the generic stray-content error. A boundary is required so similarly prefixed
// custom markup is still diagnosed as ordinary stray content. Mirrors
// misnamedSectionTagAt.
const MISNAMED_SECTIONS = [
	{ bad: 'scripts', good: 'script' },
	{ bad: 'styles', good: 'style' },
];

function misnamedSectionTagAt(src, i) {
	for (const m of MISNAMED_SECTIONS) {
		const prefix = '<' + m.bad;
		if (!src.startsWith(prefix, i)) continue;
		const after = i + prefix.length;
		if (after >= src.length || isBoundary(src[after])) return m;
	}
	return null;
}

// scanOpenTag finds the end of a section's open tag (the '>'), quote- and
// brace-aware. Returns { afterGT, attrsRaw }. Mirrors scanOpenTag.
function scanOpenTag(src, i, name) {
	let j = i + 1 + name.length;
	const attrStart = j;
	let quote = 0;
	while (j < src.length) {
		const c = src[j];
		if (quote) {
			if (c === quote) quote = 0;
			j++;
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			j++;
			continue;
		}
		if (c === '{') {
			const g = scanBraceGroup(src, j);
			if (!g.ok) throw posErr(src, j, `unclosed '{' in <${name}> tag`);
			j = g.end;
			continue;
		}
		if (c === '>') {
			return { afterGT: j + 1, attrsRaw: src.slice(attrStart, j).trim() };
		}
		j++;
	}
	throw posErr(src, i, `unterminated <${name}> tag`);
}

// findScriptClose scans a <script> body from `from` for its real </script>,
// skipping JS strings, template literals, regex literals, and comments via
// lexSkip. Returns the close tag's '<' index RELATIVE to `from`, or -1. Mirrors
// findScriptClose.
function findScriptClose(s, from) {
	let prevEndsExpr = false;
	for (let i = from; i < s.length; ) {
		if (s.startsWith('</script>', i)) return i - from;
		const r = lexSkip(s, i, prevEndsExpr);
		if (r.consumed) {
			prevEndsExpr = r.pee;
			i = r.next;
			continue;
		}
		prevEndsExpr = lexPlainEndsExpr(s[i], prevEndsExpr);
		i++;
	}
	return -1;
}

// skipCSSString returns the index just past a CSS string opened at s[i]. Mirrors
// skipCSSString.
function skipCSSString(s, i) {
	const q = s[i];
	for (let j = i + 1; j < s.length; ) {
		if (s[j] === '\\') {
			j += 2;
			continue;
		}
		if (s[j] === q) return j + 1;
		j++;
	}
	return s.length;
}

// findStyleClose scans a <style> body from `from` for its real </style>,
// skipping CSS block comments and quoted strings. Returns the close tag's '<'
// index RELATIVE to `from`, or -1. Mirrors findStyleClose.
function findStyleClose(s, from) {
	for (let i = from; i < s.length; ) {
		if (s.startsWith('</style>', i)) return i - from;
		if (s.startsWith('/*', i)) {
			const end = s.indexOf('*/', i + 2);
			if (end < 0) return -1; // unterminated comment swallows the rest
			i = end + 2;
			continue;
		}
		if (s[i] === '"' || s[i] === "'") {
			i = skipCSSString(s, i);
			continue;
		}
		i++;
	}
	return -1;
}

// findTemplateClose scans a template body (<puzzle-view> / <puzzle-skeleton>)
// from `from` for its real close tag, skipping balanced template brace groups,
// HTML comments, template comments, and \{ \} escapes. Returns the close tag's
// '<' index RELATIVE to `from`, or -1. Mirrors findTemplateClose.
//
// There is deliberately NO {#raw} case here: sections.go has none either. Section
// splitting is byte-naive about a raw body (D150 lex-off is a LEXER concern, and
// this port has no template lexer), so a literal close tag written inside a
// {#raw} body ends the section in the compiler and must end it here too. What a
// raw block DOES need is `raw` in lex.js's BLOCK_CLOSE_KEYWORDS: without it the
// '/' in {/raw} reads as a regex opener and the brace scan runs away past the
// section's real close tag.
function findTemplateClose(s, from, closeTag) {
	for (let i = from; i < s.length; ) {
		if (s.startsWith(closeTag, i)) return i - from;
		if (s.startsWith('<!--', i)) {
			const end = s.indexOf('-->', i + 4);
			if (end >= 0) {
				i = end + 3;
				continue;
			}
			i += 4;
			continue;
		}
		if (s[i] === '\\' && i + 1 < s.length && (s[i + 1] === '{' || s[i + 1] === '}')) {
			i += 2;
			continue;
		}
		if (s[i] === '{') {
			let r;
			if (s.startsWith('{##', i)) r = scanInlineComment(s, i);
			else if (isBlockCommentOpen(s, i)) r = scanBlockComment(s, i);
			else r = scanBraceGroup(s, i);
			if (!r.ok) {
				i++;
				continue;
			}
			i = r.end;
			continue;
		}
		i++;
	}
	return -1;
}

// scriptLangParser extracts the <script> `lang` attribute and maps it to a
// Prettier parser: lang="ts" → "typescript", everything else (absent, "js",
// unknown) → "babel". The Go compiler treats unknown/dynamic values as errors;
// a formatter is not a validator, so we default to babel rather than rejecting.
function scriptLangParser(attrsRaw) {
	const m = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/.exec(attrsRaw);
	if (!m) return 'babel';
	const val = m[1] ?? m[2] ?? m[3] ?? '';
	return val === 'ts' ? 'typescript' : 'babel';
}

function strayContentErr(src, off, follows) {
	if (follows === 'script' || follows === 'style') {
		return posErr(
			src,
			off,
			`unexpected content after the <${follows}> section — a literal </${follows}> inside a comment or string may have closed the body early`,
		);
	}
	return posErr(
		src,
		off,
		'unexpected content outside a section — only <puzzle-view>, <puzzle-skeleton>, <script> and <style> may appear at the top level',
	);
}

/**
 * splitSections splits src into its sections, tolerant of whitespace and order.
 * Returns an ordered array of section descriptors:
 *   { name, tagStart, contentStart, contentEnd, closeEnd, attrsRaw }
 * where [contentStart, contentEnd) is the inner body and closeEnd is the index
 * just past the close tag. A missing <puzzle-view>, more than one of any
 * section, an unterminated tag, or stray top-level content throws a
 * PzlSyntaxError with a source position. Mirrors SplitSections.
 */
export function splitSections(src) {
	const sections = [];
	const counts = { 'puzzle-view': 0, 'puzzle-skeleton': 0, script: 0, style: 0 };

	let i = 0;
	// A leading UTF-8 BOM is an encoding marker, not top-level template content.
	// Keep src itself untouched so every later offset and line/column still refers
	// to the original file.
	if (src.startsWith('\uFEFF')) i = 1;
	let strayOff = -1;
	let strayFollows = '';
	let lastClosed = '';

	while (i < src.length) {
		if (src[i] !== '<') {
			if (strayOff < 0 && !isSpaceByte(src[i])) {
				strayOff = i;
				strayFollows = lastClosed;
			}
			i++;
			continue;
		}
		if (src.startsWith('<!--', i)) {
			const idx = src.indexOf('-->', i + 4);
			if (idx < 0) throw posErr(src, i, 'unterminated comment');
			i = idx + 3;
			continue;
		}
		const misnamed = misnamedSectionTagAt(src, i);
		if (misnamed) {
			throw posErr(src, i, `<${misnamed.bad}> should be named <${misnamed.good}>`);
		}
		const { name, isClose } = sectionTagAt(src, i);
		if (name === '' || isClose) {
			if (strayOff < 0) {
				strayOff = i;
				strayFollows = lastClosed;
			}
			i++;
			continue;
		}

		const { afterGT, attrsRaw } = scanOpenTag(src, i, name);
		const closeTag = '</' + name + '>';
		let rel;
		switch (name) {
			case 'script':
				rel = findScriptClose(src, afterGT);
				break;
			case 'style':
				rel = findStyleClose(src, afterGT);
				break;
			case 'puzzle-view':
			case 'puzzle-skeleton':
				rel = findTemplateClose(src, afterGT, closeTag);
				break;
			default: {
				const abs = src.indexOf(closeTag, afterGT);
				rel = abs < 0 ? -1 : abs - afterGT;
			}
		}
		if (rel < 0) throw posErr(src, i, `missing ${closeTag} for <${name}>`);

		const contentStart = afterGT;
		const contentEnd = afterGT + rel;
		counts[name]++;
		if (counts[name] > 1) {
			throw posErr(src, i, `multiple <${name}> sections (only one allowed)`);
		}
		sections.push({
			name,
			tagStart: i,
			contentStart,
			contentEnd,
			closeEnd: contentEnd + closeTag.length,
			attrsRaw,
			parser: name === 'script' ? scriptLangParser(attrsRaw) : name === 'style' ? 'css' : null,
		});

		i = contentEnd + closeTag.length;
		lastClosed = name;
	}

	if (counts['puzzle-view'] === 0) {
		throw new PzlSyntaxError('missing <puzzle-view> section', 1, 1);
	}
	if (strayOff >= 0) {
		throw strayContentErr(src, strayOff, strayFollows);
	}
	return sections;
}
