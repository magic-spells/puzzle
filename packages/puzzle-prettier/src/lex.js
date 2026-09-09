// lex.js — a faithful JavaScript port of the Puzzle compiler's shared lexical-skip
// helpers (compiler/internal/parser/lexskip.go and scan.go). These back the
// close-tag scanners in split.js so a literal section-close sentinel hidden
// inside a JS string, template literal, regex, comment, or template brace group
// never truncates a section body. The port operates on JS strings by code unit;
// because every result is used to slice the SAME string it was scanned on, the
// UTF-16-vs-bytes distinction never affects correctness (all sentinels are ASCII).

// Identifier keywords that CANNOT end an expression, so a '/' immediately after
// one opens a regex literal (not division). Mirrors lexRegexPrecedingKeywords.
const REGEX_PRECEDING_KEYWORDS = new Set([
	'return', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'new',
	'do', 'else', 'yield', 'await', 'case',
]);

function isIdentStart(c) {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}

function isIdentChar(c) {
	return isIdentStart(c) || (c >= '0' && c <= '9');
}

export function isSpaceByte(c) {
	return c === ' ' || c === '\t' || c === '\r' || c === '\n';
}

function isNameStart(c) {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isNameChar(c) {
	return isNameStart(c) || (c >= '0' && c <= '9') || c === '-' || c === ':' || c === '.';
}

// firstWord mirrors parser.firstWord: the leading name-char run after any
// leading whitespace.
function firstWord(s) {
	let i = 0;
	while (i < s.length && isSpaceByte(s[i])) i++;
	const start = i;
	while (i < s.length && isNameChar(s[i])) i++;
	return s.slice(start, i);
}

// LexPlainEndsExpr folds a single plain byte (one LexSkip did not consume) into
// prevEndsExpr. Mirrors lexskip.go.
export function lexPlainEndsExpr(c, prev) {
	if (isSpaceByte(c)) return prev;
	if (c === ')' || c === ']' || c === '}') return true;
	if (c >= '0' && c <= '9') return true;
	return false;
}

// lexPrecededByDot reports whether the last significant byte before i is '.'.
function lexPrecededByDot(s, i) {
	for (let k = i - 1; k >= 0; k--) {
		if (isSpaceByte(s[k])) continue;
		return s[k] === '.';
	}
	return false;
}

// lexScanRegexLiteral returns the index just past the regex literal opening at i
// (s[i] must be '/'). Mirrors lexScanRegexLiteral.
export function lexScanRegexLiteral(s, i) {
	const n = s.length;
	let j = i + 1;
	let inClass = false;
	while (j < n) {
		const c = s[j];
		if (c === '\\') {
			j += 2;
			// A trailing backslash must not push past EOF: the unterminated result is
			// s.length, and lexRegexLiteralClosed indexes s[end - 1].
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

// lexScanTemplateLiteral returns the index just past the template literal
// opening at i. Mirrors lexScanTemplateLiteral: static chunks are escape-aware
// and each ${…} is skipped by scanBraceGroup, routing back through LexSkip.
function lexScanTemplateLiteral(s, i) {
	for (let j = i + 1; j < s.length; ) {
		if (s[j] === '\\') {
			j += 2;
		} else if (s[j] === '`') {
			return j + 1;
		} else if (s[j] === '$' && j + 1 < s.length && s[j + 1] === '{') {
			const g = scanBraceGroup(s, j + 1);
			if (!g.ok) return s.length;
			j = g.end;
		} else {
			j++;
		}
	}
	return s.length;
}

// LexSkip inspects the byte at s[i]. When it begins an OPAQUE lexical unit
// (string, template literal, regex literal, // or /* */ comment, or an
// identifier run) it returns { next, pee, consumed:true }; the caller must not
// re-inspect the skipped bytes. Otherwise { next:i, pee:prevEndsExpr,
// consumed:false }. Mirrors LexSkip.
export function lexSkip(s, i, prevEndsExpr) {
	const c = s[i];
	if (c === "'" || c === '"') {
		let j = i + 1;
		while (j < s.length) {
			if (s[j] === '\\') {
				j += 2;
				// A trailing backslash must not push past EOF — an unterminated string
				// ends AT s.length, and callers slice/index on the result.
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
		let j = i + 2;
		while (j < s.length && s[j] !== '\n') j++;
		return { next: j, pee: prevEndsExpr, consumed: true };
	}
	if (c === '/' && i + 1 < s.length && s[i + 1] === '*') {
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
		return { next: lexScanRegexLiteral(s, i), pee: true, consumed: true };
	}
	if ((c === '+' || c === '-') && i + 1 < s.length && s[i + 1] === c) {
		// Prefix/postfix update operators preserve the incoming state, and BOTH
		// bytes must be consumed: in a+++/re/ the third '+' stays a plain operator,
		// clears the state, and correctly leaves '/' a regex opener.
		return { next: i + 2, pee: prevEndsExpr, consumed: true };
	}
	if (isIdentStart(c)) {
		let j = i;
		while (j < s.length && isIdentChar(s[j])) j++;
		if (lexPrecededByDot(s, i)) return { next: j, pee: true, consumed: true };
		return { next: j, pee: !REGEX_PRECEDING_KEYWORDS.has(s.slice(i, j)), consumed: true };
	}
	return { next: i, pee: prevEndsExpr, consumed: false };
}

// lexRegexLiteralClosed distinguishes a completed regex scan from an
// unterminated-EOF result. Mirrors lexRegexLiteralClosed.
function lexRegexLiteralClosed(s, open, end) {
	let k = end - 1;
	while (k > open && ((s[k] >= 'a' && s[k] <= 'z') || (s[k] >= 'A' && s[k] <= 'Z'))) k--;
	return k > open && s[k] === '/';
}

// Block keywords whose {/kw} closer is STRUCTURAL — the one place a '/'
// immediately after '{' is not a regex opener. Mirrors blockCloseKeywords in
// scan.go; `raw` is D150's lex-off block.
const BLOCK_CLOSE_KEYWORDS = new Set(['if', 'unless', 'case', 'for', 'svg', 'comment', 'raw']);

// isKnownBlockCloserAt reports whether s[open:] is a complete block closer
// ({/if}, {/for}, …). Mirrors isKnownBlockCloserAt.
function isKnownBlockCloserAt(s, open) {
	let i = open + 2; // just after "{/"
	while (i < s.length && isSpaceByte(s[i])) i++;
	const start = i;
	while (i < s.length && isNameChar(s[i])) i++;
	if (!BLOCK_CLOSE_KEYWORDS.has(s.slice(start, i))) return false;
	while (i < s.length && isSpaceByte(s[i])) i++;
	return i < s.length && s[i] === '}';
}

// scanBraceGroup is the shared balanced-brace scan. s[open] must be '{'. Returns
// { ok, inner, end }. Mirrors scanBraceGroup.
export function scanBraceGroup(s, open) {
	if (open >= s.length || s[open] !== '{') return { ok: false };
	let depth = 0;
	let prevEndsExpr = false;
	for (let i = open; i < s.length; ) {
		// A '/' immediately after the opening '{' is structural only for a
		// complete, known block closer; every other slash may open a regex.
		if (i === open + 1 && s[i] === '/') {
			if (isKnownBlockCloserAt(s, open) || !lexRegexLiteralClosed(s, i, lexScanRegexLiteral(s, i))) {
				prevEndsExpr = lexPlainEndsExpr('/', prevEndsExpr);
				i++;
				continue;
			}
		}
		const r = lexSkip(s, i, prevEndsExpr);
		if (r.consumed) {
			prevEndsExpr = r.pee;
			i = r.next;
			continue;
		}
		const c = s[i];
		if (c === '{') {
			depth++;
		} else if (c === '}') {
			depth--;
			if (depth === 0) return { ok: true, inner: s.slice(open + 1, i), end: i + 1 };
		}
		prevEndsExpr = lexPlainEndsExpr(c, prevEndsExpr);
		i++;
	}
	return { ok: false };
}

// scanInlineComment scans a {## … } inline comment (D70) from the opening '{'.
// A DUMB scanner — only '{'/'}' nesting and \{ \} escapes. Mirrors
// scanInlineComment. Returns { ok, end }.
export function scanInlineComment(s, open) {
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
			if (depth === 0) return { ok: true, end: i + 1 };
		}
	}
	return { ok: false };
}

// isBlockCommentOpen reports whether s[open] begins a {#comment} opener. Mirrors
// isBlockCommentOpen.
export function isBlockCommentOpen(s, open) {
	if (open + 2 > s.length || s[open] !== '{' || s[open + 1] !== '#') return false;
	return firstWord(s.slice(open + 2)) === 'comment';
}

// matchCommentCloser reports whether s[open] begins a {/comment} closer. Mirrors
// matchCommentCloser. Returns { ok, end }.
function matchCommentCloser(s, open) {
	let i = open + 1;
	if (i >= s.length || s[i] !== '/') return { ok: false };
	i++;
	while (i < s.length && isSpaceByte(s[i])) i++;
	const kw = 'comment';
	if (i + kw.length > s.length || s.slice(i, i + kw.length) !== kw) return { ok: false };
	i += kw.length;
	while (i < s.length && isSpaceByte(s[i])) i++;
	if (i >= s.length || s[i] !== '}') return { ok: false };
	return { ok: true, end: i + 1 };
}

// scanBlockComment scans a {#comment} … {/comment} block (D70) from the opening
// '{'. Body consumed raw; nested openers counted. Mirrors scanBlockComment.
// Returns { ok, end }.
export function scanBlockComment(s, open) {
	let depth = 1;
	for (let i = open + 1; i < s.length; ) {
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
			if (depth === 0) return { ok: true, end: m.end };
			i = m.end;
			continue;
		}
		i++;
	}
	return { ok: false };
}
