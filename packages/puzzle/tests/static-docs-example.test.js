// @vitest-environment jsdom
// D179 — `staticPaths` in a REAL build. `npm run build:static-docs` (pretest)
// builds examples/static-docs, whose '/principles/:id' route lists its pages
// with the model shorthand `staticPaths: 'principle'` over the records app.js
// seeds in beforeMount. This reads the built pages, then runs the generated
// per-page module itself — the Go-written entry plus the built kernel — over a
// generated page, so the island → entry → kernel handoff is exercised exactly
// as a browser runs it.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '../examples/static-docs/dist');
const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');

describe('examples/static-docs — a staticPaths route (D179)', () => {
	it('keeps fixed production names and preloads shared chunks on every page', () => {
		const pages = fs.readdirSync(DIST, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith('.html'));
		expect(pages.length).toBeGreaterThan(1);
		for (const entry of pages) {
			const file = path.join(entry.parentPath ?? entry.path, entry.name);
			const page = new DOMParser().parseFromString(fs.readFileSync(file, 'utf8'), 'text/html');
			const links = [...page.head.querySelectorAll('link[rel="modulepreload"]')];
			expect(links.length, file).toBeGreaterThan(0);
			const hrefs = links.map((link) => link.getAttribute('href'));
			expect(new Set(hrefs).size).toBe(hrefs.length);
			for (const href of hrefs) {
				expect(href).toMatch(/^\/_puzzle\/chunks\/.+\.js$/);
				expect(fs.existsSync(path.join(DIST, href.slice(1))), href).toBe(true);
			}
			expect(page.querySelector('script[type="module"]').getAttribute('src')).toMatch(/^\/_puzzle\/[^/]+\.js$/);
			expect(page.querySelector('link[rel="stylesheet"][href="/styles.css"]')).not.toBeNull();
		}
		expect(fs.existsSync(path.join(DIST, 'app.js'))).toBe(false);
		expect(fs.existsSync(path.join(DIST, '_puzzle/index.js'))).toBe(true);
	});

	it('writes one page per principle record, sharing one module', () => {
		for (const [id, title] of [
			['p1', 'One file per component'],
			['p2', 'Data down, events up'],
			['p3', 'Static when it can be'],
		]) {
			const page = read(`principles/${id}/index.html`);
			expect(page).toContain(`>${title}</h1>`);
			expect(page).toContain(
				`<script type="application/json" data-puzzle-static-route>{"path":"/principles/${id}","params":{"id":"${id}"}}</script>`
			);
			expect(page).toContain('<script type="module" src="/_puzzle/principles--_id.js"></script>');
		}
		expect(fs.readdirSync(path.join(DIST, 'principles')).sort()).toEqual(['p1', 'p2', 'p3']);
		expect(read('_puzzle/principles--_id.js')).toContain('data-puzzle-static-route');
		// A fixed route's page carries no route island, and its module reads none.
		expect(read('about/index.html')).not.toContain('data-puzzle-static-route');
		expect(read('_puzzle/about.js')).not.toContain('data-puzzle-static-route');
		expect(read('about/index.html')).toContain('href="/principles/p2"');
	});

	it('mounts the generated page with its own params through the built module', async () => {
		const html = read('principles/p3/index.html');
		document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)[1];
		const target = document.querySelector('#app');
		const prerendered = target.innerHTML;
		const before = target.querySelector('h1');
		expect(before.textContent).toBe('Static when it can be');

		await import(pathToFileURL(path.join(DIST, '_puzzle/principles--_id.js')).href);
		for (let i = 0; i < 50 && target.querySelector('h1') === before; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		// Re-mounted (fresh nodes) over identical markup: the kernel rendered the
		// same record, so it had the page's `id` — not a missing or pattern param.
		expect(target.querySelector('h1')).not.toBe(before);
		expect(target.innerHTML).toBe(prerendered);
	});
});
