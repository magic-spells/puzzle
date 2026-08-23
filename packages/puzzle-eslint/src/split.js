// split.js — a JavaScript port of the Puzzle compiler's .pzl section splitter.
//
// This mirrors compiler/internal/parser/sections.go (with its helpers in
// lexskip.go and scan.go) from the @magic-spells/puzzle repository. The Go
// compiler is the source of truth; on any conflict, sections.go wins. Keep this
// file a faithful transcription so the ESLint plugin carves a .pzl file into the
// exact same sections the real compiler does — and, crucially, refuses to
// truncate a <script> body on a literal </script> hiding inside a string,
// template literal, comment, or regex.
//
// Everything here operates on the ORIGINAL source string in UTF-16 code-unit
// space. Offsets, lines, and columns are computed against that same string, so
// the ESLint processor can blank around a section span and keep every position
// identical to the real file (no remapping for messages or autofix ranges).

// ---------------------------------------------------------------------------
// Byte / character classifiers (mirrors of the Go helpers)
// ---------------------------------------------------------------------------

function isIdentStart(c) {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}

function isIdentChar(c) {
	return isIdentStart(c) || (c >= '0' && c <= '9');
}

function isSpaceByte(c) {
	return c === ' ' || c === '\t' || c === '\r' || c === '\n';
}

function isNameStart(c) {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

// Template name chars: letters, digits, and -, :, . (mirrors lexer.go isNameChar).
function isNameChar(c) {
	return isNameStart(c) || (c >= '0' && c <= '9') || c === '-' || c === ':' || c === '.';
}

function isBoundary(c) {
	return isSpaceByte(c) || c === '>' || c === '/';
}

// firstWord returns the leading name-run of s after trimming left whitespace.
function firstWord(s) {
	let start = 0;
	while (start < s.length && isSpaceByte(s[start])) start++;
	let i = start;
	while (i < s.length && isNameChar(s[i])) i++;
	return s.slice(start, i);
}

// ---------------------------------------------------------------------------
// Position helpers (mirror of position.go advance / sections.go posAt)
// ---------------------------------------------------------------------------

// posAt computes the 1-based line/column and 0-based offset of a code-unit
// offset into src. Columns advance on every char except '\n', matching the Go
// compiler's Position.advance exactly.
export function posAt(src, off) {
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
	return { line, col, offset: off };
}

// ---------------------------------------------------------------------------
// Shared lexical-skip scanner (mirror of lexskip.go)
// ---------------------------------------------------------------------------

const lexRegexPrecedingKeywords = new Set([
	'return', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'new',
	'do', 'else', 'yield', 'await', 'case',
]);

// lexSkip inspects s[i] for the balanced scanners. When it begins an opaque
// lexical unit (string, template literal, regex, comment, or identifier run) it
// returns { next, pee, consumed:true }; otherwise consumed:false and the caller
// handles s[i] itself.
function lexSkip(s, i, prevEndsExpr) {
	const c = s[i];
	if (c === "'" || c === '"') {
		let j = i + 1;
		while (j < s.length) {
			if (s[j] === '\\') {
				j += 2;
				// A trailing backslash must not push past EOF — an unterminated
				// string ends AT s.length, and callers slice/index on the result.
				if (j > s.length) j = s.length;
				continue;
			}
			if (s[j] === c) {
				j++;
				break;
			}
			j++;
		}
		return { next: j, pee: true, consumed: true };
	}
	if (c === '`') {
		return { next: lexScanTemplateLiteral(s, i), pee: true, consumed: true };
	}
	if (c === '/' && i + 1 < s.length && s[i + 1] === '/') {
		// Line comment.
		let j = i + 2;
		while (j < s.length && s[j] !== '\n') j++;
		return { next: j, pee: prevEndsExpr, consumed: true };
	}
	if (c === '/' && i + 1 < s.length && s[i + 1] === '*') {
		// Block comment.
		let j = i + 2;
		while (j < s.length) {
			if (s[j] === '*' && j + 1 < s.length && s[j + 1] === '/') {
				j += 2;
				break;
			}
			j++;
		}
		return { next: j, pee: prevEndsExpr, consumed: true };
	}
	if (c === '/' && !prevEndsExpr) {
		// Regex literal — a '/' where the previous token cannot end an expression.
		return { next: lexScanRegexLiteral(s, i), pee: true, consumed: true };
	}
	if ((c === '+' || c === '-') && i + 1 < s.length && s[i + 1] === c) {
		// Prefix and postfix update operators preserve the incoming state. For a
		// postfix update that keeps a following '/' in division context, so
		// `i++ / 2` is a division and not a regex literal that would swallow the
		// section's close tag. Consuming BOTH bytes is essential: in a+++/re/ the
		// third '+' remains a plain operator, clears the state, and correctly
		// leaves '/' a regex opener.
		return { next: i + 2, pee: prevEndsExpr, consumed: true };
	}
	if (isIdentStart(c)) {
		let j = i;
		while (j < s.length && isIdentChar(s[j])) j++;
		if (lexPrecededByDot(s, i)) {
			return { next: j, pee: true, consumed: true };
		}
		return { next: j, pee: !lexRegexPrecedingKeywords.has(s.slice(i, j)), consumed: true };
	}
	return { next: i, pee: prevEndsExpr, consumed: false };
}

function lexScanTemplateLiteral(s, i) {
	for (let j = i + 1; j < s.length;) {
		if (s[j] === '\\') {
			j += 2;
		} else if (s[j] === '`') {
			return j + 1;
		} else if (s[j] === '$' && j + 1 < s.length && s[j + 1] === '{') {
			const { end, err } = scanBraceGroup(s, j + 1);
			if (err) return s.length;
			j = end;
		} else {
			j++;
		}
	}
	return s.length;
}

function lexPlainEndsExpr(c, prev) {
	if (isSpaceByte(c)) return prev;
	if (c === ')' || c === ']' || c === '}') return true;
	if (c >= '0' && c <= '9') return true;
	return false;
}

function lexPrecededByDot(s, i) {
	for (let k = i - 1; k >= 0; k--) {
		if (isSpaceByte(s[k])) continue;
		return s[k] === '.';
	}
	return false;
}

function lexScanRegexLiteral(s, i) {
	const n = s.length;
	let j = i + 1;
	let inClass = false;
	while (j < n) {
		const c = s[j];
		if (c === '\\') {
			j += 2;
			// A trailing backslash must not push past EOF: the unterminated result
			// is s.length, and lexRegexLiteralClosed indexes s[end - 1].
			if (j > n) j = n;
			continue;
		}
		if (inClass) {
			if (c === ']') inClass = false;
			j++;
			continue;
		}
		if (c === '[') {
			inClass = true;
			j++;
		} else if (c === '/') {
			j++; // consume the closing '/'
			while (j < n && ((s[j] >= 'a' && s[j] <= 'z') || (s[j] >= 'A' && s[j] <= 'Z'))) j++;
			return j;
		} else {
			j++;
		}
	}
	return j;
}

// ---------------------------------------------------------------------------
// Balanced brace scanning and template comments (mirror of scan.go)
// ---------------------------------------------------------------------------

// blockCloseKeywords mirrors scan.go: the keywords whose {/kw} spelling is a
// STRUCTURAL block closer rather than a '{' followed by a possible regex
// literal. `raw` joined the set with D150's {#raw} block.
//
// The raw BODY is deliberately NOT scanned anywhere in this file. sections.go's
// findTemplateClose has no {#raw} case either — it walks a template body with
// balanced brace groups and the two comment scanners only — because the
// compiler's raw-body skip lives one stage later, in the LEXER (lexer.go
// lexBrace → scanBlockRaw). Teaching the splitter about raw bodies would make
// this plugin accept files the real compiler rejects, which is the one thing a
// mirror must never do. Recognizing {/raw} as a closer here is enough: a raw
// body's braces then balance through the ordinary group scan, exactly as they
// do in Go.
const blockCloseKeywords = new Set(['if', 'unless', 'case', 'for', 'svg', 'comment', 'raw']);

// scanBraceGroup is the one shared balanced-brace scan. s[open] must be '{'.
// Returns { inner, end, err }. err is a message string (never throws) so callers
// can decide whether a malformed group is fatal or should be skipped.
function scanBraceGroup(s, open) {
	if (open >= s.length || s[open] !== '{') {
		return { inner: '', end: 0, err: "internal error: scanBraceGroup not positioned at '{'" };
	}
	let depth = 0;
	let prevEndsExpr = false;
	for (let i = open; i < s.length;) {
		if (i === open + 1 && s[i] === '/') {
			if (isKnownBlockCloserAt(s, open) || !lexRegexLiteralClosed(s, i, lexScanRegexLiteral(s, i))) {
				prevEndsExpr = lexPlainEndsExpr('/', prevEndsExpr);
				i++;
				continue;
			}
		}
		const skip = lexSkip(s, i, prevEndsExpr);
		if (skip.consumed) {
			prevEndsExpr = skip.pee;
			i = skip.next;
			continue;
		}
		const c = s[i];
		if (c === '{') {
			depth++;
		} else if (c === '}') {
			depth--;
			if (depth === 0) {
				return { inner: s.slice(open + 1, i), end: i + 1, err: null };
			}
		}
		prevEndsExpr = lexPlainEndsExpr(c, prevEndsExpr);
		i++;
	}
	return { inner: '', end: 0, err: "unclosed '{'" };
}

function lexRegexLiteralClosed(s, open, end) {
	let k = end - 1;
	while (k > open && ((s[k] >= 'a' && s[k] <= 'z') || (s[k] >= 'A' && s[k] <= 'Z'))) k--;
	return k > open && s[k] === '/';
}

function isKnownBlockCloserAt(s, open) {
	let i = open + 2; // just after "{/"
	while (i < s.length && isSpaceByte(s[i])) i++;
	const start = i;
	while (i < s.length && isNameChar(s[i])) i++;
	if (!blockCloseKeywords.has(s.slice(start, i))) return false;
	while (i < s.length && isSpaceByte(s[i])) i++;
	return i < s.length && s[i] === '}';
}

// scanInlineComment scans a {## … } inline comment (D70). Dumb scanner: only
// tracks brace nesting and honors \{ / \} escapes. Returns { end, err }.
function scanInlineComment(s, open) {
	let depth = 0;
	for (let i = open; i < s.length; i++) {
		const c = s[i];
		if (c === '\\' && i + 1 < s.length && (s[i + 1] === '{' || s[i + 1] === '}')) {
			i++;
			continue;
		}
		if (c === '{') {
			depth++;
		} else if (c === '}') {
			depth--;
			if (depth === 0) return { end: i + 1, err: null };
		}
	}
	return { end: 0, err: 'unclosed {## comment' };
}

function isBlockCommentOpen(s, open) {
	if (open + 2 > s.length || s[open] !== '{' || s[open + 1] !== '#') return false;
	return firstWord(s.slice(open + 2)) === 'comment';
}

function matchCommentCloser(s, open) {
	let i = open + 1;
	if (i >= s.length || s[i] !== '/') return { ok: false, end: 0 };
	i++;
	while (i < s.length && isSpaceByte(s[i])) i++;
	const kw = 'comment';
	if (i + kw.length > s.length || s.slice(i, i + kw.length) !== kw) return { ok: false, end: 0 };
	i += kw.length;
	while (i < s.length && isSpaceByte(s[i])) i++;
	if (i >= s.length || s[i] !== '}') return { ok: false, end: 0 };
	return { ok: true, end: i + 1 };
}

// scanBlockComment scans a {#comment} … {/comment} block (D70) from the opening
// '{'. Body consumed raw; nested openers counted. Returns { end, err }.
function scanBlockComment(s, open) {
	let depth = 1;
	for (let i = open + 1; i < s.length;) {
		if (s[i] !== '{') {
			i++;
			continue;
		}
		if (isBlockCommentOpen(s, i)) {
			depth++;
			i++;
			continue;
		}
		const m = matchCommentCloser(s, i);
		if (m.ok) {
			depth--;
			if (depth === 0) return { end: m.end, err: null };
			i = m.end;
			continue;
		}
		i++;
	}
	return { end: 0, err: 'unterminated {#comment} — expected {/comment}' };
}

// ---------------------------------------------------------------------------
// Section close-tag scanners (mirror of sections.go)
// ---------------------------------------------------------------------------

// findTemplateClose scans a template body (<puzzle-view> or <puzzle-skeleton>)
// for closeTag, skipping HTML comments, escaped braces, template comments, and
// balanced {…} groups. Returns the close tag's '<' index RELATIVE to `from`, or
// -1.
function findTemplateClose(s, from, closeTag) {
	for (let i = from; i < s.length;) {
		if (s.startsWith(closeTag, i)) return i - from;
		if (s.startsWith('<!--', i)) {
			const end = s.indexOf('-->', i + 4);
			if (end >= 0) {
				i = end + 3;
				continue;
			}
			i += 4;
		} else if (s[i] === '\\' && i + 1 < s.length && (s[i + 1] === '{' || s[i + 1] === '}')) {
			i += 2;
		} else if (s[i] === '{') {
			let res;
			if (s.startsWith('{##', i)) {
				res = scanInlineComment(s, i);
			} else if (isBlockCommentOpen(s, i)) {
				res = scanBlockComment(s, i);
			} else {
				const bg = scanBraceGroup(s, i);
				res = { end: bg.end, err: bg.err };
			}
			if (res.err) {
				i++; // let the template lexer report the malformed group later
				continue;
			}
			i = res.end;
		} else {
			i++;
		}
	}
	return -1;
}

// findScriptClose scans a <script> body for </script>, skipping JS strings,
// template literals, regexes, and comments via lexSkip so a literal "</script>"
// in any of them does not truncate the body. Returns the '<' index RELATIVE to
// `from`, or -1.
function findScriptClose(s, from) {
	let prevEndsExpr = false;
	for (let i = from; i < s.length;) {
		if (s.startsWith('</script>', i)) return i - from;
		const skip = lexSkip(s, i, prevEndsExpr);
		if (skip.consumed) {
			prevEndsExpr = skip.pee;
			i = skip.next;
			continue;
		}
		prevEndsExpr = lexPlainEndsExpr(s[i], prevEndsExpr);
		i++;
	}
	return -1;
}

// findStyleClose scans a <style> body for </style>, skipping CSS block
// comments and quoted strings. Returns the '<' index RELATIVE to `from`, or -1.
function findStyleClose(s, from) {
	for (let i = from; i < s.length;) {
		if (s.startsWith('</style>', i)) return i - from;
		if (s.startsWith('/*', i)) {
			const end = s.indexOf('*/', i + 2);
			if (end < 0) return -1; // unterminated comment swallows the rest
			i = end + 2;
		} else if (s[i] === '"' || s[i] === "'") {
			i = skipCSSString(s, i);
		} else {
			i++;
		}
	}
	return -1;
}

function skipCSSString(s, i) {
	const q = s[i];
	for (let j = i + 1; j < s.length;) {
		if (s[j] === '\\') {
			j += 2;
			continue;
		}
		if (s[j] === q) return j + 1;
		j++;
	}
	return s.length;
}

// ---------------------------------------------------------------------------
// Section tag recognition (mirror of sections.go sectionTagAt / scanOpenTag)
// ---------------------------------------------------------------------------

const sectionNames = ['puzzle-view', 'puzzle-skeleton', 'script', 'style'];

function sectionTagAt(src, i) {
	const rest = src.slice(i);
	if (rest.startsWith('</')) {
		for (const n of sectionNames) {
			if (rest.startsWith('</' + n)) return { name: n, isClose: true };
		}
		return { name: '', isClose: false };
	}
	for (const n of sectionNames) {
		if (rest.startsWith('<' + n)) {
			const after = i + 1 + n.length;
			if (after >= src.length || isBoundary(src[after])) return { name: n, isClose: false };
		}
	}
	return { name: '', isClose: false };
}

// misnamedSectionNames mirrors sections.go: near-miss section spellings that get
// a steering error instead of the generic stray-content one. The section tags are
// singular (<script>, <style>); the plural spellings are the common mistake.
const misnamedSectionNames = [
	{ bad: 'scripts', good: 'script' },
	{ bad: 'styles', good: 'style' },
];

// misnamedSectionTagAt recognizes a near-miss section name at i so the top-level
// scanner can point at the correct spelling. A boundary is required so similarly
// prefixed custom markup is still diagnosed as ordinary stray content. Returns
// the matched { bad, good } pair, or null.
function misnamedSectionTagAt(src, i) {
	for (const m of misnamedSectionNames) {
		const prefix = '<' + m.bad;
		if (!src.startsWith(prefix, i)) continue;
		const after = i + prefix.length;
		if (after >= src.length || isBoundary(src[after])) return m;
	}
	return null;
}

// scanOpenTag finds the end of a section's open tag (the '>'), quote- and
// brace-aware. Returns { afterGT, attrOffset, attrsRaw, err }.
function scanOpenTag(src, i, name) {
	let j = i + 1 + name.length;
	const attrStart = j;
	let quote = '';
	while (j < src.length) {
		const c = src[j];
		if (quote !== '') {
			if (c === quote) quote = '';
			j++;
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			j++;
		} else if (c === '{') {
			const bg = scanBraceGroup(src, j);
			if (bg.err) {
				return { err: { offset: j, message: "unclosed '{' in <" + name + '> tag' } };
			}
			j = bg.end;
		} else if (c === '>') {
			const raw = src.slice(attrStart, j);
			const trimmed = raw.trim();
			let off = attrStart;
			if (trimmed !== '') off += raw.indexOf(trimmed);
			return { afterGT: j + 1, attrOffset: off, attrsRaw: trimmed, err: null };
		} else {
			j++;
		}
	}
	return { err: { offset: i, message: 'unterminated <' + name + '> tag' } };
}

// ---------------------------------------------------------------------------
// Section attribute parsing + validation (mirror of the parse* functions)
// ---------------------------------------------------------------------------

// parseAttrs tokenizes a section open tag's attribute text into a small list of
// { kind, name, value, valueless, offset } records. kind is one of
// 'static' | 'dynamic' | 'mixed' | 'event'. offset is the absolute code-unit
// offset of the attribute name in the original source. Returns { attrs, err }.
function parseAttrs(raw, baseOffset, section) {
	const attrs = [];
	const n = raw.length;
	let i = 0;
	const skipWs = () => {
		while (i < n && isSpaceByte(raw[i])) i++;
	};
	skipWs();
	while (i < n) {
		const nameStart = i;
		let isEvent = false;
		if (raw[i] === '@') {
			isEvent = true;
			i++;
		}
		const ns = i;
		while (i < n && isNameChar(raw[i])) i++;
		const name = raw.slice(ns, i);
		if (name === '') {
			return { attrs, err: { offset: baseOffset + nameStart, message: `malformed attribute in <${section}> tag` } };
		}
		const attrOffset = baseOffset + nameStart;
		skipWs();
		let kind = isEvent ? 'event' : 'static';
		let value = '';
		let valueless = true;
		if (i < n && raw[i] === '=') {
			i++;
			skipWs();
			valueless = false;
			if (i >= n) {
				return { attrs, err: { offset: baseOffset + i, message: `malformed attribute in <${section}> tag` } };
			}
			const vc = raw[i];
			if (vc === '"' || vc === "'") {
				let j = i + 1;
				while (j < n && raw[j] !== vc) j++;
				const inner = raw.slice(i + 1, j);
				i = j < n ? j + 1 : j;
				const cls = classifyValue(inner);
				if (!isEvent) kind = cls.kind;
				value = cls.text;
			} else if (vc === '{') {
				const bg = scanBraceGroup(raw, i);
				if (bg.err) {
					return { attrs, err: { offset: baseOffset + i, message: `malformed attribute in <${section}> tag` } };
				}
				if (!isEvent) kind = 'dynamic';
				value = bg.inner;
				i = bg.end;
			} else {
				const vs = i;
				while (i < n && !isSpaceByte(raw[i])) i++;
				value = raw.slice(vs, i);
			}
		}
		attrs.push({ kind, name, value, valueless, offset: attrOffset });
		skipWs();
	}
	return { attrs, err: null };
}

// classifyValue decides whether a quoted attribute value is static text, a
// single {…} interpolation (dynamic), or text mixed with interpolation (mixed).
function classifyValue(inner) {
	if (inner.indexOf('{') < 0) return { kind: 'static', text: inner };
	const t = inner.trim();
	if (t.startsWith('{')) {
		const bg = scanBraceGroup(t, 0);
		if (!bg.err && bg.end === t.length) return { kind: 'dynamic', text: bg.inner };
	}
	return { kind: 'mixed', text: inner };
}

function quoteStr(s) {
	// Mirror Go %q for the simple ASCII values these validators format.
	return JSON.stringify(s);
}

function editDistance(a, b) {
	const la = a.length;
	const lb = b.length;
	if (la === 0) return lb;
	if (lb === 0) return la;
	let prev = new Array(lb + 1);
	let curr = new Array(lb + 1);
	for (let j = 0; j <= lb; j++) prev[j] = j;
	for (let i = 1; i <= la; i++) {
		curr[0] = i;
		for (let j = 1; j <= lb; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[lb];
}

function parseUnsignedIntStr(s) {
	if (s === '') return { n: 0, ok: false };
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c < '0' || c > '9') return { n: 0, ok: false };
	}
	const n = Number(s);
	if (!Number.isSafeInteger(n)) return { n: 0, ok: false };
	return { n, ok: true };
}

function scriptsLangHint(v) {
	switch (v.toLowerCase().trim()) {
		case 'typescript':
		case 'tsx':
		case 'type-script':
		case 't':
		case 'tsc':
			return ' — did you mean "ts"?';
		case 'javascript':
		case 'jsx':
		case 'ecmascript':
		case 'es':
		case 'mjs':
		case 'j':
			return ' — did you mean "js"?';
		default:
			return '';
	}
}

function stylesScopedHint(name) {
	const n = name.toLowerCase().trim();
	if (n !== 'scoped' && editDistance(n, 'scoped') <= 2) return ' — did you mean `scoped`?';
	return '';
}

// parseScriptsLang validates the only attribute <script> accepts (lang).
// Returns { lang, err }. lang is '' (JS) or 'ts'.
function parseScriptsLang(attrs, baseOffset) {
	if (attrs.length === 0) return { lang: '', err: null };
	if (attrs.length !== 1) {
		return { lang: '', err: { offset: baseOffset, message: 'the only attribute allowed on <script> is `lang`' } };
	}
	const a = attrs[0];
	if (a.kind === 'static') {
		if (a.name !== 'lang') {
			return { lang: '', err: { offset: a.offset, message: `the only attribute allowed on <script> is \`lang\` (got ${quoteStr(a.name)})` } };
		}
		switch (a.value) {
			case 'ts':
				return { lang: 'ts', err: null };
			case 'js':
				return { lang: '', err: null };
			case '':
				return { lang: '', err: { offset: a.offset, message: '`lang` on <script> requires a value — use lang="ts" (TypeScript) or lang="js" (JavaScript)' } };
			default:
				return { lang: '', err: { offset: a.offset, message: `unknown <script> lang ${quoteStr(a.value)} — expected "ts" (TypeScript) or "js" (JavaScript, the default)${scriptsLangHint(a.value)}` } };
		}
	}
	if (a.kind === 'dynamic') {
		if (a.name !== 'lang') {
			return { lang: '', err: { offset: a.offset, message: `the only attribute allowed on <script> is \`lang\` (got ${quoteStr(a.name)})` } };
		}
		return { lang: '', err: { offset: a.offset, message: '`lang` on <script> must be a static "ts" or "js", not a dynamic {…} value' } };
	}
	if (a.kind === 'mixed') {
		if (a.name !== 'lang') {
			return { lang: '', err: { offset: a.offset, message: `the only attribute allowed on <script> is \`lang\` (got ${quoteStr(a.name)})` } };
		}
		return { lang: '', err: { offset: a.offset, message: '`lang` on <script> must be a static "ts" or "js", not an interpolated value' } };
	}
	// event or anything else
	return { lang: '', err: { offset: baseOffset, message: 'the only attribute allowed on <script> is `lang`' } };
}

// parseStylesScoped validates the only attribute <style> accepts (bare scoped).
// Returns { scoped, err }.
function parseStylesScoped(attrs, baseOffset) {
	if (attrs.length === 0) return { scoped: false, err: null };
	if (attrs.length !== 1) {
		return { scoped: false, err: { offset: baseOffset, message: 'the only attribute allowed on <style> is `scoped`' } };
	}
	const a = attrs[0];
	if (a.kind === 'static') {
		if (a.name !== 'scoped') {
			return { scoped: false, err: { offset: a.offset, message: `the only attribute allowed on <style> is \`scoped\` (got ${quoteStr(a.name)})${stylesScopedHint(a.name)}` } };
		}
		if (!a.valueless) {
			return { scoped: false, err: { offset: a.offset, message: '`scoped` on <style> is a bare attribute — write <style scoped>, not scoped="…"' } };
		}
		return { scoped: true, err: null };
	}
	if (a.kind === 'dynamic') {
		if (a.name !== 'scoped') {
			return { scoped: false, err: { offset: a.offset, message: `the only attribute allowed on <style> is \`scoped\` (got ${quoteStr(a.name)})${stylesScopedHint(a.name)}` } };
		}
		return { scoped: false, err: { offset: a.offset, message: '`scoped` on <style> is a bare attribute, not a dynamic {…} value — write <style scoped>' } };
	}
	if (a.kind === 'mixed') {
		if (a.name !== 'scoped') {
			return { scoped: false, err: { offset: a.offset, message: `the only attribute allowed on <style> is \`scoped\` (got ${quoteStr(a.name)})${stylesScopedHint(a.name)}` } };
		}
		return { scoped: false, err: { offset: a.offset, message: '`scoped` on <style> is a bare attribute, not an interpolated value — write <style scoped>' } };
	}
	return { scoped: false, err: { offset: baseOffset, message: 'the only attribute allowed on <style> is `scoped`' } };
}

// parseSkeletonMinDuration validates the only attribute <puzzle-skeleton>
// accepts (min-duration). Returns { minDuration, err }.
function parseSkeletonMinDuration(attrs, baseOffset) {
	if (attrs.length === 0) return { minDuration: 0, err: null };
	if (attrs.length !== 1) {
		return { minDuration: 0, err: { offset: baseOffset, message: 'the only attribute allowed on <puzzle-skeleton> is `min-duration`' } };
	}
	const a = attrs[0];
	if (a.kind === 'static') {
		if (a.name !== 'min-duration') {
			return { minDuration: 0, err: { offset: a.offset, message: `the only attribute allowed on <puzzle-skeleton> is \`min-duration\` (got ${quoteStr(a.name)})` } };
		}
		if (a.value === '') {
			return { minDuration: 0, err: { offset: a.offset, message: '`min-duration` on <puzzle-skeleton> requires an integer value, e.g. min-duration="300"' } };
		}
		const { n, ok } = parseUnsignedIntStr(a.value);
		if (!ok) {
			return { minDuration: 0, err: { offset: a.offset, message: `\`min-duration\` on <puzzle-skeleton> must be a non-negative integer in ms (got ${quoteStr(a.value)})` } };
		}
		return { minDuration: n, err: null };
	}
	if (a.kind === 'dynamic') {
		if (a.name !== 'min-duration') {
			return { minDuration: 0, err: { offset: a.offset, message: `the only attribute allowed on <puzzle-skeleton> is \`min-duration\` (got ${quoteStr(a.name)})` } };
		}
		return { minDuration: 0, err: { offset: a.offset, message: '`min-duration` on <puzzle-skeleton> must be a static integer, not a dynamic {…} value' } };
	}
	if (a.kind === 'mixed') {
		if (a.name !== 'min-duration') {
			return { minDuration: 0, err: { offset: a.offset, message: `the only attribute allowed on <puzzle-skeleton> is \`min-duration\` (got ${quoteStr(a.name)})` } };
		}
		return { minDuration: 0, err: { offset: a.offset, message: '`min-duration` on <puzzle-skeleton> must be a static integer, not an interpolated value' } };
	}
	return { minDuration: 0, err: { offset: baseOffset, message: 'the only attribute allowed on <puzzle-skeleton> is `min-duration`' } };
}

// ---------------------------------------------------------------------------
// The splitter (mirror of sections.go SplitSections)
// ---------------------------------------------------------------------------

// splitSections carves src into its sections. Returns
//   { sections, errors }
// where sections has view/skeleton/scripts/styles (each null or a span record)
// and errors is a list of { line, column, offset, message }. Like the Go
// compiler, it reports the FIRST structural error and stops; end-of-file checks
// (missing <puzzle-view>, stray content) run only when the scan completes
// without a fatal error. Any partial section found before an error is kept so
// the ESLint processor can still lint a valid <script> body.
export function splitSections(src, filename = 'input.pzl') {
	const sections = { view: null, skeleton: null, scripts: null, styles: null };
	const errors = [];

	const err = (off, message) => {
		const p = posAt(src, off);
		errors.push({ line: p.line, column: p.col, offset: p.offset, message });
	};

	let i = 0;
	// A leading BOM is an encoding marker, not top-level template content
	// (sections.go skips the 3-byte UTF-8 form; decoded into a JS string it is
	// the single code unit U+FEFF). src itself stays untouched so every later
	// offset, line, and column still refers to the original file.
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
			if (idx < 0) {
				err(i, 'unterminated comment');
				return { sections, errors };
			}
			i = idx + 3;
			continue;
		}
		const misnamed = misnamedSectionTagAt(src, i);
		if (misnamed) {
			err(i, '<' + misnamed.bad + '> should be named <' + misnamed.good + '>');
			return { sections, errors };
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

		const open = scanOpenTag(src, i, name);
		if (open.err) {
			err(open.err.offset, open.err.message);
			return { sections, errors };
		}
		const afterOpen = open.afterGT;
		const closeTag = '</' + name + '>';

		let rel;
		switch (name) {
			case 'script':
				rel = findScriptClose(src, afterOpen);
				break;
			case 'style':
				rel = findStyleClose(src, afterOpen);
				break;
			default: // puzzle-view, puzzle-skeleton
				rel = findTemplateClose(src, afterOpen, closeTag);
				break;
		}
		if (rel < 0) {
			err(i, 'missing ' + closeTag + ' for <' + name + '>');
			return { sections, errors };
		}
		const contentStart = afterOpen;
		const contentEnd = afterOpen + rel;
		const inner = src.slice(contentStart, contentEnd);

		if (name === 'puzzle-view') {
			if (sections.view !== null) {
				err(i, 'multiple <puzzle-view> sections (only one allowed)');
				return { sections, errors };
			}
			// <puzzle-view> carries arbitrary attributes — never validated here.
			sections.view = { content: inner, contentStart, contentEnd, tagStart: i, attrsRaw: open.attrsRaw };
		} else if (name === 'puzzle-skeleton') {
			if (sections.skeleton !== null) {
				err(i, 'multiple <puzzle-skeleton> sections (only one allowed)');
				return { sections, errors };
			}
			sections.skeleton = { content: inner, contentStart, contentEnd, tagStart: i, minDuration: 0 };
			const parsed = parseAttrs(open.attrsRaw, open.attrOffset, 'puzzle-skeleton');
			if (parsed.err) {
				err(parsed.err.offset, parsed.err.message);
				return { sections, errors };
			}
			const md = parseSkeletonMinDuration(parsed.attrs, open.attrOffset);
			if (md.err) {
				err(md.err.offset, md.err.message);
				return { sections, errors };
			}
			sections.skeleton.minDuration = md.minDuration;
		} else if (name === 'script') {
			if (sections.scripts !== null) {
				err(i, 'multiple <script> sections (only one allowed)');
				return { sections, errors };
			}
			// Record the span first so the body can still be linted even if the
			// lang attribute is invalid.
			sections.scripts = { content: inner, contentStart, contentEnd, tagStart: i, lang: '' };
			const parsed = parseAttrs(open.attrsRaw, open.attrOffset, 'script');
			if (parsed.err) {
				err(parsed.err.offset, parsed.err.message);
				return { sections, errors };
			}
			const lang = parseScriptsLang(parsed.attrs, open.attrOffset);
			if (lang.err) {
				err(lang.err.offset, lang.err.message);
				return { sections, errors };
			}
			sections.scripts.lang = lang.lang;
		} else if (name === 'style') {
			if (sections.styles !== null) {
				err(i, 'multiple <style> sections (only one allowed)');
				return { sections, errors };
			}
			sections.styles = { content: inner, contentStart, contentEnd, tagStart: i, scoped: false };
			const parsed = parseAttrs(open.attrsRaw, open.attrOffset, 'style');
			if (parsed.err) {
				err(parsed.err.offset, parsed.err.message);
				return { sections, errors };
			}
			const sc = parseStylesScoped(parsed.attrs, open.attrOffset);
			if (sc.err) {
				err(sc.err.offset, sc.err.message);
				return { sections, errors };
			}
			sections.styles.scoped = sc.scoped;
		}

		i = contentEnd + closeTag.length;
		lastClosed = name;
	}

	if (sections.view === null) {
		errors.push({ line: 1, column: 1, offset: 0, message: 'missing <puzzle-view> section' });
		return { sections, errors };
	}
	if (strayOff >= 0) {
		if (strayFollows === 'script' || strayFollows === 'style') {
			err(strayOff, 'unexpected content after the <' + strayFollows + '> section — a literal </' + strayFollows + '> inside a comment or string may have closed the body early');
		} else {
			err(strayOff, 'unexpected content outside a section — only <puzzle-view>, <puzzle-skeleton>, <script> and <style> may appear at the top level');
		}
		return { sections, errors };
	}

	return { sections, errors };
}
