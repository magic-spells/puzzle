// @vitest-environment jsdom
//
// Click interception across a shadow boundary. Shadow DOM retargets the event,
// so `target` is the HOST and closest('a') misses the anchor — the router used
// to decline the click and the browser did a full page load. findAnchor reads
// composedPath() instead. Same jsdom conventions as router-base.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};
const ctx = () => ({ store: null, router: null, formatters: null });

class Layout extends PuzzleView {
	render() {
		return h('puzzle-view', {}, [h('main', {}, [slot()])]);
	}
}
class Home extends PuzzleView {
	render() {
		return h('puzzle-view', {}, [text('HOME')]);
	}
}
class About extends PuzzleView {
	render() {
		return h('puzzle-view', {}, [text('ABOUT')]);
	}
}

const routes = [
	{ path: '/', name: 'home', view: Home, layout: Layout },
	{ path: '/about', name: 'about', view: About, layout: Layout },
];

let routers = [];
let suppress;

async function boot() {
	history.replaceState({}, '', '/');
	const router = new Router(routes);
	routers.push(router);
	await router.start(container(), ctx());
	// AFTER start: the router bails on an already-prevented event, so the
	// jsdom-navigation suppressor must run second.
	suppress = (e) => e.preventDefault();
	document.addEventListener('click', suppress);
	return router;
}

/** A web component whose shadow root holds the real anchor. */
function hostWithShadowLink(href, { mode = 'open', attrs = {} } = {}) {
	const host = document.createElement('x-link');
	const root = host.attachShadow({ mode });
	const a = document.createElement('a');
	a.setAttribute('href', href);
	for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
	a.appendChild(document.createTextNode('go'));
	root.appendChild(a);
	document.body.appendChild(host);
	return { host, a };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An SVG <a> — a different element type from HTML's, sharing only localName. */
function svgLink(href, { attrs = {} } = {}) {
	const svg = document.createElementNS(SVG_NS, 'svg');
	const a = document.createElementNS(SVG_NS, 'a');
	a.setAttribute('href', href);
	for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
	a.appendChild(document.createElementNS(SVG_NS, 'rect'));
	svg.appendChild(a);
	return { svg, a };
}

const clickEvent = () => new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 });

beforeEach(() => {
	history.replaceState({}, '', '/');
	suppress = null;
});

afterEach(() => {
	if (suppress) document.removeEventListener('click', suppress);
	routers.forEach((r) => r.stop());
	routers = [];
});

describe('Router — links inside shadow DOM', () => {
	it('intercepts an anchor in an open shadow root', async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');
		const { a } = hostWithShadowLink('/about');

		const evt = clickEvent();
		a.dispatchEvent(evt);

		// Proof the retarget really happened — otherwise the test passes for the
		// wrong reason and would not have caught the original bug.
		expect(evt.target.tagName).toBe('X-LINK');
		expect(evt.target.closest('a')).toBeNull();

		expect(evt.defaultPrevented).toBe(true);
		expect(push).toHaveBeenCalledWith('/about');
	});

	it('leaves an anchor in a closed shadow root to the browser', async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');
		const { host } = hostWithShadowLink('/about', { mode: 'closed' });

		// A closed root is absent from composedPath, so the click is not ours.
		host.dispatchEvent(clickEvent());
		expect(push).not.toHaveBeenCalled();
	});

	it('still intercepts a plain light-DOM anchor', async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');
		const a = document.createElement('a');
		a.setAttribute('href', '/about');
		document.body.appendChild(a);

		const evt = clickEvent();
		a.dispatchEvent(evt);

		expect(evt.defaultPrevented).toBe(true);
		expect(push).toHaveBeenCalledWith('/about');
	});

	it('applies the usual guards to a shadow anchor', async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');

		// Finding the anchor must not widen what counts as in-app.
		hostWithShadowLink('/about', { attrs: { target: '_blank' } }).a.dispatchEvent(clickEvent());
		hostWithShadowLink('/about', { attrs: { target: '_top' } }).a.dispatchEvent(clickEvent());
		hostWithShadowLink('https://example.com/x').a.dispatchEvent(clickEvent());
		hostWithShadowLink('mailto:a@b.c').a.dispatchEvent(clickEvent());

		expect(push).not.toHaveBeenCalled();
	});

	it("intercepts target='_self' (the default, spelled out by component libraries)", async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');

		const evt = clickEvent();
		hostWithShadowLink('/about', { attrs: { target: '_self' } }).a.dispatchEvent(evt);

		expect(evt.defaultPrevented).toBe(true);
		expect(push).toHaveBeenCalledWith('/about');
	});

	// An SVG <a> is a different element type: its nodeName is lowercase 'a' and
	// its .href is an SVGAnimatedString, not a string. Matching on nodeName 'A'
	// missed it; reading .href produced a dead intercepted click on a garbage URL.
	it('intercepts an SVG anchor in the light DOM', async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');
		const { svg, a } = svgLink('/about');
		document.body.appendChild(svg);

		const evt = clickEvent();
		a.dispatchEvent(evt);

		expect(evt.defaultPrevented).toBe(true);
		expect(push).toHaveBeenCalledWith('/about');
	});

	it('intercepts an SVG anchor inside an open shadow root', async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');
		const host = document.createElement('x-icon-link');
		const root = host.attachShadow({ mode: 'open' });
		const { svg, a } = svgLink('/about');
		root.appendChild(svg);
		document.body.appendChild(host);

		const evt = clickEvent();
		a.dispatchEvent(evt);

		// Retargeted to the host, so only composedPath can find this anchor.
		expect(evt.target.tagName).toBe('X-ICON-LINK');
		expect(evt.defaultPrevented).toBe(true);
		expect(push).toHaveBeenCalledWith('/about');
	});

	it('applies the usual guards to an SVG anchor', async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');

		for (const link of [
			svgLink('/about', { attrs: { target: '_blank' } }),
			svgLink('/about', { attrs: { download: '' } }),
			svgLink('https://example.com/x'),
			svgLink('mailto:a@b.c'),
		]) {
			document.body.appendChild(link.svg);
			link.a.dispatchEvent(clickEvent());
		}

		expect(push).not.toHaveBeenCalled();
	});

	it('resolves an SVG anchor href against the document base', async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');
		const { svg, a } = svgLink('about'); // relative, no leading slash
		document.body.appendChild(svg);
		history.replaceState({}, '', '/');

		a.dispatchEvent(clickEvent());

		expect(push).toHaveBeenCalledWith('/about');
	});

	it('takes the innermost anchor when one nests inside another', async () => {
		const router = await boot();
		const push = vi.spyOn(router, 'push');

		const outer = document.createElement('a');
		outer.setAttribute('href', '/');
		document.body.appendChild(outer);
		const { a } = hostWithShadowLink('/about');
		outer.appendChild(a.getRootNode().host);

		a.dispatchEvent(clickEvent());

		// composedPath runs innermost-outward; closest() would have found '/'.
		expect(push).toHaveBeenCalledWith('/about');
	});
});
