// SSG prerender integration (M1) — the orchestrator (client-runtime/ssg/index.js):
// route enumeration (nested children), the meta.title leaf→root walk, dynamic-route
// skipping, the `prerender: false` shell copy, shell injection + title replacement,
// and the missing-target error. Node env: prerender is DOM-free and writes files.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prerender, prerenderToDir, injectShell } from '../client-runtime/ssg/index.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const slot = () => new ViewNode(SLOT_TAG);

class Layout extends PuzzleView {
	render() {
		return h('div', { class: 'layout' }, [slot()]);
	}
}
class Home extends PuzzleView {
	render() {
		return h('h1', {}, [text('Home')]);
	}
}
class SettingsShell extends PuzzleView {
	render() {
		return h('div', { class: 'settings' }, [slot()]);
	}
}
class SettingsIndex extends PuzzleView {
	render() {
		return h('p', {}, [text('Settings index')]);
	}
}
class Profile extends PuzzleView {
	async data() {
		return { name: 'Ada' };
	}
	render() {
		return h('p', {}, [text(this.getData().name)]);
	}
}
class UserView extends PuzzleView {
	render() {
		return h('p', {}, [text('user')]);
	}
}
class SpaOnly extends PuzzleView {
	render() {
		return h('p', {}, [text('spa')]);
	}
}
class NotFound extends PuzzleView {
	render() {
		return h('h1', {}, [text('404')]);
	}
}
class Setting extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		value: Puzzle.string(),
	};
}

const routes = () => [
	{ path: '/', name: 'home', view: Home, layout: Layout, meta: { title: 'Home' } },
	{
		path: '/settings',
		name: 'settings',
		view: SettingsShell,
		layout: Layout,
		meta: { title: 'Settings' },
		children: [
			{ path: '', name: 'settings-index', view: SettingsIndex },
			{ path: 'profile', name: 'settings-profile', view: Profile, meta: { title: 'Profile' } },
		],
	},
	{ path: '/user/:id', name: 'user', view: UserView, layout: Layout },
	{ path: '/app', name: 'spa', view: SpaOnly, layout: Layout, prerender: false },
];

const config = () => ({ target: '#app', routes: routes(), models: {}, formatters: {} });

const SHELL =
	'<!doctype html><html><head><title>Shell</title></head><body><div id="app"></div></body></html>';

describe('SSG prerender (M1)', () => {
	it('enumerates static routes incl. nested children and renders the layout chain', async () => {
		const { pages } = await prerender(config());
		const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));

		expect(Object.keys(byPath).sort()).toEqual(['/', '/app', '/settings', '/settings/profile']);
		expect(byPath['/'].html).toBe('<div class="layout"><h1>Home</h1></div>');
		expect(byPath['/settings'].html).toBe(
			'<div class="layout"><div class="settings"><p>Settings index</p></div></div>'
		);
		expect(byPath['/settings/profile'].html).toBe(
			'<div class="layout"><div class="settings"><p>Ada</p></div></div>'
		);
	});

	it('resolves meta.title nearest-defined leaf → root', async () => {
		const { pages } = await prerender(config());
		const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));

		expect(byPath['/'].title).toBe('Home');
		expect(byPath['/settings'].title).toBe('Settings'); // leaf has none → parent
		expect(byPath['/settings/profile'].title).toBe('Profile'); // leaf wins
	});

	it('skips dynamic routes with a warning', async () => {
		const { skipped, warnings, pages } = await prerender(config());
		expect(skipped).toEqual([{ path: '/user/:id', reason: 'dynamic' }]);
		expect(warnings.some((w) => w.includes('/user/:id'))).toBe(true);
		expect(pages.some((p) => p.path === '/user/:id')).toBe(false);
	});

	it('flags prerender:false routes as shell-only pages', async () => {
		const { pages } = await prerender(config());
		const spa = pages.find((p) => p.path === '/app');
		expect(spa).toMatchObject({ path: '/app', html: null, title: null, prerender: false });
	});

	it('fails loudly, naming the route, on a data() rejection', async () => {
		class Boom extends PuzzleView {
			async data() {
				throw new Error('kaboom');
			}
			render() {
				return h('p', {}, []);
			}
		}
		const cfg = { target: '#app', routes: [{ path: '/boom', name: 'boom', view: Boom }] };
		await expect(prerender(cfg)).rejects.toThrow(/prerender failed for route "\/boom".*kaboom/s);
	});

	it('awaits config.beforeMount with a { store, config } facade', async () => {
		let seen = null;
		class UsesStore extends PuzzleView {
			data() {
				return { greeting: this.ctx.store.__seed ?? 'none' };
			}
			render() {
				return h('p', {}, [text(this.getData().greeting)]);
			}
		}
		const cfg = {
			target: '#app',
			routes: [{ path: '/', name: 'home', view: UsesStore }],
			beforeMount: (facade) => {
				seen = facade;
				facade.store.__seed = 'hello';
			},
		};
		const { pages } = await prerender(cfg);
		expect(seen).toHaveProperty('store');
		expect(seen).toHaveProperty('config');
		expect(pages[0].html).toBe('<p>hello</p>');
	});

	describe('per-page ctx/store isolation', () => {
		it('renders two routes whose shared layout seeds the same fixed-pk record', async () => {
			class SeededLayout extends PuzzleView {
				created() {
					this.ctx.store.createRecord('setting', { id: 'theme', value: 'dark' });
				}
				render() {
					return h('section', {}, [slot()]);
				}
			}
			class PageOne extends PuzzleView {
				render() {
					return h('p', {}, [text('one')]);
				}
			}
			class PageTwo extends PuzzleView {
				render() {
					return h('p', {}, [text('two')]);
				}
			}
			const cfg = {
				target: '#app',
				models: { setting: Setting },
				routes: [
					{ path: '/one', name: 'one', view: PageOne, layout: SeededLayout },
					{ path: '/two', name: 'two', view: PageTwo, layout: SeededLayout },
				],
			};

			const { pages } = await prerender(cfg);
			const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));
			expect(byPath['/one'].html).toBe('<section><p>one</p></section>');
			expect(byPath['/two'].html).toBe('<section><p>two</p></section>');
		});

		it('does not leak records created while rendering page A into page B', async () => {
			class PageA extends PuzzleView {
				data() {
					if (!this.ctx.store.findOne('setting', 'from-a')) {
						this.ctx.store.createRecord('setting', { id: 'from-a', value: 'from-a' });
					}
					return { settings: this.ctx.store.findMany('setting') };
				}
				render() {
					const values = this.getData().settings.map((s) => s.value).join(',') || 'empty';
					return h('p', {}, [text(values)]);
				}
			}
			class PageB extends PuzzleView {
				data() {
					return { settings: this.ctx.store.findMany('setting') };
				}
				render() {
					const values = this.getData().settings.map((s) => s.value).join(',') || 'empty';
					return h('p', {}, [text(values)]);
				}
			}
			const cfg = {
				target: '#app',
				models: { setting: Setting },
				routes: [
					{ path: '/a', name: 'a', view: PageA },
					{ path: '/b', name: 'b', view: PageB },
				],
			};

			const { pages } = await prerender(cfg);
			const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));
			expect(byPath['/a'].html).toBe('<p>from-a</p>');
			expect(byPath['/b'].html).toBe('<p>empty</p>');
			expect(byPath['/b'].html).not.toContain('from-a');
		});

		it('re-runs beforeMount for each page so seeded records are visible everywhere', async () => {
			let beforeMountCalls = 0;
			class SeedConsumer extends PuzzleView {
				data() {
					return {
						theme: this.ctx.store.findOne('setting', 'theme')?.value ?? 'missing',
					};
				}
				render() {
					return h('p', {}, [text(this.getData().theme)]);
				}
			}
			const cfg = {
				target: '#app',
				models: { setting: Setting },
				routes: [
					{ path: '/one', name: 'one', view: SeedConsumer },
					{ path: '/two', name: 'two', view: SeedConsumer },
				],
				beforeMount({ store }) {
					beforeMountCalls++;
					store.createRecord('setting', { id: 'theme', value: 'seeded' });
				},
			};

			const { pages } = await prerender(cfg);
			const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));
			expect(byPath['/one'].html).toBe('<p>seeded</p>');
			expect(byPath['/two'].html).toBe('<p>seeded</p>');
			expect(beforeMountCalls).toBe(2);
		});
	});

	describe('injectShell', () => {
		it('injects content + data-puzzle-ssg and replaces the title', () => {
			const out = injectShell(SHELL, { targetId: 'app', content: '<h1>Home</h1>', title: 'Home' });
			expect(out).toContain('<div id="app" data-puzzle-ssg><h1>Home</h1></div>');
			expect(out).toContain('<title>Home</title>');
			expect(out).not.toContain('<title>Shell</title>');
		});

		it('keeps the shell title when no route title is resolved', () => {
			const out = injectShell(SHELL, { targetId: 'app', content: '<h1>Home</h1>', title: null });
			expect(out).toContain('<title>Shell</title>');
		});

		it('HTML-escapes the injected title', () => {
			const out = injectShell(SHELL, { targetId: 'app', content: 'x', title: 'A & <B>' });
			expect(out).toContain('<title>A &amp; &lt;B&gt;</title>');
		});

		it('throws a descriptive error when the target element is missing', () => {
			const noTarget = '<!doctype html><html><body><main></main></body></html>';
			expect(() => injectShell(noTarget, { targetId: 'app', content: 'x', title: null })).toThrow(
				/target element not found or not empty/
			);
		});

		it('throws when the target element is not empty', () => {
			const filled = '<html><body><div id="app">stale</div></body></html>';
			expect(() => injectShell(filled, { targetId: 'app', content: 'x', title: null })).toThrow(
				/not found or not empty/
			);
		});

		it('injects into the real id="app" element, not a data-id="app" attribute (FIX 13)', () => {
			// Both empty: a buggy `\bid=` falsely matches after the hyphen in `data-id=`
			// AND the decoy satisfies `>\s*</\1>`, so it would inject into the DECOY. The
			// real mount element is the SECOND, empty <div id="app">.
			const shell =
				'<html><body><div data-id="app" class="decoy"></div><div id="app"></div></body></html>';
			const out = injectShell(shell, { targetId: 'app', content: '<h1>Home</h1>', title: null });
			// The decoy is untouched (no marker); the marker + content land in the real element.
			expect(out).toContain('<div data-id="app" class="decoy"></div>');
			expect(out).toContain('<div id="app" data-puzzle-ssg><h1>Home</h1></div>');
			expect(out).not.toContain('<div data-id="app" class="decoy" data-puzzle-ssg>');
		});
	});

	describe('prerenderToDir', () => {
		it('validates an all-dynamic route table before skipped-page enumeration', async () => {
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-ssg-invalid-routes-'));
			const shellPath = path.join(outDir, 'shell.html');
			fs.writeFileSync(shellPath, SHELL);

			const invalidDynamicConfig = {
				target: '#app',
				routes: [
					{
						path: '/user/:id',
						view: UserView,
						children: [{ path: '/absolute', view: Home }],
					},
				],
			};

			await expect(
				prerenderToDir(invalidDynamicConfig, { outDir, shellPath })
			).rejects.toThrow(/child route path must be relative/);
		});

		it('writes directory-style index.html per route with injection + title', async () => {
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-ssg-'));
			const shellPath = path.join(outDir, 'shell.html');
			fs.writeFileSync(shellPath, SHELL);

			const summary = await prerenderToDir(config(), { outDir, shellPath });

			const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
			expect(index).toContain('<div id="app" data-puzzle-ssg><div class="layout"><h1>Home</h1></div></div>');
			expect(index).toContain('<title>Home</title>');

			const settings = fs.readFileSync(path.join(outDir, 'settings', 'index.html'), 'utf8');
			expect(settings).toContain('<title>Settings</title>');
			expect(settings).toContain('<p>Settings index</p>');

			const profile = fs.readFileSync(path.join(outDir, 'settings', 'profile', 'index.html'), 'utf8');
			expect(profile).toContain('<title>Profile</title>');
			expect(profile).toContain('<p>Ada</p>');

			// prerender:false → the untouched shell written at its path
			const spa = fs.readFileSync(path.join(outDir, 'app', 'index.html'), 'utf8');
			expect(spa).toBe(SHELL);

			expect(summary.count).toBe(4);
			expect(summary.skipped).toEqual([{ path: '/user/:id', reason: 'dynamic' }]);
		});

		it('rejects a route whose path escapes the output directory, writing nothing outside it (FIX 12)', async () => {
			// Nest outDir one level down so its `..` target is unique to this run (a
			// shared tmpdir sibling would be polluted by any other run).
			const base = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-ssg-escape-'));
			const outDir = path.join(base, 'staging');
			fs.mkdirSync(outDir);
			const shellPath = path.join(base, 'shell.html');
			fs.writeFileSync(shellPath, SHELL);

			const escapeCfg = {
				target: '#app',
				routes: [{ path: '/../escape', name: 'escape', view: Home, layout: Layout }],
			};

			await expect(prerenderToDir(escapeCfg, { outDir, shellPath })).rejects.toThrow(
				/route "\/\.\.\/escape" escapes the output directory/
			);
			// The escape target (base/escape/index.html, i.e. outside outDir) was NOT written.
			expect(fs.existsSync(path.join(base, 'escape', 'index.html'))).toBe(false);
		});
	});

	describe('catch-all → 404.html', () => {
		// The bare top-level catch-all (`path: '*'`, D19) renders like a static
		// route; only the OUTPUT path differs — 404.html at the outDir root.
		const catchAllRoutes = () => [
			{ path: '/', name: 'home', view: Home, layout: Layout, meta: { title: 'Home' } },
			{ path: '/user/:id', name: 'user', view: UserView, layout: Layout },
			{
				path: '*',
				name: 'not-found',
				view: NotFound,
				layout: Layout,
				meta: { title: 'Not found' },
			},
		];
		const catchAllConfig = () => ({ target: '#app', routes: catchAllRoutes() });

		it('renders the catch-all as a page keyed by path "*", not skipped', async () => {
			const { pages, skipped, warnings } = await prerender(catchAllConfig());
			const notFound = pages.find((p) => p.path === '*');
			expect(notFound).toBeTruthy();
			expect(notFound.html).toBe('<div class="layout"><h1>404</h1></div>');
			expect(notFound.title).toBe('Not found');
			// The :param route still skips; the catch-all does not.
			expect(skipped).toEqual([{ path: '/user/:id', reason: 'dynamic' }]);
			expect(warnings.some((w) => w.includes('no catch-all route'))).toBe(false);
		});

		it('prerenderToDir writes 404.html at the root with content + marker + title', async () => {
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-ssg-404-'));
			const shellPath = path.join(outDir, 'shell.html');
			fs.writeFileSync(shellPath, SHELL);

			const summary = await prerenderToDir(catchAllConfig(), { outDir, shellPath });

			const notFound = fs.readFileSync(path.join(outDir, '404.html'), 'utf8');
			expect(notFound).toContain(
				'<div id="app" data-puzzle-ssg><div class="layout"><h1>404</h1></div></div>'
			);
			expect(notFound).toContain('<title>Not found</title>');
			// It writes 404.html, not a directory-style star path.
			expect(fs.existsSync(path.join(outDir, '*', 'index.html'))).toBe(false);
			expect(summary.written.some((w) => w.path === '*' && w.prerender === true)).toBe(true);
		});

		it('writes the plain shell to 404.html for a prerender:false catch-all', async () => {
			const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-ssg-404spa-'));
			const shellPath = path.join(outDir, 'shell.html');
			fs.writeFileSync(shellPath, SHELL);

			const cfg = {
				target: '#app',
				routes: [
					{ path: '/', name: 'home', view: Home, layout: Layout, meta: { title: 'Home' } },
					{ path: '*', name: 'not-found', view: NotFound, layout: Layout, prerender: false },
				],
			};
			await prerenderToDir(cfg, { outDir, shellPath });

			const notFound = fs.readFileSync(path.join(outDir, '404.html'), 'utf8');
			expect(notFound).toBe(SHELL); // untouched SPA shell — no marker, no markup
		});

		it('warns when no catch-all route exists', async () => {
			const { warnings } = await prerender(config());
			expect(
				warnings.some((w) =>
					w.includes("no catch-all route (path: '*') — dist/404.html not emitted")
				)
			).toBe(true);
		});

		it('still skips a non-bare "*" route (only the exact catch-all renders)', async () => {
			const cfg = {
				target: '#app',
				routes: [
					{ path: '/', name: 'home', view: Home, layout: Layout, meta: { title: 'Home' } },
					{ path: '/files/*', name: 'files', view: UserView, layout: Layout },
				],
			};
			const { skipped, pages } = await prerender(cfg);
			expect(skipped).toEqual([{ path: '/files/*', reason: 'dynamic' }]);
			expect(pages.some((p) => p.path === '/files/*')).toBe(false);
		});
	});

	it('rejects a non-#id target selector', async () => {
		await expect(prerender({ target: '.app', routes: [] })).rejects.toThrow(/form '#id'/);
	});

	// Bug fix: the build-time route snapshot must have the SAME shape the Router
	// builds at router.js:809 — `{ path, route, params, chain }` — so views/layouts
	// using the documented D47 idioms (`this.route.route.name`,
	// `this.route.chain[0].name`, `this.route.route.meta`) work at prerender time.
	describe('this.route snapshot (D47 shape)', () => {
		it('exposes { path, route, params, chain } to routed views and reads the idioms', async () => {
			let seen = null;
			class RouteProbe extends PuzzleView {
				data() {
					seen = this.route;
					return {
						leafName: this.route.route.name,
						rootName: this.route.chain[0].name,
						leafTitle: this.route.route.meta?.title ?? '',
					};
				}
				render() {
					const d = this.getData();
					return h('p', {}, [text(`${d.rootName}/${d.leafName}:${d.leafTitle}`)]);
				}
			}
			const cfg = {
				target: '#app',
				routes: [
					{
						path: '/settings',
						name: 'settings',
						view: SettingsShell,
						layout: Layout,
						meta: { title: 'Settings' },
						children: [
							{
								path: 'profile',
								name: 'settings-profile',
								view: RouteProbe,
								meta: { title: 'Profile' },
							},
						],
					},
				],
			};
			const { pages } = await prerender(cfg);
			const page = pages.find((p) => p.path === '/settings/profile');
			// chain[0] is the root `settings` def; leaf is `settings-profile`.
			expect(page.html).toContain('settings/settings-profile:Profile');

			// Exactly the four D47 keys, and no bogus top-level name/meta.
			expect(Object.keys(seen).sort()).toEqual(['chain', 'params', 'path', 'route']);
			expect(seen.name).toBeUndefined();
			expect(seen.meta).toBeUndefined();
			// Correct semantics: path is the full path, route is the LEAF def, chain
			// is root → leaf, params is {} for a static route.
			expect(seen.path).toBe('/settings/profile');
			expect(seen.route.name).toBe('settings-profile');
			expect(seen.chain.map((r) => r.name)).toEqual(['settings', 'settings-profile']);
			expect(seen.params).toEqual({});
			// Frozen like the Router's snapshot.
			expect(Object.isFrozen(seen)).toBe(true);
		});
	});

	// Bug fix: only ROUTED views/layouts get the route snapshot. A NON-routed nested
	// component rendered inside a view must see `this.route === null`, exactly as it
	// would in the browser (the ViewManager mounts nested components without a route).
	describe('nested components are off-router (this.route === null)', () => {
		it('routed view sees the snapshot; its nested component sees null', async () => {
			let viewRoute = 'unset';
			let nestedRoute = 'unset';
			class NestedBadge extends PuzzleView {
				data() {
					nestedRoute = this.route;
					return {};
				}
				render() {
					return h('span', {}, [text('badge')]);
				}
			}
			class RoutedHost extends PuzzleView {
				data() {
					viewRoute = this.route;
					return {};
				}
				render() {
					return h('div', {}, [comp(NestedBadge)]);
				}
			}
			const cfg = {
				target: '#app',
				routes: [{ path: '/', name: 'home', view: RoutedHost, layout: Layout }],
			};
			const { pages } = await prerender(cfg);
			expect(pages[0].html).toBe('<div class="layout"><div><span>badge</span></div></div>');
			// The routed view got the frozen snapshot...
			expect(viewRoute).not.toBeNull();
			expect(viewRoute.route.name).toBe('home');
			// ...but the nested component is off-router.
			expect(nestedRoute).toBeNull();
		});
	});
});
