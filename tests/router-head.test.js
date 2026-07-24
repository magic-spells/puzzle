// @vitest-environment jsdom
//
// Route head management, BROWSER half (D84, v1.50 — constellation/doc/DOC-SPEC.md §45,
// amended by the D89 follow-up): the router's #syncHead runs inside
// #commitLocation and does exactly ONE thing — assign document.title at the
// atomic commit point (D61: a failed/superseded navigation never touches it).
// Memory mode performs NO document work at all (D42).
//
// The managed og:/twitter:/description/canonical tags are emitted EXCLUSIVELY at
// build time by the SSG injector (covered by ssg-head.test.js). The runtime never
// creates, updates, or removes them in any output mode: crawlers fetch each URL
// fresh from the server and never client-navigate, so they always read the tags
// baked into that page's HTML. These tests pin the negative — the router must
// leave `[data-puzzle-head]` strictly alone, including tags a prerendered page
// arrived with. Title semantics stay pre-D84-compatible: only a non-null resolved
// title assigns document.title.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { MANAGED_TAGS } from '../client-runtime/headTags.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const ctx = () => ({ store: null, router: null, formatters: null });

const headTag = (id) => document.head.querySelector(`[data-puzzle-head="${id}"]`);
const headTags = (id) => document.head.querySelectorAll(`[data-puzzle-head="${id}"]`);
/** Every framework-managed tag currently in the document head. */
const allHeadTags = () => document.head.querySelectorAll('[data-puzzle-head]');

class DefaultLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
	}
}
class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}
class AboutView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'about' }, [text('ABOUT')]);
	}
}
class DocsShell extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'docs' }, [slot()]);
	}
}
class IntroView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'intro' }, [text('INTRO')]);
	}
}

const HOME_META = {
	title: 'Home Page',
	description: 'The home page',
	canonical: 'https://example.com/',
	socialImage: 'https://example.com/og.png',
};

// Track live routers so listeners never leak into the next test.
let routers = [];
async function boot(routes, options) {
	const el = container();
	const router = options ? new Router(routes, options) : new Router(routes);
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.title = '';
	// Marker tags persist on the jsdom document across tests — clear them so every
	// test starts from an unmanaged head.
	document.head.querySelectorAll('[data-puzzle-head]').forEach((el) => el.remove());
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	vi.restoreAllMocks();
});

describe('Router head sync (D84) — title at the commit point, and nothing else', () => {
	it('sets document.title on the initial navigation and derives NO managed tags', async () => {
		await boot([{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META }]);

		expect(document.title).toBe('Home Page');
		// A route resolving ALL FOUR reserved fields still produces zero DOM tags:
		// the og:/twitter:/description/canonical set is a build-time product only.
		expect(allHeadTags()).toHaveLength(0);
		for (const spec of MANAGED_TAGS) {
			expect(headTag(spec.id)).toBeNull();
		}
	});

	it('navigation updates document.title; no tag is created for fields the target resolves', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META },
			{
				path: '/about',
				name: 'about',
				view: AboutView,
				layout: DefaultLayout,
				meta: { title: 'About Us', description: 'About page' },
			},
		];
		const { router } = await boot(routes);
		expect(document.title).toBe('Home Page');
		expect(allHeadTags()).toHaveLength(0);

		await router.push('/about');
		expect(document.title).toBe('About Us');
		expect(allHeadTags()).toHaveLength(0);
	});

	it('resolves title leaf→root through a nested chain (per-field walk, no DOM tags)', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META },
			{
				path: '/docs',
				name: 'docs',
				view: DocsShell,
				layout: DefaultLayout,
				meta: { title: 'Docs', description: 'Docs desc', socialImage: '/docs.png' },
				children: [
					// index child defines no meta — inherits the parent's title
					{ path: '', name: 'docs-index', view: IntroView },
					{ path: 'intro', name: 'intro', view: IntroView, meta: { title: 'Intro', description: null } },
				],
			},
		];
		const { router } = await boot(routes);

		await router.push('/docs');
		expect(document.title).toBe('Docs');

		await router.push('/docs/intro');
		expect(document.title).toBe('Intro');
		// The full per-field resolution (including `description: null` suppression)
		// is head.js resolveHead's contract and is covered by ssg-head.test.js —
		// only the title reaches the DOM from here.
		expect(allHeadTags()).toHaveLength(0);
	});

	it('an explicit title:null leaves document.title alone (pre-D84 posture)', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META },
			{ path: '/bare', name: 'bare', view: AboutView, layout: DefaultLayout, meta: { title: null } },
		];
		const { router } = await boot(routes);
		expect(document.title).toBe('Home Page');

		await router.push('/bare');
		// The tab title is NOT cleared (a blank tab would be worse than a stale one,
		// and pre-D84 an unresolved title also left document.title untouched).
		expect(document.title).toBe('Home Page');
		expect(allHeadTags()).toHaveLength(0);
	});

	it('a title-only app syncs the tab title without touching document.head', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Solo' } },
		];
		await boot(routes);

		expect(document.title).toBe('Solo');
		// og:title/twitter:title ARE derived from meta.title — but by the SSG, into
		// the served HTML. Nothing derives them here.
		expect(headTags('og:title')).toHaveLength(0);
		expect(headTags('twitter:title')).toHaveLength(0);
	});

	it('a failed navigation (rejecting data()) leaves the title untouched (D61 atomicity)', async () => {
		class BadView extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			render() {
				return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META },
			{
				path: '/bad',
				name: 'bad',
				view: BadView,
				layout: DefaultLayout,
				meta: { title: 'Bad', description: 'never lands', canonical: 'https://bad.dev/' },
			},
		];
		const { router } = await boot(routes);
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await router.push('/bad');

		expect(errSpy).toHaveBeenCalled();
		// the losing navigation never reached #commitLocation
		expect(document.title).toBe('Home Page');
		expect(allHeadTags()).toHaveLength(0);
	});

	it('leaves unmanaged head elements alone', async () => {
		const foreign = document.createElement('meta');
		foreign.setAttribute('name', 'description');
		foreign.setAttribute('content', 'hand-authored, unmarked');
		document.head.appendChild(foreign);

		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout, meta: { title: 'About' } },
		]);
		await router.push('/about');

		// the unmarked description meta was never adopted, updated, or removed
		expect(foreign.isConnected).toBe(true);
		expect(foreign.getAttribute('content')).toBe('hand-authored, unmarked');
		foreign.remove();
	});
});

describe('Router head sync (D84) — memory mode performs no document work (D42)', () => {
	it('never touches document.title or document.head, even with full meta', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, meta: HOME_META },
			{ path: '/about', name: 'about', view: AboutView, meta: { title: 'About', description: 'x' } },
		];
		const { router } = await boot(routes, { mode: 'memory' });

		expect(document.title).toBe('');
		expect(allHeadTags()).toHaveLength(0);

		await router.push('/about');
		expect(document.title).toBe('');
		expect(allHeadTags()).toHaveLength(0);
	});
});

describe('Router head sync (D84) — hybrid takeover leaves prerendered tags intact', () => {
	/** Seed document.head the way the SSG injector leaves a prerendered page. */
	function seedSsgHead() {
		document.head.insertAdjacentHTML(
			'beforeend',
			'<meta property="og:title" content="Home Page" data-puzzle-head="og:title">' +
				'<meta name="twitter:title" content="Home Page" data-puzzle-head="twitter:title">' +
				'<meta name="description" content="The home page" data-puzzle-head="description">' +
				'<meta property="og:description" content="The home page" data-puzzle-head="og:description">' +
				'<meta name="twitter:description" content="The home page" data-puzzle-head="twitter:description">' +
				// a field the app's routes do NOT resolve — the runtime still must not
				// touch it; the served HTML for THIS url is what a crawler reads
				'<link rel="canonical" href="https://prerendered.dev/" data-puzzle-head="canonical">'
		);
	}

	/** A container pre-seeded like the SSG prerender step leaves it. */
	function ssgContainer(inner) {
		const el = document.createElement('div');
		el.id = 'app';
		el.setAttribute('data-puzzle-ssg', '');
		el.innerHTML = inner;
		document.body.appendChild(el);
		return el;
	}

	it('takeover and later navigations never rewrite, remove, or duplicate SSG marker tags', async () => {
		seedSsgHead();
		const seeded = [...allHeadTags()];
		const before = seeded.map((el) => el.outerHTML);

		const el = ssgContainer('<puzzle-view class="home">HOME</puzzle-view>');
		const routes = [
			{
				path: '/',
				name: 'home',
				view: HomeView,
				meta: { title: 'Home Page', description: 'The home page' },
			},
			{ path: '/about', name: 'about', view: AboutView, meta: { title: 'About Us', description: 'About' } },
		];
		const router = new Router(routes);
		routers.push(router);
		await router.start(el, ctx());

		// navigation #0 left the prerendered head byte-identical…
		expect([...allHeadTags()]).toEqual(seeded);
		expect([...allHeadTags()].map((n) => n.outerHTML)).toEqual(before);
		// …including the canonical this app's routes do not resolve
		expect(headTag('canonical')?.getAttribute('href')).toBe('https://prerendered.dev/');

		// A later client navigation moves the TAB TITLE only. The prerendered tags
		// intentionally keep describing the entry page: a crawler asking for /about
		// gets /about's own prerendered HTML and never sees this document.
		await router.push('/about');
		expect(document.title).toBe('About Us');
		expect([...allHeadTags()].map((n) => n.outerHTML)).toEqual(before);
		expect(headTags('og:title')).toHaveLength(1);
		expect(headTag('og:title')?.getAttribute('content')).toBe('Home Page');

		await router.push('/');
		expect([...allHeadTags()].map((n) => n.outerHTML)).toEqual(before);
	});
});
