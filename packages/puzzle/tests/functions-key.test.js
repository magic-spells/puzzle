// @vitest-environment jsdom
// the app config's `functions` key was `formatters` before 0.10 (D199). the old
// key throws at every door a config comes in through, naming the new key and
// the codemod, so an upgrade fails loudly instead of rendering every app
// function call as an unknown-function error.
import { describe, it, expect } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { prerender } from '../client-runtime/ssg/index.js';
import { mountView, createTestApp } from '../client-runtime/testing/index.js';

// the rename hint every door shares
const HINT = /functions since 0\.10 .*puzzle check --fix/;

class Home extends PuzzleView {
	render() {
		return new ViewNode('h1', {}, [new ViewNode('text', { value: 'Home' })]);
	}
}

const routes = () => [{ path: '/', name: 'home', view: Home }];

describe('the pre-0.10 formatters key (D199)', () => {
	it('throws in the PuzzleApp constructor', () => {
		expect(() => new PuzzleApp({ target: '#app', routes: routes(), formatters: {} })).toThrow(HINT);
	});

	it('throws even when the map is empty or null — only the key matters', () => {
		expect(() => new PuzzleApp({ target: '#app', routes: routes(), formatters: null })).toThrow(HINT);
	});

	it('throws in prerender, which reads a raw config without a PuzzleApp', async () => {
		await expect(prerender({ target: '#app', routes: routes(), formatters: {} })).rejects.toThrow(HINT);
	});

	it('throws in the mountView options', async () => {
		await expect(mountView(Home, { formatters: { shout: (s) => s } })).rejects.toThrow(HINT);
	});

	it('throws in createTestApp, which builds a PuzzleApp', async () => {
		await expect(createTestApp({ routes: routes(), formatters: {} })).rejects.toThrow(HINT);
	});

	it('accepts the functions key and registers its entries', async () => {
		const el = document.createElement('div');
		el.id = 'app';
		document.body.appendChild(el);
		const app = new PuzzleApp({ target: '#app', routes: routes(), functions: { shout: (s) => s + '!' } });
		await app.mount();
		try {
			expect(app.formatters.get('shout')('hi')).toBe('hi!');
		} finally {
			app.destroy?.();
			el.remove();
		}
	});
});
