// Build-time fetch for prerender reads (D161).
//
// D161 makes prerender `data()` fetch at BUILD time, which puts the read path in
// Node rather than the browser. A prerender read must therefore be answerable
// from the build machine: either the API is real and `apiURL` is absolute, or
// there is no API and the model declares no `endpoint` and no read verb while the
// app seeds the store in `beforeMount({ store })`. An app-relative URL is neither
// — a browser resolves it against the page it is on, Node has no page — so it
// fails with a diagnostic naming the URL and both fixes rather than undici's bare
// `TypeError: Failed to parse URL from /api/notes.json`.
import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prerender, prerenderToDir } from '../client-runtime/ssg/index.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const SHELL = `<!DOCTYPE html><html><head><title>x</title></head><body><div id="app"></div><script type="module" src="/app.js"></script></body></html>`;

/** A temp dir standing in for the build's staged output, with the shell in it. */
function stageDir(prefix) {
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	const shellPath = path.join(outDir, '__shell.html');
	fs.writeFileSync(shellPath, SHELL);
	return { outDir, shellPath };
}

class Note extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		body: Puzzle.string(),
	};
	static adapter = { endpoint: '/notes.json' };
}

class Feed extends PuzzleView {
	data() {
		return { notes: this.ctx.store.findMany('note') };
	}
	render() {
		return h(
			'ul',
			{},
			this.getData().notes.map((n) => h('li', {}, [text(n.body)]))
		);
	}
}
Feed.__pzlModule = 'app/views/Feed.pzl';

const relativeConfig = (overrides = {}) => ({
	target: '#app',
	apiURL: '/api',
	adapter,
	models: { note: Note },
	routes: [{ path: '/', name: 'home', view: Feed }],
	...overrides,
});

describe('prerender build-time fetch', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('leaves an absolute endpoint completely alone', async () => {
		const calls = [];
		const body = [{ id: 'a', body: 'alpha' }];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url) => {
				calls.push(String(url));
				// The read path parses res.text() (datastore/adapter.js responseData).
				return {
					ok: true,
					status: 200,
					statusText: 'OK',
					json: async () => body,
					text: async () => JSON.stringify(body),
				};
			})
		);

		const { pages } = await prerender(relativeConfig({ apiURL: 'https://api.test' }), {
			mode: 'static',
		});

		expect(pages[0].html).toContain('alpha');
		// Untouched — the wrapper hands an absolute URL straight to the real fetch.
		expect(calls).toEqual(['https://api.test/notes.json']);
	});

	it('fails an unresolvable app-relative read with a diagnostic, not a raw URL parse error', async () => {
		const err = await prerender(relativeConfig(), { mode: 'static' }).then(
			() => null,
			(e) => e
		);

		expect(err).toBeTruthy();
		const chain = [err.message, err.cause?.message ?? ''].join('\n');
		// Names the URL, the reason, and both ways to make the read answerable.
		expect(chain).toContain('/api/notes.json');
		expect(chain).toContain('no page origin');
		expect(chain).toContain('apiURL');
		expect(chain).toContain('endpoint');
		expect(chain).toContain('beforeMount');
		// And never surfaces undici's bare message as the whole story.
		expect(chain).not.toMatch(/^TypeError: Failed to parse URL/);
	});

	it('fails an app-relative path hardcoded inside an authored verb', async () => {
		// The D158 escape hatch: a model verb calls fetch() with a path that never
		// passes through `apiURL`, which is why the seam is the global fetch.
		class PinnedNote extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				body: Puzzle.string(),
			};
			static adapter = {
				endpoint: '/notes.json',
				async loadMany(fetch) {
					return fetch('/data/notes.json');
				},
			};
		}

		const err = await prerender(
			relativeConfig({ apiURL: 'https://api.test', models: { note: PinnedNote } }),
			{ mode: 'static' }
		).then(
			() => null,
			(e) => e
		);

		expect(err).toBeTruthy();
		const chain = [err.message, err.cause?.message ?? ''].join('\n');
		expect(chain).toContain('/data/notes.json');
		expect(chain).toContain('no page origin');
	});

	it('restores the global fetch after a pass, including a failing one', async () => {
		const sentinel = async () => {
			throw new Error('unused');
		};
		vi.stubGlobal('fetch', sentinel);

		const { outDir, shellPath } = stageDir('puzzle-build-fetch-restore-');
		await prerenderToDir(
			relativeConfig({
				apiURL: 'https://api.test',
				models: {},
				routes: [{ path: '/', name: 'home', view: Feed }],
			}),
			{ outDir, shellPath, mode: 'static' }
		);
		expect(globalThis.fetch).toBe(sentinel);

		// A pass that throws must restore too.
		await prerender(relativeConfig(), { mode: 'static' }).catch(() => {});
		expect(globalThis.fetch).toBe(sentinel);
	});
});
