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
