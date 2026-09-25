/**
 * The markup sanitizer behind the `raw` formatter (D174): a small DOM-free
 * tokenizer plus an allowlist. It runs unchanged in the browser (views/html.js)
 * and in the static/hybrid prerender (ssg/serialize.js), so both emit the same
 * string for the same value. The shared conformance table
 * (tests/conformance/formatters.json) pins the output; Sites' Go `raw` runs the
 * same rows.
 *
 * Why this is safe without a DOM. The OUTPUT is written by this module, never
 * copied from the input: every kept tag is re-emitted from its lowercased name,
 * every kept attribute is re-emitted double-quoted with `"`, `<`, `>` and bare
 * `&` escaped, text is re-emitted with `<`, `>` and bare `&` escaped, and
 * comments, doctypes, CDATA and processing instructions are dropped. No
 * RAWTEXT/RCDATA element (script, style, textarea, title, …), no `<template>`
 * or `<noscript>`, and no foreign content (svg, math) is ever emitted, so a
 * browser parsing the output tokenizes exactly the tags and attributes written
 * here — the tokenizer's own reading of hostile input can only decide what gets
 * DROPPED, never what an emitted byte means. That is the property the classic
 * mutation-XSS vectors (`<svg><style>…`, `<noscript><p title="</noscript>…">`)
 * rely on breaking, and it is why a tokenizer can stand in for DOMPurify here.
 *
 * - Kept tags and attributes: TAG_ATTRS and PLAIN_TAGS below; `title`, `lang`,
 *   `dir`, `class` and `id` on any of them (DOMPurify's defaults). `class`
 *   lets the value use the app's CSS — an overlay risk for untrusted HTML, not
 *   code execution. No `style`, no `on*` handler, and never `name`: `name` is
 *   what makes an element reachable through `document.<name>` and a form's
 *   named properties, so keeping it stripped is what keeps `document`
 *   unclobberable — it must stay off this allowlist for good.
 * - `id` is kept verbatim (heading anchors, styling) with two exceptions: never
 *   on `<img>` — the one kept tag that is a form-associated "listed" element,
 *   so `<img id="action">` inside the app's own `<form>` would shadow
 *   `form.action` and hundreds of other form properties — and never when it
 *   starts with `__`, which keeps `window.__…` framework globals and dev hooks
 *   out of reach. Any other id still becomes a `window[id]` named property when
 *   the page has no global of that name; see the security notes in SKILL.md.
 * - `target` is kept on `<a>` only as `_blank` (any case), re-emitted as
 *   `target="_blank"` with `rel="noopener noreferrer"`; an author `rel` is
 *   never kept. Any other value is dropped: a named target sets `window.name`
 *   in the opened page, and `_top`/`_parent` escape a frame.
 * - URL attributes (href, src, srcset, and action/formaction/xlink:href should
 *   the allowlist ever grow them) keep only http(s) and relative URLs; an `<a
 *   href>` also keeps mailto: and tel:. The check runs on the value after
 *   character-reference decoding, tab/newline removal and C0/space trimming —
 *   the URL parser's own normalization — and the value is re-emitted from that
 *   decoded form with every `&` escaped, so the browser resolves exactly the
 *   string that was checked. A srcset is dropped whole when any candidate fails.
 * - Dropped with their contents: DROP_RAW (scanned to the matching end tag as
 *   the browser does), DROP_NESTED (skipped to the balancing end tag), and
 *   `<plaintext>` (the rest of the input).
 * - Any other tag is unwrapped: the tag goes, its text and allowed descendants
 *   stay (`<font>`, `<form>`, `<button>`, `<label>`, …). A void one (`input`,
 *   `link`, `meta`, `base`, `embed`) simply disappears.
 * - The output is balanced: a stray end tag is dropped, and every tag still open
 *   at the end is closed, so a value cannot leak formatting into the page around
 *   it. A tag cut off by the end of the input is dropped whole, like the browser.
 * - NUL characters are removed.
 */

// Every table below is a literal — no top-level call or loop — so the module
// has no side effects and tree-shakes out of an app that never reaches it.
// Space-padded name lists are matched by `has`; tag names never hold a space.
const has = (list, name) => list.includes(' ' + name + ' ');

// Tags kept with attributes beyond the global three, then the tags kept with
// only the global three.
const TAG_ATTRS = {
	a: 'href target',
	img: 'src srcset alt width height',
	ol: 'start reversed',
	li: 'value',
	td: 'colspan rowspan',
	th: 'colspan rowspan scope',
	col: 'span',
	colgroup: 'span',
	time: 'datetime',
	del: 'datetime',
	ins: 'datetime',
	details: 'open',
};
const PLAIN_TAGS =
	' p br hr h1 h2 h3 h4 h5 h6 blockquote pre code b i em strong u s strike sub sup small mark' +
	' abbr cite dfn kbd q samp var bdi bdo span div address figure figcaption ul dl dt dd' +
	' table caption thead tbody tfoot tr summary wbr ';
// Never add `name` here (see the header): it is the clobbering surface.
const GLOBAL_ATTRS = ' title lang dir class id ';
const URL_ATTRS = ' href src srcset action formaction xlink:href ';

/** The attributes a kept tag keeps beyond the global three, or null for a dropped tag. */
function tagAttrs(name) {
	if (Object.hasOwn(TAG_ATTRS, name)) return ' ' + TAG_ATTRS[name] + ' ';
	return has(PLAIN_TAGS, name) ? ' ' : null;
}

// Elements that never have content (no end tag). Only br/col/hr/img/wbr are
// kept; the rest are listed so an unwrapped void tag opens nothing.
const VOID = ' area base br col embed hr img input link meta param source track wbr keygen frame ';
// RAWTEXT/RCDATA in the browser: their content is text up to `</name`, so it is
// scanned the same way and dropped with the element.
const DROP_RAW = ' script style xmp iframe noembed noframes noscript textarea title ';
// Ordinary markup content that is never meant to render as rich text: skipped
// to the balancing end tag. svg/math are foreign content (no namespace
// confusion is ever emitted); template/object/applet are inert or embedded
// documents; select/head/frameset hold no document markup.
const DROP_NESTED = ' template object applet svg math select head frameset ';

// The attribute-value decoder's named references: the markup characters, and
// the ones obfuscated URLs spell a scheme with (`javascript&colon;`,
// `java&Tab;script:`). Anything not here stays literal text, and since decoded
// values are re-emitted with `&` escaped, the browser reads it literally too.
const NAMED = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', colon: ':', Tab: '\t',
	NewLine: '\n',
};

const WS = /[\t\n\f\r ]/;
// A character reference the browser will decode: passed through untouched in
// text and plain attribute values (decoding it can never produce markup there).
const REF = /&(?:#\d+|#[xX][\da-fA-F]+|[A-Za-z][A-Za-z\d]*);/y;

/** Escape text or a plain attribute value, keeping well-formed character references. */
function escapeKeepRefs(s, quote) {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === '&') {
			REF.lastIndex = i;
			out += REF.test(s) ? '&' : '&amp;';
		} else if (ch === '<') out += '&lt;';
		else if (ch === '>') out += '&gt;';
		else if (ch === '"' && quote) out += '&quot;';
		else out += ch;
	}
	return out;
}

/** Escape every markup character — the value is final text, nothing is left to decode. */
function escapeAll(s, quote) {
	s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return quote ? s.replace(/"/g, '&quot;') : s;
}

function decodeRefs(s) {
	return s.replace(/&(?:#(\d+)|#[xX]([\da-fA-F]+));?|&([A-Za-z][A-Za-z\d]*);/g, (m, dec, hex, name) => {
		if (name) return Object.hasOwn(NAMED, name) ? NAMED[name] : m;
		const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
		return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
			? String.fromCodePoint(code)
			: '\ufffd';
	});
}

/**
 * A URL the page may keep: relative, http(s), or — for a link — mailto:/tel:.
 * The URL parser strips leading C0 controls and spaces (U+0000–U+0020, which
 * `trim()` does not all cover) and removes every tab and newline before it
 * reads a scheme, so the check does the same.
 */
function safeUrl(url, link) {
	const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, ''));
	if (!scheme) return true;
	const s = scheme[1].toLowerCase();
	return s === 'http' || s === 'https' || (link && (s === 'mailto' || s === 'tel'));
}

/** The emitted ` name="value"` for one attribute, or '' when it is dropped. */
function keepAttr(allowed, tag, name, value) {
	if (!has(GLOBAL_ATTRS, name) && !has(allowed, name)) return '';
	if (name === 'id') {
		// Checked and re-emitted decoded, so the browser reads the string checked.
		const id = decodeRefs(value);
		return tag === 'img' || id.startsWith('__') ? '' : ` id="${escapeAll(id, true)}"`;
	}
	if (name === 'target') {
		return decodeRefs(value).toLowerCase() === '_blank' ? ' target="_blank"' : '';
	}
	if (!has(URL_ATTRS, name)) return ` ${name}="${escapeKeepRefs(value, true)}"`;
	const url = decodeRefs(value).replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
	const ok =
		name === 'srcset'
			? // Every whitespace- or comma-separated token, so a candidate URL is
				// checked wherever the srcset parser would start one; descriptors
				// (`2x`, `640w`) carry no scheme and pass.
				url.split(/[\s,]+/).every((t) => safeUrl(t, false))
			: safeUrl(url, tag === 'a' && name === 'href');
	return ok ? ` ${name}="${escapeAll(url, true)}"` : '';
}

/**
 * Parse one tag from `<` at i. Returns { name, attrs, selfClosing, end } with
 * `end` just past the `>`, or null when the input ends inside the tag (the
 * browser drops such a tag). Attributes follow the HTML tokenizer: a name runs
 * to whitespace, `/`, `>` or `=`; a value is double-quoted, single-quoted or
 * unquoted to whitespace or `>`. End tags are parsed the same way so a `>`
 * inside a quoted value does not end them early.
 */
function readTag(s, i) {
	let j = i + (s[i + 1] === '/' ? 2 : 1);
	const start = j;
	while (j < s.length && !WS.test(s[j]) && s[j] !== '/' && s[j] !== '>') j++;
	const name = s.slice(start, j).toLowerCase();
	const attrs = [];
	let selfClosing = false;
	for (;;) {
		while (j < s.length && (WS.test(s[j]) || (s[j] === '/' && s[j + 1] !== '>'))) j++;
		if (j >= s.length) return null;
		if (s[j] === '>') break;
		if (s[j] === '/') {
			selfClosing = true;
			j++;
			continue;
		}
		const n0 = j++;
		while (j < s.length && !WS.test(s[j]) && s[j] !== '/' && s[j] !== '>' && s[j] !== '=') j++;
		const attr = s.slice(n0, j).toLowerCase();
		while (j < s.length && WS.test(s[j])) j++;
		let value = '';
		if (s[j] === '=') {
			j++;
			while (j < s.length && WS.test(s[j])) j++;
			const q = s[j];
			if (q === '"' || q === "'") {
				const close = s.indexOf(q, j + 1);
				if (close < 0) return null;
				value = s.slice(j + 1, close);
				j = close + 1;
			} else {
				const v0 = j;
				while (j < s.length && !WS.test(s[j]) && s[j] !== '>') j++;
				value = s.slice(v0, j);
			}
		}
		attrs.push([attr, value]);
	}
	return { name, attrs, selfClosing, end: j + 1 };
}

/** The index just past `</name…>` for a RAWTEXT element, or the end of the input. */
function rawtextEnd(s, i, name) {
	const re = new RegExp('</' + name + '[\\t\\n\\f\\r />]', 'ig');
	re.lastIndex = i;
	const m = re.exec(s);
	return m ? m.index : s.length;
}

/** Sanitize a markup string against the allowlist. Always returns a string. */
export function sanitizeHtml(value) {
	const s = String(value ?? '').replace(/\0/g, '');
	const open = [];
	// How many of each tag name are open, so an end tag is O(1) to reject
	// (a stray `</i>` must not scan the stack: 40k of them would be quadratic).
	const openCount = Object.create(null);
	let out = '';
	// While skipping a DROP_NESTED element: its name and nesting depth.
	let skip = null;
	let depth = 0;
	let i = 0;
	while (i < s.length) {
		const lt = s.indexOf('<', i);
		const stop = lt < 0 ? s.length : lt;
		if (!skip && stop > i) out += escapeKeepRefs(s.slice(i, stop), false);
		if (lt < 0) break;
		i = lt;
		const next = s[i + 1] || '';
		if (s.startsWith('<!--', i)) {
			// `<!-->` and `<!--->` close at once; otherwise `-->` or `--!>` does.
			const m = /^<!--(?:-?>|[\s\S]*?--!?>)/.exec(s.slice(i));
			i = m ? i + m[0].length : s.length;
			continue;
		}
		const endTag = next === '/';
		const letter = /[A-Za-z]/.test(endTag ? s[i + 2] || '' : next);
		if (!letter) {
			if (next === '!' || next === '?' || (endTag && s[i + 2] !== '>')) {
				// Bogus comment — a doctype, `<![CDATA[`, `<?xml`, `</ 3>` — to the first `>`.
				const gt = s.indexOf('>', i);
				i = gt < 0 ? s.length : gt + 1;
			} else if (endTag) {
				i += 3; // `</>` is ignored
			} else {
				if (!skip) out += '&lt;';
				i++;
			}
			continue;
		}
		const tag = readTag(s, i);
		if (!tag) break;
		i = tag.end;
		const { name } = tag;
		if (endTag) {
			if (skip) {
				if (name === skip && --depth === 0) skip = null;
			} else if (openCount[name] > 0) {
				let top;
				do {
					top = open.pop();
					openCount[top]--;
					out += `</${top}>`;
				} while (top !== name);
			}
			continue;
		}
		if (has(DROP_RAW, name)) {
			i = rawtextEnd(s, i, name);
			continue;
		}
		if (name === 'plaintext') break;
		if (skip) {
			if (name === skip) depth++;
			continue;
		}
		if (has(DROP_NESTED, name)) {
			// `<svg/>` and `<math/>` self-close as foreign content; the rest ignore the slash.
			if (!(tag.selfClosing && (name === 'svg' || name === 'math'))) {
				skip = name;
				depth = 1;
			}
			continue;
		}
		const allowed = tagAttrs(name);
		if (allowed == null) continue;
		const seen = new Set();
		let attrs = '';
		let blank = false;
		for (const [attr, v] of tag.attrs) {
			// The browser keeps the FIRST of a repeated attribute.
			if (seen.has(attr)) continue;
			seen.add(attr);
			const kept = keepAttr(allowed, name, attr, v);
			if (attr === 'target' && kept) blank = true;
			attrs += kept;
		}
		if (blank) attrs += ' rel="noopener noreferrer"';
		out += `<${name}${attrs}>`;
		if (!has(VOID, name)) {
			open.push(name);
			openCount[name] = (openCount[name] || 0) + 1;
		}
	}
	while (open.length) out += `</${open.pop()}>`;
	return out;
}

/**
 * `newline_to_br`: the value as escaped text, with a real `<br>` for every
 * `\r\n`, `\r` and `\n`. Safe by construction — the only markup is the `<br>`s.
 */
export function newlineToBr(value) {
	return escapeAll(String(value ?? ''), false).replace(/\r\n|\r|\n/g, '<br>');
}
