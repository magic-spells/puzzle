// Build-time fetch origin for prerender reads (D161).
//
// D161 made prerender `data()` fetch at BUILD time, which moved the read path off
// the browser and into Node. A browser resolves an app-relative URL against the
// page it is on; Node has no page, so `apiURL: '/api'` + `endpoint: '/notes.json'`
// reached `fetch('/api/notes.json')` and died with undici's bare
// `TypeError: Failed to parse URL from /api/notes.json` — naming neither the route
// nor the fix. That shape is what every example and the todos scaffold use.
//
// These tests deliberately do NOT stub fetch: the whole point is that a real
// build-time read reaches the real static file the build is writing.
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

/** Stage a public asset the way the Go build copies app/public/ into dist/. */
function stageAsset(outDir, urlPath, body) {
	const file = path.join(outDir, urlPath.replace(/^\//, ''));
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(body));
}

class Note extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		body: Puzzle.string(),
	};
	static adapter = { endpoint: '/notes.json' };
}

/** A model whose authored verb hardcodes an app-relative path — the D158 escape
 *  hatch examples/blog and the todos scaffold use to map a per-record read onto a
 *  collection file. This path never passes through `apiURL`, which is why the
 *  wrapper has to sit on the global fetch rather than on the config value. */
class PinnedNote extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		body: Puzzle.string(),
	};
	static adapter = {
		endpoint: '/notes.json',
		async loadOne(fetch, id) {
			const res = await fetch('/api/notes.json');
			if (!res.ok) return res;
			const notes = await res.json();
			return notes.find((n) => String(n.id) === String(id)) ?? new Response(null, { status: 404 });
		},
	};
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

class Pinned extends PuzzleView {
	data() {
		return { note: this.ctx.store.findOne('pinnedNote', 'b'), missing: this.ctx.store.findOne('pinnedNote', 'nope') };
	}
	render() {
		const { note, missing } = this.getData();
		return h('div', {}, [text(note ? note.body : 'none'), text(missing ? 'found' : '|absent')]);
	}
}
Pinned.__pzlModule = 'app/views/Pinned.pzl';

const relativeConfig = (overrides = {}) => ({
	target: '#app',
	apiURL: '/api',
	adapter,
	models: { note: Note },
	routes: [{ path: '/', name: 'home', view: Feed }],
	...overrides,
});

describe('prerender build-time fetch origin', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('resolves an app-relative endpoint against the build output being written', async () => {
		const { outDir, shellPath } = stageDir('puzzle-origin-');
		stageAsset(outDir, '/api/notes.json', [{ id: 'a', body: 'alpha' }]);

		await prerenderToDir(relativeConfig(), { outDir, shellPath, mode: 'static' });

		// The record came off disk through a real HTTP read of the staged file.
		const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
		expect(index).toContain('alpha');
	});

	it('resolves a hardcoded app-relative path inside an authored verb', async () => {
		const { outDir, shellPath } = stageDir('puzzle-origin-verb-');
		stageAsset(outDir, '/api/notes.json', [{ id: 'b', body: 'bravo' }]);

		const { pages } = await prerenderToDir(
			relativeConfig({
				models: { pinnedNote: PinnedNote },
				routes: [{ path: '/', name: 'home', view: Pinned }],
			}),
			{ outDir, shellPath, mode: 'static' }
		);
		void pages;

		const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
		expect(index).toContain('bravo');
		// The id the collection file does not hold 404s and settles as absence,
		// exactly as it would at runtime — a 404 is an answer, not a build failure.
		expect(index).toContain('|absent');
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
		// Untouched — no origin rewriting, and no loopback server was ever needed.
		expect(calls).toEqual(['https://api.test/notes.json']);
	});

	it('fails an unresolvable app-relative read with a diagnostic, not a raw URL parse error', async () => {
		// Bare prerender(): a custom pipeline with no outDir has nothing to serve.
		const err = await prerender(relativeConfig(), { mode: 'static' }).then(
			() => null,
			(e) => e
		);

		expect(err).toBeTruthy();
		const chain = [err.message, err.cause?.message ?? ''].join('\n');
		// Names the route, the endpoint, the reason, and what to configure.
		expect(chain).toContain('/api/notes.json');
		expect(chain).toContain('no page origin');
		expect(chain).toContain('apiURL');
		expect(chain).toContain('prerenderToDir()');
		// And never surfaces undici's bare message as the whole story.
		expect(chain).not.toMatch(/^TypeError: Failed to parse URL/);
	});

	it('restores the global fetch after a pass, including a failing one', async () => {
		const sentinel = async () => {
			throw new Error('unused');
		};
		vi.stubGlobal('fetch', sentinel);

		const { outDir, shellPath } = stageDir('puzzle-origin-restore-');
		stageAsset(outDir, '/api/notes.json', [{ id: 'a', body: 'alpha' }]);
		await prerenderToDir(relativeConfig({ apiURL: 'https://api.test', models: {}, routes: [{ path: '/', name: 'home', view: Feed }] }), {
			outDir,
			shellPath,
			mode: 'static',
		});
		expect(globalThis.fetch).toBe(sentinel);

		// A pass that throws must restore too.
		await prerender(relativeConfig(), { mode: 'static' }).catch(() => {});
		expect(globalThis.fetch).toBe(sentinel);
	});
});
