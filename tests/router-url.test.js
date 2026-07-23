// @vitest-environment jsdom
//
// Router.url(path) + the router-bound built-in `link` formatter (v1.46, D79).
//
// url() is the render-time inverse of the click interceptor: a path-shaped route
// in, a mode-encoded href out. It reads only #mode/#base (both set in the
// constructor), so the unit tests below construct Router instances directly with
// { mode, base } options and never start() them — no listeners attach, so no
// teardown is needed. The `link` formatter is registered by PuzzleApp during
// mount (after the router is built), so those tests mount a real app the same way
// tests/app.test.js does.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}

describe('Router.url() — argument guard (D79)', () => {
	it('throws a [puzzle]-tagged error on a non-string argument', () => {
		const r = new Router([], { mode: 'history' });
		for (const bad of [5, null, undefined, {}, [], true, () => {}]) {
			expect(() => r.url(bad)).toThrow(/\[puzzle\]/);
		}
	});
});

describe('Router.url() — non-path strings pass through unchanged (D79)', () => {
	// Any string NOT starting with '/' is the deliberate external/anchor
	// pass-through — identical in every mode.
	const passthroughs = [
		'https://example.com/x',
		'mailto:a@b.com',
		'#anchor',
		'#/x',
		'',
	];

	for (const mode of ['history', 'hash', 'memory']) {
		it(`returns non-'/' strings unchanged in ${mode} mode`, () => {
			const r = new Router([], { mode });
			for (const s of passthroughs) {
				expect(r.url(s)).toBe(s);
			}
		});
	}
});

describe('Router.url() — memory mode (D79)', () => {
	it('returns the path unchanged (no URL carrier)', () => {
		const r = new Router([], { mode: 'memory' });
		expect(r.url('/a')).toBe('/a');
		expect(r.url('/a/b')).toBe('/a/b');
		expect(r.url('/')).toBe('/');
	});
});

describe('Router.url() — history mode (D79)', () => {
	it('no base → path unchanged', () => {
		const r = new Router([], { mode: 'history' });
		expect(r.url('/a/b')).toBe('/a/b');
		expect(r.url('/')).toBe('/');
	});

	it("base '/app' → base-prefixed path", () => {
		const r = new Router([], { mode: 'history', base: '/app' });
		expect(r.url('/a')).toBe('/app/a');
		expect(r.url('/')).toBe('/app/');
	});
});

describe('Router.url() — hash mode (D79)', () => {
	it('no base → path carried in the fragment', () => {
		const r = new Router([], { mode: 'hash' });
		expect(r.url('/a')).toBe('#/a');
		expect(r.url('/a?x=1')).toBe('#/a?x=1');
		expect(r.url('/docs#faq')).toBe('#/docs#faq');
		expect(r.url('/')).toBe('#/');
	});

	it("base '/app' → base rides ahead of the whole fragment", () => {
		const r = new Router([], { mode: 'hash', base: '/app' });
		expect(r.url('/a')).toBe('#/app/a');
	});
});

// --------------------------------------------------------------------------
// Built-in `link` formatter (registered by PuzzleApp during mount, after the
// router is constructed, unless the app config already supplies its own).
// --------------------------------------------------------------------------

const container = (id = 'app') => {
	const el = document.createElement('div');
	el.id = id;
	document.body.appendChild(el);
	return el;
};

let apps = [];
function make(config) {
	const app = new PuzzleApp(config);
	apps.push(app);
	return app;
}

const routes = [{ path: '/', name: 'home', view: HomeView }];

describe('built-in `link` formatter (D79)', () => {
	beforeEach(() => {
		history.replaceState({}, '', '/');
		document.title = '';
		document.body.innerHTML = '';
	});

	afterEach(() => {
		apps.forEach((a) => a.unmount());
		apps = [];
	});

	it('is registered on a mounted app', async () => {
		container();
		const app = make({ target: '#app', routes });
		await app.mount();
		expect(typeof app.formatters.getAll().link).toBe('function');
	});

	it('history-mode app (default): link(\'/x\') → \'/x\'', async () => {
		container();
		const app = make({ target: '#app', routes });
		await app.mount();
		expect(app.formatters.getAll().link('/x')).toBe('/x');
	});

	it("hash-mode app: link('/x') → '#/x'", async () => {
		container();
		const app = make({ target: '#app', routes, routerMode: 'hash' });
		await app.mount();
		expect(app.formatters.getAll().link('/x')).toBe('#/x');
	});

	it('link(null) and link(undefined) → empty string', async () => {
		container();
		const app = make({ target: '#app', routes });
		await app.mount();
		const link = app.formatters.getAll().link;
		expect(link(null)).toBe('');
		expect(link(undefined)).toBe('');
	});

	it("link(5) → '5' (coerced; does not start with '/', passes through)", async () => {
		container();
		const app = make({ target: '#app', routes });
		await app.mount();
		expect(app.formatters.getAll().link(5)).toBe('5');
	});

	it('non-\'/\' strings pass through unchanged', async () => {
		container();
		const app = make({ target: '#app', routes });
		await app.mount();
		expect(app.formatters.getAll().link('https://example.com')).toBe('https://example.com');
	});

	it('a user-supplied `link` in config.formatters WINS (built-in must not overwrite it)', async () => {
		container();
		const app = make({
			target: '#app',
			routes,
			formatters: { link: (v) => 'custom:' + v },
		});
		await app.mount();
		expect(app.formatters.getAll().link('/x')).toBe('custom:/x');
	});
});
