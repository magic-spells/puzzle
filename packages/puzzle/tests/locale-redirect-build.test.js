// @vitest-environment node
// D177 — the first-visit redirect script exactly as a REAL build emits it. The
// script is a function's source text, and in a build that source is the one the
// prerender's esbuild bundle printed, not the file on disk: a renamed free
// identifier or an injected helper would break it in browsers while every unit
// test still passed. `npm run build:locale-prefix` (pretest) builds
// tests/fixtures/locale-prefix-site with the compiler; this reads its pages.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REDIRECT_CASES, REDIRECT_MANIFEST, SAME_ORIGIN } from './fixtures/locale-redirect-cases.js';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/locale-prefix-site/dist');
const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');
const SCRIPT_RE = /<script>(\(function\([^)]*\)\{[\s\S]*?\}\))\(([^<]*),window\)<\/script>/;
const TAGS = Object.keys(REDIRECT_MANIFEST.locales);
const ORIGIN = 'https://site.dev';

function fakeWindow(row, replace) {
	const url = new URL(row.url, ORIGIN);
	const stored = row.stored ?? null;
	return {
		location: { pathname: url.pathname, search: url.search, hash: url.hash, origin: ORIGIN, replace },
		document: { referrer: row.referrer === SAME_ORIGIN ? ORIGIN + '/es/' : (row.referrer ?? '') },
		localStorage: { getItem: () => stored },
		navigator: { languages: row.languages, language: row.languages[0] },
	};
}

describe('the built first-visit redirect script (D177)', () => {
	const page = read('about/index.html');
	const match = SCRIPT_RE.exec(page);

	it('rides in the head of the default-locale pages only, called with the build’s locales', () => {
		expect(match).not.toBe(null);
		expect(page.indexOf(match[0])).toBeLessThan(page.indexOf('</head>'));
		expect(JSON.parse(`[${match[2]}]`)).toEqual([TAGS, 'en', '']);
		expect(read('index.html')).toContain(match[1]);
		for (const file of ['es/index.html', 'es/about/index.html', 'pt-BR/about/index.html']) {
			expect(SCRIPT_RE.test(read(file))).toBe(false);
		}
	});

	it('names nothing but its own parameters and locals and the browser globals', () => {
		const code = match[1]
			.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
			.replace(/(?<=[(,=:!&|?]\s*)\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+\/[a-z]*/g, '/re/');
		const declared = new Set([
			...[...code.matchAll(/function\s*\(([^)]*)\)/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())),
			...[...code.matchAll(/\b(?:const|let|var)\s+([\w$]+)/g)].map((m) => m[1]),
			...[...code.matchAll(/\(\s*([\w$]+)\s*\)\s*=>|([\w$]+)\s*=>/g)].map((m) => m[1] ?? m[2]),
		]);
		const keywords = ['function', 'try', 'catch', 'const', 'let', 'var', 'if', 'return', 'new', 'typeof', 'for', 'continue', 're'];
		const globals = ['location', 'document', 'navigator', 'localStorage', 'URL'];
		const names = [...code.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)].map((m) => m[0]);
		const free = names.filter((name) => !declared.has(name) && !keywords.includes(name) && !globals.includes(name));
		expect(free).toEqual([]);
	});

	// The emitted function, run on the shared decision table: every row, with the
	// row's routerBase passed in (the build's own call uses this fixture's '').
	const built = () => new Function(`return ${match[1]}`)();

	it.each(REDIRECT_CASES)('$name', (row) => {
		const replace = vi.fn();
		built()(TAGS, 'en', row.routerBase ?? '', fakeWindow(row, replace));
		if (row.expected) expect(replace).toHaveBeenCalledExactlyOnceWith(row.expected);
		else expect(replace).not.toHaveBeenCalled();
	});

	it('runs as the whole emitted <script> on a bare window', () => {
		const replace = vi.fn();
		const body = match[0].slice('<script>'.length, -'</script>'.length);
		new Function('window', body)(fakeWindow({ url: '/about?x=1', languages: ['pt'] }, replace));
		expect(replace).toHaveBeenCalledExactlyOnceWith('/pt-BR/about?x=1');
	});
});
