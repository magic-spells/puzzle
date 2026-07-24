// @vitest-environment jsdom
//
// Shared route-tree walk (client-runtime/router/routeTree.js) + drift guard.
//
// The Router compiles its matcher table and the SSG prerenderer enumerates its
// pages from the SAME walkRouteTree, so the nested-tree → per-leaf rules live in
// one place. This file locks that in from two sides:
//   1. Unit tests for the pure walk + joinPath (index-child composition,
//      trailing-slash join, deep nesting, DFS order, per-node onNode).
//   2. A drift guard on a rich nested fixture (layouts, index children, params,
//      multiple depths, catch-all): the SSG enumeration and the Router's compiled
//      route table must agree on the exact set of leaf fullPaths.
import { describe, it, expect, afterEach } from 'vitest';
import { walkRouteTree, joinPath } from '../client-runtime/router/routeTree.js';
import { enumerateRoutes } from '../client-runtime/ssg/index.js';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

// --- helpers ---------------------------------------------------------------

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (v) => new ViewNode('text', { value: v });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Run the shared walk over a routes array, collecting one { chain, fullPaths } per leaf. */
function walkAll(routes) {
	const out = [];
	const makeLeaf = (chain, fullPaths) => ({ chain, fullPaths });
	for (const r of routes) walkRouteTree(r, out, makeLeaf);
	return out;
}

/** The leaf fullPath strings the shared walk produces, in declaration order. */
function walkFullPaths(routes) {
	return walkAll(routes).map(({ fullPaths }) => fullPaths[fullPaths.length - 1]);
}

// ---------------------------------------------------------------------------
describe('routeTree — joinPath', () => {
	it('an index child ("") composes to exactly the parent path', () => {
		expect(joinPath('/', '')).toBe('/');
		expect(joinPath('/settings', '')).toBe('/settings');
		expect(joinPath('/a/b/c', '')).toBe('/a/b/c');
	});

	it('a named child joins with a single "/", trimming the parent trailing slash', () => {
		expect(joinPath('/', 'a')).toBe('/a');
		expect(joinPath('/settings', 'x')).toBe('/settings/x');
		expect(joinPath('/settings/', 'x')).toBe('/settings/x'); // trailing slash trimmed
	});
});

describe('routeTree — walkRouteTree', () => {
	it('a flat route with no children is itself the single leaf', () => {
		const leaf = { path: '/about' };
		const leaves = walkAll([leaf]);
		expect(leaves).toHaveLength(1);
		expect(leaves[0].chain).toEqual([leaf]);
		expect(leaves[0].fullPaths).toEqual(['/about']);
	});

	it('an index child re-composes the parent exact path; a named child appends', () => {
		const index = { path: '' };
		const named = { path: 'profile' };
		const parent = { path: '/settings', children: [index, named] };
		const leaves = walkAll([parent]);
		expect(leaves.map((l) => l.fullPaths.at(-1))).toEqual(['/settings', '/settings/profile']);
		// chain is root→leaf; index-child leaf's chain is [parent, index]
		expect(leaves[0].chain).toEqual([parent, index]);
		expect(leaves[0].fullPaths).toEqual(['/settings', '/settings']);
		expect(leaves[1].fullPaths).toEqual(['/settings', '/settings/profile']);
	});

	it('accumulates fullPaths at every level through deep nesting', () => {
		const leafC = { path: 'c' };
		const b = { path: 'b', children: [leafC] };
		const a = { path: '/a', children: [b] };
		const [leaf] = walkAll([a]);
		expect(leaf.chain).toEqual([a, b, leafC]);
		expect(leaf.fullPaths).toEqual(['/a', '/a/b', '/a/b/c']);
	});

	it('emits leaves depth-first in declaration order', () => {
		const routes = [
			{ path: '/x', children: [{ path: '' }, { path: 'k' }] },
			{ path: '/y' },
		];
		expect(walkFullPaths(routes)).toEqual(['/x', '/x/k', '/y']);
	});

	it('an empty children array makes the node itself a leaf', () => {
		const node = { path: '/lonely', children: [] };
		expect(walkFullPaths([node])).toEqual(['/lonely']);
	});

	it('is validation-free — the Router, not the shared walk, rejects a bad config', () => {
		// A child path with a leading '/' is a config error. The shared walk neither
		// knows nor cares — it just composes; the Router's makeEntry is where it throws.
		const bad = { path: '/app', children: [{ path: '/oops' }] };
		expect(() => walkFullPaths([bad])).not.toThrow();
		expect(() => new Router([bad], { mode: 'memory' })).toThrow(
			/child route path must be relative/
		);
	});
});

// ---------------------------------------------------------------------------
// Drift guard: SSG enumeration ⟷ Router compiled table.

// Trivial view/layout classes so the memory Router can actually mount each chain.
class Layout extends PuzzleView {
	render() {
		return h('div', { class: 'layout' }, [slot()]);
	}
}
const shell = (name) =>
	class extends PuzzleView {
		render() {
			return h('div', { class: name }, [slot()]);
		}
	};
const leafView = (name) =>
	class extends PuzzleView {
		render() {
			return h('div', { class: name }, [text(name)]);
		}
	};

// route defs kept as named references so we can assert the Router matched the
// EXACT def object the enumeration produced.
const Home = { path: '', view: leafView('home') };
const About = { path: 'about', view: leafView('about') };
const Profile = { path: 'profile', view: leafView('profile') };
const Security = { path: 'security', view: leafView('security') };
const Settings = { path: 'settings', view: shell('settings'), children: [Profile, Security] };
const RootIndex = { path: '/', view: shell('root'), layout: Layout, children: [Home, About, Settings] };

const DocsIndex = { path: '', view: leafView('docs-index') };
const DocPage = { path: ':slug', view: leafView('doc-page') };
const DeepPage = { path: ':page', view: leafView('deep-page') };
const Section = { path: ':section', view: shell('section'), children: [DeepPage] };
const Docs = { path: '/docs', view: shell('docs'), children: [DocsIndex, DocPage, Section] };

const NotFound = { path: '*', view: leafView('not-found') };

const FIXTURE = [RootIndex, Docs, NotFound];

const EXPECTED_FULLPATHS = [
	'/',
	'/about',
	'/settings/profile',
	'/settings/security',
	'/docs',
	'/docs/:slug',
	'/docs/:section/:page',
	'*',
];

let routers = [];
async function boot(routes) {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const router = new Router(routes, { mode: 'memory' });
	routers.push(router);
	await router.start(el, { store: null, router, formatters: null });
	return router;
}
afterEach(() => {
	for (const r of routers) r.stop?.();
	routers = [];
});

describe('routeTree drift guard — SSG enumeration ⟷ Router table', () => {
	it('the shared walk and the SSG enumeration produce the identical leaf fullPath list', () => {
		const ssgPaths = enumerateRoutes(FIXTURE).map((e) => e.fullPath);
		expect(ssgPaths).toEqual(EXPECTED_FULLPATHS);
		// SSG enumerateRoutes must not diverge from the raw shared walk.
		expect(ssgPaths).toEqual(walkFullPaths(FIXTURE));
	});

	it('the SSG enumeration carries the inherited top-level layout', () => {
		const byPath = Object.fromEntries(enumerateRoutes(FIXTURE).map((e) => [e.fullPath, e]));
		expect(byPath['/'].layout).toBe(Layout);
		expect(byPath['/settings/profile'].layout).toBe(Layout); // inherited from the '/' root
		expect(byPath['/docs'].layout).toBe(null); // the /docs root declares none
		expect(byPath['*'].layout).toBe(null);
	});

	it('the Router matches every enumerated leaf to the exact same route def', async () => {
		const router = await boot(FIXTURE);
		for (const entry of enumerateRoutes(FIXTURE)) {
			// '*' is matched via the catch-all (an unknown URL); params get a concrete token.
			const navPath =
				entry.fullPath === '*' ? '/no-such-route-xyz' : entry.fullPath.replace(/:[^/]+/g, 'x');
			await router.push(navPath);
			await tick();
			const leafDef = entry.chain[entry.chain.length - 1];
			expect(router.current.route).toBe(leafDef);
		}
	});

	it('a parent WITH children but NO index child does not match its bare path (falls to catch-all)', async () => {
		const router = await boot(FIXTURE);
		await router.push('/settings');
		await tick();
		expect(router.current.route).toBe(NotFound); // '/settings' is not a leaf
	});
});
