// @vitest-environment jsdom
//
// Literal route patterns + failure-safe param decode (router bug-fix pass).
// Static path text with regex metacharacters ('.', '+', '(', '[', …) must match
// LITERALLY — makeEntry compiles one '/'-segment at a time, escaping every
// non-param segment — and a malformed percent-encoded param ('/%zz' → URIError)
// must make that route a NON-MATCH (falling through to the catch-all) instead of
// throwing out of the whole navigation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});

describe('Router — literal static route patterns (regex metacharacters escaped)', () => {
	const routes = () => [
		{ path: '/docs.v1', name: 'docs', view: Docs },
		{ path: '/files+new', name: 'files', view: Files },
		{ path: '/report(2024)', name: 'report', view: Report },
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
