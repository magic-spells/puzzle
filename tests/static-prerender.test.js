// Static output mode (D79) — the prerender + shell-surgery half
// (client-runtime/ssg/index.js `mode: 'static'`): per-page store snapshot capture,
// __pzlModule stamp collection (+ the missing-stamp error), slug rules + collision
// suffixing, static shell surgery (app.js tag stripped, data + entry scripts
// injected, `</script>` in a record cannot break the JSON island, data-puzzle-static
// marker), and the extended summary fields. Node env: prerender is DOM-free.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prerender, prerenderToDir, injectStaticShell } from '../client-runtime/ssg/index.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

/** Stamp a fixture class the way CONTRACT 2 codegen will (app-root-relative path). */
function stamp(Class, module) {
	Class.__pzlModule = module;
	return Class;
}

class Layout extends PuzzleView {
	render() {
		return h('div', { class: 'layout' }, [slot()]);
	}
}
stamp(Layout, 'app/layouts/Default.pzl');

class Home extends PuzzleView {
	render() {
		return h('h1', {}, [text('Home')]);
	}
}
stamp(Home, 'app/views/Home.pzl');

class Guide extends PuzzleView {
	render() {
		return h('div', { class: 'guide' }, [slot()]);
	}
}
stamp(Guide, 'app/views/Guide.pzl');

class Templates extends PuzzleView {
	render() {
		return h('p', {}, [text('templates')]);
	}
}
stamp(Templates, 'app/views/guide/Templates.pzl');

class NotFound extends PuzzleView {
	render() {
		return h('h1', {}, [text('404')]);
	}
}
stamp(NotFound, 'app/views/NotFound.pzl');

class Note extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		body: Puzzle.string(),
	};
}

const SHELL =
	'<!doctype html><html><head><title>Shell</title></head>' +
	'<body><div id="app"></div><script type="module" src="/app.js"></script></body></html>';

const staticConfig = () => ({
	target: '#app',
	models: { note: Note },
	formatters: {},
	routes: [
		{ path: '/', name: 'home', view: Home, layout: Layout, meta: { title: 'Home' } },
		{
			path: '/guide',
			name: 'guide',
			view: Guide,
			layout: Layout,
			children: [
				{ path: 'templates', name: 'guide-templates', view: Templates, meta: { title: 'Templates' } },
			],
		},
		{ path: '*', name: 'not-found', view: NotFound, layout: Layout, meta: { title: 'Not found' } },
	],
});

function writeShell(dir, shell = SHELL) {
	const shellPath = path.join(dir, 'shell.html');
	fs.writeFileSync(shellPath, shell);
	return shellPath;
}

describe('static prerender (D79)', () => {
	describe('per-page store snapshot capture', () => {
		it('captures each page`s store snapshot as `data` (wire shape)', async () => {
			class Seeded extends PuzzleView {
				created() {
					this.ctx.store.createRecord('note', { id: 'n1', body: 'hello' });
				}
				render() {
					return h('p', {}, [text('seeded')]);
				}
			}
			stamp(Seeded, 'app/views/Seeded.pzl');
			const cfg = {
				target: '#app',
				models: { note: Note },
				routes: [{ path: '/', name: 'home', view: Seeded }],
			};
			const { pages } = await prerender(cfg, { mode: 'static' });
			expect(pages[0].data).toBeTruthy();
			expect(pages[0].data.note).toHaveLength(1);
			expect(pages[0].data.note[0]).toMatchObject({ id: 'n1', body: 'hello' });
		});

		it('does not attach static fields in hybrid mode', async () => {
			const { pages } = await prerender(staticConfig());
			expect(pages[0].data).toBeUndefined();
			expect(pages[0].modules).toBeUndefined();
			expect(pages[0].route).toBeUndefined();
		});

		it('captures beforeMount data + modules for a prerender:false page (html null)', async () => {
			// CONTRACT 3: a prerender:false page builds the context (beforeMount runs) and
			// captures the payload, but the VIEW is not preloaded (html stays null) — so the
			// snapshot carries beforeMount seeds only, and data() re-runs client-side.
			class SpaOnly extends PuzzleView {
				render() {
					return h('p', {}, [text('spa')]);
				}
			}
			stamp(SpaOnly, 'app/views/SpaOnly.pzl');
			const cfg = {
				target: '#app',
				models: { note: Note },
				routes: [{ path: '/app', name: 'spa', view: SpaOnly, prerender: false }],
				beforeMount({ store }) {
					store.createRecord('note', { id: 'spa', body: 'x' });
				},
			};
			const { pages } = await prerender(cfg, { mode: 'static' });
			const spa = pages.find((p) => p.path === '/app');
			expect(spa.html).toBeNull();
			expect(spa.prerender).toBe(false);
			expect(spa.data.note[0].id).toBe('spa');
			expect(spa.modules).toEqual({ views: ['app/views/SpaOnly.pzl'], layout: null });
		});
	});

	describe('__pzlModule stamp collection', () => {
		it('collects chain view stamps + the layout stamp', async () => {
			const { pages } = await prerender(staticConfig(), { mode: 'static' });
			const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));
			expect(byPath['/'].modules).toEqual({
				views: ['app/views/Home.pzl'],
				layout: 'app/layouts/Default.pzl',
			});
			expect(byPath['/guide/templates'].modules).toEqual({
				views: ['app/views/Guide.pzl', 'app/views/guide/Templates.pzl'],
				layout: 'app/layouts/Default.pzl',
			});
		});

		it('serializes a plain-JSON route snapshot (no classes)', async () => {
			const { pages } = await prerender(staticConfig(), { mode: 'static' });
			const templates = pages.find((p) => p.path === '/guide/templates');
			expect(templates.route).toEqual({
				path: '/guide/templates',
				params: {},
				chain: [
					{ path: '/guide', name: 'guide' },
					{ path: 'templates', name: 'guide-templates', meta: { title: 'Templates' } },
				],
			});
			// No view classes leaked into the JSON snapshot.
			expect(JSON.stringify(templates.route)).not.toContain('function');
		});

		it('throws naming the route + class when a view has no __pzlModule stamp', async () => {
			class Unstamped extends PuzzleView {
				render() {
					return h('p', {}, [text('x')]);
				}
			}
			const cfg = {
				target: '#app',
				routes: [{ path: '/bare', name: 'bare', view: Unstamped }],
			};
			await expect(prerender(cfg, { mode: 'static' })).rejects.toThrow(
				/static output requires \.pzl views\/layouts.*route "\/bare".*Unstamped.*__pzlModule/s
			);
		});

		it('throws when the layout has no __pzlModule stamp', async () => {
			class BareLayout extends PuzzleView {
				render() {
					return h('div', {}, [slot()]);
				}
			}
			const cfg = {
				target: '#app',
				routes: [{ path: '/', name: 'home', view: Home, layout: BareLayout }],
			};
			await expect(prerender(cfg, { mode: 'static' })).rejects.toThrow(
				/route "\/" layout BareLayout has no __pzlModule stamp/
			);
		});
	});

	describe('slug rules + collision suffixing', () => {
		it('maps `/` → index, `*` → 404, nested → `--`, and suffixes collisions', async () => {
			// Two distinct routes that both slugify to `guide--templates`: the second
			// gets `-2` deterministically in enumeration order.
			class A extends PuzzleView {
				render() {
					return h('p', {}, [text('a')]);
				}
			}
			class B extends PuzzleView {
				render() {
					return h('p', {}, [text('b')]);
				}
			}
			stamp(A, 'app/views/A.pzl');
			stamp(B, 'app/views/B.pzl');
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-static-slug-'));
			const shellPath = writeShell(outDir);
			const cfg = {
				target: '#app',
				routes: [
					{ path: '/', name: 'home', view: A },
					{ path: '/guide/templates', name: 't1', view: A },
					{ path: '/guide--templates', name: 't2', view: B }, // slugifies identically
					{ path: '*', name: 'nf', view: B },
				],
			};
			const summary = await prerenderToDir(cfg, { outDir, shellPath, mode: 'static' });
			const byPath = Object.fromEntries(summary.written.map((w) => [w.path, w.entry]));
			expect(byPath['/']).toBe('_puzzle/index.js');
			expect(byPath['/guide/templates']).toBe('_puzzle/guide--templates.js');
			// The second route slugifies to the same base → deterministic `-2` suffix.
			expect(byPath['/guide--templates']).toBe('_puzzle/guide--templates-2.js');
			expect(byPath['*']).toBe('_puzzle/404.js');
		});
	});

	describe('static shell surgery', () => {
		it('strips /app.js, injects data + entry scripts, marks data-puzzle-static', async () => {
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-static-'));
			const shellPath = writeShell(outDir);
			const summary = await prerenderToDir(staticConfig(), { outDir, shellPath, mode: 'static' });

			const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
			// app.js bundle tag stripped.
			expect(index).not.toContain('src="/app.js"');
			// static marker (NOT the router takeover marker).
			expect(index).toContain('<div id="app" data-puzzle-static><div class="layout"><h1>Home</h1></div></div>');
			expect(index).not.toContain('data-puzzle-ssg');
			// data island + per-page module before </body>.
			expect(index).toContain('<script type="application/json" data-puzzle-static-data>');
			expect(index).toContain('<script type="module" src="/_puzzle/index.js"></script>');
			expect(index).toContain('<title>Home</title>');

			// The extended summary fields.
			expect(summary.mode).toBe('static');
			expect(summary.target).toBe('app');
			expect(summary.apiURL).toBeNull();
			expect(summary.hasFormatters).toBe(false);
		});

		it('warns once (not per page) when no /app.js tag is present', async () => {
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-static-noappjs-'));
			const noBundle =
				'<!doctype html><html><head><title>Shell</title></head><body><div id="app"></div></body></html>';
			const shellPath = writeShell(outDir, noBundle);
			const summary = await prerenderToDir(staticConfig(), { outDir, shellPath, mode: 'static' });
			const appJsWarnings = summary.warnings.filter((w) => w.includes('to strip'));
			expect(appJsWarnings).toHaveLength(1);
		});

		it('reports apiURL + hasFormatters from config', async () => {
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-static-cfg-'));
			const shellPath = writeShell(outDir);
			const cfg = {
				target: '#app',
				apiURL: 'https://api.example.com',
				formatters: { shout: (s) => String(s).toUpperCase() },
				routes: [{ path: '/', name: 'home', view: Home }],
			};
			const summary = await prerenderToDir(cfg, { outDir, shellPath, mode: 'static' });
			expect(summary.apiURL).toBe('https://api.example.com');
			expect(summary.hasFormatters).toBe(true);
		});

		it('leaves a prerender:false page`s target empty + unmarked but still injects scripts', async () => {
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-static-spa-'));
			const shellPath = writeShell(outDir);
			const cfg = {
				target: '#app',
				routes: [{ path: '/app', name: 'spa', view: stamp(class extends Home {}, 'app/views/Spa.pzl'), prerender: false }],
			};
			const summary = await prerenderToDir(cfg, { outDir, shellPath, mode: 'static' });
			const spa = fs.readFileSync(path.join(outDir, 'app', 'index.html'), 'utf8');
			// Target stays empty + unmarked.
			expect(spa).toContain('<div id="app"></div>');
			expect(spa).not.toContain('data-puzzle-static>');
			// But the per-page module + data island are still injected.
			expect(spa).toContain('<script type="module" src="/_puzzle/app.js"></script>');
			expect(spa).toContain('data-puzzle-static-data');
			expect(spa).not.toContain('src="/app.js"');
			expect(summary.written[0].prerender).toBe(false);
		});
	});

	describe('data island JSON escaping', () => {
		it('escapes `<` so a `</script>` in a record cannot break out of the island', () => {
			const evil = { note: [{ id: 'n', body: '</script><script>alert(1)</script>' }] };
			const out = injectStaticShell(SHELL.replace('<script type="module" src="/app.js"></script>', ''), {
				targetId: 'app',
				content: '<p>x</p>',
				title: null,
				slug: 'index',
				data: evil,
			});
			// No literal `</script>` from the record survives — every `<` is escaped.
			const island = out.slice(
				out.indexOf('data-puzzle-static-data>') + 'data-puzzle-static-data>'.length,
				out.indexOf('</script><script type="module"')
			);
			expect(island).not.toContain('</script>');
			expect(island).not.toContain('<script>');
			expect(island).toContain('\\u003c/script>');
			// And it still parses back to the original data.
			const parsed = JSON.parse(island);
			expect(parsed.note[0].body).toBe('</script><script>alert(1)</script>');
		});

		it('appends scripts when the shell has no </body>', () => {
			const out = injectStaticShell('<div id="app"></div>', {
				targetId: 'app',
				content: '<p>x</p>',
				title: null,
				slug: 'index',
				data: {},
			});
			expect(out).toContain('<div id="app" data-puzzle-static><p>x</p></div>');
			expect(out.endsWith('<script type="module" src="/_puzzle/index.js"></script>')).toBe(true);
		});
	});

	describe('hybrid mode is unchanged', () => {
		it('emits no static scripts/markers and byte-identical takeover output', async () => {
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-hybrid-'));
			const shellPath = writeShell(outDir);
			const summary = await prerenderToDir(staticConfig(), { outDir, shellPath });
			const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
			expect(index).toContain('data-puzzle-ssg');
			expect(index).not.toContain('data-puzzle-static');
			expect(index).not.toContain('_puzzle/');
			expect(index).toContain('src="/app.js"'); // bundle tag kept
			expect(summary.mode).toBeUndefined();
		});
	});
});
