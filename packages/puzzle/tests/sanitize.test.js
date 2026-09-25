// @vitest-environment jsdom
//
// The `raw` sanitizer (D174). The shared conformance table pins the exact output
// for every row (tests/formatters.test.js runs it); this suite adds the property
// checks that hold for every row of the XSS corpus and beyond: the output parsed
// by a real HTML parser holds no executable surface, re-sanitizing it changes
// nothing, and the rich-text rows keep their structure.
import { describe, expect, it } from 'vitest';
import { sanitizeHtml, newlineToBr } from '../client-runtime/sanitize.js';
import conformance from './conformance/formatters.json';

const rawRows = conformance.cases.filter((c) => c.name === 'raw');

// Extra vectors beyond the shared table — more obfuscations of the same classes.
const extraVectors = [
	'<a href="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058alert(1)">x</a>',
	'<a href="&#x0A;javascript:alert(1)">x</a>',
	'<a href="javascript&#58;alert(1)">x</a>',
	'<a href=" javascript:alert(1)">x</a>',
	'<a href="\tjavascript:alert(1)">x</a>',
	'<a href="jav&#x0D;ascript:alert(1)">x</a>',
	'<a href="JAVASCRIPT:alert(1)">x</a>',
	'<a href="&NewLine;javascript:alert(1)">x</a>',
	'<a href="livescript:alert(1)">x</a>',
	'<a href="file:///etc/passwd">x</a>',
	'<img src=`javascript:alert(1)`>',
	'<img """><script>alert(1)</script>">',
	'<img src="x" onerror  =  "alert(1)">',
	'<img/src="x"/onerror="alert(1)">',
	'<img src=x:alert(alt) onerror=eval(src) alt=0>',
	'<a/href="javascript:alert(1)">x</a>',
	'<div onclick\n="alert(1)">x</div>',
	'<isindex action="javascript:alert(1)" type="image">',
	'<form><button formaction="javascript:alert(1)">x</button></form>',
	'<input type="image" src="x" onerror="alert(1)">',
	'<video><source onerror="alert(1)"></video>',
	'<audio src="x" onerror="alert(1)"></audio>',
	'<marquee onstart="alert(1)">x</marquee>',
	'<svg><a xlink:href="javascript:alert(1)"><text x="20" y="20">x</text></a></svg>',
	'<svg><animate onbegin="alert(1)" attributeName="x" dur="1s"/></svg>',
	'<math href="javascript:alert(1)">x</math>',
	'<noscript><style></noscript><img src=x onerror=alert(1)></style></noscript>',
	'<noembed><img src=x onerror=alert(1)></noembed>',
	'<noframes><img src=x onerror=alert(1)></noframes>',
	'<template><template><img src=x onerror=alert(1)></template></template>after',
	'<object><object></object><img src=x onerror=alert(1)></object>',
	'<style><!--</style><img src=x onerror=alert(1)>-->',
	'<!--[if IE]><script>alert(1)</script><![endif]-->',
	'<![CDATA[><img src=x onerror=alert(1)>]]>',
	'<?php echo 1 ?><img src=x onerror=alert(1)>',
	'</p/onmouseover=alert(1)>x',
	'<meta charset="x"><base href="//evil.example/">',
	'<a href="https://ok.example"><img src="x" onload="alert(1)"></a>',
	'<table><tr><td background="javascript:alert(1)">x</td></tr></table>',
	'<p id="location" name="cookie" class="fixed inset-0">clobber</p>',
	'<a href="https://ok.example" target="_blank" rel="opener" ping="https://evil.example">x</a>',
	'<img src="https://ok.example/a.png" srcset=" javascript:alert(1) 1x">',
	'<img srcset="https://ok.example/a.png 1x,\njavascript:alert(1) 2x">',
];

const EXECUTABLE_TAGS = [
	'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math',
	'template', 'noscript', 'noembed', 'noframes', 'textarea', 'title', 'xmp', 'plaintext', 'link',
	'meta', 'base', 'form', 'input', 'button', 'select', 'option', 'isindex', 'video', 'audio',
	'source', 'marquee', 'body', 'html', 'head',
];
const URL_ATTRS = ['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href', 'background', 'ping'];

// The URL parser's own view of a scheme: leading/trailing C0 and space trimmed,
// tabs and newlines removed.
function scheme(url) {
	const m = /^([a-z][a-z\d+.-]*):/i.exec(url.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\n\r]/g, ''));
	return m ? m[1].toLowerCase() : '';
}

/** Parse markup the way views/html.js does and report anything executable. */
function executableSurface(html) {
	const t = document.createElement('template');
	t.innerHTML = html;
	const problems = [];
	for (const el of t.content.querySelectorAll('*')) {
		const tag = el.localName;
		if (EXECUTABLE_TAGS.includes(tag)) problems.push(`<${tag}>`);
		if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') problems.push(`foreign ${tag}`);
		for (const attr of el.attributes) {
			const name = attr.name.toLowerCase();
			if (name.startsWith('on')) problems.push(`${tag}[${name}]`);
			if (name === 'style' || name === 'name') problems.push(`${tag}[${name}]`);
			if (name === 'rel' && attr.value !== 'noopener noreferrer') problems.push(`${tag}[rel=${attr.value}]`);
			// DOM clobbering: an id naming a document or <form> property.
			if (name === 'id' && (attr.value in document || attr.value in document.createElement('form'))) {
				problems.push(`${tag}[id=${attr.value}]`);
			}
			if (name === 'target' && el.getAttribute('rel') !== 'noopener noreferrer') {
				problems.push(`${tag}[target] without rel=noopener noreferrer`);
			}
			if (URL_ATTRS.includes(name)) {
				const candidates = name === 'srcset' ? attr.value.split(',').map((c) => c.trim().split(/\s+/)[0]) : [attr.value];
				for (const url of candidates) {
					const s = scheme(url);
					const link = tag === 'a' && name === 'href';
					if (s && !['http', 'https'].includes(s) && !(link && ['mailto', 'tel'].includes(s))) {
						problems.push(`${tag}[${name}=${attr.value}]`);
					}
				}
			}
		}
	}
	return problems;
}

describe('raw sanitizer (D174)', () => {
	const corpus = [...rawRows.map((c) => c.input ?? ''), ...extraVectors];

	it.each(corpus.map((input) => [JSON.stringify(input), input]))(
		'%s comes out inert',
		(_label, input) => {
			const out = sanitizeHtml(input);
			expect(executableSurface(out)).toEqual([]);
			// Idempotent: the output is already in the canonical form, so a second
			// pass reads exactly the tags and attributes the first one wrote.
			expect(sanitizeHtml(out)).toBe(out);
		},
	);

	it('keeps ordinary rich text: paragraphs, lists, links, images, headings, inline and block markup', () => {
		const input =
			'<h2>Heading</h2><p>Para with <b>b</b> <i>i</i> <em>em</em> <strong>strong</strong> <code>code</code>.</p>' +
			'<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>quote</blockquote><pre>pre\n  text</pre>' +
			'<p><a href="https://example.com" title="t">link</a><br><img src="/a.png" alt="a"></p>';
		expect(sanitizeHtml(input)).toBe(input);
		const t = document.createElement('template');
		t.innerHTML = sanitizeHtml(input);
		const tags = [...t.content.querySelectorAll('*')].map((el) => el.localName);
		for (const tag of ['h2', 'p', 'b', 'i', 'em', 'strong', 'code', 'ul', 'ol', 'li', 'blockquote', 'pre', 'a', 'br', 'img']) {
			expect(tags).toContain(tag);
		}
		expect(t.content.querySelector('a').getAttribute('href')).toBe('https://example.com');
		expect(t.content.querySelector('img').getAttribute('src')).toBe('/a.png');
	});

	it('re-emits URL attributes from their decoded form, so the browser resolves the checked string', () => {
		expect(sanitizeHtml('<a href="/search?q=a&amp;b=c">x</a>')).toBe('<a href="/search?q=a&amp;b=c">x</a>');
		// An unknown named reference stays literal — for the checker and, because
		// the `&` is escaped on the way out, for the browser too.
		const out = sanitizeHtml('<a href="javascript&unknownref;alert(1)">x</a>');
		const t = document.createElement('template');
		t.innerHTML = out;
		expect(t.content.querySelector('a').getAttribute('href')).toBe('javascript&unknownref;alert(1)');
	});

	it('balances its output so a value cannot leak formatting into the page', () => {
		expect(sanitizeHtml('<b><i>x')).toBe('<b><i>x</i></b>');
		expect(sanitizeHtml('<p>a</b>b</p>')).toBe('<p>ab</p>');
		expect(sanitizeHtml('<ul><li>a<li>b</ul>')).toBe('<ul><li>a<li>b</li></li></ul>');
	});

	it('coerces a missing value to empty and stringifies everything else', () => {
		expect(sanitizeHtml(undefined)).toBe('');
		expect(sanitizeHtml(null)).toBe('');
		expect(sanitizeHtml(42)).toBe('42');
	});
});

describe('class, id and target (DOMPurify defaults)', () => {
	it("keeps class and id, so content can use the app's CSS and anchors", () => {
		expect(sanitizeHtml('<h2 id="faq" class="text-xl font-bold">FAQ</h2>')).toBe(
			'<h2 id="faq" class="text-xl font-bold">FAQ</h2>'
		);
	});

	it.each(['location', 'cookie', 'domain', 'forms', 'images', 'body', 'write', 'action', 'submit', 'elements'])(
		'drops a clobbering id="%s"',
		(id) => {
			expect(sanitizeHtml(`<img id="${id}" src="/a.png"><p id="${id}">x</p>`)).toBe('<img src="/a.png"><p>x</p>');
		}
	);

	it('checks the decoded id and re-emits it decoded', () => {
		expect(sanitizeHtml('<p id="c&#111;okie">x</p>')).toBe('<p>x</p>');
		expect(sanitizeHtml('<p id="a&amp;b">x</p>')).toBe('<p id="a&amp;b">x</p>');
	});

	it('forces rel="noopener noreferrer" on a kept target and never keeps an author rel', () => {
		expect(sanitizeHtml('<a href="/x" target="_blank" rel="opener">x</a>')).toBe(
			'<a href="/x" target="_blank" rel="noopener noreferrer">x</a>'
		);
		expect(sanitizeHtml('<a href="/x" rel="opener">x</a>')).toBe('<a href="/x">x</a>');
		expect(sanitizeHtml('<p target="_blank">x</p>')).toBe('<p>x</p>');
	});
});

describe('newline_to_br (D174)', () => {
	it('escapes the value and emits real <br> elements, with no other markup', () => {
		const out = newlineToBr('<script>alert(1)</script>\n<b>x</b>\r\ny\rz');
		expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;<br>&lt;b&gt;x&lt;/b&gt;<br>y<br>z');
		const t = document.createElement('template');
		t.innerHTML = out;
		expect([...t.content.querySelectorAll('*')].map((el) => el.localName)).toEqual(['br', 'br', 'br']);
	});
});
