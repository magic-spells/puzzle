// @vitest-environment jsdom
//
// Compiler-output proof for default-slot forwarding (v1.38, D71): the layout +
// wrapper component under test are the Go compiler's ACTUAL output
// (tests/fixtures/slot-forwarding/*.compiled.js, produced by `npm run
// build:slot-forwarding` from the .pzl sources in the same directory) — the
// hand-written-tree suite is tests/slot-forwarding.test.js. Green here means a
// real `.pzl` layout wrapping its `<Slot/>` in a component invocation compiles
// to a working app: the routed view mounts inside the wrapper's default slot
// and no literal <slot> element ever reaches the DOM.
import { describe, it, expect, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import WrappedLayout from './fixtures/slot-forwarding/WrappedLayout.compiled.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

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

let routers = [];
afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
});

describe('default-slot forwarding — compiled layout (D71)', () => {
	it('routes through the compiled Card-wrapping layout and swaps views on navigation', async () => {
		const el = container();
		const router = new Router(
			[
				{ path: '/', name: 'home', view: HomeView, layout: WrappedLayout },
				{ path: '/about', name: 'about', view: AboutView, layout: WrappedLayout },
			],
			{ mode: 'memory' }
		);
		routers.push(router);
		await router.start(el, { store: null, router: null, formatters: { getAll: () => ({}) } });

		expect(el.querySelector('.layout .card .body .home')).not.toBeNull();
		expect(el.querySelector('slot')).toBeNull();

		await router.push('/about');
		expect(el.querySelector('.layout .card .body .about')).not.toBeNull();
		expect(el.querySelector('.layout .card .body .home')).toBeNull();
		expect(el.querySelector('slot')).toBeNull();
	});
});
