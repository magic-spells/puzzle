// @vitest-environment jsdom
//
// Route head management, SPA half (D84, v1.50 — constellation/doc/DOC-SPEC.md §45):
// the router's #syncHead runs inside #commitLocation, so managed head tags +
// document.title move at the atomic commit point (D61 — a failed/superseded
// navigation touches neither), memory mode performs NO document work (D42), and
// hybrid takeover ADOPTS SSG-emitted marker tags by identity — same node updated
// in place, never duplicated. Title semantics stay pre-D84-compatible: only a
// non-null resolved title assigns document.title; explicit null suppresses the
// derived og/twitter tags but leaves the tab title alone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { MANAGED_TAGS } from '../client-runtime/head.js';

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
	// Managed tags persist on the jsdom document across tests — clear them so
	// every test starts from an unmanaged head.
	document.head.querySelectorAll('[data-puzzle-head]').forEach((el) => el.remove());
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	vi.restoreAllMocks();
});

describe('Router head sync (D84) — managed tags at the commit point', () => {
	it('creates every derived tag in <head> + sets document.title on the initial navigation', async () => {
		await boot([{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META }]);

		expect(document.title).toBe('Home Page');
		expect(headTag('og:title')?.getAttribute('content')).toBe('Home Page');
		expect(headTag('og:title')?.getAttribute('property')).toBe('og:title');
		expect(headTag('twitter:title')?.getAttribute('name')).toBe('twitter:title');
		expect(headTag('description')?.getAttribute('content')).toBe('The home page');
		expect(headTag('og:description')?.getAttribute('content')).toBe('The home page');
		expect(headTag('twitter:description')?.getAttribute('content')).toBe('The home page');
		expect(headTag('canonical')?.tagName.toLowerCase()).toBe('link');
		expect(headTag('canonical')?.getAttribute('rel')).toBe('canonical');
		expect(headTag('canonical')?.getAttribute('href')).toBe('https://example.com/');
		expect(headTag('og:url')?.getAttribute('content')).toBe('https://example.com/');
		expect(headTag('og:image')?.getAttribute('content')).toBe('https://example.com/og.png');
		expect(headTag('twitter:image')?.getAttribute('content')).toBe('https://example.com/og.png');
		expect(headTag('twitter:card')?.getAttribute('content')).toBe('summary_large_image');
		// exactly one node per identity, all in <head>
		for (const spec of MANAGED_TAGS) {
			expect(headTags(spec.id)).toHaveLength(1);
		}
	});

	it('navigation updates the managed tags + title; fields the target does not resolve are REMOVED', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META },
			{
				path: '/about',
				name: 'about',
				view: AboutView,
				layout: DefaultLayout,
				// only title + description resolve here — canonical/socialImage must not go stale
				meta: { title: 'About Us', description: 'About page' },
			},
		];
		const { router } = await boot(routes);
		expect(headTag('canonical')).not.toBeNull();

		await router.push('/about');
		expect(document.title).toBe('About Us');
		expect(headTag('og:title')?.getAttribute('content')).toBe('About Us');
		expect(headTag('description')?.getAttribute('content')).toBe('About page');
		// stale tags removed, not left pointing at the previous route
		expect(headTag('canonical')).toBeNull();
		expect(headTag('og:url')).toBeNull();
		expect(headTag('og:image')).toBeNull();
		expect(headTag('twitter:image')).toBeNull();
		expect(headTag('twitter:card')).toBeNull();
	});

	it('resolves per-field leaf→root through a nested chain; explicit null suppresses inheritance', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META },
			{
				path: '/docs',
				name: 'docs',
				view: DocsShell,
				layout: DefaultLayout,
				meta: { title: 'Docs', description: 'Docs desc', socialImage: '/docs.png' },
				children: [
					{ path: '', name: 'docs-index', view: IntroView },
					// leaf: fresh title, description SUPPRESSED, socialImage inherited
					{ path: 'intro', name: 'intro', view: IntroView, meta: { title: 'Intro', description: null } },
				],
			},
		];
		const { router } = await boot(routes);

		await router.push('/docs'); // index child inherits everything from /docs
		expect(document.title).toBe('Docs');
		expect(headTag('description')?.getAttribute('content')).toBe('Docs desc');
		expect(headTag('og:image')?.getAttribute('content')).toBe('/docs.png');

		await router.push('/docs/intro');
		expect(document.title).toBe('Intro');
		expect(headTag('og:title')?.getAttribute('content')).toBe('Intro');
		// the leaf's `description: null` beat the parent's value — tags gone
		expect(headTag('description')).toBeNull();
		expect(headTag('og:description')).toBeNull();
		expect(headTag('twitter:description')).toBeNull();
		// socialImage still inherited from /docs
		expect(headTag('og:image')?.getAttribute('content')).toBe('/docs.png');
		expect(headTag('twitter:card')?.getAttribute('content')).toBe('summary_large_image');
	});

	it('an explicit title:null removes og/twitter title tags but leaves document.title alone (pre-D84 posture)', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: HOME_META },
			{ path: '/bare', name: 'bare', view: AboutView, layout: DefaultLayout, meta: { title: null } },
		];
		const { router } = await boot(routes);
		expect(document.title).toBe('Home Page');

		await router.push('/bare');
		// suppressed: no managed title tags…
		expect(headTag('og:title')).toBeNull();
		expect(headTag('twitter:title')).toBeNull();
		// …but the tab title is NOT cleared (a blank tab would be worse than a stale one,
		// and pre-D84 an unresolved title also left document.title untouched).
		expect(document.title).toBe('Home Page');
	});

	it('title-only apps now derive og:title/twitter:title — and nothing else (intended D84 behavior)', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Solo' } },
		];
		await boot(routes);

		expect(document.title).toBe('Solo');
		expect(headTag('og:title')?.getAttribute('content')).toBe('Solo');
		expect(headTag('twitter:title')?.getAttribute('content')).toBe('Solo');
		for (const spec of MANAGED_TAGS) {
			if (spec.field === 'title') continue;
			expect(headTag(spec.id)).toBeNull();
		}
	});

	it('a failed navigation (rejecting data()) leaves the head untouched (D61 atomicity)', async () => {
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
		const homeDescription = headTag('description');

		await router.push('/bad');

		expect(errSpy).toHaveBeenCalled();
		expect(document.title).toBe('Home Page');
		// same NODE, same value — the losing navigation never reached #commitLocation
		expect(headTag('description')).toBe(homeDescription);
		expect(headTag('description')?.getAttribute('content')).toBe('The home page');
		expect(headTag('canonical')?.getAttribute('href')).toBe('https://example.com/');
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
		expect(document.head.querySelectorAll('[data-puzzle-head]')).toHaveLength(0);

		await router.push('/about');
		expect(document.title).toBe('');
		expect(document.head.querySelectorAll('[data-puzzle-head]')).toHaveLength(0);
	});
});

describe('Router head sync (D84) — hybrid takeover adoption', () => {
	/** Seed document.head the way the SSG injector leaves it (same identities/shape). */
	function seedSsgHead() {
		document.head.insertAdjacentHTML(
			'beforeend',
			'<meta property="og:title" content="Home Page" data-puzzle-head="og:title">' +
				'<meta name="twitter:title" content="Home Page" data-puzzle-head="twitter:title">' +
				'<meta name="description" content="The home page" data-puzzle-head="description">' +
				'<meta property="og:description" content="The home page" data-puzzle-head="og:description">' +
				'<meta name="twitter:description" content="The home page" data-puzzle-head="twitter:description">' +
				// a field the app's routes do NOT resolve — must be cleaned up at takeover
				'<link rel="canonical" href="https://stale.dev/" data-puzzle-head="canonical">'
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

	it('adopts SSG-emitted marker tags by identity — same nodes updated, zero duplicates, stale ones removed', async () => {
		seedSsgHead();
		const seededOgTitle = headTag('og:title');
		const seededDescription = headTag('description');

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

		// navigation #0 adopted the prerendered tags: SAME nodes, no new ones
		expect(headTag('og:title')).toBe(seededOgTitle);
		expect(headTag('description')).toBe(seededDescription);
		for (const spec of MANAGED_TAGS) {
			expect(headTags(spec.id).length).toBeLessThanOrEqual(1);
		}
		// the prerendered canonical resolves to nothing in this app — removed
		expect(headTag('canonical')).toBeNull();

		// a later SPA navigation still updates the adopted nodes in place
		await router.push('/about');
		expect(document.title).toBe('About Us');
		expect(headTag('og:title')).toBe(seededOgTitle);
		expect(headTag('og:title')?.getAttribute('content')).toBe('About Us');
		expect(headTags('og:title')).toHaveLength(1);
		expect(headTags('description')).toHaveLength(1);

		// and back again — never a duplicate, no matter how many commits
		await router.push('/');
		expect(headTag('og:title')?.getAttribute('content')).toBe('Home Page');
		for (const spec of MANAGED_TAGS) {
			expect(headTags(spec.id).length).toBeLessThanOrEqual(1);
		}
	});
});
