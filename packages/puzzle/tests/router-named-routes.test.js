// @vitest-environment jsdom
//
// named route targets (D196). a navigation target is a path string, as it has
// always been, or `{ name, params, query, hash }`. one resolver
// (router/routeNames.js) turns the named form back into the path string, and
// every consumer calls it: router.url() (so the `link` library function),
// push(), replace() and guard redirects on the live router in path, hash and
// memory modes; the hybrid prerender's url() shadow; the static router stub;
// and the static page kernel, which reads the name table from the page's names
// island because a static page ships no route table.
//
// same jsdom conventions as router-hash.test.js and static-kernel.test.js:
// hand-written render() stand-ins, routers tracked and stopped in afterEach.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { routeNames, routeNamesJSON, targetPath } from '../client-runtime/router/routeNames.js';
import { hashRouter, memoryRouter } from '../client-runtime/router/modes.js';
import { makeFormatterRegistry } from '../client-runtime/formatters.js';
import { prerender, injectStaticShell } from '../client-runtime/ssg/index.js';
import { makeRouterStub } from '../client-runtime/ssg/assemble.js';
import { mountStatic } from '../client-runtime/static/index.js';
import { mountView } from '../client-runtime/testing/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));

// a view whose class name shows which route rendered
const view = (cls) =>
	class extends PuzzleView {
		render() {
			return h('puzzle-view', { class: cls }, [text(cls)]);
		}
	};

// the album view records the params data() saw, so decoding is observable
let seenParams;
class AlbumView extends PuzzleView {
	data({ params }) {
		seenParams = params;
		return { id: params.id };
	}
	render() {
		return h('puzzle-view', { class: 'album' }, [text('album ' + this.getData().id)]);
	}
}

class SettingsLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'settings' }, [slot()]);
	}
}

// the table every live-router test uses: a top-level page, a dynamic page, a
// parent with a name of its own plus a named index child and a named nested
// child, an unnamed route and a named catch-all.
const routes = () => [
	{ path: '/', name: 'home', view: view('home') },
	{ path: '/albums/:id', name: 'album', view: AlbumView },
	{ path: '/artists/:artist/albums/:id', name: 'artist-album', view: AlbumView },
	{
		path: '/settings',
		name: 'settings',
		view: SettingsLayout,
		children: [
			{ path: '', name: 'settings-home', view: view('settings-home') },
			{ path: 'profile', name: 'settings-profile', view: view('settings-profile') },
		],
	},
	{ path: '/login', name: 'login', view: view('login') },
	{ path: '/about', view: view('about') },
	{ path: '*', name: 'not-found', view: view('nf') },
];

const ctx = () => ({ store: null, router: null, formatters: null });

let routers = [];

/**
 * boot a router in the given mode at `url` (path and hash modes read it from
 * location; memory mode starts at its own initial path).
 * @param {'path' | 'hash' | 'memory'} kind
 * @param {object} [options] extra Router options
 */
async function boot(kind, { url = '/', ...options } = {}, table = routes()) {
	history.replaceState({}, '', url);
	const el = document.createElement('div');
	document.body.appendChild(el);
	const mode = kind === 'hash' ? hashRouter() : kind === 'memory' ? memoryRouter() : undefined;
	const router = new Router(table, { ...(mode && { mode }), ...options });
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

beforeEach(() => {
	seenParams = undefined;
	history.replaceState({}, '', '/');
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

describe('routeNames — the name table (D196)', () => {
	it('registers every named node under its full path, parents and index children included', () => {
		const table = routeNames(routes());
		expect(table.get('home')).toBe('/');
		expect(table.get('album')).toBe('/albums/:id');
		expect(table.get('settings')).toBe('/settings');
		expect(table.get('settings-home')).toBe('/settings');
		expect(table.get('settings-profile')).toBe('/settings/profile');
		// the catch-all is known, but has no url of its own
		expect(table.get('not-found')).toBeNull();
		// an unnamed route is simply not in the table
		expect([...table.keys()]).not.toContain(undefined);
		expect(table.size).toBe(8);
	});

	it('throws on a duplicate name, naming both paths', () => {
		const dup = [
			{ path: '/a', name: 'page', view: view('a') },
			{ path: '/b', children: [{ path: 'c', name: 'page', view: view('c') }], view: view('b') },
		];
		expect(() => routeNames(dup)).toThrow(
			'[puzzle] route name "page" is used by two routes ("/a" and "/b/c") — route names must be unique'
		);
	});

	it('the Router constructor rejects a duplicate name at startup', () => {
		expect(
			() =>
				new Router([
					{ path: '/one', name: 'same', view: view('one') },
					{ path: '/two', name: 'same', view: view('two') },
				])
		).toThrow(/route name "same" is used by two routes/);
	});

	it('routeNamesJSON drops the catch-all', () => {
		expect(routeNamesJSON(routeNames(routes()))).toEqual({
			home: '/',
			album: '/albums/:id',
			'artist-album': '/artists/:artist/albums/:id',
			settings: '/settings',
			'settings-home': '/settings',
			'settings-profile': '/settings/profile',
			login: '/login',
		});
	});
});

describe('targetPath — resolving a target (D196)', () => {
	const names = routeNames(routes());

	it('returns a path string untouched', () => {
		expect(targetPath('/albums/7', names)).toBe('/albums/7');
		expect(targetPath('https://example.com', names)).toBe('https://example.com');
	});

	it('fills params, then appends query and hash', () => {
		expect(targetPath({ name: 'album', params: { id: 7 } }, names)).toBe('/albums/7');
		expect(targetPath({ name: 'artist-album', params: { artist: 'nina', id: '3' } }, names)).toBe(
			'/artists/nina/albums/3'
		);
		expect(
			targetPath({ name: 'album', params: { id: 7 }, query: { tab: 'tracks', page: 2 }, hash: 'credits' }, names)
		).toBe('/albums/7?tab=tracks&page=2#credits');
		// a hash may carry its own `#`; an array repeats its key; null and
		// undefined query values are left out
		expect(
			targetPath({ name: 'home', query: { tag: ['a', 'b'], q: null, empty: undefined }, hash: '#top' }, names)
		).toBe('/?tag=a&tag=b#top');
		expect(targetPath({ name: 'home', query: {}, hash: '' }, names)).toBe('/');
	});

	it('resolves a nested route and an index child by full path', () => {
		expect(targetPath({ name: 'settings-profile' }, names)).toBe('/settings/profile');
		expect(targetPath({ name: 'settings-home' }, names)).toBe('/settings');
		expect(targetPath({ name: 'settings' }, names)).toBe('/settings');
	});

	it('uri-encodes each param, so a `/`, `?`, `#` or space cannot change the url shape', () => {
		expect(targetPath({ name: 'album', params: { id: 'a/b?c#d e' } }, names)).toBe(
			'/albums/a%2Fb%3Fc%23d%20e'
		);
		expect(targetPath({ name: 'home', query: { q: 'a&b c' } }, names)).toBe('/?q=a%26b+c');
	});

	it('an inherited key is not a route name', () => {
		expect(() => targetPath({ name: 'toString' }, names)).toThrow(/unknown route name/);
		expect(() => targetPath({ name: '__proto__' }, names)).toThrow(/unknown route name/);
	});

	it('throws a clear error for each mistake', () => {
		expect(() => targetPath({ name: 'albun', params: { id: 1 } }, names)).toThrow(
			/^\[puzzle\] unknown route name "albun" \(named routes: home, album, /
		);
		expect(() => targetPath({ name: 'x' }, new Map())).toThrow(
			'[puzzle] unknown route name "x" — no route in the table has a name'
		);
		expect(() => targetPath({ name: 'album' }, names)).toThrow(
			'[puzzle] route "album" (/albums/:id) needs the param "id"'
		);
		expect(() => targetPath({ name: 'album', params: { id: '' } }, names)).toThrow(/needs the param "id"/);
		expect(() => targetPath({ name: 'album', params: { id: null } }, names)).toThrow(/needs the param "id"/);
		expect(() => targetPath({ name: 'album', params: { id: 1, slug: 'x' } }, names)).toThrow(
			'[puzzle] route "album" (/albums/:id) has no param "slug"'
		);
		expect(() => targetPath({ name: 'album', param: { id: 1 } }, names)).toThrow(
			'[puzzle] route target "album" has an unknown key "param" — a target takes name, params, query and hash'
		);
		expect(() => targetPath({ name: 'not-found' }, names)).toThrow(
			'[puzzle] route "not-found" is the catch-all and has no URL to link to'
		);
		expect(() => targetPath({ params: { id: 1 } }, names)).toThrow(/route target \(got no name\)/);
		expect(() => targetPath({ name: '' }, names)).toThrow(/got no name/);
		expect(() => targetPath(null, names)).toThrow(/expected a path string or a \{ name, params \} route target \(got null\)/);
		expect(() => targetPath(['/a'], names)).toThrow(/got an array/);
		expect(() => targetPath(7, names)).toThrow(/got number/);
	});

	it('a param value of 0 is a value, not a missing param', () => {
		expect(targetPath({ name: 'album', params: { id: 0 } }, names)).toBe('/albums/0');
	});
});

describe('router.url() with a named target, in every routing mode (D196)', () => {
	it('path mode', async () => {
		const { router } = await boot('path');
		expect(router.url({ name: 'album', params: { id: 7 } })).toBe('/albums/7');
		expect(router.url({ name: 'settings-profile', hash: 'email' })).toBe('/settings/profile#email');
		// the same href the path string gives, always
		expect(router.url({ name: 'album', params: { id: 7 }, query: { t: 1 } })).toBe(router.url('/albums/7?t=1'));
	});

	it('path mode under routerBase', async () => {
		const { router } = await boot('path', { base: '/docs', url: '/docs/' });
		expect(router.url({ name: 'album', params: { id: 7 } })).toBe('/docs/albums/7');
		expect(router.url({ name: 'home' })).toBe(router.url('/'));
	});

	it('hash mode', async () => {
		const { router } = await boot('hash');
		const href = router.url({ name: 'album', params: { id: 7 } });
		expect(href).toBe(router.url('/albums/7'));
		expect(href).toContain('#/albums/7');
	});

	it('memory mode', async () => {
		const { router } = await boot('memory');
		expect(router.url({ name: 'album', params: { id: 7 } })).toBe(router.url('/albums/7'));
	});

	it('locale prefix routing: the page locale and link({ locale }) both apply', async () => {
		const { router } = await boot('path', { url: '/es/', locale: 'es', defaultLocale: 'en', locales: ['en', 'es'] });
		expect(router.url({ name: 'album', params: { id: 7 } })).toBe('/es/albums/7');
		expect(router.url({ name: 'album', params: { id: 7 } }, { locale: 'en' })).toBe('/albums/7');
		expect(router.url({ name: 'album', params: { id: 7 } }, { locale: false })).toBe('/albums/7');
	});

	it('throws on an unknown name instead of rendering a dead href', async () => {
		const { router } = await boot('path');
		expect(() => router.url({ name: 'nope' })).toThrow(/unknown route name "nope"/);
	});
});

describe('push() / replace() with a named target, in every routing mode (D196)', () => {
	for (const kind of ['path', 'hash', 'memory']) {
		it(`${kind} mode: push lands on the route and data() gets the decoded params`, async () => {
			const { router, el } = await boot(kind);
			const result = await router.push({ name: 'album', params: { id: 'a/b c' }, query: { tab: 'tracks' } });
			expect(result.ok).toBe(true);
			expect(router.current.route.name).toBe('album');
			expect(router.current.pathname).toBe('/albums/a%2Fb%20c');
			expect(router.current.query.tab).toBe('tracks');
			// the router decodes each matched segment, so data() sees the value as passed
			expect(seenParams).toEqual({ id: 'a/b c' });
			expect(el.textContent).toContain('album a/b c');
		});

		it(`${kind} mode: replace lands on a nested named route`, async () => {
			const { router, el } = await boot(kind);
			await router.push('/about');
			await router.replace({ name: 'settings-profile' });
			expect(router.current.path).toBe('/settings/profile');
			expect(el.querySelector('.settings-profile')).not.toBeNull();
		});
	}

	it('path mode: the address bar gets the encoded url', async () => {
		const { router } = await boot('path', { base: '/docs', url: '/docs/' });
		await router.push({ name: 'artist-album', params: { artist: 'nina', id: 3 }, hash: 'credits' });
		expect(location.pathname).toBe('/docs/artists/nina/albums/3');
		expect(location.hash).toBe('#credits');
	});

	it('hash mode: the fragment carries the resolved path', async () => {
		const { router } = await boot('hash');
		await router.push({ name: 'album', params: { id: 9 } });
		expect(location.hash).toBe('#/albums/9');
	});

	it('a named push to where the router already is stays a no-op, like the path form', async () => {
		const { router } = await boot('path');
		await router.push('/albums/7');
		const before = history.length;
		await router.push({ name: 'album', params: { id: 7 } });
		expect(history.length).toBe(before);
	});

	it('a bad target throws before navigation starts, leaving the page where it was', async () => {
		const { router } = await boot('path');
		await router.push('/about');
		expect(() => router.push({ name: 'album' })).toThrow(/needs the param "id"/);
		expect(() => router.replace({ name: 'nope' })).toThrow(/unknown route name/);
		expect(router.current.path).toBe('/about');
	});
});

describe('guards may redirect to a named target (D196)', () => {
	it('a guard returning { name } redirects there', async () => {
		const table = routes().map((r) =>
			r.name === 'album' ? { ...r, guard: () => ({ name: 'login', query: { next: '/albums/1' } }) } : r
		);
		const { router, el } = await boot('path', {}, table);
		await router.push({ name: 'album', params: { id: 1 } });
		await tick();
		expect(router.current.route.name).toBe('login');
		expect(router.current.query.next).toBe('/albums/1');
		expect(el.querySelector('.login')).not.toBeNull();
	});
});

describe('the link library function with a named target (D196)', () => {
	it('passes a plain object to url() and keeps every other value a string', async () => {
		const { router } = await boot('path');
		const link = makeFormatterRegistry({}, (target, options) => router.url(target, options)).getAll().link;
		expect(link({ name: 'album', params: { id: 7 } })).toBe('/albums/7');
		expect(link('/albums/7')).toBe('/albums/7');
		expect(link(null)).toBe('');
		// a URL object is not a target: it stringifies, as it always has
		expect(link(new URL('https://example.com/x'))).toBe('https://example.com/x');
	});

	it('combines with { locale } under prefix routing', async () => {
		const { router } = await boot('path', { url: '/es/', locale: 'es', defaultLocale: 'en', locales: ['en', 'es'] });
		const link = makeFormatterRegistry({}, (target, options) => router.url(target, options)).getAll().link;
		expect(link({ name: 'album', params: { id: 7 } })).toBe('/es/albums/7');
		expect(link({ name: 'album', params: { id: 7 } }, { locale: 'en' })).toBe('/albums/7');
	});

	it('mountView: a named link explains that it needs a route table', async () => {
		class Linker extends PuzzleView {
			render() {
				const __f = this.ctx.formatters.getAll();
				return h('a', { href: __f.link({ name: 'album', params: { id: 1 } }) }, [text('x')]);
			}
		}
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		await mountView(Linker).catch((e) => error(e));
		const messages = error.mock.calls.flat().map(String).join('\n');
		expect(messages).toMatch(/mountView has no route table to resolve a named link/);
	});
});

// ---------------------------------------------------------------------------
// prerender: hybrid and static output resolve names exactly like the live app.

// renders hrefs the way compiled render code does, through the formatter map
class Nav extends PuzzleView {
	render() {
		const __f = this.ctx.formatters.getAll();
		return h('nav', {}, [
			h('a', { class: 'named', href: __f.link({ name: 'album', params: { id: 7 }, hash: 'top' }) }, [text('Album')]),
			h('a', { class: 'plain', href: __f.link('/about') }, [text('About')]),
		]);
	}
}
Nav.__pzlModule = 'app/views/Nav.pzl';

class Plain extends PuzzleView {
	render() {
		const __f = this.ctx.formatters.getAll();
		return h('nav', {}, [h('a', { href: __f.link('/about') }, [text('About')])]);
	}
}
Plain.__pzlModule = 'app/views/Plain.pzl';

const prerenderRoutes = () => [
	{ path: '/', name: 'home', view: Nav },
	// a dynamic route with no staticPaths makes no page of its own
	{ path: '/albums/:id', name: 'album', view: AlbumView },
	{ path: '/about', name: 'about', view: Plain },
	{ path: '/spa', view: Plain, prerender: false },
];
AlbumView.__pzlModule = 'app/views/Album.pzl';

const SHELL =
	'<!doctype html><html><head><title>t</title></head><body><div id="app"></div>' +
	'<script type="module" src="/app.js"></script></body></html>';

describe('hybrid prerender resolves named links (D196)', () => {
	it('emits the same href the live router renders, under routerBase', async () => {
		const { pages } = await prerender({ target: '#app', routerBase: '/docs', routes: prerenderRoutes() });
		const home = pages.find((p) => p.path === '/');
		expect(home.html).toContain('href="/docs/albums/7#top"');
		expect(home.html).toContain(`href="${new Router(prerenderRoutes(), { base: '/docs' }).url('/albums/7#top')}"`);
		// hybrid pages boot the real router, so they carry no names island
		expect(home.names).toBeUndefined();
	});

	it('an unknown name fails the build with the route error', async () => {
		class Broken extends PuzzleView {
			render() {
				const __f = this.ctx.formatters.getAll();
				return h('a', { href: __f.link({ name: 'albumz', params: { id: 1 } }) }, [text('x')]);
			}
		}
		await expect(
			prerender({ target: '#app', routes: [{ path: '/', name: 'home', view: Broken }] })
		).rejects.toThrow(/unknown route name "albumz"/);
	});
});

describe('static output resolves named links and carries the table only where needed (D196)', () => {
	it('the static router stub resolves against the names it is given', () => {
		const stub = makeRouterStub(null, { base: '/docs' });
		stub.names = routeNames(prerenderRoutes());
		expect(stub.url({ name: 'album', params: { id: 7 } })).toBe('/docs/albums/7');
		expect(stub.named).toBe(true);
		expect(stub.url('/about')).toBe('/docs/about');
		for (const bad of [5, null, true]) expect(() => stub.url(bad)).toThrow(/\[puzzle\]/);
	});

	it('a page that renders a named link carries the names island; one that does not stays unchanged', async () => {
		const { pages } = await prerender(
			{ target: '#app', routes: prerenderRoutes() },
			{ mode: 'static' }
		);
		const home = pages.find((p) => p.path === '/');
		const about = pages.find((p) => p.path === '/about');
		const spa = pages.find((p) => p.html == null);
		expect(home.html).toContain('href="/albums/7#top"');
		expect(home.names).toEqual({ home: '/', album: '/albums/:id', about: '/about' });
		// no named link, no island: byte-identical to an app that never names one
		expect(about.names).toBeUndefined();
		// a prerender:false page renders only in the browser, so it always carries the table
		expect(spa.names).toEqual(home.names);

		const html = injectStaticShell(SHELL, {
			targetId: 'app',
			content: home.html,
			head: null,
			slug: 'index',
			data: home.data ?? {},
			names: home.names,
		});
		expect(html).toContain(
			'<script type="application/json" data-puzzle-static-names>{"home":"/","album":"/albums/:id","about":"/about"}</script>'
		);
		const plain = injectStaticShell(SHELL, {
			targetId: 'app',
			content: about.html,
			head: null,
			slug: 'about',
			data: about.data ?? {},
			names: about.names ?? null,
		});
		expect(plain).not.toContain('data-puzzle-static-names');
	});

	/**
	 * drop a static page into the jsdom document the way the shell surgery does.
	 * @param {object} page a prerendered page
	 * @param {boolean} withNames whether to write its names island
	 */
	function seed(page, withNames = true) {
		const names =
			withNames && page.names
				? `<script type="application/json" data-puzzle-static-names>${JSON.stringify(page.names)}</script>`
				: '';
		document.body.innerHTML =
			`<div id="app" data-puzzle-static>${page.html}</div>` +
			`<script type="application/json" data-puzzle-static-data>${JSON.stringify(page.data)}</script>` +
			names;
		return document.querySelector('#app');
	}

	it('the static kernel re-renders the same href from the island (parity)', async () => {
		const { pages } = await prerender({ target: '#app', routes: prerenderRoutes() }, { mode: 'static' });
		const home = pages.find((p) => p.path === '/');
		const el = seed(home);
		const prerendered = el.innerHTML;
		await mountStatic({ target: '#app', views: [Nav], route: home.route });
		await tick();
		expect(el.innerHTML).toBe(prerendered);
		expect(el.querySelector('a.named').getAttribute('href')).toBe('/albums/7#top');
	});

	it('without the island, the kernel names what is missing', async () => {
		const { pages } = await prerender({ target: '#app', routes: prerenderRoutes() }, { mode: 'static' });
		const home = pages.find((p) => p.path === '/');
		seed(home, false);
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		await mountStatic({ target: '#app', views: [Nav], route: home.route }).catch((e) => error(e));
		const messages = error.mock.calls.flat().map(String).join('\n');
		expect(messages).toMatch(/this static page has no route names to resolve a named link/);
	});
});
