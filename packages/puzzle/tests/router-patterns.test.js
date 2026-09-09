// @vitest-environment jsdom
//
// Literal route patterns + failure-safe param decode (router bug-fix pass).
// Static path text with regex metacharacters ('.', '+', '(', '[', …) must match
// LITERALLY — makeEntry compiles one '/'-segment at a time, escaping every
// non-param segment — and a malformed percent-encoded param ('/%zz' → URIError)
// must make that route a NON-MATCH (falling through to the catch-all) instead of
// throwing out of the whole navigation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const ctx = () => ({ store: null, router: null, formatters: null });

// Views rendering a labelled root so the matched entry is observable in the DOM.
const view = (label) =>
	class extends PuzzleView {
		render() {
			return h('puzzle-view', { class: label }, [text(label)]);
		}
	};

const Docs = view('docs');
const Files = view('files');
const Report = view('report');
const Release = view('release');
const LiteralStar = view('literal-star');
const User = view('user');
const NotFound = view('notfound');

let routers = [];
async function boot(routes) {
	const el = container();
	const router = new Router(routes);
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	vi.restoreAllMocks();
});

describe('Router — literal static route patterns (regex metacharacters escaped)', () => {
	const routes = () => [
		{ path: '/docs.v1', name: 'docs', view: Docs },
		{ path: '/files+new', name: 'files', view: Files },
		{ path: '/report(2024)', name: 'report', view: Report },
		{ path: '/releases/v1:beta', name: 'release', view: Release },
		{ path: '/files/*', name: 'literal-star', view: LiteralStar },
		{ path: '*', name: 'nf', view: NotFound },
	];

	it("matches '/docs.v1' literally — the '.' is not a wildcard", async () => {
		const { router, el } = await boot(routes());
		await router.push('/docs.v1');
		expect(router.current.path).toBe('/docs.v1');
		expect(el.querySelector('.docs')).not.toBeNull();
	});

	it("does NOT match '/docsXv1' against '/docs.v1' — falls through to the catch-all", async () => {
		const { router, el } = await boot(routes());
		await router.push('/docsXv1');
		expect(el.querySelector('.docs')).toBeNull();
		expect(el.querySelector('.notfound')).not.toBeNull();
	});

	it("matches '/files+new' literally — the '+' is not a quantifier", async () => {
		const { router, el } = await boot(routes());
		await router.push('/files+new');
		expect(router.current.path).toBe('/files+new');
		expect(el.querySelector('.files')).not.toBeNull();

		// '/filesnew' (the string '+' would otherwise quantify) must NOT match.
		await router.push('/filesnew');
		expect(el.querySelector('.files')).toBeNull();
		expect(el.querySelector('.notfound')).not.toBeNull();
	});

	it("matches a path containing parentheses literally — they are not a capture group", async () => {
		const { router, el } = await boot(routes());
		await router.push('/report(2024)');
		expect(router.current.path).toBe('/report(2024)');
		expect(el.querySelector('.report')).not.toBeNull();

		// '/report2024' (parens stripped) must NOT match the literal-parens route.
		await router.push('/report2024');
		expect(el.querySelector('.report')).toBeNull();
		expect(el.querySelector('.notfound')).not.toBeNull();
	});

	it("matches ':' and '*' literally when they are not a complete dynamic segment", async () => {
		const { router, el } = await boot(routes());

		await router.push('/releases/v1:beta');
		expect(el.querySelector('.release')).not.toBeNull();
		expect(router.current.params).toEqual({});

		await router.push('/files/*');
		expect(el.querySelector('.literal-star')).not.toBeNull();
		expect(router.current.params).toEqual({});
	});
});

describe('Router — a declared trailing slash is insignificant', () => {
	// #match strips one trailing slash from every incoming pathname, so a route
	// compiled verbatim from '/docs/' would have a regex nothing could reach.
	const routes = () => [
		{ path: '/docs/', name: 'docs', view: Docs },
		{ path: '*', name: 'nf', view: NotFound },
	];

	it("matches both '/docs' and '/docs/' against a route declared '/docs/'", async () => {
		const { router, el } = await boot(routes());

		await router.push('/docs');
		expect(el.querySelector('.docs')).not.toBeNull();
		expect(router.current.route.name).toBe('docs');

		await router.push('/docs/');
		expect(el.querySelector('.docs')).not.toBeNull();
		expect(router.current.route.name).toBe('docs');
	});

	it("leaves the root '/' route untouched", async () => {
		const { router, el } = await boot([
			{ path: '/', name: 'root', view: Docs },
			{ path: '*', name: 'nf', view: NotFound },
		]);

		expect(router.current.route.name).toBe('root');
		expect(el.querySelector('.docs')).not.toBeNull();
	});
});

describe('Router — declaration-order shadow warnings', () => {
	it('warns when an earlier dynamic route shadows a later static route', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		new Router([
			{ path: '/user/:id', name: 'user', view: User },
			{ path: '/user/new', name: 'new-user', view: Release },
		]);

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				'route "/user/new" is unreachable because earlier route "/user/:id" matches it first'
			)
		);
	});

	it('does not warn when the static route is declared before the dynamic route', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		new Router([
			{ path: '/user/new', name: 'new-user', view: Release },
			{ path: '/user/:id', name: 'user', view: User },
		]);

		expect(warn).not.toHaveBeenCalled();
	});
});

describe('Router — failure-safe param decode', () => {
	const routes = () => [
		{ path: '/user/:id', name: 'user', view: User },
		{ path: '*', name: 'nf', view: NotFound },
	];

	it('still decodes a valid encoded param (percent-encoded UTF-8)', async () => {
		const { router, el } = await boot(routes());
		await router.push('/user/j%C3%B8rgen');
		expect(el.querySelector('.user')).not.toBeNull();
		expect(router.current.params.id).toBe('jørgen'); // decoded
	});

	it('treats a malformed param (/user/%zz) as a non-match and falls through to the catch-all without throwing', async () => {
		const { router, el } = await boot(routes());
		await expect(router.push('/user/%zz')).resolves.not.toThrow;
		expect(el.querySelector('.user')).toBeNull(); // the :id route did not take it
		expect(el.querySelector('.notfound')).not.toBeNull(); // catch-all rendered
	});

	it('a malformed param with NO catch-all leaves the current view in place (no throw)', async () => {
		const { router, el } = await boot([{ path: '/user/:id', name: 'user', view: User }]);
		await router.push('/user/j%C3%B8rgen');
		expect(el.querySelector('.user')).not.toBeNull();

		// no route matches the malformed param and there is no catch-all — the nav is
		// a no-op (warns "no route matched"), the current view stays put, nothing throws.
		await router.push('/user/%zz');
		expect(el.querySelector('.user')).not.toBeNull();
		expect(router.current.params.id).toBe('jørgen'); // unchanged
	});
});
