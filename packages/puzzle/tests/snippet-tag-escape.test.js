// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { ViewNode, SNIPPET_TAG } from '../client-runtime/views/ViewNode.js';
import { serialize } from '../client-runtime/ssg/serialize.js';

// D89 boundary (finding 6): the feature-usage scan reads FIRST-PARTY .pzl source
// only, so a COMPILED component package emitting `new ViewNode('#snippet', …)`
// can hand a snippet vnode to an app whose __PUZZLE_HAS_SNIPPETS__ define is
// false. Nothing consumes it there, so it reaches the live tree — where
// `document.createElement('#snippet')` used to throw a DOM InvalidCharacterError
// (and the SSG serializer used to swallow it as ''). Both paths must instead say
// what actually went wrong. The check is ungated, so it holds in every build.

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const snippet = (fits, params, fn) => new ViewNode(SNIPPET_TAG, { fits, params, fn });

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const DIAGNOSTIC = 'it is framework metadata';

afterEach(() => {
	delete globalThis.__PUZZLE_HAS_SNIPPETS__;
	delete globalThis.__PUZZLE_DEV__;
	document.body.innerHTML = '';
});

describe('a snippet vnode that reaches the DOM is diagnosed, not a DOM error', () => {
	it('throws the framework diagnostic from browser mount', () => {
		globalThis.__PUZZLE_HAS_SNIPPETS__ = false;
		const vm = new ViewManager(container(), {});
		const tree = h('div', {}, [snippet('row', ['item'], () => [text('stamp')])]);

		expect(() => vm.render(tree)).toThrow(/vnode tag "#snippet" reached the DOM/);
		expect(() => vm.render(tree)).toThrow(new RegExp(DIAGNOSTIC));
		expect(() => vm.render(tree)).toThrow(/__PUZZLE_HAS_SNIPPETS__ is false/);
	});

	it('throws the same diagnostic from the SSG serializer', async () => {
		globalThis.__PUZZLE_HAS_SNIPPETS__ = false;
		await expect(
			serialize(h('div', {}, [snippet('row', [], () => [text('stamp')])]))
		).rejects.toThrow(/vnode tag "#snippet" reached the DOM/);
	});

	it('holds with the define ON — the check is outside the gate', () => {
		const vm = new ViewManager(container(), {});
		expect(() => vm.render(h('div', {}, [snippet('row', [], () => [])]))).toThrow(
			/vnode tag "#snippet" reached the DOM/
		);
	});

	it('still throws in a production build, with the explanation compiled out', () => {
		// The THROW is ungated; only the paragraph explaining an unsupported build
		// shape is development-only, so production folds ~190 B gzip of prose out of
		// every app and keeps a line that still names the tag.
		globalThis.__PUZZLE_DEV__ = false;
		const vm = new ViewManager(container(), {});
		let thrown;
		try {
			vm.render(h('div', {}, [snippet('row', [], () => [])]));
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect(thrown.message).toBe('[puzzle] metadata tag "#snippet" reached the DOM (compiled out)');
		expect(thrown.message).not.toMatch(/__PUZZLE_HAS_SNIPPETS__/);
	});
});
