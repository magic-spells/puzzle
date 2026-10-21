// @vitest-environment jsdom
//
// router.views and the top-level `agent` route field (D183). `views` is the
// route table as frozen data — one entry per leaf in declaration order, the
// catch-all left out — built once on first read from the compiled entries.
// `agent` resolves nearest-defined leaf→root (`false` on a parent hides the
// subtree, a child's own object re-exposes it); Puzzle never acts on it, and
// the dev checks validate the values, warn on duplicate names, and — once any
// route declares `agent` — list the leaves that resolve to nothing.
//
// The warnings are once-per-message for the module (the SSG pass builds several
// routers), so each test uses its own paths.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { lazy } from '../client-runtime/router/lazy.js';
import { memoryRouter } from '../client-runtime/router/modes.js';
import { prerender } from '../client-runtime/ssg/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import {
	SLOT_TAG,
	ViewNode,
} from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) =>
	new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const view = (name) =>
	class extends PuzzleView {
		render() {
			return h('p', { class: name }, [text(name)]);
		}
	};
class Shell extends PuzzleView {
	render() {
		return h('div', { class: 'shell' }, [new ViewNode(SLOT_TAG)]);
	}
}
const Page = view('page');

const router = (routes, options) =>
	new Router(routes, { mode: memoryRouter(), ...options });

afterEach(() => {
	vi.restoreAllMocks();
});

describe('router.views — entries', () => {
	it('lists one entry per leaf with path, params, name, meta, title, agent and chain', () => {
		const meta = { title: 'Task', custom: 1 };
		const routes = [
			{ path: '/', name: 'home', view: Page },
			{
				path: '/:workspace',
				name: 'workspace',
				view: Shell,
				layout: Shell,
				children: [
					{ path: 'tasks/:taskId', name: 'task', view: Page, meta },
				],
			},
			{ path: '*', name: 'not-found', view: Page },
		];
		const views = router(routes).views;
		expect(views.map((v) => v.path)).toEqual([
			'/',
			'/:workspace/tasks/:taskId',
		]);
		const task = views[1];
		expect(task).toEqual({
			path: '/:workspace/tasks/:taskId',
			params: ['workspace', 'taskId'],
			name: 'task',
			meta,
			title: 'Task',
			agent: undefined,
			chain: [routes[1], routes[1].children[0]],
		});
		// meta is the leaf's own object, as defined; chain holds the definitions.
		expect(task.meta).toBe(meta);
		expect(task.chain[0]).toBe(routes[1]);
		expect(views[0].meta).toBeUndefined();
	});

	it('leaves the catch-all out', () => {
		const views = router([
			{ path: '*', name: 'nf', view: Page },
			{ path: '/a', view: Page },
		]).views;
		expect(views.map((v) => v.path)).toEqual(['/a']);
		expect(router([{ path: '*', view: Page }]).views).toEqual([]);
	});

	it('is frozen and built once per router', () => {
		const routes = [{ path: '/a/:id', view: Page }];
		const r = router(routes);
		const views = r.views;
		expect(r.views).toBe(views);
		expect(Object.isFrozen(views)).toBe(true);
		expect(Object.isFrozen(views[0])).toBe(true);
		expect(Object.isFrozen(views[0].params)).toBe(true);
		expect(Object.isFrozen(views[0].chain)).toBe(true);
		// The frozen copies leave the router's own entries and the route defs alone.
		expect(Object.isFrozen(r.routeEntries[0].paramNames)).toBe(false);
		expect(Object.isFrozen(routes[0])).toBe(false);
		expect(router(routes).views).not.toBe(views);
	});

	it('resolves title leaf→root: inherited, null-suppressed, and { t }', () => {
		const views = router([
			{
				path: '/docs',
				view: Shell,
				meta: { title: 'Docs' },
				children: [
					{ path: '', view: Page },
					{ path: 'quiet', view: Page, meta: { title: null } },
					{
						path: 'intl',
						view: Page,
						meta: { title: { t: 'docs.intl' } },
					},
					{
						path: 'own',
						view: Page,
						meta: { title: 'Own', other: true },
					},
				],
			},
			{ path: '/bare', view: Page },
		]).views;
		const byPath = Object.fromEntries(
			views.map((v) => [v.path, v.title])
		);
		expect(byPath).toEqual({
			'/docs': 'Docs',
			'/docs/quiet': undefined,
			'/docs/intl': { t: 'docs.intl' },
			'/docs/own': 'Own',
			'/bare': undefined,
		});
	});

	it('lists nested layouts and lazy routes like any other leaf', () => {
		const lazyPage = lazy(async () => Page);
		const lazyLayout = lazy(async () => Shell);
		const views = router([
			{
				path: '/app',
				view: Shell,
				layout: lazyLayout,
				children: [
					{
						path: 'settings',
						view: Shell,
						children: [{ path: 'profile', view: lazyPage }],
					},
				],
			},
			{ path: '/lazy', view: lazyPage },
		]).views;
		expect(views.map((v) => v.path)).toEqual([
			'/app/settings/profile',
			'/lazy',
		]);
		expect(views[0].chain.map((n) => n.path)).toEqual([
			'/app',
			'settings',
			'profile',
		]);
		expect(views[0].chain[2].view).toBe(lazyPage);
		expect(views[1].chain[0].view).toBe(lazyPage);
	});

	it('keeps paths locale-free under locale prefix routing (D177)', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = new Router(
			[
				{ path: '/', view: Page },
				{ path: '/about', view: Page, agent: { name: 'about' } },
				{ path: '/user/:id', view: Page, agent: false },
			],
			{ locale: 'es', defaultLocale: 'en', locales: ['en', 'es'] }
		);
		expect(r.views.map((v) => v.path)).toEqual([
			'/',
			'/about',
			'/user/:id',
		]);
	});
});

describe('agent route field — resolution', () => {
	it('resolves nearest-defined leaf→root: a hidden parent hides its subtree, a child re-exposes itself', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const views = router([
			{
				path: '/admin',
				view: Shell,
				agent: false,
				children: [
					{ path: '', view: Page },
					{ path: 'users', view: Page },
					{
						path: 'help',
						view: Page,
						agent: { name: 'admin-help', about: 'How to use admin' },
					},
				],
			},
			{
				path: '/inbox',
				view: Shell,
				agent: { name: 'inbox', about: 'Your messages' },
				children: [
					{ path: 'archive', view: Page, agent: { name: 'archive' } },
					{ path: 'spam', view: Page, agent: false },
				],
			},
		]).views;
		const byPath = Object.fromEntries(
			views.map((v) => [v.path, v.agent])
		);
		expect(byPath).toEqual({
			'/admin': false,
			'/admin/users': false,
			'/admin/help': {
				name: 'admin-help',
				about: 'How to use admin',
			},
			'/inbox/archive': { name: 'archive' },
			'/inbox/spam': false,
		});
		// Consumers filter; the field changes nothing about navigation.
		expect(
			views.filter((v) => v.agent).map((v) => v.agent.name)
		).toEqual(['admin-help', 'archive']);
	});

	it('does not block navigation to a hidden route', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = new Router(
			[
				{ path: '/', view: Page },
				{ path: '/secret', view: Page, agent: false },
			],
			{
				mode: memoryRouter(),
			}
		);
		const el = document.createElement('div');
		await r.start(el, { store: null, router: r, formatters: null });
		const result = await r.push('/secret');
		expect(result.ok).toBe(true);
		expect(r.current.path).toBe('/secret');
		r.stop();
	});
});

describe('agent route field — dev checks', () => {
	it('throws on an invalid agent value, on any node, catch-all included', () => {
		const bad = [
			true,
			null,
			'x',
			{},
			{ name: 1 },
			{ name: 'x', about: 2 },
		];
		for (const agent of bad) {
			expect(() =>
				router([{ path: '/bad', view: Page, agent }])
			).toThrow(
				/\[puzzle\] agent on route "\/bad" must be false or \{ name: string, about\?: string \}/
			);
		}
		expect(() =>
			router([
				{
					path: '/p',
					view: Shell,
					children: [{ path: 'c', view: Page, agent: 'yes' }],
				},
			])
		).toThrow(
			'agent on route "c" must be false or { name: string, about?: string } (got string)'
		);
		expect(() =>
			router([{ path: '*', view: Page, agent: { about: 'x' } }])
		).toThrow(
			'agent on route "*" must be false or { name: string, about?: string } (got an object without a string name)'
		);
	});

	it('accepts false and { name } with or without about', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(() =>
			router([
				{ path: '/v1', view: Page, agent: false },
				{ path: '/v2', view: Page, agent: { name: 'v2' } },
				{
					path: '/v3',
					view: Page,
					agent: { name: 'v3', about: 'Three' },
				},
			])
		).not.toThrow();
	});

	it('warns once about a duplicate resolved name', () => {
		const warn = vi
			.spyOn(console, 'warn')
			.mockImplementation(() => {});
		const routes = [
			{
				path: '/dup',
				view: Shell,
				agent: { name: 'dup' },
				children: [
					{ path: 'a', view: Page },
					{ path: 'b', view: Page },
				],
			},
		];
		router(routes);
		router(routes);
		const dupes = warn.mock.calls.filter(([m]) =>
			m.includes('agent name')
		);
		expect(dupes).toEqual([
			[
				'[puzzle] agent name "dup" is used by both "/dup/a" and "/dup/b"',
			],
		]);
	});

	it('once any route declares agent, warns once listing the leaves that resolve to nothing', () => {
		const warn = vi
			.spyOn(console, 'warn')
			.mockImplementation(() => {});
		const routes = [
			{ path: '/listed', view: Page, agent: { name: 'listed' } },
			{ path: '/hidden', view: Page, agent: false },
			{ path: '/silent-a', view: Page },
			{
				path: '/group',
				view: Shell,
				children: [{ path: 'silent-b/:id', view: Page }],
			},
			{ path: '*', view: Page },
		];
		router(routes);
		router(routes);
		expect(warn.mock.calls).toEqual([
			[
				'[puzzle] these routes have no agent field (set agent: { name, about } or agent: false): ' +
					'"/silent-a", "/group/silent-b/:id"',
			],
		]);
	});

	it('stays silent when no route uses agent', () => {
		const warn = vi
			.spyOn(console, 'warn')
			.mockImplementation(() => {});
		const r = router([
			{ path: '/quiet-a', view: Page, name: 'a' },
			{
				path: '/quiet-b',
				view: Shell,
				children: [{ path: 'c', view: Page }],
			},
			{ path: '*', view: Page },
		]);
		expect(r.views).toHaveLength(2);
		expect(warn).not.toHaveBeenCalled();
	});
});

describe('agent route field — prerender', () => {
	it('prerenders hidden and described routes like any other', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { pages } = await prerender({
			target: '#app',
			routes: [
				{
					path: '/',
					view: view('home'),
					agent: { name: 'home', about: 'Start' },
					meta: { title: 'Home' },
				},
				{
					path: '/private',
					view: Shell,
					agent: false,
					children: [{ path: '', view: view('private') }],
				},
			],
		});
		const byPath = Object.fromEntries(
			pages.map((p) => [p.path, p.html])
		);
		expect(byPath).toEqual({
			'/': '<p class="home">home</p>',
			'/private':
				'<div class="shell"><p class="private">private</p></div>',
		});
	});
});
