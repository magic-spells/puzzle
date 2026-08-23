// @vitest-environment jsdom
//
// Router focus management + route announcement (v1.56, D93): after a committed
// client-side navigation the router moves focus into the new content and
// announces the committed document.title in a framework-owned polite live region.
// Both happen inside #commitState, immediately AFTER the D33/D41 scroll landing,
// so scroll stays deterministic — which is why focus() must always carry
// { preventScroll: true }.
//
// jsdom caveats (asserted honestly, never vacuously):
// - jsdom's focus() ignores its options argument, so `preventScroll` cannot be
//   verified by observing scroll. It IS verified by spying on
//   HTMLElement.prototype.focus and asserting the argument the router passes —
//   which is exactly the regression (silently dropping the option) worth catching.
// - jsdom does no layout, so "visually hidden" is asserted structurally (the
//   clip-rect inline styles, and the absence of display:none/visibility:hidden
//   which would drop the node out of the accessibility tree) rather than by
//   measuring a rendered box.
// - Screen-reader announcement is unobservable; the assertion is that the region
//   exists with the right ARIA attributes and receives the committed title.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { memoryRouter } from '../client-runtime/router/modes.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const tick = () => new Promise((r) => setTimeout(r, 0));

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};
const ctx = () => ({ store: null, router: null, formatters: null });

const liveRegion = () => document.querySelector('[data-puzzle-live-region]');

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}
class AboutView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'about' }, [h('h1', { id: 'about-h1' }, [text('ABOUT')])]);
	}
}
class UserView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'user' }, [text('USER')]);
	}
}
class SearchView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'search' }, [
			h('input', { class: 'search-input', type: 'search' }),
		]);
	}
}

const ROUTES = [
	{ path: '/', name: 'home', view: HomeView, meta: { title: 'Home Page' } },
	{ path: '/about', name: 'about', view: AboutView, meta: { title: 'About Page' } },
	{ path: '/user/:id', name: 'user', view: UserView, meta: { title: 'User Page' } },
	{ path: '/search', name: 'search', view: SearchView, meta: { title: 'Search Page' } },
];

let routers = [];
let scrollToSpy;

async function boot(routes = ROUTES, options) {
	const el = container();
	const router = new Router(routes, options);
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.body.innerHTML = '';
	document.title = '';
	// jsdom has no real scrolling; stub it so the D33 landing is a silent no-op
	// (and so the ordering test below can observe when it ran).
	scrollToSpy = vi.fn();
	Object.defineProperty(window, 'scrollTo', {
		configurable: true,
		writable: true,
		value: scrollToSpy,
	});
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	vi.restoreAllMocks();
});

describe('Router focus — the committed leaf root (D93)', () => {
	it('focuses the committed leaf view root after a push', async () => {
		const { router, el } = await boot();
		await router.push('/about');

		const leaf = el.querySelector('puzzle-view.about');
		expect(leaf).toBeTruthy();
		expect(document.activeElement).toBe(leaf);
	});

	it('passes { preventScroll: true } to focus() — the scroll-restoration guard', async () => {
		// The load-bearing assertion: without preventScroll the browser scrolls the
		// element into view and fights the window.scrollTo #commitState just ran
		// (D33 restore / D41 anchor landings). jsdom ignores the option, so the only
		// honest check is the argument the router hands to focus().
		const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
		const { router } = await boot();
		await router.push('/about');

		expect(focusSpy).toHaveBeenCalledTimes(1);
		expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
	});

	it('focus runs AFTER the scroll landing, so the scroll position is final', async () => {
		// The same regression from the other side: window.scrollTo must already have
		// run by the time focus() is called.
		const order = [];
		scrollToSpy.mockImplementation(() => order.push('scroll'));
		vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => order.push('focus'));

		const { router } = await boot();
		await router.push('/about');

		expect(order).toEqual(['scroll', 'focus']);
	});

	it('params-only push still moves focus to the reused leaf root', async () => {
		const { router, el } = await boot();
		await router.push('/user/1');
		const user = el.querySelector('puzzle-view.user');
		user.blur();
		expect(document.activeElement).toBe(document.body);

		await router.push('/user/2');
		expect(document.activeElement).toBe(user); // same reused instance + element
	});

	it('query-only replace keeps an input focused and writes nothing new to the live region', async () => {
		const { router, el } = await boot();
		await router.push('/search');
		const input = el.querySelector('.search-input');
		input.focus();
		const announcement = liveRegion().textContent;
		let writes = 0;
		const observer = new MutationObserver((records) => {
			writes += records.length;
		});
		observer.observe(liveRegion(), { childList: true, characterData: true, subtree: true });

		await router.replace('/search?q=spell');
		await tick();
		observer.disconnect();

		expect(document.activeElement).toBe(input);
		expect(liveRegion().textContent).toBe(announcement);
		expect(writes).toBe(0);
	});
});

describe('Router focus — tabindex hygiene (D93)', () => {
	it('stamps tabindex="-1" before focusing', async () => {
		const { router, el } = await boot();
		await router.push('/about');

		const leaf = el.querySelector('puzzle-view.about');
		expect(leaf.getAttribute('tabindex')).toBe('-1');
		expect(document.activeElement).toBe(leaf);
	});

	it('removes the attribute on blur — no permanent tab stop, no debris', async () => {
		const { router, el } = await boot();
		await router.push('/about');
		const leaf = el.querySelector('puzzle-view.about');
		expect(leaf.getAttribute('tabindex')).toBe('-1');

		leaf.blur();
		await tick();
		expect(leaf.hasAttribute('tabindex')).toBe(false);
	});

	it('removes the attribute when focus moves on to another element (a Tab press)', async () => {
		const { router, el } = await boot();
		const sibling = document.createElement('button');
		document.body.appendChild(sibling);
		await router.push('/about');
		const leaf = el.querySelector('puzzle-view.about');
		expect(leaf.getAttribute('tabindex')).toBe('-1');

		sibling.focus();
		await tick();
		expect(document.activeElement).toBe(sibling);
		expect(leaf.hasAttribute('tabindex')).toBe(false);
	});

	it('suppresses both focus-ring channels while the stamp is live (D139)', async () => {
		// A keyboard-driven navigation makes :focus-visible match the freshly
		// focused root, so without this the UA draws its outline around the ENTIRE
		// view — and Tailwind's focus:ring-* utilities draw the same noise via
		// box-shadow. Inline + !important so no app stylesheet wins.
		const { router, el } = await boot();
		await router.push('/about');

		const leaf = el.querySelector('puzzle-view.about');
		expect(leaf.style.getPropertyValue('outline')).toBe('none');
		expect(leaf.style.getPropertyPriority('outline')).toBe('important');
		expect(leaf.style.getPropertyValue('box-shadow')).toBe('none');
		expect(leaf.style.getPropertyPriority('box-shadow')).toBe('important');
	});

	it('removes the ring suppression on the same blur that lifts the tabindex', async () => {
		const { router, el } = await boot();
		await router.push('/about');
		const leaf = el.querySelector('puzzle-view.about');

		leaf.blur();
		await tick();
		expect(leaf.hasAttribute('tabindex')).toBe(false);
		expect(leaf.style.getPropertyValue('outline')).toBe('');
		expect(leaf.style.getPropertyValue('box-shadow')).toBe('');
	});

	it('puts a pre-existing inline outline/box-shadow back exactly as found', async () => {
		class StyledView extends PuzzleView {
			render() {
				return h(
					'puzzle-view',
					{ class: 'styled', style: 'outline: 2px dashed red; box-shadow: 0 0 4px blue;' },
					[text('S')]
				);
			}
		}
		const { router, el } = await boot([
			...ROUTES,
			{ path: '/styled', name: 'styled', view: StyledView },
		]);
		await router.push('/styled');

		const leaf = el.querySelector('puzzle-view.styled');
		expect(leaf.style.getPropertyValue('outline')).toBe('none'); // suppressed while focused
		leaf.blur();
		await tick();
		expect(leaf.style.getPropertyValue('outline')).toBe('2px dashed red');
		expect(leaf.style.getPropertyValue('box-shadow')).toBe('0 0 4px blue');
		expect(leaf.style.getPropertyPriority('outline')).toBe('');
	});

	it('leaves an author-set tabindex completely alone', async () => {
		class TabbableView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'tabbable', tabindex: '0' }, [text('T')]);
			}
		}
		const { router, el } = await boot([
			...ROUTES,
			{ path: '/tabbable', name: 'tabbable', view: TabbableView },
		]);
		await router.push('/tabbable');

		const leaf = el.querySelector('puzzle-view.tabbable');
		expect(document.activeElement).toBe(leaf);
		expect(leaf.getAttribute('tabindex')).toBe('0');
		// The author chose this element's focus semantics — including its visuals:
		// no ring suppression either (D139).
		expect(leaf.style.getPropertyValue('outline')).toBe('');
		expect(leaf.style.getPropertyValue('box-shadow')).toBe('');
		leaf.blur();
		await tick();
		expect(leaf.getAttribute('tabindex')).toBe('0'); // never stripped
	});
});

describe('Router focus — route announcement (D93)', () => {
	it('creates one visually-hidden polite live region in start()', async () => {
		await boot();
		const region = liveRegion();

		expect(region).toBeTruthy();
		expect(region.tagName).toBe('DIV');
		expect(region.getAttribute('aria-live')).toBe('polite');
		expect(region.getAttribute('aria-atomic')).toBe('true');
		expect(region.parentNode).toBe(document.body);
		expect(document.querySelectorAll('[data-puzzle-live-region]')).toHaveLength(1);
		// Visually hidden by the clip-rect pattern — and crucially NOT display:none /
		// visibility:hidden, which remove the node from the accessibility tree and
		// would silence every announcement.
		expect(region.style.position).toBe('absolute');
		expect(region.style.width).toBe('1px');
		expect(region.style.height).toBe('1px');
		expect(region.style.overflow).toBe('hidden');
		// Serialization is engine-specific (jsdom normalizes to `rect(0px, 0px, …)`),
		// so assert the property PARSED rather than a byte-exact string — the point
		// is that the clip actually took, which the space-separated CSS3 form does
		// not do in stricter parsers.
		expect(region.style.clip).toMatch(/^rect\(/);
		expect(region.style.clipPath).toBe('inset(50%)');
		expect(region.style.display).not.toBe('none');
		expect(region.style.visibility).not.toBe('hidden');
	});

	it('announces the freshly committed document.title on each navigation', async () => {
		const { router } = await boot();
		// Nav #0 announces nothing — the browser owns first paint.
		expect(document.title).toBe('Home Page');
		expect(liveRegion().textContent).toBe('');

		await router.push('/about');
		expect(document.title).toBe('About Page');
		expect(liveRegion().textContent).toBe('About Page');

		await router.push('/user/7');
		expect(liveRegion().textContent).toBe('User Page');
	});

	it('reads document.title rather than re-deriving it from route meta', async () => {
		// A route with NO meta.title deliberately leaves the previous tab title in
		// place (D84); the announcement must say what the document actually says.
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView, meta: { title: 'Home Page' } },
			{ path: '/plain', name: 'plain', view: AboutView },
		]);
		await router.push('/plain');
		expect(document.title).toBe('Home Page');
		expect(liveRegion().textContent).toBe('Home Page');
	});

	it('falls back to route identity when the title did not move (no per-route titles)', async () => {
		// The default app: one static <title> from the shipped HTML and no meta.title
		// anywhere. Re-writing that unchanged string into the region is SILENT —
		// aria-live announces on change only — so D93 announced nothing at all after
		// the first navigation. Every consecutive navigation must change the region.
		document.title = 'My App';
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/about', name: 'about', view: AboutView },
			{ path: '/user/:id', name: 'user', view: UserView },
		]);

		const seen = [];
		await router.push('/about');
		seen.push(liveRegion().textContent);
		await router.push('/user/7');
		seen.push(liveRegion().textContent);
		// Params-only navigation: same route NAME both times, so the name alone would
		// leave the region unchanged — the path identifies this one.
		await router.push('/user/8');
		seen.push(liveRegion().textContent);

		expect(document.title).toBe('My App'); // never touched (D84)
		expect(seen).toEqual(['about', 'user', '/user/8']);
		expect(new Set(seen).size).toBe(3); // three navigations, three real changes
	});

	it('announces the NEW route, not the title the route it left behind set', async () => {
		// Mixed app: /about carries a title, /plain does not — so document.title still
		// says "About Page" when /plain commits. Announcing that would name the page
		// the user just left.
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView, meta: { title: 'Home Page' } },
			{ path: '/about', name: 'about', view: AboutView, meta: { title: 'About Page' } },
			{ path: '/plain', name: 'plain', view: UserView },
		]);

		await router.push('/about');
		expect(liveRegion().textContent).toBe('About Page');

		await router.push('/plain');
		expect(document.title).toBe('About Page'); // the tab title deliberately stands
		expect(liveRegion().textContent).not.toBe('About Page');
		expect(liveRegion().textContent).toBe('plain');
	});

	it('a title that DID move still wins over the fallback', async () => {
		// The fallback is a last resort: whenever the route resolved a title of its
		// own, that is what gets announced (the D93 posture, unchanged).
		const { router } = await boot();
		await router.push('/about');
		expect(liveRegion().textContent).toBe('About Page');
		await router.push('/user/7');
		expect(liveRegion().textContent).toBe('User Page');
		await router.push('/');
		expect(liveRegion().textContent).toBe('Home Page');
	});

	it('removes the live region in stop() — idempotently', async () => {
		const { router } = await boot();
		expect(liveRegion()).toBeTruthy();
		router.stop();
		expect(liveRegion()).toBeNull();
		router.stop();
		expect(liveRegion()).toBeNull();
	});
});

describe('Router focus — skip cases (D93)', () => {
	it('does not move focus on navigation #0', async () => {
		const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
		const { el } = await boot();

		expect(focusSpy).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(document.body);
		expect(el.querySelector('puzzle-view.home').hasAttribute('tabindex')).toBe(false);
	});

	it('DOES move focus on pop (back/forward)', async () => {
		const { router, el } = await boot();
		const homeState = history.state;

		await router.push('/about');
		expect(document.activeElement).toBe(el.querySelector('puzzle-view.about'));

		// Simulate back the way the rest of the router suite does: the browser moves
		// URL + state, then fires popstate.
		history.replaceState(homeState, '', '/');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(router.current.route.name).toBe('home');
		expect(document.activeElement).toBe(el.querySelector('puzzle-view.home'));
		expect(liveRegion().textContent).toBe('Home Page');
	});

	it('moves focus on replace() too', async () => {
		const { router, el } = await boot();
		await router.replace('/about');
		expect(document.activeElement).toBe(el.querySelector('puzzle-view.about'));
	});

	it('memory mode is a complete no-op — no focus, no live region', async () => {
		const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
		const { router } = await boot(ROUTES, { mode: memoryRouter() });
		expect(liveRegion()).toBeNull();

		await router.push('/about');
		expect(focusSpy).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(document.body);
		expect(liveRegion()).toBeNull();
	});

	it('a failed navigation moves neither focus nor the announcement', async () => {
		class BadView extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			render() {
				return h('puzzle-view', {}, []);
			}
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { router } = await boot([...ROUTES, { path: '/bad', name: 'bad', view: BadView }]);
		await router.push('/bad');

		expect(document.activeElement).toBe(document.body);
		expect(liveRegion().textContent).toBe('');
		errSpy.mockRestore();
	});
});

describe('Router focus — focusBehavior: false (D93)', () => {
	it('disables everything, including the live region', async () => {
		const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
		const { router, el } = await boot(ROUTES, { focusBehavior: false });

		expect(liveRegion()).toBeNull();
		await router.push('/about');

		expect(focusSpy).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(document.body);
		expect(el.querySelector('puzzle-view.about').hasAttribute('tabindex')).toBe(false);
		expect(liveRegion()).toBeNull();
	});
});

describe('Router focus — custom focusBehavior (D93)', () => {
	it('focuses the element the function returns, with both route snapshots in hand', async () => {
		const calls = [];
		const { router, el } = await boot(ROUTES, {
			focusBehavior: (to, from) => {
				calls.push([to.path, from ? from.path : null]);
				return document.getElementById('about-h1');
			},
		});
		await router.push('/about');

		const h1 = el.querySelector('#about-h1');
		expect(calls).toEqual([['/about', '/']]);
		expect(document.activeElement).toBe(h1);
		// The default target (the leaf root) is untouched when a custom function wins.
		expect(el.querySelector('puzzle-view.about').hasAttribute('tabindex')).toBe(false);
	});

	it('runs after mount, so it can query the freshly committed DOM', async () => {
		// The returned node only exists because the incoming chain is already in the
		// document when focusBehavior runs — resolving pre-commit would find nothing.
		let seen = null;
		const { router } = await boot(ROUTES, {
			focusBehavior: () => {
				seen = document.querySelector('puzzle-view.about');
				return seen;
			},
		});
		await router.push('/about');
		expect(seen).toBeTruthy();
		expect(document.activeElement).toBe(seen);
	});

	it('a falsy return skips focusing but still announces', async () => {
		const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
		const { router } = await boot(ROUTES, { focusBehavior: () => null });
		await router.push('/about');

		expect(focusSpy).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(document.body);
		expect(liveRegion().textContent).toBe('About Page');
	});

	it('a non-focusable return is ignored rather than crashing the commit', async () => {
		const { router } = await boot(ROUTES, { focusBehavior: () => ({ not: 'an element' }) });
		await expect(router.push('/about')).resolves.not.toThrow();
		expect(router.current.route.name).toBe('about');
		expect(document.activeElement).toBe(document.body);
	});

	it('a throwing function is logged and treated as falsy — the nav still commits', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { router } = await boot(ROUTES, {
			focusBehavior: () => {
				throw new Error('nope');
			},
		});
		await router.push('/about');

		expect(errSpy).toHaveBeenCalledWith('[puzzle] focusBehavior failed:', expect.any(Error));
		expect(document.activeElement).toBe(document.body);
		expect(router.current.route.name).toBe('about'); // navigation unaffected
		expect(liveRegion().textContent).toBe('About Page');
	});
});

describe('Router focus — elementless leaf (D93)', () => {
	it('walks up the chain when the leaf view has no element', async () => {
		// A parent whose template has NO <Slot/>: its routed child is preloaded but
		// never mounted, so child.element is null (the hole warnMissingSlots reports).
		// Focus must land on the nearest ancestor with a live root instead of
		// throwing on the null element.
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		class SlotlessShell extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'shell' }, [text('SHELL')]);
			}
		}
		class ChildView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'child' }, [text('CHILD')]);
			}
		}
		const { router, el } = await boot([
			...ROUTES,
			{
				path: '/shell',
				name: 'shell',
				view: SlotlessShell,
				children: [{ path: 'child', name: 'child', view: ChildView }],
			},
		]);

		await expect(router.push('/shell/child')).resolves.not.toThrow();
		expect(el.querySelector('puzzle-view.child')).toBeNull(); // never mounted
		expect(document.activeElement).toBe(el.querySelector('puzzle-view.shell'));
		warnSpy.mockRestore();
	});
});
